import type { TextArea } from '@/providers/base';
import type {
  JobPriorityClass,
  TranslateImageJobRequest,
  TranslateImageJobResponse,
} from '@/shared/runtime-contracts';
import type { TranslationStylePreset } from '@/utils/translation-style';

/**
 * A translation request on its way to the worker.
 *
 * It carries the image and the output preferences, never the provider
 * settings. The worker resolves the provider, the endpoint and the API key
 * from the authoritative configuration: a request that named them could send
 * the user's key to an endpoint of the requester's choosing.
 */
interface TranslationTransportRequest {
  imageBase64: string;
  mimeType: string;
  imageKey?: string;
  pageUrl?: string;
  imageUrl?: string;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  forceRefresh?: boolean;
  jobId?: string;
  pageKey?: string;
  priorityClass?: JobPriorityClass;
  scope?: 'viewport' | 'page' | 'chapter' | 'manual';
  isHybridRegions?: boolean;
}

interface TranslationTransportResponse {
  success: boolean;
  error?: string;
  textAreas?: TextArea[];
  /**
   * Bubbles the model found and translated but gave no box for.
   *
   * There is nowhere to draw them, so the caller has to say so.
   */
  unplacedCount?: number;
  pipeline?: 'ocr-first' | 'region-fallback' | 'full-image-fallback';
  cached?: boolean;
  diagnostics?: {
    detectedRegions: number;
    fallbackRegions: number;
    ocrMs: number;
    translateMs: number;
    totalMs: number;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface TranslationTransport {
  translateImage(
    request: TranslationTransportRequest
  ): Promise<TranslationTransportResponse>;
}

/**
 * Generate a job id that works in EVERY context the content script runs in.
 *
 * `crypto.randomUUID()` is a `[SecureContext]` API. A content script
 * inherits the page's secure-context state, so on a plain `http://` page
 * `crypto.randomUUID` is `undefined` and calling it throws a TypeError —
 * which used to be swallowed into a bare `{success: false}`, making the
 * extension look completely broken on every non-HTTPS manga site.
 *
 * `crypto.getRandomValues` is available in insecure contexts, so it is the
 * primary source; the timestamp+Math.random pair is the last resort for
 * environments that expose neither.
 */
export function generateJobId(): string {
  const cryptoRef: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    try {
      return cryptoRef.randomUUID();
    } catch {
      // Some embedders expose randomUUID but throw on it. Fall through.
    }
  }

  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    try {
      const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
      // RFC 4122 version 4 layout, so the value is still a well-formed UUID.
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
      ].join('-');
    } catch {
      // Fall through to the last-resort id.
    }
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class ChromeRuntimeTranslationTransport implements TranslationTransport {
  async translateImage(
    request: TranslationTransportRequest
  ): Promise<TranslationTransportResponse> {
    const pageKey =
      request.pageKey || request.imageUrl || request.imageKey || 'inline-image';

    const response = this.normalizeJobResponse(
      (await chrome.runtime.sendMessage({
        type: 'JOB_TRANSLATE_IMAGE',
        jobId: request.jobId || generateJobId(),
        pageKey,
        scope: request.scope || 'page',
        priorityClass: request.priorityClass || 'visible-now',
        imageBase64: request.imageBase64,
        mimeType: request.mimeType,
        imageUrl: request.imageUrl,
        sourcePageUrl: request.pageUrl,
        targetLanguage: request.targetLanguage,
        translationStylePreset: request.translationStylePreset,
        forceRefresh: request.forceRefresh,
        isHybridRegions: request.isHybridRegions,
      } satisfies TranslateImageJobRequest)) as
        | TranslateImageJobResponse
        | undefined
    );

    if (!response) {
      throw new Error('Background script 无响应，请刷新页面后重试');
    }

    return response;
  }

  private normalizeJobResponse(
    response: TranslateImageJobResponse | undefined
  ): TranslationTransportResponse | undefined {
    if (!response) {
      return undefined;
    }

    return {
      success: response.success,
      error: response.error,
      textAreas: response.textAreas,
      unplacedCount: response.unplacedCount,
      pipeline: response.pipeline,
      cached: response.cached,
      diagnostics: response.job.diagnostics ?? undefined,
      usage: response.usage ?? null,
    };
  }
}

const defaultTransport: TranslationTransport =
  new ChromeRuntimeTranslationTransport();

export function getDefaultTranslationTransport(): TranslationTransport {
  return defaultTransport;
}
