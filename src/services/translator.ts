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
} from '@/providers';
import {
  useTranslationCacheStore,
  type TranslationResult,
} from '@/stores/cache-v2';
import { useAppConfigStore } from '@/stores/config-v2';
import { useUsageStore } from '@/stores/usage-store';
import {
  processImage,
  cropRegions,
  combineCroppedRegions,
  base64ToDataUrl,
  type ImageProcessingOptions,
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
  type ServerExecutionConfig,
} from '@/services/translation-transport';
import { retryWithBackoff } from '@/utils/error-handler';
import type { TranslationStylePreset } from '@/utils/translation-style';
import { splitIntoBatches } from '@/utils/image-priority';


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

export interface TranslatorConfig {
  /** Whether to use self-hosted server or direct provider mode */
  executionMode?: 'server' | 'provider-direct';
  /** Provider type to use */
  provider: ProviderType;
  /** API key for cloud providers */
  apiKey?: string;
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
  /** Self-hosted server configuration */
  server?: ServerExecutionConfig;
  /** Render mode for translated content */
  renderMode?: 'anchors-only' | 'strong-overlay-compat';
  /** Image processing options */
  imageOptions?: ImageProcessingOptions;
  /** Transport implementation */
  transport?: TranslationTransport;
}

export interface TranslationProgress {
  /** Current image being processed */
  current: number;
  /** Total images to process */
  total: number;
  /** Current status message */
  status: string;
  /** Estimated time remaining in seconds (optional) */
  estimatedTimeRemaining?: number;
  /** Current operation phase */
  phase:
  | 'initializing'
  | 'processing'
  | 'translating'
  | 'rendering'
  | 'complete'
  | 'error';
}

export type ProgressCallback = (progress: TranslationProgress) => void;

