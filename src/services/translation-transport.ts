import type { TextArea } from '@/providers/base';
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
  server?: ServerExecutionConfig;
  renderMode?: 'anchors-only' | 'strong-overlay-compat';
  translationStylePreset: TranslationStylePreset;
  forceRefresh?: boolean;
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
    const response = (await chrome.runtime.sendMessage({
      action: 'translateImage',
      ...request,
    })) as TranslationTransportResponse | undefined;

    if (!response) {
      throw new Error('Background script 无响应，请刷新页面后重试');
    }

    return response;
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
