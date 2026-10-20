import type { TextArea } from '@/providers/base';
import type { ContentConfigSnapshot } from '@/shared/content-config';
import type { TranslationStylePreset } from '@/utils/translation-style';

export type SupportedSite = 'manhwaread';

export interface TranslationDiagnostics {
  detectedRegions: number;
  fallbackRegions: number;
  ocrMs: number;
  translateMs: number;
  totalMs: number;
}

export type RequestedExecutionPath = 'plugin-direct' | 'ollama-direct';

/**
 * Derive the execution path based on provider type.
 * Local providers (ollama, lm-studio) use direct execution,
 * while cloud providers use plugin-mediated execution.
 */
export function deriveRequestedPath(provider: string): RequestedExecutionPath {
  return provider === 'ollama' || provider === 'lm-studio'
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
  diagnostics?:
    | (TranslationDiagnostics & {
        retryCount?: number;
        cacheStatus?: 'hit' | 'miss' | 'bypass';
      })
    | null;
}

/**
 * A translation job, as it travels from a content script to the worker.
 *
 * The request carries the *work*, never the *credentials*. `provider`,
 * `apiKey`, `baseUrl` and `model` used to be part of it, which meant any
 * content script able to post a message could choose the endpoint that the
 * user's API key was sent to. The worker now resolves the provider and its
 * settings from the authoritative configuration instead, so the only endpoint
 * a request can ever reach is the one the user configured.
 */
export interface TranslateImageJobRequest {
  type: 'JOB_TRANSLATE_IMAGE';
  jobId: string;
  pageKey: string;
  scope: JobScope;
  priorityClass: JobPriorityClass;
  imageBase64: string;
  mimeType: string;
  imageUrl?: string;
  sourcePageUrl?: string;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  forceRefresh?: boolean;
  isHybridRegions?: boolean;
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

/**
 * Ask the worker for the redacted configuration.
 *
 * The worker answers with a snapshot that carries no credential — see
 * `@/shared/content-config`. Content scripts use it instead of reading
 * `chrome.storage.local` themselves, so the master switch and the provider
 * settings they act on are the worker's view of the truth.
 */
export interface GetConfigRequest {
  type: 'GET_CONFIG';
}

export interface GetConfigResponse {
  success: boolean;
  config?: ContentConfigSnapshot;
  error?: string;
}

/**
 * Ask the worker to check that the configured provider is usable.
 *
 * The check needs the API key, so it cannot run in the content script: the
 * worker builds the provider from the authoritative configuration and
 * reports back only whether the configuration is valid.
 */
export interface ProviderPreflightRequest {
  type: 'PROVIDER_PREFLIGHT';
}

export interface ProviderPreflightResponse {
  success: boolean;
  valid: boolean;
  message: string;
  error?: string;
}

/**
 * The worker telling every tab that the configuration changed.
 *
 * The payload is the same redacted snapshot, so a content script can refresh
 * its view without reading storage.
 */
export interface ConfigUpdatedMessage {
  type: 'CONFIG_UPDATED';
  config: ContentConfigSnapshot;
}
