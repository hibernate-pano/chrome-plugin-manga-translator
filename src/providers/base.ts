import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  getTargetLanguageName,
  getTranslationStyleInstruction,
  type TranslationStylePreset,
} from '@/utils/translation-style';
import {
  formatHttpStatusMessage,
  type HttpStatusError,
} from '@/utils/error-handler';

/**
 * Vision Provider Base Interface
 *
 * Defines the contract for the surviving Vision LLM providers
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
  /**
   * How many areas the model returned that we could not place on the page.
   *
   * These are bubbles the model found and translated but did not give a box
   * for, so there is nowhere to draw the translation. The page shows fewer
   * bubbles than the model found, and the difference has to be visible to
   * the reader — a bubble that is still in the source language while the
   * page says "translated" is a lie.
   */
  unplacedCount?: number;
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
 * Standardized image data for providers
 */
interface ImageData {
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
export type ProviderType = 'openai-compatible' | 'ollama' | 'lm-studio';

/*
 * "Does this provider need an API key?" is answered in
 * `@/shared/local-providers`, next to the list it is derived from. It used
 * to be answered here, and the content script — which runs on every page —
 * had to import this whole module (the provider base class, the prompt
 * builders, the response parsers) just to ask it.
 */
export { providerRequiresApiKey } from '@/shared/local-providers';

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
    translationStylePreset?: TranslationStylePreset,
    isHybridRegions?: boolean
  ): Promise<VisionResponse>;

  /**
   * Check the configuration locally, without touching the network.
   *
   * This is the check the content script can run: it executes inside the page
   * and is subject to the page's CORS rules, so it must not make provider
   * requests. It answers "is this configuration complete?", not "does this
   * endpoint work?".
   */
  validateConfig(): Promise<ValidationResult>;

  /**
   * Probe the configured endpoint for real.
   *
   * Only safe to call from an extension page (Options), which has host
   * permissions and is not subject to page CORS. Optional: callers should
   * fall back to `validateConfig` when a provider does not implement it.
   *
   * `allowBillableProbe` decides whether the probe may fall back to an
   * endpoint that charges for it. A gateway that does not expose `/models`
   * can only be checked with a real completion, which the provider bills
   * for — so a background poll must not be allowed to spend the user's
   * money every fifteen minutes to keep a status dot green. The explicit
   * 「测试配置」 button may: the user asked for a real test, and the page
   * says so next to the button.
   */
  testConnection?(options?: {
    allowBillableProbe?: boolean;
  }): Promise<ValidationResult>;
}

/**
 * Default prompt template for manga translation
 *
 * @param targetLanguage The target language for translation
 * @returns Formatted prompt string
 */
