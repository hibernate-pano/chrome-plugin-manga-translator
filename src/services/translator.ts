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
import type {
  JobPriorityClass,
  RequestedExecutionPath,
} from '@/shared/runtime-contracts';
import {
  useTranslationCacheStore,
  type TranslationResult,
} from '@/stores/cache-v2';
import { useAppConfigStore } from '@/stores/config-v2';
import { useUsageStore } from '@/stores/usage-store';
import {
  processImage,
  type ImageProcessingOptions,
  DEFAULT_OPTIONS,
} from '@/services/image-processor';
import {
  getDefaultTranslationTransport,
  type TranslationTransport,
} from '@/services/translation-transport';
import { retryWithBackoff } from '@/utils/error-handler';
import { getErrorMessage } from '@/utils/error-message';
import type { TranslationStylePreset } from '@/utils/translation-style';


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

function deriveRequestedPath(
  provider: ProviderType
): RequestedExecutionPath {
  return provider === 'ollama' ? 'ollama-direct' : 'plugin-direct';
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
    const providerConfig = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
    };

    if (providerRequiresApiKey(this.config.provider) && !providerConfig.apiKey) {
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
    imageKeyOverride?: string,
    forceRefresh: boolean = false
  ): Promise<TranslationResult> {
    if (isDevelopment) {
      _log('开始翻译图片');
    }

    try {
      const processOptions: ImageProcessingOptions = {
        maxSize: DEFAULT_OPTIONS.maxSize,
        quality: DEFAULT_OPTIONS.quality,
        viewportCrop: false,
        ...this.config.imageOptions,
      };

      if (viewportCrop) {
        processOptions.maxSize = 1600;
        processOptions.quality = 0.80;
        processOptions.format = 'webp';
        processOptions.viewportCrop = true;
      }

      const processed = await processImage(image, processOptions);
      if (isDevelopment) {
        _log('图片处理完成, hash:', processed.hash.substring(0, 16));
      }

      const imageKey = imageKeyOverride || processed.hash;
      const cacheKey = this.buildCacheKey(processed.hash);

      if (this.config.cacheEnabled && !forceRefresh) {
        const cached = useTranslationCacheStore.getState().get(cacheKey);
        if (cached) {
          if (isDevelopment) {
            _log('使用缓存结果, 文字区域数:', cached.textAreas.length);
          }
          useUsageStore.getState().addRecord({
            provider: this.config.provider,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            cached: true,
          });
          return cached;
        }
      }

      const response = await retryWithBackoff(
        () =>
          this.callTranslationTransport(
            processed.base64,
            processed.mimeType,
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

      if (response.usage) {
        useUsageStore.getState().addRecord({
          provider: this.config.provider,
          usage: response.usage,
          cached: false,
        });
      }

      const result: TranslationResult = {
        success: true,
        textAreas: response.textAreas,
      };

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
    // pageKey is used by BackgroundJobQueue for PAGE-LEVEL dedup, so it must
    // identify the page, not the image. Prefer the explicit pageUrl; if the
    // caller didn't supply one, fall back to the current window location
    // (the content script always has it). Never use imageKey here —
    // using it would collapse all images on a page into one job slot.
    const pageKey =
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
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      requestedPath: deriveRequestedPath(this.config.provider),
      renderMode: this.config.renderMode,
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
      usage: response.usage as { promptTokens: number; completionTokens: number; totalTokens: number } | undefined,
    };
  }

  private buildCacheKey(imageHash: string): string {
    const requestedPath = deriveRequestedPath(this.config.provider);
    const executionScope = `provider::${requestedPath}::${this.config.provider}::${this.config.model || 'default'}`;
    return [
      imageHash,
      executionScope,
      this.config.targetLanguage,
      this.config.translationStylePreset,
      this.config.renderMode || 'strong-overlay-compat',
    ].join('::');
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
    if (providerRequiresApiKey(this.config.provider) && !this.config.apiKey) {
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
    provider: config.provider,
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
