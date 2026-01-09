/**
 * Vision Provider Base Interface
 *
 * Defines the contract for all Vision LLM providers (OpenAI, Claude, DeepSeek, Ollama)
 * that can analyze manga images and return translation results.
 */

/**
 * Represents a detected text area in the manga image with its translation
 */
export interface TextArea {
  /** X coordinate relative to image width (0-1) */
  x: number;
  /** Y coordinate relative to image height (0-1) */
  y: number;
  /** Width relative to image width (0-1) */
  width: number;
  /** Height relative to image height (0-1) */
  height: number;
  /** Original text detected in the image */
  originalText: string;
  /** Translated text */
  translatedText: string;
}

/**
 * Response from Vision LLM analysis
 */
export interface VisionResponse {
  /** Array of detected and translated text areas */
  textAreas: TextArea[];
  /** Raw response from the API (for debugging) */
  rawResponse?: string;
}

/**
 * Configuration for a Vision Provider
 */
export interface ProviderConfig {
  /** API key for cloud providers */
  apiKey?: string;
  /** Custom API base URL */
  baseUrl?: string;
  /** Model name to use */
  model?: string;
}

/**
 * Result of configuration validation
 */
export interface ValidationResult {
  valid: boolean;
  message: string;
}

/**
 * Common API response structure
 */
export interface ApiResponse {
  content?: string;
  error?: {
    type: string;
    message: string;
    code?: string;
  };
}

/**
 * Standardized image data for providers
 */
export interface ImageData {
  base64: string;
  mediaType: string;
}

/**
 * Result of configuration validation
 */
export interface ValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;
  /** Human-readable message explaining the result */
  message: string;
}

/**
 * Supported provider types
 */
export type ProviderType = 'openai' | 'claude' | 'deepseek' | 'ollama';

/**
 * Vision Provider Interface
 *
 * All Vision LLM providers must implement this interface to be used
 * by the translation service.
 */
export interface VisionProvider {
  /** Display name of the provider */
  readonly name: string;

  /** Provider type identifier */
  readonly type: ProviderType;

  /**
   * Initialize the provider with configuration
   * @param config Provider-specific configuration
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Analyze a manga image and return translation results
   *
   * This is the core method that:
   * 1. Sends the image to the Vision LLM
   * 2. Receives text detection and translation results
   * 3. Parses and returns structured data
   *
   * @param imageBase64 Base64-encoded image data
   * @param targetLanguage Target language for translation (e.g., 'zh-CN')
   * @returns Promise resolving to detected text areas with translations
   */
  analyzeAndTranslate(
    imageBase64: string,
    targetLanguage: string
  ): Promise<VisionResponse>;

  /**
   * Validate the current configuration
   * @returns Promise resolving to validation result
   */
  validateConfig(): Promise<ValidationResult>;
}

/**
 * Default prompt template for manga translation
 *
 * @param targetLanguage The target language for translation
 * @returns Formatted prompt string
 */
export function getMangaTranslationPrompt(targetLanguage: string): string {
  return `你是一个专业的漫画翻译助手。请分析这张漫画图片，完成以下任务：

1. 识别图片中所有的文字区域（对话气泡、旁白、音效等）
2. 将识别到的文字翻译成${targetLanguage}
3. 返回每个文字区域的位置和翻译结果

请以 JSON 格式返回结果：
{
  "textAreas": [
    {
      "x": 0.1,
      "y": 0.2,
      "width": 0.3,
      "height": 0.1,
      "originalText": "原文",
      "translatedText": "翻译"
    }
  ]
}

注意：
- 坐标使用相对比例（0-1），不是像素值
- 按照漫画阅读顺序排列（日漫从右到左，韩漫从左到右）
- 保持翻译的语气和风格与原文一致
- 如果图片中没有文字，返回空数组 {"textAreas": []}`;
}

/**
 * Parse Vision LLM response to extract text areas
 *
 * Handles both raw JSON and Markdown-wrapped JSON responses
 *
 * @param response Raw response string from the API
 * @returns Parsed VisionResponse
 * @throws Error if parsing fails
 */
export function parseVisionResponse(response: string): VisionResponse {
  let jsonStr = response.trim();

  // Handle Markdown code block wrapper
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch && jsonMatch[1]) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object in the response
  const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    jsonStr = jsonObjectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate the structure
    if (!parsed.textAreas || !Array.isArray(parsed.textAreas)) {
      return { textAreas: [], rawResponse: response };
    }

    // Validate and normalize each text area
    const textAreas: TextArea[] = parsed.textAreas
      .filter((area: unknown): area is Record<string, unknown> => {
        if (typeof area !== 'object' || area === null) return false;
        const a = area as Record<string, unknown>;
        return (
          typeof a['x'] === 'number' &&
          typeof a['y'] === 'number' &&
          typeof a['width'] === 'number' &&
          typeof a['height'] === 'number' &&
          typeof a['translatedText'] === 'string'
        );
      })
      .map((area: Record<string, unknown>) => ({
        x: Math.max(0, Math.min(1, area['x'] as number)),
        y: Math.max(0, Math.min(1, area['y'] as number)),
        width: Math.max(0, Math.min(1, area['width'] as number)),
        height: Math.max(0, Math.min(1, area['height'] as number)),
        originalText: (area['originalText'] as string) || '',
        translatedText: area['translatedText'] as string,
      }));

    return { textAreas, rawResponse: response };
  } catch {
    throw new Error(
      `Failed to parse Vision LLM response: ${response.substring(0, 200)}`
    );
  }
}

// ==================== Abstract Base Provider ====================

/**
 * Abstract base class for vision providers with common functionality
 */
export abstract class BaseVisionProvider implements VisionProvider {
  abstract readonly name: string;
  abstract readonly type: ProviderType;

  protected config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model || this.getDefaultModel(),
      baseUrl: config.baseUrl || this.getDefaultBaseUrl(),
    };
  }

  async validateConfig(): Promise<ValidationResult> {
    if (!this.config.apiKey) {
      return { valid: false, message: 'API key is required' };
    }

    return { valid: true, message: 'Configuration is valid' };
  }

  abstract analyzeAndTranslate(
    imageBase64: string,
    targetLanguage: string
  ): Promise<VisionResponse>;

  /**
   * Get the default model for this provider
   */
  protected abstract getDefaultModel(): string;

  /**
   * Get the default base URL for this provider
   */
  protected abstract getDefaultBaseUrl(): string;
}

// ==================== Utility Functions ====================

/**
 * Parse base64 data URL and return standardized ImageData
 */
export function parseImageData(base64: string): ImageData {
  if (base64.startsWith('data:')) {
    const match = base64.match(/^data:([^;]+);base64,(.+)$/);
    if (match && match[1] && match[2]) {
      return {
        base64: match[2],
        mediaType: match[1],
      };
    }
  }

  // Assume JPEG if no data URL prefix
  return {
    base64,
    mediaType: 'image/jpeg',
  };
}

/**
 * Create standardized API error from various provider error formats
 */
export function createApiError(error: unknown, providerName: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as any;
    if (err.message) {
      return new Error(`${providerName}: ${err.message}`);
    }
    if (err.error?.message) {
      return new Error(`${providerName}: ${err.error.message}`);
    }
  }

  return new Error(`${providerName}: Unknown API error`);
}
