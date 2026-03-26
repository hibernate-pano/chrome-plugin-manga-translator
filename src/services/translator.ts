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
  type ImageProcessingOptions,
  DEFAULT_OPTIONS,
} from '@/services/image-processor';
import {
  getDefaultTranslationTransport,
  type TranslationTransport,
} from '@/services/translation-transport';
import { retryWithBackoff } from '@/utils/error-handler';
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
  async translateImage(image: HTMLImageElement, viewportCrop: boolean = false): Promise<TranslationResult> {
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

      // 步骤3：检查缓存
      if (this.config.cacheEnabled) {
        const cached = useTranslationCacheStore.getState().get(processed.hash);
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

      // 步骤4：通过 background script 代理调用 AI API（解决 CORS）
      if (isDevelopment) {
        _log(`通过 background 代理调用 Vision LLM: ${this.config.provider}`);
      }

      const callViaTransport = () =>
        this.callTranslationTransport(
          processed.base64,
          processed.mimeType,
          this.config.targetLanguage
        );

      // 使用重试机制处理瞬时错误（网络超时、限速等）
      // 减少单图翻译场景下的重试次数和退避时间
      const response = await retryWithBackoff(callViaTransport, 2, 1000);

      if (isDevelopment) {
        _log('Vision LLM 返回结果, 文字区域数:', response.textAreas.length);
      }

      // 记录 Token 用量到统计 store
      if (response.usage) {
        useUsageStore.getState().addRecord({
          provider: this.config.provider,
          usage: response.usage,
          cached: false,
        });
      }

      // 将裁剪坐标映射回原始图片比例坐标
      const mappedTextAreas = response.textAreas.map((area) => {
        if (!processed.cropHeight || processed.cropHeight === processed.originalHeight) {
          return area; // 如果没有裁剪或裁剪高度等于原高，不用映射
        }

        // 解析返回的相对坐标
        const absoluteYInCrop = area.y * processed.cropHeight;
        const absoluteHeightInCrop = area.height * processed.cropHeight;

        // 加上裁剪的偏移量
        const absoluteYOrig = absoluteYInCrop + (processed.cropY || 0);

        // 转回原图绝对相对坐标
        return {
          ...area,
          y: absoluteYOrig / processed.originalHeight,
          height: absoluteHeightInCrop / processed.originalHeight,
        };
      });

      const result: TranslationResult = {
        success: true,
        textAreas: mappedTextAreas,
      };

      // 步骤5：写入缓存
      if (this.config.cacheEnabled) {
        if (isDevelopment) {
          _log('存入缓存');
        }
        useTranslationCacheStore
          .getState()
          .set(processed.hash, result, this.config.provider);
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
    targetLanguage: string
  ): Promise<{ textAreas: TextArea[]; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const response = await this.transport.translateImage({
      imageBase64,
      mimeType,
      targetLanguage,
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      translationStylePreset: this.config.translationStylePreset,
    });

    if (!response.success) {
      throw new Error(response.error || '翻译请求失败');
    }

    return {
      textAreas: (response.textAreas as TextArea[]) || [],
      usage: response.usage as { promptTokens: number; completionTokens: number; totalTokens: number } | undefined,
    };
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
    provider: config.provider,
    apiKey: providerSettings.apiKey,
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