interface TransportTextAreasResponse {
  textAreas: TextArea[];
  cached?: boolean;
  pipeline?: 'ocr-first' | 'region-fallback' | 'full-image-fallback';
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const HYBRID_PIPELINE_VERSION = 'hybrid-v1';
const MAX_REASONABLE_REGION_COUNT = 80;
const MAX_ALLOWED_MISSING_RATIO = 0.4;

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
    const providerConfig = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
    };

    // 检查必要的配置
    const useServer =
      this.config.executionMode === 'server' &&
      !!this.config.server?.enabled &&
      !!this.config.server.baseUrl.trim();

    if (useServer) {
      this.isInitialized = true;
      return;
    }

    if (this.config.provider !== 'ollama' && !providerConfig.apiKey) {
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
    viewportCrop: boolean = false,
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

      if (viewportCrop) {
        processOptions.maxSize = 1600;    // 优化：文字识别不需要超高分辨率
        processOptions.quality = 0.80;    // 优化：降低质量减少 base64 体积
        processOptions.format = 'webp';   // 优化：使用 WebP 格式缩小体积
        processOptions.viewportCrop = true;
      }

      const processed = await processImage(image, processOptions);
      if (isDevelopment) {
        _log('图片处理完成, hash:', processed.hash.substring(0, 16));
      }

      const imageKey = imageKeyOverride || processed.hash;
      const cacheKey = this.buildCacheKey(processed.hash);

      // 步骤3：检查缓存
      if (this.config.cacheEnabled) {
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

      const result = await this.translateWithHybridPipeline(
        image,
        processed,
        imageKey,
        viewportCrop
      );

      // 步骤5：写入缓存
      if (this.config.cacheEnabled) {
        if (isDevelopment) {
          _log('存入缓存');
        }
        useTranslationCacheStore
          .getState()
          .set(cacheKey, result, this.config.provider);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
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
    metadata?: {
      imageKey?: string;
      imageUrl?: string;
      pageUrl?: string;
    }
  ): Promise<TransportTextAreasResponse> {
    const response = await this.transport.translateImage({
      imageBase64,
      mimeType,
      imageKey: metadata?.imageKey,
      pageUrl: metadata?.pageUrl,
      imageUrl: metadata?.imageUrl,
      targetLanguage,
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      executionMode: this.config.executionMode,
      server: this.config.server,
      renderMode: this.config.renderMode,
      translationStylePreset: this.config.translationStylePreset,
    });

    if (!response.success) {
      throw new Error(response.error || '翻译请求失败');
    }

    return {
      textAreas: (response.textAreas as TextArea[]) || [],
      cached: response.cached,
      pipeline: response.pipeline,
      usage: response.usage as { promptTokens: number; completionTokens: number; totalTokens: number } | undefined,
    };
  }

  private buildCacheKey(imageHash: string): string {
    const executionScope =
      this.config.executionMode === 'server' && this.config.server?.baseUrl
        ? `server::${this.config.server.baseUrl}`
        : `provider::${this.config.provider}::${this.config.model || 'default'}`;
    return [
      imageHash,
      executionScope,
      this.config.targetLanguage,
      this.config.translationStylePreset,
      this.config.renderMode || 'strong-overlay-compat',
      HYBRID_PIPELINE_VERSION,
    ].join('::');
  }

  private async translateWithHybridPipeline(
    image: HTMLImageElement,
    processed: Awaited<ReturnType<typeof processImage>>,
    imageKey: string,
    viewportCrop: boolean
  ): Promise<TranslationResult> {
    const appConfig = useAppConfigStore.getState();
    const useServer =
      this.config.executionMode === 'server' &&
      !!this.config.server?.enabled &&
      !!this.config.server.baseUrl.trim();
    const hybridEnabled = appConfig.translationPipeline === 'hybrid-regions';
    const allowFallback = appConfig.fallbackToFullImage;

    if (useServer) {
      const response = await retryWithBackoff(
        () =>
          this.callTranslationTransport(
            processed.base64,
            processed.mimeType,
            this.config.targetLanguage,
            {
              imageKey,
              imageUrl: image.currentSrc || image.src,
              pageUrl: window.location.href,
            }
          ),
        2,
        1000
      );

      const readingResult = this.textAreasToReadingResult(
        response.textAreas,
        imageKey,
        processed,
        response.pipeline === 'full-image-fallback'
          ? 'full-image-fallback'
          : 'hybrid-regions'
      );

      return {
        success: true,
        textAreas: response.textAreas,
        readingResult,
        cached: response.cached,
      };
    }

    if (hybridEnabled) {
      try {
        const readingResult = await this.translateRegionsWithHybrid(
          processed,
          imageKey
        );
        return {
          success: true,
          textAreas: this.readingEntriesToTextAreas(readingResult.entries, processed),
          readingResult,
        };
      } catch (error) {
        if (isDevelopment) {
          _logError('Hybrid pipeline failed, falling back to full image', error);
        }
        if (!allowFallback) {
          throw error;
        }
      }
    }

    const fallbackProcessed = viewportCrop
      ? await processImage(image, {
        ...this.config.imageOptions,
        viewportCrop: false,
      })
      : processed;

    const fallbackResponse = await retryWithBackoff(
      () =>
        this.callTranslationTransport(
          fallbackProcessed.base64,
          fallbackProcessed.mimeType,
          this.config.targetLanguage,
          {
            imageKey,
            imageUrl: image.currentSrc || image.src,
            pageUrl: window.location.href,
          }
        ),
      2,
      1000
    );

    if (fallbackResponse.usage) {
      useUsageStore.getState().addRecord({
        provider: this.config.provider,
        usage: fallbackResponse.usage,
        cached: false,
      });
    }

    const mappedTextAreas = this.mapTextAreasToOriginalImage(
      fallbackResponse.textAreas,
      fallbackProcessed
    );

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
      Math.max(1, useAppConfigStore.getState().regionBatchSize)
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
          {
            imageKey,
            pageUrl: window.location.href,
          }
        ),
      2,
      1000
    );

    if (response.usage) {
      useUsageStore.getState().addRecord({
        provider: this.config.provider,
        usage: response.usage,
        cached: false,
      });
    }

    const grouped = new Map<number, TextArea[]>();

    for (const area of response.textAreas) {
      const centerY = (area.y + area.height / 2) * combined.height;
      const segment = combined.segments.find(
        item => centerY >= item.top && centerY <= item.top + item.height
      ) || this.findNearestSegment(centerY, combined.segments);

      if (!segment) {
        continue;
      }

      const current = grouped.get(segment.index) || [];
      current.push(area);
      grouped.set(segment.index, current);
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

  private findNearestSegment(
    centerY: number,
    segments: Array<{ index: number; top: number; height: number }>
  ): { index: number; top: number; height: number } | null {
    let nearest: { index: number; top: number; height: number } | null = null;
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

      const absoluteXOrig = (absoluteX / processed.width) * processed.originalWidth;
      const absoluteWidthOrig =
        (absoluteWidth / processed.width) * processed.originalWidth;
      const absoluteYOrig =
        (absoluteYInCrop / processed.height) * (processed.cropHeight || processed.originalHeight) +
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
   * Translate multiple images
   *
   * @param images Array of image elements
   * @param onProgress Progress callback
   * @returns Array of translation results
   */
  async translateImages(
    images: HTMLImageElement[],
    onProgress?: ProgressCallback
  ): Promise<TranslationResult[]> {
    if (isDevelopment) {
      _log(`开始批量翻译, 图片数量: ${images.length}`);
    }

    // 创建新的中止控制器
    this.abortController = new AbortController();

    const results: TranslationResult[] = [];
    const total = images.length;

    for (let i = 0; i < images.length; i++) {
      // 检查是否已取消
      if (this.abortController.signal.aborted) {
        if (isDevelopment) {
          _log('批量翻译已取消');
        }
        break;
      }

      const image = images[i];
      if (!image) continue;

      if (isDevelopment) {
        _log(`处理图片 ${i + 1}/${total}`);
      }
      onProgress?.({
        current: i + 1,
        total,
        status: `翻译中 ${i + 1}/${total}`,
        phase: 'processing',
      });

      const result = await this.translateImage(image);
      results.push(result);
    }

    if (isDevelopment) {
      _log(
        `批量翻译完成, 成功: ${results.filter(r => r.success).length}/${results.length}`
      );
    }
    return results;
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
    if (
      this.config.executionMode === 'server' &&
      this.config.server?.enabled &&
      this.config.server.baseUrl.trim()
    ) {
      return { valid: true, message: '服务端模式配置有效' };
    }

    if (this.config.provider !== 'ollama' && !this.config.apiKey) {
      return { valid: false, message: `请配置 ${this.config.provider} 的 API Key` };
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
 * Create a translator service from the current app configuration
 *
 * @returns Configured TranslatorService instance
 */
export function createTranslatorFromConfig(): TranslatorService {
  const config = useAppConfigStore.getState();
  const providerSettings = config.providers[config.provider];

  return new TranslatorService({
    executionMode:
      config.server.enabled && config.server.baseUrl
        ? 'server'
        : config.executionMode,
    provider: config.provider,
    server: config.server,
    apiKey: providerSettings.apiKey,
    baseUrl: providerSettings.baseUrl,
    model: providerSettings.model,
    targetLanguage: config.targetLanguage,
    cacheEnabled: config.cacheEnabled,
    translationStylePreset: config.translationStylePreset,
    renderMode: config.renderMode,
    imageOptions: {
      maxSize: config.maxImageSize,
    },
    // 不使用 Tesseract 预处理，直接发送完整图片给 VLM
    // 原因：1) Tesseract 坐标映射存在 Bug  2) VLM 直接处理完整图片质量更好
  });
}

// ==================== Singleton Instance ====================

let translatorInstance: TranslatorService | null = null;

/**
 * Get or create the singleton translator instance
 *
 * @param forceNew Force creation of a new instance
 * @returns TranslatorService instance
 */
export function getTranslator(forceNew = false): TranslatorService {
  if (!translatorInstance || forceNew) {
    translatorInstance = createTranslatorFromConfig();
  }
  return translatorInstance;
}

/**
 * Reset the singleton translator instance
 * Used when configuration changes
 */
export function resetTranslator(): void {
  if (translatorInstance) {
    translatorInstance.cancel();
  }
  translatorInstance = null;
}

// ==================== Re-exports ====================

export type { TranslationResult, TextArea };
