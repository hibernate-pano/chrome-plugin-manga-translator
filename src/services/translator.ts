/**
 * Translator Service
 *
 * Core translation service that orchestrates:
 * - Image processing（图像压缩 + base64 + hash）
 * - Provider API calls（通过 background script 代理，解决 CORS）
 * - Cache management（hash-based 缓存）
 * - Error handling（retry + 用户友好的错误信息）
 *
 * Requirements: 2.2, 2.3, 2.4
 */

import {
  type ProviderType,
  type TextArea,
  providerRequiresApiKey,
} from '@/providers';
import {
  deriveRequestedPath,
  type JobPriorityClass,
} from '@/shared/runtime-contracts';
import {
  useTranslationCacheStore,
  type TranslationResult,
} from '@/stores/cache-v2';
import { useContentConfigStore } from '@/stores/content-config';
import { useUsageStore } from '@/stores/usage-store';
import {
  processImage,
  cropRegions,
  combineCroppedRegions,
  base64ToDataUrl,
  type ImageProcessingOptions,
  type CombinedRegionSegment,
  DEFAULT_OPTIONS,
} from '@/services/image-processor';
import {
  detectTextRegions,
  mergeOverlappingRegions,
  type TextRegion,
} from '@/services/text-detector';
import {
  createReadingEntryId,
  type ImageReadingResult,
  type ReadingEntry,
} from '@/services/reading-result';
import {
  getDefaultTranslationTransport,
  type TranslationTransport,
} from '@/services/translation-transport';
import { retryWithBackoff } from '@/utils/error-handler';
import { getErrorMessage } from '@/utils/error-message';
import type { TranslationStylePreset } from '@/utils/translation-style';
import { processInParallel, splitIntoBatches } from '@/utils/image-priority';

// ==================== Logging Utilities ====================

const isDevelopment = import.meta.env.DEV;

function _log(message: string, ...args: unknown[]): void {
  if (isDevelopment) {
    console.log(`[Translator] ${message}`, ...args);
  }
}

function _logError(message: string, ...args: unknown[]): void {
  if (isDevelopment) {
    console.error(`[Translator] ${message}`, ...args);
  }
}

// ==================== Type Definitions ====================

interface TranslatorConfig {
  /** Provider type to use */
  provider: ProviderType;
  /**
   * API key for cloud providers.
   *
   * Trusted contexts only. The content script never has a key: it works from
   * the redacted snapshot, where `hasApiKey` says whether a key exists
   * without revealing it.
   */
  apiKey?: string;
  /**
   * Whether the provider has an API key configured.
   *
   * This is what the content script knows: enough to tell the user "fill in
   * your API key", not enough to call the provider.
   */
  hasApiKey?: boolean;
  /** Base URL for API */
  baseUrl?: string;
  /** Model name */
  model?: string;
  /** Target language for translation */
  targetLanguage: string;
  /** Whether to use cache */
  cacheEnabled: boolean;
  /** Prompt style preset */
  translationStylePreset: TranslationStylePreset;
  /** Image processing options */
  imageOptions?: ImageProcessingOptions;
  /** Transport implementation */
  transport?: TranslationTransport;
}

/**
 * Outcome of the tiled pipeline.
 *
 * `allowFullImageFallback` distinguishes the two ways a tiled run can fail:
 * - every tile failed → the full-image path is the last resort and is
 *   allowed to run.
 * - only some tiles failed → the full-image path must NOT run. A long strip
 *   is downscaled to 1024px in that path (an 800x8000 strip becomes 102px
 *   wide), so the extra request buys an unreadable thumbnail on top of the
 *   money it costs. Reporting the failure instead keeps the image
 *   unprocessed, so the user can retry exactly the images that failed.
 */
interface TiledTranslationOutcome extends TranslationResult {
  allowFullImageFallback: boolean;
}

