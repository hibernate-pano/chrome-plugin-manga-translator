import type { TextArea } from '@/providers/base';
import type {
  JobPriorityClass,
  RequestedExecutionPath,
  TranslateImageJobRequest,
  TranslateImageJobResponse,
  TranslateViaServerResponse,
} from '@/shared/runtime-contracts';
import type { TranslationStylePreset } from '@/utils/translation-style';

export interface ServerExecutionConfig {
  enabled: boolean;
  baseUrl: string;
  authToken: string;
  timeoutMs: number;
}

export interface TranslationTransportRequest {
  imageBase64: string;
  mimeType: string;
  imageKey?: string;
  pageUrl?: string;
  imageUrl?: string;
  targetLanguage: string;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  executionMode?: 'server' | 'provider-direct';
  requestedPath?: RequestedExecutionPath;
  server?: ServerExecutionConfig;
  renderMode?: 'anchors-only' | 'strong-overlay-compat';
  translationStylePreset: TranslationStylePreset;
  forceRefresh?: boolean;
  jobId?: string;
  pageKey?: string;
  priorityClass?: JobPriorityClass;
  scope?: 'viewport' | 'page' | 'chapter' | 'manual';
}

export interface TranslationTransportResponse {
  success: boolean;
  error?: string;
  textAreas?: TextArea[];
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

export class ChromeRuntimeTranslationTransport implements TranslationTransport {
  async translateImage(
    request: TranslationTransportRequest
  ): Promise<TranslationTransportResponse> {
    const requestedPath = this.resolveRequestedPath(request);
    const pageKey = request.pageKey || request.imageUrl || request.imageKey || 'inline-image';

    const response = this.normalizeJobResponse(
      (await chrome.runtime.sendMessage({
        type: 'JOB_TRANSLATE_IMAGE',
        jobId: request.jobId || crypto.randomUUID(),
        pageKey,
        scope: request.scope || 'page',
        priorityClass: request.priorityClass || 'visible-now',
        requestedPath,
        imageBase64: request.imageBase64,
        mimeType: request.mimeType,
        imageUrl: request.imageUrl,
        sourcePageUrl: request.pageUrl,
        targetLanguage: request.targetLanguage,
        translationStylePreset: request.translationStylePreset,
        provider: request.provider,
        apiKey: request.apiKey,
        baseUrl: request.baseUrl,
        model: request.model,
        forceRefresh: request.forceRefresh,
      } satisfies TranslateImageJobRequest)) as
        | TranslateImageJobResponse
        | TranslateViaServerResponse
        | undefined
    );

    if (!response) {
      throw new Error('Background script 无响应，请刷新页面后重试');
    }

    return response;
  }

  private resolveRequestedPath(
    request: TranslationTransportRequest
  ): RequestedExecutionPath {
    if (request.requestedPath) {
      return request.requestedPath;
    }

    if (request.executionMode === 'server') {
      return 'accelerator';
    }

    return request.provider === 'ollama' ? 'ollama-direct' : 'plugin-direct';
  }

  private normalizeJobResponse(
    response:
      | TranslateImageJobResponse
      | TranslateViaServerResponse
      | undefined
  ): TranslationTransportResponse | undefined {
    if (!response) {
      return undefined;
    }

    if ('job' in response) {
      return {
        success: response.success,
        error: response.error,
        textAreas: response.textAreas,
        pipeline: response.pipeline,
        cached: response.cached,
        diagnostics: response.job.diagnostics ?? undefined,
        usage: response.usage ?? null,
      };
    }

    return {
      ...response,
      diagnostics: response.diagnostics ?? undefined,
    };
  }
}

let defaultTransport: TranslationTransport =
  new ChromeRuntimeTranslationTransport();

export function getDefaultTranslationTransport(): TranslationTransport {
  return defaultTransport;
}

export function setDefaultTranslationTransport(
  transport: TranslationTransport
): void {
  defaultTransport = transport;
}

export function resetDefaultTranslationTransport(): void {
  defaultTransport = new ChromeRuntimeTranslationTransport();
}
