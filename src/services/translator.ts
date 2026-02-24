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
import {
  useTranslationCacheStore,
  type TranslationResult,
} from '@/stores/cache-v2';
import { useAppConfigStore } from '@/stores/config-v2';
import {
  processImage,
  type ImageProcessingOptions,
  cropRegions,
  combineCroppedRegions,
} from './image-processor';
import {
  detectTextRegions,
  mergeOverlappingRegions,
  terminateWorker,
  type TextRegion,
} from './text-detector';
import { retryWithBackoff } from '@/utils/error-handler';

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
  /** Image processing options */
  imageOptions?: ImageProcessingOptions;
  /** Whether to use text detection to crop regions before sending to VLM */
  useTextDetection?: boolean;
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

// ==================== Helper Functions ====================

/**
 * Map translated text areas from cropped image back to original image coordinates
 *
 * When using text detection, the VLM receives a cropped/combined image.
 * This function maps the response coordinates back to the original image.
 */
function mapTranslatedAreasToOriginal(
  translatedAreas: TextArea[],
  detectedRegions: TextRegion[],
  originalWidth: number,
  originalHeight: number
): TextArea[] {
  if (!detectedRegions || detectedRegions.length === 0) {
    return translatedAreas;
  }

  // The combined image is a vertical stack of cropped regions
  // We need to calculate the position of each region in the combined image
  const spacing = 20; // Same as in combineCroppedRegions
  let currentY = 0;
  const regionPositions: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const region of detectedRegions) {
    // Center horizontally in max width
    const maxWidth = Math.max(...detectedRegions.map((r) => r.width));
    const x = Math.round((maxWidth - region.width) / 2);

    regionPositions.push({
      x: x + currentY,
      y: currentY,
      width: region.width,
      height: region.height,
    });

    currentY += region.height + spacing;
  }

  const totalHeight = currentY - spacing;
  const totalWidth = Math.max(...detectedRegions.map((r) => r.width));

  return translatedAreas.map((area) => {
    // Find which region this translation belongs to
    for (let i = 0; i < regionPositions.length; i++) {
      const pos = regionPositions[i];
      if (!pos) continue;

      // Check if this area falls within this region's bounds in the combined image
      if (
        area.y >= pos.y &&
        area.y <= pos.y + pos.height &&
        area.x >= pos.x &&
        area.x <= pos.x + pos.width
      ) {
        // Map coordinates back to original image
        const region = detectedRegions[i];
        if (!region) continue;

        const relativeX = (area.x - pos.x) / pos.width;
        const relativeY = (area.y - pos.y) / pos.height;

        return {
          ...area,
          x: region.x + relativeX * region.width,
          y: region.y + relativeY * region.height,
          // Scale width/height proportionally
          width: (area.width / pos.width) * region.width,
          height: (area.height / pos.height) * region.height,
        };
      }
    }

    // If no matching region found, scale to original dimensions
    return {
      ...area,
      x: (area.x / totalWidth) * originalWidth,
      y: (area.y / totalHeight) * originalHeight,
      width: (area.width / totalWidth) * originalWidth,
      height: (area.height / totalHeight) * originalHeight,
    };
  });
}

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

    console.warn(
      `[Translator] 初始化 Provider: ${this.config.provider}, Model: ${this.config.model || 'default'}`
    );
    this.provider = await createProvider(this.config.provider, {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.model,
    });

    this.isInitialized = true;
    if (import.meta.env.DEV) {
      console.log(`[Translator] Provider 初始化完成: ${this.provider.name}`);
    }
  }

  /**
   * Translate a single image
   *
   * @param image Image element to translate
   * @returns Translation result
   */
  async translateImage(image: HTMLImageElement): Promise<TranslationResult> {
    if (import.meta.env.DEV) {
      console.log('[Translator] 开始翻译图片');
    }

    // Ensure provider is initialized
    if (!this.provider) {
      await this.initialize();
    }

    if (!this.provider) {
      if (import.meta.env.DEV) {
        console.error('[Translator] Provider 未初始化');
      }
      return {
        success: false,
        textAreas: [],
        error: 'Provider not initialized',
      };
    }

    try {
      // Process image (compress if needed, get base64 and hash)
      if (import.meta.env.DEV) {
        console.log('[Translator] 处理图片...');
      }
      const processed = await processImage(image, this.config.imageOptions);
      if (import.meta.env.DEV) {
        console.log(
          '[Translator] 图片处理完成, hash:',
          processed.hash.substring(0, 16)
        );
      }

      // Check cache first
      if (this.config.cacheEnabled) {
        const cached = useTranslationCacheStore.getState().get(processed.hash);
        if (cached) {
          if (import.meta.env.DEV) {
            console.log(
              '[Translator] 使用缓存结果, 文字区域数:',
              cached.textAreas.length
            );
          }
          return cached;
        }
      }

      // Determine what image to send to VLM
      let imageToTranslate = processed.base64;
      let detectedRegions: TextRegion[] | undefined;

      // Optional: Use text detection to crop regions before sending to VLM
      if (this.config.useTextDetection) {
        if (import.meta.env.DEV) {
          console.log('[Translator] 使用文字检测裁剪图像...');
        }

        try {
          const detectionResult = await detectTextRegions(image);

          if (detectionResult.regions.length > 0) {
            // Merge overlapping regions for better coverage
            const mergedRegions = mergeOverlappingRegions(
              detectionResult.regions,
              0.3
            );

            if (import.meta.env.DEV) {
              console.log(
                `[Translator] 检测到 ${mergedRegions.length} 个文字区域`
              );
            }

            // Crop the regions
            const croppedImages = await cropRegions(
              image,
              mergedRegions.map((r) => ({
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
              })),
              this.config.imageOptions
            );

            // Combine all cropped regions into one image
            if (croppedImages.length > 0) {
              imageToTranslate = combineCroppedRegions(croppedImages, {
                ...this.config.imageOptions,
                format: 'png',
              });
              detectedRegions = mergedRegions;

              if (import.meta.env.DEV) {
                console.log(
                  `[Translator] 裁剪完成, 合并为 ${croppedImages.length} 个区域`
                );
              }
            }
          } else {
            if (import.meta.env.DEV) {
              console.log('[Translator] 未检测到文字区域，使用原图');
            }
          }
        } catch (detectError) {
          // If text detection fails, fall back to full image
          console.warn('[Translator] 文字检测失败，使用原图:', detectError);
        }
      }

      // Call provider API with retry for transient errors
      if (import.meta.env.DEV) {
        console.log(`[Translator] 调用 Vision LLM: ${this.provider.name}`);
      }

      const callProvider = () =>
        this.provider!.analyzeAndTranslate(
          imageToTranslate,
          this.config.targetLanguage
        );

      // Use retry for transient errors (timeout, network, rate limit)
      const response = await retryWithBackoff(callProvider, 3, 2000);
      if (import.meta.env.DEV) {
        console.log(
          '[Translator] Vision LLM 返回结果, 文字区域数:',
          response.textAreas.length
        );
      }

      // Map the VLM response coordinates back to original image coordinates
      const textAreas = detectedRegions
        ? mapTranslatedAreasToOriginal(
            response.textAreas,
            detectedRegions,
            processed.originalWidth,
            processed.originalHeight
          )
        : response.textAreas;

      const result: TranslationResult = {
        success: true,
        textAreas,
      };

      // Store in cache
      if (this.config.cacheEnabled) {
        if (import.meta.env.DEV) {
          console.log('[Translator] 存入缓存');
        }
        useTranslationCacheStore
          .getState()
          .set(processed.hash, result, this.config.provider);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      // Always log translation errors for diagnostics
      console.warn('[Translator] 翻译失败:', errorMessage);
      if (import.meta.env.DEV && error instanceof Error && error.stack) {
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
    if (import.meta.env.DEV) {
      console.log(`[Translator] 开始批量翻译, 图片数量: ${images.length}`);
    }

    // Create new abort controller for this batch
    this.abortController = new AbortController();

    const results: TranslationResult[] = [];
    const total = images.length;

    for (let i = 0; i < images.length; i++) {
      // Check if cancelled
      if (this.abortController.signal.aborted) {
        if (import.meta.env.DEV) {
          console.log('[Translator] 批量翻译已取消');
        }
        break;
      }

      const image = images[i];
      if (!image) continue;

      // Report progress
      if (import.meta.env.DEV) {
        console.log(`[Translator] 处理图片 ${i + 1}/${total}`);
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

    if (import.meta.env.DEV) {
      console.log(
        `[Translator] 批量翻译完成, 成功: ${results.filter(r => r.success).length}/${results.length}`
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
    // Enable text detection by default to save tokens
    useTextDetection: true,
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
