/**
 * Translator Service
 * 
 * Core translation service that orchestrates:
 * - Image processing
 * - Provider API calls
 * - Cache management
 * - Error handling
 * 
 * Requirements: 2.2, 2.3, 2.4
 */

import {
  type VisionProvider,
  type ProviderType,
  type TextArea,
  createProvider,
} from '@/providers';
import { useTranslationCacheStore, type TranslationResult } from '@/stores/cache-v2';
import { useAppConfigStore } from '@/stores/config-v2';
import { processImage, type ImageProcessingOptions } from './image-processor';

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
  /** Image processing options */
  imageOptions?: ImageProcessingOptions;
}

export interface TranslationProgress {
  /** Current image being processed */
  current: number;
  /** Total images to process */
  total: number;
  /** Current status message */
  status: string;
}

export type ProgressCallback = (progress: TranslationProgress) => void;

// ==================== Translator Service Class ====================

/**
 * Translator Service
 * 
 * Manages the translation workflow for manga images.
 */
export class TranslatorService {
  private provider: VisionProvider | null = null;
  private config: TranslatorConfig;
  private abortController: AbortController | null = null;
  private isInitialized = false;

  constructor(config: TranslatorConfig) {
    this.config = config;
  }

  /**
   * Initialize the translator with the configured provider
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && this.provider) {
      return;
    }

    console.log(`[Translator] 初始化 Provider: ${this.config.provider}`);
    this.provider = await createProvider(this.config.provider, {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
    });

    this.isInitialized = true;
    console.log(`[Translator] Provider 初始化完成: ${this.provider.name}`);
  }

  /**
   * Translate a single image
   * 
   * @param image Image element to translate
   * @returns Translation result
   */
  async translateImage(image: HTMLImageElement): Promise<TranslationResult> {
    console.log('[Translator] 开始翻译图片');
    
    // Ensure provider is initialized
    if (!this.provider) {
      await this.initialize();
    }

    if (!this.provider) {
      console.error('[Translator] Provider 未初始化');
      return {
        success: false,
        textAreas: [],
        error: 'Provider not initialized',
      };
    }

    try {
      // Process image (compress if needed, get base64 and hash)
      console.log('[Translator] 处理图片...');
      const processed = await processImage(image, this.config.imageOptions);
      console.log('[Translator] 图片处理完成, hash:', processed.hash.substring(0, 16));

      // Check cache first
      if (this.config.cacheEnabled) {
        const cached = useTranslationCacheStore.getState().get(processed.hash);
        if (cached) {
          console.log('[Translator] 使用缓存结果, 文字区域数:', cached.textAreas.length);
          return cached;
        }
      }

      // Call provider API
      console.log(`[Translator] 调用 Vision LLM: ${this.provider.name}`);
      const response = await this.provider.analyzeAndTranslate(
        processed.base64,
        this.config.targetLanguage
      );
      console.log('[Translator] Vision LLM 返回结果, 文字区域数:', response.textAreas.length);

      const result: TranslationResult = {
        success: true,
        textAreas: response.textAreas,
      };

      // Store in cache
      if (this.config.cacheEnabled) {
        console.log('[Translator] 存入缓存');
        useTranslationCacheStore.getState().set(
          processed.hash,
          result,
          this.config.provider
        );
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Translator] 翻译失败:', errorMessage);
      // Include stack trace in development mode
      if (error instanceof Error && error.stack) {
        console.error('[Translator] 错误堆栈:', error.stack);
      }
      return {
        success: false,
        textAreas: [],
        error: errorMessage,
      };
    }
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
    console.log(`[Translator] 开始批量翻译, 图片数量: ${images.length}`);
    
    // Create new abort controller for this batch
    this.abortController = new AbortController();
    
    const results: TranslationResult[] = [];
    const total = images.length;

    for (let i = 0; i < images.length; i++) {
      // Check if cancelled
      if (this.abortController.signal.aborted) {
        console.log('[Translator] 批量翻译已取消');
        break;
      }

      const image = images[i];
      if (!image) continue;

      // Report progress
      console.log(`[Translator] 处理图片 ${i + 1}/${total}`);
      onProgress?.({
        current: i + 1,
        total,
        status: `翻译中 ${i + 1}/${total}`,
      });

      const result = await this.translateImage(image);
      results.push(result);
    }

    console.log(`[Translator] 批量翻译完成, 成功: ${results.filter(r => r.success).length}/${results.length}`);
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
    if (!this.provider) {
      await this.initialize();
    }

    if (!this.provider) {
      return { valid: false, message: 'Provider not initialized' };
    }

    return this.provider.validateConfig();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TranslatorConfig>): void {
    this.config = { ...this.config, ...config };
    // Reset provider to force re-initialization with new config
    this.provider = null;
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
    imageOptions: {
      maxSize: config.maxImageSize,
    },
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