interface TransportTextAreasResponse {
  textAreas: TextArea[];
  cached?: boolean;
  pipeline?: 'ocr-first' | 'region-fallback' | 'full-image-fallback';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const HYBRID_PIPELINE_VERSION = 'hybrid-v1';
const MAX_REASONABLE_REGION_COUNT = 80;
const MAX_ALLOWED_MISSING_RATIO = 0.4;

// ==================== Tiled (sliding-window) pipeline constants ====================

/**
 * Long webtoon strips are translated as a stack of overlapping tiles.
 * Each tile is a crisp, near-1:1 slice of the original image instead of the
 * whole strip downscaled to a thumbnail — small text stays legible and the
 * VLM output never approaches the token ceiling.
 */
const TILED_PIPELINE_VERSION = 'tiled-v1';
/** Min image height (px) to treat as a long strip and tile. */
const TILING_MIN_HEIGHT = 2200;
/** Min aspect ratio (h/w) to treat as a long strip. */
const TILING_MIN_ASPECT = 2.2;
/** Nominal tile height in ORIGINAL image pixels. */
const TILE_HEIGHT = 1152;
/** Vertical overlap between adjacent tiles (text split across the seam). */
const TILE_OVERLAP = 96;
/** Keep tiles inside this many original pixels so text stays legible. */
const TILE_MAX_DIMENSION = 1600;

interface TileSpec {
  top: number;
  height: number;
}

/**
 * Split a tall strip into overlapping tiles.
 * Returns a single full-height tile for short images (no-op).
 */
/** @internal exported for tests */
export function computeTiles(
  imageWidth: number,
  imageHeight: number
): TileSpec[] {
  if (
    imageHeight < TILING_MIN_HEIGHT ||
    imageHeight / Math.max(1, imageWidth) < TILING_MIN_ASPECT
  ) {
    return [{ top: 0, height: imageHeight }];
  }

  const tiles: TileSpec[] = [];
  let top = 0;
  while (top < imageHeight) {
    const height = Math.min(TILE_HEIGHT, imageHeight - top);
    // Shrink the last tile if it would leave a sliver < 1/3 tile height;
    // extend the previous tile instead (overlap handles the seam).
    if (top > 0 && imageHeight - top < TILE_HEIGHT * 0.4) {
      const prev = tiles[tiles.length - 1];
      if (prev) {
        prev.height = imageHeight - prev.top;
      }
      break;
    }
    tiles.push({ top, height });
    if (top + height >= imageHeight) {
      break;
    }
    top = top + height - TILE_OVERLAP;
  }
  return tiles;
}

/**
 * Deduplicate areas that straddle a tile seam (VLM re-detects text in the
 * overlap). Keep the area whose center is higher (upper tile wins) but only
 * when two boxes genuinely overlap across a horizontally compatible band.
 *
 * Why the overlap test is RELATIVE to the box height:
 *
 * The old test compared the vertical overlap against a fixed 0.03 of the
 * image height. That number is only meaningful for a page-sized image. On a
 * 8000px-tall webtoon strip, 0.03 of the image is 240px, while a speech
 * bubble is ~40px tall (0.005 of the image). Two copies of the same bubble
 * detected in two adjacent tiles overlap by far less than 240px, so they
 * were judged "not duplicates" and the same sentence got rendered twice.
 *
 * A duplicate of the same bubble must overlap by roughly a full bubble
 * height, so the test is: the vertical overlap covers at least half of the
 * SHORTER of the two boxes, AND the two boxes share a horizontal band.
 * A pair of genuinely distinct bubbles stacked in the same column overlaps
 * by much less than half of either box, so it is kept.
 */
/** @internal exported for tests */
export function filterOverlapDuplicates(areas: TextArea[]): TextArea[] {
  const kept: TextArea[] = [];
  const toleranceX = 0.06; // center-x must be near
  const overlapRatio = 0.5; // overlap must cover half of the shorter box
  // Guard against binary floating point deciding a boundary case: an overlap
  // of exactly half the shorter box IS a duplicate, but 0.04 comes out as
  // 0.03999999999999998 when computed from fractional coordinates.
  const ratioEpsilon = 1e-9;

  for (const area of areas) {
    const duplicated = kept.some(other => {
      const areaHeight = area.height ?? 0;
      const otherHeight = other.height ?? 0;
      const ay0 = area.y,
        ay1 = area.y + areaHeight;
      const by0 = other.y,
        by1 = other.y + otherHeight;
      const overlapHeight = Math.min(ay1, by1) - Math.max(ay0, by0);
      if (overlapHeight <= 0) return false;

      // Scale the comparison to the box, not to the image: a duplicate of
      // the same bubble overlaps by (almost) a whole bubble height.
      const minHeight = Math.min(areaHeight, otherHeight);
      if (minHeight <= 0) return false;
      if (overlapHeight / minHeight < overlapRatio - ratioEpsilon) {
        return false;
      }

      const cxA = area.x + (area.width ?? 0) / 2;
      const cxB = other.x + (other.width ?? 0) / 2;
      return Math.abs(cxA - cxB) < toleranceX;
    });
    if (!duplicated) {
      kept.push(area);
    }
  }
  return kept;
}

// ==================== Cache Key Normalization ====================

/**
 * Normalize a base URL so that cosmetic differences do not fragment the
 * cache, while genuinely different endpoints do.
 *
 * `https://API.Example.com/v1/` and `https://api.example.com/v1` are the
 * same endpoint and must share a cache entry; `https://api.example.com/v1`
 * and `https://api.example.com/v2` (or a different host entirely) must not.
 */
export function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? '').trim();
  if (!trimmed) {
    return 'default';
  }

  try {
    const url = new URL(trimmed);
    const host = url.host.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol.toLowerCase()}//${host}${port}${path}`;
  } catch {
    // Not a parseable URL — fall back to a case-insensitive, slash-trimmed
    // comparison so a typo'd base URL still gets a stable key.
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

// ==================== Translator Service Class ====================

/**
 * Translator Service
 *
 * Manages the translation workflow for manga images.
 *
 * 架构说明：
 * - 图像处理（压缩/base64）在 content script 中完成
 * - AI API 调用通过 background script 代理，解决 CORS 问题
 * - 缓存通过 image hash 实现，避免重复调用
 */
export class TranslatorService {
  private config: TranslatorConfig;
  private transport: TranslationTransport;
  private abortController: AbortController | null = null;
  private isInitialized = false;

  constructor(config: TranslatorConfig) {
    this.config = config;
    this.transport = config.transport ?? getDefaultTranslationTransport();
  }

  /**
   * Initialize the translator with the configured provider
   * 注意：background 代理模式下，provider 仅用于 validateConfig
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.warn(
      `[Translator] 初始化 Provider: ${this.config.provider}, Model: ${this.config.model || 'default'}`
    );

    // 验证配置：确保 API Key 已设置
    //
    // The content script never holds the key itself — it only knows whether
    // one is configured — so the check accepts either form.
    if (providerRequiresApiKey(this.config.provider) && !this.hasCredential()) {
      throw new Error(
        `${this.config.provider} 需要配置 API Key。请前往设置页面填写。`
      );
    }

    this.isInitialized = true;
    if (isDevelopment) {
      _log(`Provider 配置验证完成: ${this.config.provider}`);
    }
  }

  /**
   * Is a credential available for this provider?
   *
   * A trusted caller can hand over the key itself; the content script only
   * knows whether one is configured. Both answer the same question.
   */
  private hasCredential(): boolean {
    return Boolean(this.config.apiKey) || this.config.hasApiKey === true;
  }

  /**
   * Translate a single image
   *
   * 翻译流程：
   * 1. 图像处理（压缩 + base64 + hash）
   * 2. 检查缓存（hash 命中则跳过 API 调用）
   * 3. 通过 background script 代理调用 AI API（解决 CORS）
   * 4. 写入缓存
   *
   * @param image Image element to translate
   * @returns Translation result
   */
  async translateImage(
    image: HTMLImageElement,
    forceRefresh: boolean = false,
    imageKeyOverride?: string
  ): Promise<TranslationResult> {
    if (isDevelopment) {
      _log('开始翻译图片');
    }

    try {
      // 步骤1：处理图片（压缩 + base64 + hash + possible viewport crop）
      if (isDevelopment) {
        _log('处理图片...');
      }

      const processOptions: ImageProcessingOptions = {
        maxSize: DEFAULT_OPTIONS.maxSize,
        quality: DEFAULT_OPTIONS.quality,
        viewportCrop: false,
        ...this.config.imageOptions, // Merge user-defined options
      };

      const processed = await processImage(image, processOptions);
      if (isDevelopment) {
        _log('图片处理完成, hash:', processed.hash.substring(0, 16));
      }

      const imageKey = imageKeyOverride || processed.hash;
      const cacheKey = this.buildCacheKey(processed.hash);

      // 步骤3：检查缓存
      if (this.config.cacheEnabled && !forceRefresh) {
        const cached = useTranslationCacheStore.getState().get(cacheKey);
        if (cached) {
          if (isDevelopment) {
            _log('使用缓存结果, 文字区域数:', cached.textAreas.length);
          }
          // 如果缓存命中，则使用缓存同时记录 Token 为 0（命中）
          useUsageStore.getState().addRecord({
            provider: this.config.provider,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            cached: true,
          });
          return cached;
        }
      }

      // Long webtoon strips always use the tiled pipeline. The old
      // viewport-crop call path only translated the currently visible slice
      // of an <img>, then marked the whole image processed, leaving the rest
      // untranslated.
      if (image.naturalHeight >= TILING_MIN_HEIGHT) {
        const result = await this.translateImageTiled(image, forceRefresh);
        if (!result.success) {
          if (result.allowFullImageFallback) {
            // 所有切片都失败（例如 CORS 无法取原图）→ 回退整图压缩旧路径
            if (isDevelopment) {
              _logError(
                'Tiled pipeline failed, falling back to full-image',
                result.error
              );
            }
          } else {
            // 部分切片失败：整图路径会把 800x8000 的长条压到 102px 宽，
            // 再多付一次钱换回一张几乎空白的窄图。直接报告失败，让这张图
            // 保持“未处理”，用户可以只重试失败的图片。
            if (isDevelopment) {
              _logError('Tiled pipeline partially failed:', result.error);
            }
            return result;
          }
        } else {
          // 切片成功也写缓存（整图 hash 为 key），与整图路径共用同一套
          // 缓存语义：同一张图只付费翻译一次，后续直接命中。
          const tiledRealCount = (result.textAreas ?? []).filter(
            area => (area.translatedText ?? '').trim().length > 0
          ).length;
          if (this.config.cacheEnabled && tiledRealCount > 0) {
            useTranslationCacheStore
              .getState()
              .set(cacheKey, result, this.config.provider);
          }
          return result;
        }
      }

      const result = await this.translateWithHybridPipeline(
        image,
        processed,
        imageKey,
        forceRefresh
      );

      // 步骤5：写入缓存。质量门：模型返回 success 但零文字区是"假成功"，
      // 不写缓存，让下一次翻译有机会换路径/拿新结果，而不是永远空白。
      const realTextCount = (result.textAreas ?? []).filter(
        area => (area.translatedText ?? '').trim().length > 0
      ).length;
      if (this.config.cacheEnabled && result.success && realTextCount > 0) {
        if (isDevelopment) {
          _log('存入缓存, 文字区域数:', realTextCount);
        }
        useTranslationCacheStore
          .getState()
          .set(cacheKey, result, this.config.provider);
      } else if (isDevelopment && result.success && realTextCount === 0) {
        _logError('翻译成功但无文字区域，跳过缓存（假成功）');
      }

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.warn('[Translator] 翻译失败:', errorMessage);
      if (isDevelopment && error instanceof Error && error.stack) {
        _logError('错误堆栈:', error.stack);
      }
      return {
        success: false,
        textAreas: [],
        error: errorMessage,
      };
    }
  }

  /**
   * 通过 background script 代理调用 AI API
   *
   * 理由：content script 受 CORS 策略限制，无法直接调用第三方 AI API。
   * 通过 background service worker 中转，可以绕过 CORS 限制。
   */
  private async callTranslationTransport(
    imageBase64: string,
    mimeType: string,
    targetLanguage: string,
    forceRefresh: boolean,
    metadata?: {
      imageKey?: string;
      imageUrl?: string;
      pageUrl?: string;
      priorityClass?: JobPriorityClass;
      scope?: 'viewport' | 'page' | 'chapter' | 'manual';
    }
  ): Promise<TransportTextAreasResponse> {
    // BackgroundJobQueue dedups by pageKey. The dedup guard exists to stop
    // duplicate calls for the SAME translation unit from double-paying, not
    // to serialize a whole page. Key it on the per-image identity (imageKey)
    // so distinct images / tiles enqueue and run in parallel. Keying on
    // pageUrl collapses every concurrent image on a Korean webtoon page into
    // one job (the parallel path returns the first image's result for all).
    // Cache (hash-based) still dedups identical images, so imageKey dedup is
    // just a queue safety net, not the only guard.
    const pageKey =
      metadata?.imageKey ||
      metadata?.imageUrl ||
      metadata?.pageUrl ||
      (typeof window !== 'undefined' ? window.location.href : undefined) ||
      'inline-image';

    const response = await this.transport.translateImage({
      imageBase64,
      mimeType,
      imageKey: metadata?.imageKey,
      pageUrl: metadata?.pageUrl,
      imageUrl: metadata?.imageUrl,
      targetLanguage,
      translationStylePreset: this.config.translationStylePreset,
      forceRefresh,
      pageKey,
      priorityClass: metadata?.priorityClass,
      scope: metadata?.scope,
    });

    if (!response.success) {
      throw new Error(response.error || '翻译请求失败');
    }

    return {
      textAreas: (response.textAreas as TextArea[]) || [],
      cached: response.cached,
      pipeline: response.pipeline,
      usage: response.usage as
        | {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
          }
        | undefined,
    };
  }

  private buildCacheKey(imageHash: string): string {
    const requestedPath = deriveRequestedPath(this.config.provider);
    // The endpoint is part of the identity of the execution: the same
    // provider + model behind a different base URL is a different service
    // (a gateway vs. the vendor directly, or a different vendor entirely
    // that happens to use the same model name — `gpt-4o` is not unique).
    // Without it in the key, switching endpoints silently served the old
    // endpoint's translation from cache.
    const executionScope = [
      'provider',
      requestedPath,
      this.config.provider,
      this.config.model || 'default',
      normalizeBaseUrl(this.config.baseUrl),
    ].join('::');
    return [
      imageHash,
      executionScope,
      this.config.targetLanguage,
      this.config.translationStylePreset,
      // The render mode used to sit here as a configurable slot. It had one
      // value in practice and the 'anchors-only' variant was never
      // implemented, so the slot became a constant. It stays in the key
      // anyway: dropping the element would change every key's bytes and
      // invalidate every user's existing translation cache.
      'strong-overlay-compat',
      HYBRID_PIPELINE_VERSION,
      // Pipeline version bump invalidates tiled-vs-pre-tiled caches on upgrade.
      TILED_PIPELINE_VERSION,
    ].join('::');
  }

  /**
   * Tiled (sliding-window) pipeline for long webtoon strips.
   *
   * Splits the original image into overlapping horizontal tiles, translates
   * each tile separately (crisp, near-1:1 crop — no thumbnail downscaling,
   * no token truncation), maps each tile's relative coords back to original
   * image space, then merges and dedupes.
   *
   * Failure policy:
   * - a tile that produces no text is retried once (covers transient
   *   JSON/parse flakiness).
   * - a tile that THROWS is retried once as well. A single network blip used
   *   to make the whole strip fall back to the full-image path, which bills
   *   a 13th request for a strip that already cost 12 and returns a
   *   1024px-wide thumbnail of an 8000px strip — unreadable.
   * - the full-image fallback is reserved for the case where EVERY tile
   *   failed. There is nothing to lose then, and it is the only path that
   *   can still translate a strip whose tiles could not be fetched at all
   *   (e.g. a CORS-blocked original).
   * - a complete run that came back empty is a success: the model answered
   *   honestly that there is nothing to translate, and the caller must not
   *   pay a second time for the same answer.
   */
  private async translateImageTiled(
    image: HTMLImageElement,
    forceRefresh: boolean
  ): Promise<TiledTranslationOutcome> {
    const tiles = computeTiles(image.naturalWidth, image.naturalHeight);
    if (tiles.length <= 1) {
      // Not actually a long strip — let the caller use the classic path.
      return {
        success: false,
        textAreas: [],
        error: 'not-tall-enough',
        allowFullImageFallback: true,
      };
    }

    if (isDevelopment) {
      _log(
        `切片翻译: ${image.naturalWidth}x${image.naturalHeight} → ${tiles.length} tiles`
      );
    }

    const imageKey = image.src || `img-${Date.now()}`;
    const parallelLimit = Math.min(
      3,
      Math.max(1, useContentConfigStore.getState().parallelLimit || 3)
    );

    // 并发翻译所有切片（限制并发，避免打爆 provider）。processInParallel
    // 按 index 保序保存结果，失败切片记 undefined，不中断其他切片。
    const perTileResults = await processInParallel(
      tiles,
      (tile, index) =>
        this.translateTile(image, tile, index, imageKey, forceRefresh),
      {
        maxConcurrent: parallelLimit,
        signal: this.abortController?.signal,
      }
    );

    // Retry ONLY the tiles that produced no answer at all. A `null` slot
    // means the tile threw; an empty `areas` means the provider answered and
    // found nothing. `processInParallel` writes `undefined` for a slot it
    // never ran (abort, or a rejection it caught itself), so all three are
    // "no answer" and none of them may be counted as a reply.
    const failedIndexes: number[] = [];
    perTileResults.forEach((result, index) => {
      if (result === null || result === undefined) {
        failedIndexes.push(index);
      }
    });

    if (failedIndexes.length > 0 && failedIndexes.length < tiles.length) {
      if (isDevelopment) {
        _log(
          `${failedIndexes.length}/${tiles.length} 个切片失败，重试失败的切片（不回退整图）`
        );
      }
      const failedTiles = failedIndexes.map(index => tiles[index] as TileSpec);
      const retried = await processInParallel(
        failedTiles,
        (tile, retryIndex) => {
          const originalIndex = failedIndexes[retryIndex] as number;
          return this.translateTile(
            image,
            tile,
            originalIndex,
            `${imageKey}::retry`,
            forceRefresh
          );
        },
        {
          maxConcurrent: parallelLimit,
          signal: this.abortController?.signal,
        }
      );

      retried.forEach((result, retryIndex) => {
        const originalIndex = failedIndexes[retryIndex];
        if (originalIndex === undefined) {
          return;
        }
        perTileResults[originalIndex] = result;
      });
    }

    const allAreas: TextArea[] = perTileResults.flatMap(r => r?.areas ?? []);

    if (allAreas.length === 0) {
      const answered = perTileResults.filter(
        result => result !== null && result !== undefined
      ).length;
      const unanswered = perTileResults.length - answered;

      // Every tile failed → the full-image path is the last resort.
      if (answered === 0) {
        return {
          success: false,
          textAreas: [],
          error: '所有切片翻译请求均失败',
          allowFullImageFallback: true,
        };
      }

      // Some tiles failed and the rest found no text: the emptiness is
      // partially unexplained. Reporting the failure keeps the image
      // unprocessed so it can be retried; falling back to the full image
      // would bill a 13th request for an unreadable 1024px thumbnail.
      if (unanswered > 0) {
        return {
          success: false,
          textAreas: [],
          error: `${unanswered}/${perTileResults.length} 个切片翻译失败`,
          allowFullImageFallback: false,
        };
      }

      if (isDevelopment) {
        _log(`切片全部完成 (${answered} 个)，模型确认无文字，不再回退整图`);
      }
      return {
        success: true,
        textAreas: [],
        allowFullImageFallback: false,
      };
    }

    // Some areas exist but some tiles are still unanswered: the areas we do
    // have are worth keeping, but the strip is incomplete, so the caller
    // must not also pay for the full-image path.
    const stillUnanswered = perTileResults.filter(
      result => result === null || result === undefined
    ).length;
    const allowFullImageFallback = stillUnanswered === perTileResults.length;

    const clean = filterOverlapDuplicates(allAreas);
    const clipped = clean.map(area => ({
      ...area,
      x: Math.max(0, Math.min(1, area.x ?? 0)),
      y: Math.max(0, Math.min(1, area.y ?? 0)),
      width: Math.max(0, Math.min(1, area.width ?? 0)),
      height: Math.max(0, Math.min(1, area.height ?? 0)),
    }));

    if (isDevelopment) {
      _log(`切片结果: ${clean.length} 个区域 (去重后)`);
    }

    return {
      success: true,
      textAreas: clipped,
      allowFullImageFallback,
    };
  }

  /**
   * Translate a single tile (crop + transport + map back to original coords).
   * Returns null on failure so one bad tile doesn't fail the page.
   */
  private async translateTile(
    image: HTMLImageElement,
    tile: TileSpec,
    index: number,
    imageKey: string,
    forceRefresh: boolean
  ): Promise<{ areas: TextArea[] } | null> {
    try {
      const processed = await processImage(image, {
        maxSize: TILE_MAX_DIMENSION,
        quality: 0.9,
        format: 'webp',
        viewportCrop: false,
        // Explicit crop on the ORIGINAL image; sky-high legibility.
        cropRegion: {
          top: tile.top,
          height: tile.height,
        },
      });

      let response = await this.callTranslationTransport(
        processed.base64,
        processed.mimeType,
        this.config.targetLanguage,
        forceRefresh,
        {
          scope: 'page',
          imageKey: `${imageKey}::t${index}`,
          pageUrl:
            typeof window !== 'undefined' ? window.location.href : undefined,
        }
      );
      this.recordUsage(response.usage);

      // Quality gate: a tile that yields no text is suspicious. Retry once
      // (covers transient JSON/parse flakiness) before accepting empty.
      const nonEmpty = (response.textAreas ?? []).filter(
        area => (area.translatedText ?? '').trim().length > 0
      );
      if (nonEmpty.length === 0 && !forceRefresh) {
        response = await this.callTranslationTransport(
          processed.base64,
          processed.mimeType,
          this.config.targetLanguage,
          true,
          {
            scope: 'page',
            imageKey: `${imageKey}::t${index}-r`,
            pageUrl:
              typeof window !== 'undefined' ? window.location.href : undefined,
          }
        );
        this.recordUsage(response.usage);
      }

      const mapped = this.mapTextAreasToOriginalImage(
        response.textAreas ?? [],
        processed
      );
      return { areas: mapped };
    } catch (error) {
      if (isDevelopment) {
        _logError(`切片 ${index + 1} 失败:`, error);
      }
      return null;
    }
  }

  private async translateWithHybridPipeline(
    image: HTMLImageElement,
    processed: Awaited<ReturnType<typeof processImage>>,
    imageKey: string,
    forceRefresh: boolean
  ): Promise<TranslationResult> {
    const appConfig = useContentConfigStore.getState();
    const hybridEnabled =
      appConfig.translationPipeline === 'hybrid-regions' &&
      this.config.provider !== 'ollama';
    const allowFallback = appConfig.fallbackToFullImage;

    if (hybridEnabled) {
      try {
        const readingResult = await this.translateRegionsWithHybrid(
          processed,
          imageKey
        );
        return {
          success: true,
          textAreas: this.readingEntriesToTextAreas(
            readingResult.entries,
            processed
          ),
          readingResult,
        };
      } catch (error) {
        if (isDevelopment) {
          _logError(
            'Hybrid pipeline failed, falling back to full image',
            error
          );
        }
        if (!allowFallback) {
          throw error;
        }
      }
    }

    const fallbackProcessed = processed;

    const fallbackResponse = await retryWithBackoff(
      () =>
        this.callTranslationTransport(
          fallbackProcessed.base64,
          fallbackProcessed.mimeType,
          this.config.targetLanguage,
          forceRefresh,
          {
            imageKey,
            imageUrl: image.currentSrc || image.src,
            pageUrl: window.location.href,
          }
        ),
      2,
      1000
    );

    this.recordUsage(fallbackResponse.usage);

    const mappedTextAreas = this.mapTextAreasToOriginalImage(
      fallbackResponse.textAreas,
      fallbackProcessed
    );

    // 自动降级（P1）：全图路径“成功但零文字”是假成功。
    // 模型没读到文字时，尝试 Tesseract 检测 + 区域翻译兜底。
    const realCount = mappedTextAreas.filter(
      area => (area.translatedText ?? '').trim().length > 0
    ).length;
    if (
      realCount === 0 &&
      !hybridEnabled &&
      this.config.provider !== 'ollama'
    ) {
      if (isDevelopment) {
        _logError('全图路径返回零文字，自动降级到 Tesseract hybrid...');
      }
      try {
        const hybridResult = await this.translateRegionsWithHybrid(
          fallbackProcessed,
          imageKey
        );
        const hybridAreas = this.readingEntriesToTextAreas(
          hybridResult.entries,
          fallbackProcessed
        );
        if (hybridAreas.length > 0) {
          return {
            success: true,
            textAreas: hybridAreas,
            readingResult: hybridResult,
          };
        }
      } catch (error) {
        if (isDevelopment) {
          _logError('Tesseract hybrid 兜底也失败:', error);
        }
      }
    }

    const readingResult = this.textAreasToReadingResult(
      mappedTextAreas,
      imageKey,
      fallbackProcessed,
      'full-image-fallback'
    );

    return {
      success: true,
      textAreas: mappedTextAreas,
      readingResult,
    };
  }

  private async translateRegionsWithHybrid(
    processed: Awaited<ReturnType<typeof processImage>>,
    imageKey: string
  ): Promise<ImageReadingResult> {
    const dataUrl = base64ToDataUrl(processed.base64, processed.mimeType);
    const detection = await detectTextRegions(dataUrl, {
      minConfidence: 0.25,
    });
    const mergedRegions = this.prepareTextRegions(detection.regions);

    if (
      mergedRegions.length === 0 ||
      mergedRegions.length > MAX_REASONABLE_REGION_COUNT
    ) {
      throw new Error('Hybrid region detection produced unusable results');
    }

    const batches = splitIntoBatches(
      mergedRegions,
      Math.max(1, useContentConfigStore.getState().regionBatchSize)
    );

    const entries: ReadingEntry[] = [];
    let order = 0;

    for (const batch of batches) {
      const batchEntries = await this.translateRegionBatch(
        dataUrl,
        batch,
        processed,
        imageKey,
        order
      );
      entries.push(...batchEntries);
      order += batch.length;
    }

    const missingRatio = 1 - entries.length / mergedRegions.length;
    if (missingRatio > MAX_ALLOWED_MISSING_RATIO) {
      throw new Error('Hybrid region translation missing too many entries');
    }

    return {
      imageKey,
      entries: entries.sort((a, b) => a.order - b.order),
      pipeline: 'hybrid-regions',
    };
  }

  private prepareTextRegions(regions: TextRegion[]): TextRegion[] {
    const merged = mergeOverlappingRegions(regions, 0.12);
    return merged
      .filter(region => region.width >= 12 && region.height >= 12)
      .sort((left, right) => {
        const leftVertical = left.height > left.width * 1.8;
        const rightVertical = right.height > right.width * 1.8;
        if (leftVertical && rightVertical) {
          if (Math.abs(left.x - right.x) > 24) {
            return left.x - right.x;
          }
        }
        if (Math.abs(left.y - right.y) > 20) {
          return left.y - right.y;
        }
        return left.x - right.x;
      });
  }

  private async translateRegionBatch(
    imageDataUrl: string,
    regions: TextRegion[],
    processed: Awaited<ReturnType<typeof processImage>>,
    imageKey: string,
    orderOffset: number
  ): Promise<ReadingEntry[]> {
    const croppedImages = await cropRegions(
      imageDataUrl,
      regions.map(region => ({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      })),
      {
        format: 'jpeg',
        quality: 0.92,
      }
    );

    const combined = await combineCroppedRegions(croppedImages, {
      format: 'jpeg',
      quality: 0.92,
    });

    const response = await retryWithBackoff(
      () =>
        this.callTranslationTransport(
          combined.base64,
          'image/jpeg',
          this.config.targetLanguage,
          false,
          {
            imageKey,
            pageUrl: window.location.href,
          }
        ),
      2,
      1000
    );

    this.recordUsage(response.usage);

    const grouped = new Map<number, TextArea[]>();

    for (const area of response.textAreas) {
      const segment = this.resolveSegmentForArea(area, combined);

      if (!segment) {
        continue;
      }

      // Key by the segment's SOURCE index, not its position in the combined
      // image. `combineCroppedRegions` drops crops whose image fails to
      // load, so the stacked position shifts for every region after the
      // first failure — grouping by the stacked index handed region 1 the
      // translation of region 2.
      const current = grouped.get(segment.sourceIndex) || [];
      current.push(area);
      grouped.set(segment.sourceIndex, current);
    }

    const entries: ReadingEntry[] = [];

    regions.forEach((region, index) => {
      const matchedAreas = grouped.get(index);
      if (!matchedAreas || matchedAreas.length === 0) {
        return;
      }

      const sourceRegion = this.toOriginalRegion(region, processed);
      const originalText = matchedAreas
        .map(area => area.originalText)
        .filter(Boolean)
        .join('\n')
        .trim();
      const translatedText = matchedAreas
        .map(area => area.translatedText)
        .filter(Boolean)
        .join('\n')
        .trim();

      if (!translatedText) {
        return;
      }

      const anchorIndex = orderOffset + index + 1;
      entries.push({
        id: createReadingEntryId(imageKey, anchorIndex),
        imageKey,
        anchorIndex,
        sourceRegion,
        displayRegion: sourceRegion,
        originalText,
        translatedText,
        confidence: region.confidence,
        order: orderOffset + index,
        status: 'region-vlm',
      });
    });

    return entries;
  }

  /**
   * Find the combined-image segment a provider answer belongs to.
   *
   * The vertical position of the box inside the combined image is the
   * reliable signal: the segment boundaries are known exactly (each crop is
   * stacked with a fixed spacing), so a box that falls inside a segment
   * belongs to that segment.
   *
   * `area.index` is deliberately NOT used as an anchor here. The strip is
   * sent without the numeric anchor labels, so an `index` field on the
   * answer is the model's own invention, not a label read off the image —
   * trusting it would mis-map answers rather than fix them.
   */
  private resolveSegmentForArea(
    area: TextArea,
    combined: { height: number; segments: CombinedRegionSegment[] }
  ): CombinedRegionSegment | null {
    const segments = combined.segments;
    if (segments.length === 0) {
      return null;
    }

    const centerY = (area.y + area.height / 2) * combined.height;
    const byPosition = segments.find(
      item => centerY >= item.top && centerY <= item.top + item.height
    );
    return byPosition ?? this.findNearestSegment(centerY, segments);
  }

  private findNearestSegment(
    centerY: number,
    segments: CombinedRegionSegment[]
  ): CombinedRegionSegment | null {
    let nearest: CombinedRegionSegment | null = null;
    let minDistance = Number.POSITIVE_INFINITY;

    for (const segment of segments) {
      const segmentCenter = segment.top + segment.height / 2;
      const distance = Math.abs(segmentCenter - centerY);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = segment;
      }
    }

    return nearest;
  }

  private recordUsage(
    usage:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined
  ): void {
    if (!usage) {
      return;
    }
    useUsageStore.getState().addRecord({
      provider: this.config.provider,
      usage,
      cached: false,
    });
  }

  private mapTextAreasToOriginalImage(
    textAreas: TextArea[],
    processed: Awaited<ReturnType<typeof processImage>>
  ): TextArea[] {
    return textAreas.map(area => {
      const absoluteX = area.x * processed.width;
      const absoluteWidth = area.width * processed.width;
      const absoluteYInCrop = area.y * processed.height;
      const absoluteHeightInCrop = area.height * processed.height;

      const absoluteXOrig =
        (absoluteX / processed.width) * processed.originalWidth;
      const absoluteWidthOrig =
        (absoluteWidth / processed.width) * processed.originalWidth;
      const absoluteYOrig =
        (absoluteYInCrop / processed.height) *
          (processed.cropHeight || processed.originalHeight) +
        (processed.cropY || 0);
      const absoluteHeightOrig =
        (absoluteHeightInCrop / processed.height) *
        (processed.cropHeight || processed.originalHeight);

      return {
        ...area,
        x: absoluteXOrig / processed.originalWidth,
        y: absoluteYOrig / processed.originalHeight,
        width: absoluteWidthOrig / processed.originalWidth,
        height: absoluteHeightOrig / processed.originalHeight,
      };
    });
  }

  private toOriginalRegion(
    region: TextRegion,
    processed: Awaited<ReturnType<typeof processImage>>
  ): { x: number; y: number; width: number; height: number } {
    const xRatio = region.x / processed.width;
    const yRatio = region.y / processed.height;
    const widthRatio = region.width / processed.width;
    const heightRatio = region.height / processed.height;
    const visibleHeight = processed.cropHeight || processed.originalHeight;

    return {
      x: xRatio * processed.originalWidth,
      y: yRatio * visibleHeight + (processed.cropY || 0),
      width: widthRatio * processed.originalWidth,
      height: heightRatio * visibleHeight,
    };
  }

  private textAreasToReadingResult(
    textAreas: TextArea[],
    imageKey: string,
    processed: Awaited<ReturnType<typeof processImage>>,
    pipeline: 'hybrid-regions' | 'full-image-fallback'
  ): ImageReadingResult {
    const entries = [...textAreas]
      .sort((left, right) => {
        if (Math.abs(left.y - right.y) > 0.03) {
          return left.y - right.y;
        }
        return left.x - right.x;
      })
      .map((area, index) => {
        const sourceRegion = {
          x: area.x * processed.originalWidth,
          y: area.y * processed.originalHeight,
          width: area.width * processed.originalWidth,
          height: area.height * processed.originalHeight,
        };
        const anchorIndex = index + 1;

        return {
          id: createReadingEntryId(imageKey, anchorIndex),
          imageKey,
          anchorIndex,
          sourceRegion,
          displayRegion: sourceRegion,
          originalText: area.originalText,
          translatedText: area.translatedText,
          confidence: 1,
          order: index,
          status: 'fallback-full-image' as const,
        };
      });

    return {
      imageKey,
      entries,
      pipeline,
    };
  }

  private readingEntriesToTextAreas(
    entries: ReadingEntry[],
    processed: Awaited<ReturnType<typeof processImage>>
  ): TextArea[] {
    return entries.map(entry => ({
      x: entry.sourceRegion.x / processed.originalWidth,
      y: entry.sourceRegion.y / processed.originalHeight,
      width: entry.sourceRegion.width / processed.originalWidth,
      height: entry.sourceRegion.height / processed.originalHeight,
      originalText: entry.originalText,
      translatedText: entry.translatedText,
    }));
  }

  /**
   * Cancel ongoing translation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Check if provider is properly configured
   */
  async validateConfig(): Promise<{ valid: boolean; message: string }> {
    if (providerRequiresApiKey(this.config.provider) && !this.hasCredential()) {
      return {
        valid: false,
        message: `请配置 ${this.config.provider} 的 API Key`,
      };
    }
    return { valid: true, message: '配置有效' };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TranslatorConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.transport) {
      this.transport = config.transport;
    }
    // 重置初始化状态，下次使用时重新初始化
    this.isInitialized = false;
  }

  /**
   * Get current configuration
   */
  getConfig(): TranslatorConfig {
    return { ...this.config };
  }
}

// ==================== Factory Functions ====================

/**
 * Create a translator service from the current app configuration.
 *
 * The configuration comes from the redacted content-snapshot store, so the
 * translator never holds an API key: the worker owns the credential and
 * performs the actual provider call.
 *
 * @returns Configured TranslatorService instance
 */
export function createTranslatorFromConfig(): TranslatorService {
  const config = useContentConfigStore.getState();
  const providerSettings = config.providers[config.provider];

  return new TranslatorService({
    provider: config.provider,
    hasApiKey: providerSettings.hasApiKey,
    baseUrl: providerSettings.baseUrl,
    model: providerSettings.model,
    targetLanguage: config.targetLanguage,
    cacheEnabled: config.cacheEnabled,
    translationStylePreset: config.translationStylePreset,
    imageOptions: {
      maxSize: config.maxImageSize,
    },
    // 不使用 Tesseract 预处理，直接发送完整图片给 VLM
    // 原因：1) Tesseract 坐标映射存在 Bug  2) VLM 直接处理完整图片质量更好
  });
}

// ==================== Singleton Instance ====================
