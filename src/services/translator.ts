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

/*
 * 从 `@/providers/base` 取类型，从 `@/shared/local-providers` 取"这个服务商
 * 要不要 Key"。
 *
 * 两件事都不能走 `@/providers` 那个桶：桶里静态地引着三个真正的服务商实
 * 现（OpenAI 兼容、Ollama、LM Studio），而它们各自带着 HTTP 客户端、提
 * 示词构造和用量记账。内容脚本一个都用不上——它只认识"这个服务商要不要
 * Key"，请求是 worker 发的——但静态 import 会把这些全都拖进 content.js。
 *
 * content.js 是每打开一个网页都要加载一次的东西，拖进来的每一 KB 都是
 * 每个网页都要付的。
 */
import type { ProviderType, TextArea } from '@/providers/base';
import { providerRequiresApiKey } from '@/shared/local-providers';
import { RUN_SCOPE_ID } from '@/shared/run-scope';
import {
  deriveRequestedPath,
  type JobPriorityClass,
  type RecordCacheHitMessage,
} from '@/shared/runtime-contracts';
import {
  ensureCacheHydrated,
  useTranslationCacheStore,
  type TranslationResult,
} from '@/stores/cache-v2';
import { useContentConfigStore } from '@/stores/content-config';
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
import {
  extractErrorStatus,
  parseHttpStatusFromMessage,
  retryWithBackoff,
  stripHttpStatusMarker,
} from '@/utils/error-handler';
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

/**
 * Clamp a ratio into 0..1.
 *
 * A model can return a box that reaches outside the image it was given. When
 * that box is mapped back onto the original image, the part that hangs over
 * the edge has to be cut off — otherwise the translation is drawn over the
 * page's own furniture.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Tell the worker that an image was served from the cache.
 *
 * The record is a statistic, not a bill: a lost one makes the cache-hit
 * rate a little lower, and nothing else. So a failure here is logged and
 * swallowed — a translation must not fail because a counter could not be
 * written.
 */
