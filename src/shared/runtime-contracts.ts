import type { TextArea } from '@/providers/base';
import type { TranslationStylePreset } from '@/utils/translation-style';

export type SupportedSite = 'manhwaread';

export interface PageSupportState {
  supported: boolean;
  site: SupportedSite | null;
  reason: string | null;
}

export type ContentStatus =
  | 'unsupported'
  | 'idle'
  | 'picking'
  | 'translating'
  | 'rendered'
  | 'error';

export interface ContentRuntimeState {
  status: ContentStatus;
  support: PageSupportState;
  message: string | null;
  selectedImageUrl: string | null;
  translatedCount: number;
}

export type ContentRequest =
  | { type: 'GET_CONTENT_STATE' }
  | { type: 'START_PICKING' }
  | { type: 'CANCEL_PICKING' }
  | { type: 'CLEAR_OVERLAYS' };

export interface ContentResponse {
  success: boolean;
  error?: string;
  state?: ContentRuntimeState;
}

export interface ContentStateUpdateMessage {
  type: 'CONTENT_STATE_UPDATE';
  state: ContentRuntimeState;
}

export interface TranslationDiagnostics {
  detectedRegions: number;
  fallbackRegions: number;
  ocrMs: number;
  translateMs: number;
  totalMs: number;
}

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

export interface TranslateViaServerRequest {
  type: 'TRANSLATE_VIA_SERVER';
  imageUrl: string;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  forceRefresh?: boolean;
}

export interface TranslateViaServerResponse {
  success: boolean;
  textAreas: TextArea[];
  pipeline: 'ocr-first' | 'region-fallback' | 'full-image-fallback';
  cached: boolean;
  diagnostics?: TranslationDiagnostics | null;
  error?: string;
}

export interface TestServerConnectionRequest {
  type: 'TEST_SERVER_CONNECTION';
}

export interface TestServerConnectionResponse {
  success: boolean;
  message: string;
}

export type BackgroundRequest =
  | FetchImageBytesRequest
  | TranslateViaServerRequest
  | TestServerConnectionRequest;

export type BackgroundResponse =
  | FetchImageBytesResponse
  | TranslateViaServerResponse
  | TestServerConnectionResponse;

export function createUnsupportedState(reason: string): ContentRuntimeState {
  return {
    status: 'unsupported',
    support: {
      supported: false,
      site: null,
      reason,
    },
    message: reason,
    selectedImageUrl: null,
    translatedCount: 0,
  };
}
