import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';

export const APP_CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

export interface ServerConfig {
  baseUrl: string;
  authToken: string;
  timeoutMs: number;
}

export interface RuntimeAppConfig {
  enabled: boolean;
  server: ServerConfig;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  baseUrl: 'http://127.0.0.1:8000',
  authToken: '',
  timeoutMs: 30000,
};

export const DEFAULT_RUNTIME_APP_CONFIG: RuntimeAppConfig = {
  enabled: false,
  server: DEFAULT_SERVER_CONFIG,
  targetLanguage: 'zh-CN',
  translationStylePreset: DEFAULT_TRANSLATION_STYLE_PRESET,
};

type StorageEnvelope = {
  state?: Partial<RuntimeAppConfig>;
  version?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTranslationStylePreset(
  value: unknown
): value is TranslationStylePreset {
  return (
    value === 'faithful' ||
    value === 'natural-zh' ||
    value === 'concise-bubble'
  );
}

export function normalizeRuntimeAppConfig(value: unknown): RuntimeAppConfig {
  const envelope = isRecord(value) ? (value as StorageEnvelope) : {};
  const state = isRecord(envelope.state)
    ? envelope.state
    : isRecord(value)
      ? (value as Partial<RuntimeAppConfig>)
      : {};

  const server = isRecord(state.server)
    ? (state.server as Partial<ServerConfig>)
    : {};

  return {
    enabled:
      typeof state.enabled === 'boolean'
        ? state.enabled
        : DEFAULT_RUNTIME_APP_CONFIG.enabled,
    server: {
      baseUrl:
        typeof server.baseUrl === 'string'
          ? server.baseUrl
          : DEFAULT_SERVER_CONFIG.baseUrl,
      authToken:
        typeof server.authToken === 'string'
          ? server.authToken
          : DEFAULT_SERVER_CONFIG.authToken,
      timeoutMs:
        typeof server.timeoutMs === 'number'
          ? server.timeoutMs
          : DEFAULT_SERVER_CONFIG.timeoutMs,
    },
    targetLanguage:
      typeof state.targetLanguage === 'string'
        ? state.targetLanguage
        : DEFAULT_RUNTIME_APP_CONFIG.targetLanguage,
    translationStylePreset: isTranslationStylePreset(
      state.translationStylePreset
    )
      ? state.translationStylePreset
      : DEFAULT_RUNTIME_APP_CONFIG.translationStylePreset,
  };
}

export async function loadRuntimeAppConfig(): Promise<RuntimeAppConfig> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get([APP_CONFIG_STORAGE_KEY]);
      return normalizeRuntimeAppConfig(result[APP_CONFIG_STORAGE_KEY]);
    }
  } catch (error) {
    console.error('[AppConfig] Failed to load runtime config:', error);
  }

  return DEFAULT_RUNTIME_APP_CONFIG;
}

export function createPersistedRuntimeConfig(
  state: RuntimeAppConfig = DEFAULT_RUNTIME_APP_CONFIG
): StorageEnvelope {
  return {
    state,
    version: 0,
  };
}