async function reportCacheHit(provider: ProviderType): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'RECORD_CACHE_HIT',
      provider,
    } satisfies RecordCacheHitMessage);
  } catch (error) {
    console.error('[Usage] failed to report a cache hit:', error);
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
  /**
   * Which page run these requests belong to.
   *
   * The worker drops the requests of a run when the reader cancels, so every
   * request has to say which run it is. It comes from the content script
   * (see `@/shared/run-scope`), not from here: a translator can be rebuilt
   * mid-run when the settings change, and the run it belongs to has not.
   */
  runScope?: string;
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

/**
 * One tile's answer.
 *
 * `error` is set when the tile ran and failed. It used to be `null` for a
 * failure, which said nothing: the reason was logged in development builds
 * only and thrown away, so a production build could not tell a timeout from
 * a wrong API key — and neither could the reader.
 */
interface TileTranslationResult {
  areas: TextArea[];
  error?: string;
  /**
   * The HTTP status behind `error`, when the failure came from a response.
   *
   * Without it, a 401 and a 408 both arrive as the same sentence, and the
   * reader is told "an unknown error occurred" — the one message that says
   * nothing about what to do next.
   */
  errorStatus?: number;
}

interface TransportTextAreasResponse {
  textAreas: TextArea[];
  /**
   * Bubbles the model found and translated but gave no box for.
   *
   * There is nowhere to draw them, so the caller has to say so.
   */
  unplacedCount?: number;
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

/**
 * 「这张图确实没有文字」——OCR 跑完了，一个区域都没找到。
 *
 * 和「兜底没跑起来」是两件事，`translateRegionsWithHybrid` 的调用方必须
 * 分得开：
 *
 * - 找到零个区域 → 这是一个答案。空结果可以返回、可以写缓存、下次打开
 *   不用再付一次钱。
 * - 兜底抛错（语言包下载不到、识别服务挂了）→ 这不是答案。以前两者都走
 *   「返回空、记成功、写缓存」那一条路，于是用户的页面上一个字都没有，
 *   HUD 却说「翻译完成 / 成功 12」；更糟的是同一张图下次打开命中缓存，
 *   再也不会重试。
 */
class NoTextDetectedError extends Error {
  constructor() {
    super('Hybrid detection found no text regions');
    this.name = 'NoTextDetectedError';
  }
}
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
    imageKeyOverride?: string,
    options?: { priorityClass?: JobPriorityClass; signal?: AbortSignal }
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
        // 缓存是从 chrome.storage.local 异步读进来的。在读完之前查缓存，每
        // 一张图都会得到“没命中”，于是整页重新送去翻译、重新计费 —— 而用户
        // 什么都没做（自动翻译路径上尤其明显）。
        await ensureCacheHydrated();
        const cached = useTranslationCacheStore.getState().get(cacheKey);
        if (cached) {
          if (isDevelopment) {
            _log('使用缓存结果, 文字区域数:', cached.textAreas.length);
          }
          // 缓存命中：没有请求发出去，也没有 Token 花掉。
          //
          // 这条记录由 worker 来写：每个月的合计只有一份才是账，页面自己
          // 写一份、worker 再写一份，两边的数字就谁也加不出总数来。
          void reportCacheHit(this.config.provider);
          return cached;
        }
      }

      // Long webtoon strips always use the tiled pipeline. The old
      // viewport-crop call path only translated the currently visible slice
      // of an <img>, then marked the whole image processed, leaving the rest
      // untranslated.
      if (image.naturalHeight >= TILING_MIN_HEIGHT) {
        const result = await this.translateImageTiled(
          image,
          forceRefresh,
          options?.priorityClass,
          options?.signal
        );
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
          /*
           * 一条"整条都没有文字"的条漫也要写缓存。
           *
           * 整图路径现在也写"零文字"的缓存了：模型认认真真看过这张图、
           * 回答说"这里没有文字"，那是一个答案，不是一次失败；把它当成失败
           * 反复重问，是拿用户的钱去问一个已经问过的问题。（这一段注释以前
           * 说的是"故意不写"，而代码早就改成了写 —— 一条和代码对着干的
           * 注释，会让下一个改代码的人把旧行为"恢复"回去。）
           *
           * 条漫不一样：它是 N 次请求。不写缓存意味着用户下次打开同一页又要
           * 付 N 次——而没有文字的那些片还会再被问一次，实际可能翻倍。每一
           * 片都回答了"这块没有文字"，那是一个答案，不是一次失败；要重来的
           * 话用户还有「忽略缓存重翻」这个出口。
           *
           * `success && textAreas.length === 0` 恰好就是"每一片都回答了、每
           * 一片都没找到文字"：只要有一片失败，整条走的是失败分支，不会走到
           * 这里。
           */
          const tiledCacheable =
            result.success &&
            (tiledRealCount > 0 || (result.textAreas ?? []).length === 0);
          if (this.config.cacheEnabled && tiledCacheable) {
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
        forceRefresh,
        options?.priorityClass,
        options?.signal
      );

      // 步骤5：写入缓存。质量门分两种"空"：
      //
      // - 找到了文字区，但译文是空的 → 假成功，不写缓存。下次再问一次，
      //   换个模型或换个提示词也许能拿到。这是整图路径故意的规则。
      // - 一个文字区都没有 → 模型（和 OCR）看了这张图，回答说"没有文字"。
      //   这也是一个答案。用户下次打开同一页，不该再付一次钱。
      //   （条漫路径一直按这个口径写缓存，这里是整图路径跟上它。）
      const textAreas = result.textAreas ?? [];
      const realTextCount = textAreas.filter(
        area => (area.translatedText ?? '').trim().length > 0
      ).length;
      const answeredNoText = textAreas.length === 0;
      const cacheable = realTextCount > 0 || answeredNoText;
      if (this.config.cacheEnabled && result.success && cacheable) {
        if (isDevelopment) {
          _log('存入缓存, 文字区域数:', realTextCount);
        }
        useTranslationCacheStore
          .getState()
          .set(cacheKey, result, this.config.provider);
      } else if (isDevelopment && result.success && !cacheable) {
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
        /*
         * The status travels with the result.
         *
         * Everything below this point had it — the provider put it on the
         * Error, the worker carried it across the process boundary as a
         * number — and this catch was the one place that dropped it. From
         * here on the content script only had a sentence, so 401 and 408
         * both classified as "an unknown error occurred".
         */
        errorStatus: extractErrorStatus(error),
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
      /**
       * The image is a stack of separate crops, not one page.
       *
       * The worker carries this to the provider so the prompt describes the
       * image that was actually sent.
       */
      isHybridRegions?: boolean;
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
      isHybridRegions: metadata?.isHybridRegions,
      runScope: this.config.runScope,
    });

    if (!response.success) {
      /*
       * The status is what tells "the provider rejected this" from "the
       * provider was still working when we gave up" — and only the second one
       * is money already spent.
       *
       * It used to survive only as the `[HTTP nnn]` marker inside the
       * message text, because the worker flattened the error to a string
       * before it crossed the process boundary. The worker now sends it as a
       * number as well; the marker is still read, as the fallback for a
       * worker that is older than the one that sends it.
       */
      const error = new Error(response.error || '翻译请求失败');
      const status =
        response.errorStatus ??
        parseHttpStatusFromMessage(response.error ?? '');
      if (status !== undefined) {
        (error as Error & { status?: number }).status = status;
      }
      throw error;
    }

    return {
      textAreas: (response.textAreas as TextArea[]) || [],
      unplacedCount: response.unplacedCount,
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

  /**
   * 发出一次翻译请求。
   *
   * 用量**不在这里记** —— 记在 worker 那边（`provider-direct-client.ts`）。
   *
   * 记账必须跟着"真的问了一次服务商"走，而这里是唯一能知道这一点的层：它
   * 的队列会把两个相同的 pageKey 合并成一个 job，两个调用方拿到同一份结
   * 果，而服务商只被问了一次。在调用方这边记，就会把一次请求算成两次 ——
   * 把用户没花的钱算成花了。worker 那边记一次，两边就都对了。
   *
   * 缓存命中不经过这里，所以它自己的那条记录（`cached: true`）仍然留在
   * 翻译器里：它不是一次请求，是一次没有发生的请求。
   */
  private async sendTranslationRequest(
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
      isHybridRegions?: boolean;
    }
  ): Promise<TransportTextAreasResponse> {
    return this.callTranslationTransport(
      imageBase64,
      mimeType,
      targetLanguage,
      forceRefresh,
      metadata
    );
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
    forceRefresh: boolean,
    priorityClass?: JobPriorityClass,
    signal?: AbortSignal
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
        this.translateTile(
          image,
          tile,
          index,
          imageKey,
          forceRefresh,
          priorityClass,
          signal
        ),
      {
        maxConcurrent: parallelLimit,
        // The reader's cancel reaches the tile loop through here: the pool
        // stops picking up new tiles once the signal fires.
        //
        // It used to read a signal from a field that was never assigned, so
        // it was always `undefined` — a long strip kept running all of its
        // tiles after the reader pressed cancel.
        signal,
      }
    );

    /*
     * Retry ONLY the tiles that produced no answer at all.
     *
     * Three shapes come back: `undefined` for a tile the pool never ran (the
     * reader cancelled), an `error` for a tile that ran and failed, and a
     * plain result for a tile the provider answered. Only the first two are
     * "no answer", and neither of them may be counted as a reply.
     */
    const isUnanswered = (result: TileTranslationResult | undefined): boolean =>
      result === undefined || result.error !== undefined;

    const failedIndexes: number[] = [];
    perTileResults.forEach((result, index) => {
      if (isUnanswered(result)) {
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
            forceRefresh,
            // 重试的那一片和第一次一样急。丢了优先级标记，它就会被当成
            // 「读者正盯着的那张」，插到人家真正在等的图前面。
            priorityClass,
            signal
          );
        },
        {
          maxConcurrent: parallelLimit,
          signal,
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

    /*
     * 为什么失败。
     *
     * 每一片失败时把原因带出来，最后合成一句给读者看的话。以前这里只有
     * 一个计数（「3/12 个切片翻译失败」），原因在 `translateTile` 的 catch
     * 里就丢了——而且只在开发模式下打过一行日志，所以正式构建里连开发者
     * 自己都看不到「是超时还是密钥错了」。
     */
    const failureReasons = Array.from(
      new Set(
        perTileResults
          .map(result => result?.error)
          .filter((reason): reason is string => Boolean(reason))
      )
    );
    const reasonSuffix =
      failureReasons.length > 0 ? `：${failureReasons.join('；')}` : '';

    /*
     * 状态码：只有当所有失败的那几片是同一个状态时才算数。
     *
     * 401（密钥无效）和 408（超时）给读者的下一步完全不同，所以状态码得
     * 跟着上来；但如果几片失败的原因不一样，报一个状态码就是在替其中一
     * 部分撒谎——那种情况下宁可不说，让原因文本自己把话说清楚。
     */
    const failureStatuses = Array.from(
      new Set(
        perTileResults
          .map(result => result?.errorStatus)
          .filter((status): status is number => typeof status === 'number')
      )
    );
    const sharedErrorStatus =
      failureStatuses.length === 1 ? failureStatuses[0] : undefined;

    if (allAreas.length === 0) {
      const answered = perTileResults.filter(
        result => result !== undefined && result.error === undefined
      ).length;
      const unanswered = perTileResults.length - answered;

      // Every tile failed → the full-image path is the last resort.
      if (answered === 0) {
        return {
          success: false,
          textAreas: [],
          error: `所有切片翻译请求均失败${reasonSuffix}`,
          errorStatus: sharedErrorStatus,
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
          error: `${unanswered}/${perTileResults.length} 个切片翻译失败${reasonSuffix}`,
          errorStatus: sharedErrorStatus,
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
    const stillUnanswered = perTileResults.filter(isUnanswered).length;
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
      /*
       * 这一条没有翻出来的地方。
       *
       * 没有回答的切片是"不知道那一片上有什么"；回答了却把译文留空的气泡
       * 是"知道那儿有字，没给译文"。两种都得说出来：这一条漫画有一截还是
       * 原文，而这一轮被记成成功。
       */
      missingCount:
        stillUnanswered +
        clipped.filter(area => (area.translatedText ?? '').trim().length === 0)
          .length,
    };
  }

  /**
   * Translate a single tile (crop + transport + map back to original coords).
   *
   * A tile that failed carries its reason instead of vanishing: the reason
   * is what the reader is told, and it used to be dropped on the floor here
   * (the catch logged it only in development builds, so a production build
   * could not tell a timeout from a wrong key).
   */
  private async translateTile(
    image: HTMLImageElement,
    tile: TileSpec,
    index: number,
    imageKey: string,
    forceRefresh: boolean,
    priorityClass?: JobPriorityClass,
    signal?: AbortSignal
  ): Promise<TileTranslationResult> {
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

      /*
       * 裁片是本地做的，模型请求要发出去之前，读者可能已经按了取消。
       *
       * 池子只在**取**下一片之前看信号，而裁片本身要花时间（画 canvas、
       * 编码）。等裁完才发现已经取消，这一片的钱就白花了。
       */
      if (signal?.aborted) {
        throw new Error('Translation cancelled');
      }

      let response = await this.sendTranslationRequest(
        processed.base64,
        processed.mimeType,
        this.config.targetLanguage,
        forceRefresh,
        {
          scope: 'page',
          priorityClass,
          imageKey: `${imageKey}::t${index}`,
          pageUrl:
            typeof window !== 'undefined' ? window.location.href : undefined,
        }
      );

      /*
       * 什么时候值得再问一次。
       *
       * 以前这里是「这一片没有译文 → 再问一次」。但"模型回答了『这里没有
       * 文字』"和"模型找到了框却没给译文"是两件事：前者是一个**答案**，
       * 再问一次只会再花一次钱、换回同一句"这里没有文字"；后者才是可疑的，
       * 再问一次有可能拿到译文。
       *
       * 所以判据从"没有译文"收窄成"**找到了框**却没有译文"。一个本来就没字
       * 的切片，从此只花一次钱。
       */
      const areas = response.textAreas ?? [];
      const nonEmpty = areas.filter(
        area => (area.translatedText ?? '').trim().length > 0
      );
      if (
        areas.length > 0 &&
        nonEmpty.length === 0 &&
        !forceRefresh &&
        !signal?.aborted
      ) {
        response = await this.sendTranslationRequest(
          processed.base64,
          processed.mimeType,
          this.config.targetLanguage,
          true,
          {
            scope: 'page',
            priorityClass,
            imageKey: `${imageKey}::t${index}-r`,
            pageUrl:
              typeof window !== 'undefined' ? window.location.href : undefined,
          }
        );
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
      /*
       * The `[HTTP nnn]` marker is stripped from the text and carried as a
       * number instead.
       *
       * The marker protocol is anchored to the start of a message, so a
       * marker sitting in the middle of "所有切片翻译请求均失败：[HTTP 401] …"
       * is read by nobody — it would only show up in front of the reader as
       * a piece of internal plumbing.
       */
      return {
        areas: [],
        error: stripHttpStatusMarker(getErrorMessage(error)),
        errorStatus: extractErrorStatus(error),
      };
    }
  }

  private async translateWithHybridPipeline(
    image: HTMLImageElement,
    processed: Awaited<ReturnType<typeof processImage>>,
    imageKey: string,
    forceRefresh: boolean,
    priorityClass?: JobPriorityClass,
    signal?: AbortSignal
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
          imageKey,
          priorityClass,
          signal
        );
        return {
          success: true,
          textAreas: this.readingEntriesToTextAreas(
            readingResult.entries,
            processed
          ),
          readingResult,
          missingCount: readingResult.missingCount,
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
        this.sendTranslationRequest(
          fallbackProcessed.base64,
          fallbackProcessed.mimeType,
          this.config.targetLanguage,
          forceRefresh,
          {
            priorityClass,
            imageKey,
            imageUrl: image.currentSrc || image.src,
            pageUrl: window.location.href,
          }
        ),
      2,
      1000
    );

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
          imageKey,
          // 兜底的那次请求和整图那次一样急。丢了优先级标记，它会被当成
          // 「读者正盯着的那张」，插到人家真正在等的图前面。
          priorityClass
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
            missingCount: hybridResult.missingCount,
          };
        }
      } catch (error) {
        if (isDevelopment) {
          _logError('Tesseract hybrid 兜底也失败:', error);
        }
        /*
         * 只有「OCR 跑完了、确实没有文字」能落到下面那个空结果。
         *
         * 兜底自己失败（语言包下不下来、识别服务不通）时，"没有文字"是
         * 我们**没查出来**的事，不是查出来的结论。以前这里把它吞掉，于是
         * 一张没翻出东西的图被记成成功、写进缓存 —— 用户花了钱，页面上
         * 什么都没有，而且下次打开同一页永远不会再问一次。
         *
         * 抛出去：上层把它记成失败，重试列表里能看到，缓存也不会写。
         */
        if (!(error instanceof NoTextDetectedError)) {
          throw error;
        }
      }
    }

    const readingResult = this.textAreasToReadingResult(
      mappedTextAreas,
      imageKey,
      fallbackProcessed,
      'full-image-fallback',
      fallbackResponse.unplacedCount ?? 0
    );

    return {
      success: true,
      textAreas: mappedTextAreas,
      readingResult,
      missingCount: readingResult.missingCount,
    };
  }

  private async translateRegionsWithHybrid(
    processed: Awaited<ReturnType<typeof processImage>>,
    imageKey: string,
    priorityClass?: JobPriorityClass,
    signal?: AbortSignal
  ): Promise<ImageReadingResult> {
    const dataUrl = base64ToDataUrl(processed.base64, processed.mimeType);
    const detection = await detectTextRegions(dataUrl, {
      minConfidence: 0.25,
    });
    const mergedRegions = this.prepareTextRegions(detection.regions);

    if (mergedRegions.length === 0) {
      /*
       * OCR ran and found nothing. Unlike a failure, that is an answer:
       * the caller is allowed to return an empty result and cache it.
       */
      throw new NoTextDetectedError();
    }
    if (mergedRegions.length > MAX_REASONABLE_REGION_COUNT) {
      throw new Error('Hybrid region detection produced unusable results');
    }

    const batches = splitIntoBatches(
      mergedRegions,
      Math.max(1, useContentConfigStore.getState().regionBatchSize)
    );

    const entries: ReadingEntry[] = [];
    let order = 0;

    for (const batch of batches) {
      /*
       * 读者按了取消，就不要再发下一批了。
       *
       * 混合管线是一批一批问模型的，一章能问十几次。取消之前这里没有人在
       * 听信号，于是读者点了取消之后，剩下的批次照发、照计费。
       */
      if (signal?.aborted) {
        throw new Error('Translation cancelled');
      }
      const batchEntries = await this.translateRegionBatch(
        dataUrl,
        batch,
        processed,
        imageKey,
        order,
        priorityClass
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
      /*
       * 少翻出来的那几个气泡，要有人说出来。
       *
       * OCR 找到了 10 个气泡，模型只翻了 6 个 —— 剩下的 4 个还是原文。
       * 这一轮以前被记成"成功"：HUD 写着「翻译完成」，弹窗写着「成功 1 张」，
       * 而读者看到的是一半日文一半中文的页面，还以为是自己看漏了。
       *
       * 允许缺的比例（`MAX_ALLOWED_MISSING_RATIO`）是"别因为漏一两个就
       * 整张作废"的容错，不是"漏了不用告诉用户"的理由。
       */
      missingCount: Math.max(0, mergedRegions.length - entries.length),
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
    orderOffset: number,
    priorityClass?: JobPriorityClass
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
        this.sendTranslationRequest(
          combined.base64,
          'image/jpeg',
          this.config.targetLanguage,
          false,
          {
            priorityClass,
            imageKey,
            pageUrl: window.location.href,
            /*
             * 这一条路送去的不是一张漫画页，是一叠互不相关的裁剪。
             *
             * 以前这里发的是整图那条提示词，而它写着"把一个气泡里的多行
             * 合并成一个条目"——在一叠裁剪上，模型会把相邻两块当成同一个
             * 气泡，合成一个大框。译文于是整段盖在其中一块上，另一块什么
             * 都没有，而这一轮仍然被记成成功。
             *
             * 拼图条那条提示词说的就是这张图：块与块之间有分隔线，块里的
             * 文字和邻居无关，不许跨块合并。
             */
            isHybridRegions: true,
          }
        ),
      2,
      1000
    );

    const grouped = new Map<number, TextArea[]>();
    const segmentBySourceIndex = new Map<number, CombinedRegionSegment>();

    for (const area of response.textAreas) {
      const segment = this.resolveSegmentForArea(area, combined);

      if (!segment) {
        continue;
      }

      segmentBySourceIndex.set(segment.sourceIndex, segment);

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

      // 一个 region 里可能有不止一个文字框——OCR 的框会重叠合并，模型也可能
      // 把一个气泡拆成几个框。以前这些框的译文被拼成一段，画在一个覆盖整个
      // region 的方块上：两个气泡挤在一个框里，原文被盖住一半，译文也挤在
      // 一起。现在每个框各自算回原图坐标，各画各的。
      const segment = segmentBySourceIndex.get(index);
      const areas = segment
        ? matchedAreas.map(area =>
            this.mapStripAreaToOriginal(
              area,
              segment,
              region,
              combined,
              processed
            )
          )
        : [];

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
        areas,
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

    /*
     * 没有框的条目不认领。
     *
     * 以前这里有一条退路：模型只给编号不给框时，按编号去认块。但编号是模型
     * 自己编的 —— 拼图条上并没有画编号（`combineCroppedRegions` 只画分隔
     * 线），模型给的编号和块的顺序对不对得上，全看它怎么数。认错了，一句
     * 译文就画进了跟它无关的气泡。
     *
     * 拼图条是一张真图，位置本来就有，提示词要的就是坐标。没有框的条目一律
     * 不画，并且已经被解析层记进"没翻出来"的数字里，用户看得见。
     */
    if (area.width <= 0 || area.height <= 0) {
      return null;
    }

    /*
     * 按"框和哪一段重叠得最多"来认领，而不是按中心点。
     *
     * 中心点会认错：一个跨越了两段的框（模型把相邻两个气泡合成了一个），
     * 中心点落在哪一段，译文就整段盖在哪一段上。按重叠面积认领，译文至少
     * 落在它覆盖得最多的那一段上；另一段没有译文，会被算成"没翻出来"，
     * 用户看得见。
     */
    const boxTop = area.y * combined.height;
    const boxBottom = (area.y + area.height) * combined.height;

    let best: CombinedRegionSegment | null = null;
    let bestOverlap = 0;
    for (const segment of segments) {
      const overlap =
        Math.min(boxBottom, segment.top + segment.height) -
        Math.max(boxTop, segment.top);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = segment;
      }
    }
    if (best) {
      return best;
    }

    const centerY = (area.y + area.height / 2) * combined.height;
    return this.findNearestSegment(centerY, segments);
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
    region: { x: number; y: number; width: number; height: number },
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
    pipeline: 'hybrid-regions' | 'full-image-fallback',
    unplacedCount: number = 0
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
      /*
       * 找到了却没翻出来的气泡。
       *
       * 模型把一个气泡的 `translatedText` 留空，是"我看见了这个气泡，但
       * 没给出译文"。页面上那个气泡还是原文，而这一轮被记成成功 —— 读者
       * 只看到「翻译完成」，只当自己看漏了。数字要跟着结果一起上去。
       *
       * `unplacedCount` 是另一种"没翻出来"：模型给了译文，却没有给出框，
       * 于是没有地方可以画。页面上的气泡比模型找到的少 —— 差的这几个也
       * 还在原文里，同样要说出来。
       */
      missingCount:
        textAreas.filter(
          area => (area.translatedText ?? '').trim().length === 0
        ).length + unplacedCount,
    };
  }

  private readingEntriesToTextAreas(
    entries: ReadingEntry[],
    processed: Awaited<ReturnType<typeof processImage>>
  ): TextArea[] {
    return entries.flatMap(entry => {
      // A region that holds several text boxes keeps them apart, each with
      // its own box on the original image.
      if (entry.areas && entry.areas.length > 0) {
        return entry.areas;
      }

      return [
        {
          x: entry.sourceRegion.x / processed.originalWidth,
          y: entry.sourceRegion.y / processed.originalHeight,
          width: entry.sourceRegion.width / processed.originalWidth,
          height: entry.sourceRegion.height / processed.originalHeight,
          originalText: entry.originalText,
          translatedText: entry.translatedText,
        },
      ];
    });
  }

  /**
   * Map a box the model found inside the combined strip back onto the
   * original image.
   *
   * The strip is a vertical stack of the cropped regions, drawn 1:1 — no
   * scaling — so a box in the strip is the same number of pixels as in the
   * crop it came from. The way back is therefore: strip pixels → pixels
   * inside the crop (subtract the crop's offset in the strip) → pixels in
   * the processed image (add the region's origin) → pixels in the original
   * image (undo the compression and the viewport crop).
   */
  private mapStripAreaToOriginal(
    area: TextArea,
    segment: CombinedRegionSegment,
    region: TextRegion,
    combined: { width: number; height: number },
    processed: Awaited<ReturnType<typeof processImage>>
  ): TextArea {
    const left = typeof segment.left === 'number' ? segment.left : 0;
    const cropWidth =
      typeof segment.width === 'number' && segment.width > 0
        ? segment.width
        : region.width;
    const cropHeight =
      typeof segment.height === 'number' && segment.height > 0
        ? segment.height
        : region.height;

    const stripX = area.x * combined.width;
    const stripY = area.y * combined.height;

    /*
     * 模型只给了编号、没给框的时候，这一块就是它自己的地盘。
     *
     * 以前这里会把 0 当成框的位置，于是译文被画成零尺寸 —— 看不见，
     * 而那一块还留着原文。整块作为框，是诚实的答案：这一块里有多少字，
     * 译文就盖多少。
     */
    if (area.width <= 0 || area.height <= 0) {
      const original = this.toOriginalRegion(region, processed);
      return {
        x: original.x / processed.originalWidth,
        y: original.y / processed.originalHeight,
        width: original.width / processed.originalWidth,
        height: original.height / processed.originalHeight,
        originalText: area.originalText,
        translatedText: area.translatedText,
      };
    }

    // Where the box sits inside its own crop, as a fraction.
    const relX = clamp01((stripX - left) / cropWidth);
    const relY = clamp01((stripY - segment.top) / cropHeight);
    const relWidth = clamp01((area.width * combined.width) / cropWidth);
    const relHeight = clamp01((area.height * combined.height) / cropHeight);

    const original = this.toOriginalRegion(
      {
        x: region.x + relX * cropWidth,
        y: region.y + relY * cropHeight,
        width: relWidth * cropWidth,
        height: relHeight * cropHeight,
      },
      processed
    );

    return {
      x: original.x / processed.originalWidth,
      y: original.y / processed.originalHeight,
      width: original.width / processed.originalWidth,
      height: original.height / processed.originalHeight,
      originalText: area.originalText,
      translatedText: area.translatedText,
    };
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
    // 每一页的请求都带着同一个运行标识，读者取消时 worker 才分得清
    // 哪一些是该丢的。
    runScope: RUN_SCOPE_ID,
    imageOptions: {
      maxSize: config.maxImageSize,
    },
    // 不使用 Tesseract 预处理，直接发送完整图片给 VLM
    // 原因：1) Tesseract 坐标映射存在 Bug  2) VLM 直接处理完整图片质量更好
  });
}

// ==================== Singleton Instance ====================