export function getMangaTranslationPrompt(
  targetLanguage: string,
  translationStylePreset: TranslationStylePreset = DEFAULT_TRANSLATION_STYLE_PRESET,
  isHybridRegions: boolean = false
): string {
  // The style instruction names the language it wants. It used to always
  // name Chinese, which contradicted the target-language setting whenever
  // the user picked something else.
  const styleInstruction = getTranslationStyleInstruction(
    translationStylePreset,
    targetLanguage
  );
  const languageName = getTargetLanguageName(targetLanguage);

  if (isHybridRegions) {
    /*
     * 拼图条提示词。
     *
     * 送去的图不是一张漫画页，而是**一叠互不相关的裁剪**：每一块是 OCR
     * 找到的一个文字区，块与块之间没有任何关系。以前这条路上用的是整图
     * 那条提示词，而它明明白白写着"把一个气泡里的多行合并成一个条目"——
     * 在一叠裁剪上，模型会把相邻的两块当成同一个气泡，合成一个大框。
     * 译文于是画进其中一个气泡，另一个气泡什么都没有，而这一轮仍然被
     * 记成成功。
     *
     * 根因不是模型不听话，是这张图长得就不像提示词说的那样。现在这条
     * 提示词说的就是这张图：竖着排的若干块，块与块之间有分隔线，块里
     * 的文字和邻居无关。
     */
    return `Translate the text in this image to ${languageName}.

The image is NOT one comic page. It is a vertical stack of SEPARATE cropped blocks, and a horizontal rule separates each block from the next. The text inside one block has nothing to do with the text in its neighbours.

Return ONLY valid JSON in this format:
{"textAreas":[{"x":0.1,"y":0.2,"width":0.3,"height":0.1,"originalText":"<source text>","translatedText":"<translation>"}]}

RULES:
1. x,y,width,height are 0.0-1.0 ratios relative to THIS WHOLE IMAGE (the whole stack), x,y = top-left corner.
2. The box MUST fully CONTAIN every character of the text it covers. Leave a small margin around the glyphs.
3. NEVER merge text from two different blocks into one item. One block is one region; a bubble never spans two blocks. Return one item per text block.
4. Translate the text in every block that has text. If a block has no text, skip it.
5. Output ONLY valid JSON. No conversational wrapper.

${styleInstruction}`;
  }

  return `Extract ALL visible text from this manga/comic image and translate to ${languageName}.

Return ONLY valid JSON: {"textAreas":[{"x":0.1,"y":0.2,"width":0.3,"height":0.1,"originalText":"<source text>","translatedText":"<translation>"}]}

RULES:
1. Find ALL text: bubbles, narration, signs, SFX, tiny side text, faint small captions. Don't miss small text.
2. x,y,width,height are 0.0-1.0 ratios relative to image. x,y = top-left corner. The box MUST fully CONTAIN every character of the text — the translation is drawn on top of this box and covers the original, so any character outside the box stays visible next to the translation. Leave a small margin (about 5% of the text size) around the glyphs. Do NOT clip a character, and do NOT shrink the box to the first line of a multi-line bubble: ALL lines of the bubble must be inside the box.
3. Merge multi-line text in one bubble into ONE item — one box covering all of its lines.
4. SFX: use target language onomatopoeia.
5. Keep original speaker tone (formal/casual).
6. Use \\\\n for line breaks in translatedText.
7. No text found: {"textAreas":[]}
8. If two text blocks are separate, return separate items. Avoid giant boxes that overlap unrelated text.
9. Output ONLY the JSON.
10. Source language may be KOREAN (webtoon), Japanese, or English. For Korean: translate casual 반말 as the casual register of the target language, honorific -요/-습니다 as its polite register, and keep Korean webtoon netspeak idiomatic in the target language rather than literal.
11. Do NOT invent text — only return areas for text you can actually read. If the image is unreadable or empty, return {"textAreas":[]} EXACTLY, never hallucinate bubbles.

${styleInstruction}`;
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

  // Detect truncated JSON (model hit the token ceiling mid-output).
  // The response is cut off at an object/array boundary without closing it.
  const trimmed = response.trim();
  const openBraces = (trimmed.match(/\{/g) ?? []).length;
  const closeBraces = (trimmed.match(/\}/g) ?? []).length;
  const openBrackets = (trimmed.match(/\[/g) ?? []).length;
  const closeBrackets = (trimmed.match(/\]/g) ?? []).length;
  const looksTruncated =
    trimmed.includes('{') &&
    (openBraces !== closeBraces || openBrackets !== closeBrackets) &&
    !trimmed.endsWith('}') &&
    !trimmed.endsWith(']');
  if (looksTruncated) {
    throw new Error(
      'Model response was cut off (token limit reached). The image is probably very long or dense. The tiled pipeline avoids this for long strips; if you still see this, increase MAX_TOKENS in providers/constants.ts.'
    );
  }

  // Detect common model incompatibility patterns
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
  /*
   * 缺 `textAreas` 字段是"格式不对"，不是"这一页没有文字"。
   *
   * 提示词里写得很清楚：没有文字时返回 `{"textAreas":[]}`。所以字段缺失
   * 只可能是模型没照格式来（大小写写错、字段名换了、包了一层）。以前这
   * 种回答被读成"一个文字区都没有"，然后被当成"这一页确实没有文字"缓存
   * 下来 —— 用户付了钱，看到的是一页没翻的漫画，而且永远不会再问第二次。
   *
   * 抛错比空答案诚实：这一轮算失败，可以重试，错误也会摆到用户面前。
   */
  if (!('textAreas' in parsed)) {
    throw new Error(
      'Model response has no "textAreas" field. The model did not follow the requested format (an empty page must be answered as {"textAreas":[]}).'
    );
  }
  if (!Array.isArray(parsed['textAreas'])) {
    throw new Error(
      'Model response has a "textAreas" field that is not an array. The model did not follow the requested format.'
    );
  }

  const rawAreas = parsed['textAreas'] as unknown[];
  const textAreas: TextArea[] = [];
  let unusableBoxes = 0;

  for (const area of rawAreas) {
    if (typeof area !== 'object' || area === null) {
      continue;
    }
    const a = area as Record<string, unknown>;
    const hasTranslatedText = typeof a['translatedText'] === 'string';
    const isXValid = a['x'] === undefined || typeof a['x'] === 'number';
    const isYValid = a['y'] === undefined || typeof a['y'] === 'number';
    const isWValid = a['width'] === undefined || typeof a['width'] === 'number';
    const isHValid =
      a['height'] === undefined || typeof a['height'] === 'number';
    if (
      !hasTranslatedText ||
      !isXValid ||
      !isYValid ||
      !isWValid ||
      !isHValid
    ) {
      continue;
    }

    const x = clampRatio(a['x']);
    const y = clampRatio(a['y']);
    const width = clampRatio(a['width']);
    const height = clampRatio(a['height']);

    /*
     * 没有框的翻译不能画。
     *
     * 以前的做法是把缺失的坐标当成 0，于是模型忘了给坐标时，这句译文会
     * 以最小字号被画成左上角一列单字 —— 盖在画面上，而真正的气泡还留着
     * 日文。这种"画出来了"的假成功比"没画"更糟。
     *
     * 拼图条那条路以前有个例外：模型只给编号不给框时，编号被拿来认位置。
     * 现在那条路的提示词也要坐标（拼图条是一张真图，位置本来就有），编号
     * 是模型自己编的，认它反而会把译文画到别的块上去。例外取消：没有框
     * 的条目一律丢掉，并且记进"没翻出来"的数字里，用户看得见。
     */
    if (width <= 0 || height <= 0) {
      unusableBoxes += 1;
      continue;
    }

    textAreas.push({
      x,
      y,
      width,
      height,
      originalText: (a['originalText'] as string) || '',
      translatedText: a['translatedText'] as string,
    });
  }

  /*
   * 框越界的条目：让它落在图里，而不是被渲染器挪到别处。
   *
   * 以前 x、y、width、height 是各自夹到 [0,1] 的，所以 x=0.9、width=0.5
   * 这种（右边缘超出图外 40%）会被保留，渲染器再把面板往左挪 —— 译文就
   * 画在了模型没有指的地方。夹宽度更诚实：框小了，但还在模型说的位置。
   */
  const clamped = textAreas.map(area => {
    const maxWidth = Math.max(0, 1 - area.x);
    const maxHeight = Math.max(0, 1 - area.y);
    if (area.width <= maxWidth && area.height <= maxHeight) {
      return area;
    }
    return {
      ...area,
      width: Math.min(area.width, maxWidth),
      height: Math.min(area.height, maxHeight),
    };
  });

  return { textAreas: clamped, rawResponse, unplacedCount: unusableBoxes };
}

