import type { TextArea } from '@/providers/base';
import type { TranslationStylePreset } from '@/utils/translation-style';

export type SupportedSite = 'manhwaread';

export interface PageSupportState {
  supported: boolean;
  site: SupportedSite | null;
  reason: string | null;
}

export interface TranslationDiagnostics {
  detectedRegions: number;
  fallbackRegions: number;
  ocrMs: number;
  translateMs: number;
  totalMs: number;
}

export type RequestedExecutionPath =
  | 'plugin-direct'
  | 'ollama-direct';

/**
 * Derive the execution path based on provider type.
 * Local providers (ollama, lm-studio) use direct execution,
 * while cloud providers use plugin-mediated execution.
 */
export function deriveRequestedPath(
  provider: string
): RequestedExecutionPath {
  return (provider === 'ollama' || provider === 'lm-studio')
    ? 'ollama-direct'
    : 'plugin-direct';
}

export type JobPriorityClass =
  | 'visible-now'
  | 'next-up'
  | 'warm-cache'
  | 'manual-retry'
  | 'deferred-failure';

export type JobScope = 'viewport' | 'page' | 'chapter' | 'manual';

export interface FetchImageBytesRequest {
  type: 'FETCH_IMAGE_BYTES';
  imageUrl: string;
}

export interface FetchImageBytesResponse {
  success: boolean;
  error?: string;
  imageBase64?: string;
  mimeType?: string;
}

export interface JobStatusPayload {
  jobId: string;
  pageKey: string;
  priorityClass: JobPriorityClass;
  requestedPath: RequestedExecutionPath;
  actualCapabilityUsed?: RequestedExecutionPath;
  scope: JobScope;
  state:
    | 'queued'
    | 'running'
    | 'partial'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  fallbackReason?: string;
  diagnostics?: (TranslationDiagnostics & {
    retryCount?: number;
    cacheStatus?: 'hit' | 'miss' | 'bypass';
  }) | null;
}

export interface TranslateImageJobRequest {
  type: 'JOB_TRANSLATE_IMAGE';
  jobId: string;
  pageKey: string;
  scope: JobScope;
  priorityClass: JobPriorityClass;
  requestedPath: RequestedExecutionPath;
  imageBase64: string;
  mimeType: string;
  imageUrl?: string;
  sourcePageUrl?: string;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  forceRefresh?: boolean;
}

export interface TranslateImageJobResponse {
  success: boolean;
  job: JobStatusPayload;
  textAreas: TextArea[];
  pipeline?: 'ocr-first' | 'region-fallback' | 'full-image-fallback';
  cached?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  error?: string;
}

export interface QueryJobStatusRequest {
  type: 'JOB_QUERY_STATUS';
  jobId: string;
}

export interface QueryJobStatusResponse {
  success: boolean;
  job?: JobStatusPayload;
  error?: string;
}

export type BackgroundRequest =
  | FetchImageBytesRequest
  | TranslateImageJobRequest
  | QueryJobStatusRequest;

export type BackgroundResponse =
  | FetchImageBytesResponse
  | TranslateImageJobResponse
  | QueryJobStatusResponse;
