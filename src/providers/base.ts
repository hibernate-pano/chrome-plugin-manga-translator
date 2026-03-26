import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  getTranslationStyleInstruction,
  type TranslationStylePreset,
} from '@/utils/translation-style';

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
 * Token 使用量统计（AI API 返回）
 */
export interface TokenUsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Response from Vision LLM analysis
 */
export interface VisionResponse {
  /** Array of detected and translated text areas */
  textAreas: TextArea[];
  /** Raw response from the API (for debugging) */
  rawResponse?: string;
  /** Token 使用量（用于统计费用） */
  usage?: TokenUsageInfo;
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
export type ProviderType =
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'ollama'
  | 'siliconflow'
  | 'dashscope';

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
    targetLanguage: string,
    translationStylePreset?: TranslationStylePreset
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
export function getMangaTranslationPrompt(
  targetLanguage: string,
  translationStylePreset: TranslationStylePreset = DEFAULT_TRANSLATION_STYLE_PRESET
): string {
  return `Extract ALL visible text from this manga/comic image and translate to ${targetLanguage}.

Return ONLY valid JSON: {"textAreas":[{"x":0.1,"y":0.2,"width":0.3,"height":0.1,"originalText":"原文","translatedText":"翻译"}]}

RULES:
1. Find ALL text: bubbles, narration, signs, SFX, tiny side text, faint small captions. Don't miss small text.
2. x,y,width,height are 0.0-1.0 ratios relative to image. x,y = top-left corner. Mark a TIGHT box around the text itself, not the whole speech bubble or empty padding.
3. Merge multi-line text in one bubble into ONE item.
4. SFX: use target language onomatopoeia.
5. Keep original speaker tone (formal/casual).
6. Use \\\\n for line breaks in translatedText.
7. No text found: {"textAreas":[]}
8. If two text blocks are separate, return separate items. Avoid giant boxes that overlap unrelated text.
9. Output ONLY the JSON.

${getTranslationStyleInstruction(translationStylePreset)}`;
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

  // Strip thinking tags (DeepSeek/Qwen models often wrap responses)
  jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

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

  const parseResult = tryParseJson(jsonStr);
  if (parseResult !== null) {
    return validateAndNormalize(parseResult, response);
  }

  // Retry: fix trailing commas before } or ]
  const fixed = jsonStr.replace(/,\s*([\]}])/g, '$1');
  const fixedResult = tryParseJson(fixed);
  if (fixedResult !== null) {
    return validateAndNormalize(fixedResult, response);
  }

  console.warn(
    '[parseVisionResponse] Failed to parse LLM response:',
    response.substring(0, 500)
  );

  // Detect common model incompatibility patterns
  const trimmed = response.trim();
  if (trimmed.length <= 5 && !trimmed.includes('{')) {
    // Truncated garbage like "}" — model doesn't understand the task
    throw new Error(
      'Model returned truncated response. This model may not support structured JSON output. Try switching to a vision-language model like Qwen2.5-VL.'
    );
  }
  if (!trimmed.includes('{') && trimmed.length > 20) {
    // Plain text description — model is doing captioning, not following instructions
    throw new Error(
      'Model returned plain text instead of JSON. This model does not follow instruction format. Try switching to a vision-language model like Qwen2.5-VL.'
    );
  }

  throw new Error(
    `Failed to parse Vision LLM response: ${response.substring(0, 200)}`
  );
}

function tryParseJson(str: string): Record<string, unknown> | null {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function validateAndNormalize(
  parsed: Record<string, unknown>,
  rawResponse: string
): VisionResponse {
  if (!parsed['textAreas'] || !Array.isArray(parsed['textAreas'])) {
    return { textAreas: [], rawResponse };
  }

  const textAreas: TextArea[] = (parsed['textAreas'] as unknown[])
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

  return { textAreas, rawResponse };
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

  if (typeof error === 'string' && error.length > 0) {
    return new Error(`${providerName}: ${error}`);
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err['message'] === 'string') {
      return new Error(`${providerName}: ${err['message']}`);
    }
    if (
      typeof err['error'] === 'object' &&
      err['error'] !== null &&
      typeof (err['error'] as Record<string, unknown>)['message'] === 'string'
    ) {
      return new Error(
        `${providerName}: ${(err['error'] as Record<string, unknown>)['message']}`
      );
    }
  }

  return new Error(`${providerName}: Unknown API error`);
}