/**
 * A ratio of the image, clamped to [0, 1].
 */
function clampRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
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
 *
 * `status` is the HTTP status of the response that failed. It is carried on
 * the error object AND embedded in the message, because the background worker
 * flattens errors to plain messages before they reach the content script —
 * without the in-message marker the status is lost and every provider
 * failure degrades to a generic "翻译失败" instead of "API 密钥无效".
 */
export function createApiError(
  error: unknown,
  providerName: string,
  status?: number
): HttpStatusError {
  if (typeof status === 'number' && status > 0) {
    return createApiErrorWithStatus(error, providerName, status);
  }
  return new Error(formatApiErrorMessage(error, providerName));
}

/**
 * Extract a human-readable message out of the many shapes an API error can
 * take, without the HTTP status decoration.
 */
function formatApiErrorMessage(error: unknown, providerName: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return `${providerName}: ${error}`;
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err['message'] === 'string') {
      return `${providerName}: ${err['message']}`;
    }
    if (
      typeof err['error'] === 'object' &&
      err['error'] !== null &&
      typeof (err['error'] as Record<string, unknown>)['message'] === 'string'
    ) {
      return `${providerName}: ${(err['error'] as Record<string, unknown>)['message']}`;
    }
  }

  return `${providerName}: Unknown API error`;
}

/**
 * Create an API error that carries the HTTP status of the failed response.
 *
 * The status lands in two places on purpose:
 * - `error.status` for in-process consumers (the extension page, the
 *   provider's own tests) that can read the object directly.
 * - the message, prefixed with `[HTTP <code>]`, for every consumer that
 *   only ever sees a string — the background worker's `getErrorMessage()`
 *   flattening is the common case.
 */
export function createApiErrorWithStatus(
  error: unknown,
  providerName: string,
  status: number
): HttpStatusError {
  const base = formatApiErrorMessage(error, providerName);
  const withStatus: HttpStatusError = new Error(
    formatHttpStatusMessage(status, base)
  );
  withStatus.status = status;
  return withStatus;
}
