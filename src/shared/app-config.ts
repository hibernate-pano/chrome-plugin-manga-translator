import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';

export const APP_CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface RuntimeAppConfig {
  enabled: boolean;
  provider: 'openai-compatible' | 'ollama';
  openaiCompatible: ProviderSettings;
  ollama: ProviderSettings;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  autoContinueEnabled: boolean;
}

export const DEFAULT_OPENAI_COMPATIBLE_CONFIG: ProviderSettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
};

export const DEFAULT_OLLAMA_CONFIG: ProviderSettings = {
  apiKey: '',
  baseUrl: 'http://localhost:11434',
  model: 'llava',
};

export const DEFAULT_RUNTIME_APP_CONFIG: RuntimeAppConfig = {
  enabled: false,
  provider: 'openai-compatible',
  openaiCompatible: DEFAULT_OPENAI_COMPATIBLE_CONFIG,
  ollama: DEFAULT_OLLAMA_CONFIG,
  targetLanguage: 'zh-CN',
  translationStylePreset: DEFAULT_TRANSLATION_STYLE_PRESET,
  autoContinueEnabled: true,
};

type StorageEnvelope = {
  state?: Partial<RuntimeAppConfig>;
  version?: number;
};

const LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS = [
  'openai-compatible',
  'openai',
  'siliconflow',
  'dashscope',
  'claude',
  'deepseek',
  'nvidia',
] as const;

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

function getRecordEntry(
  container: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = container[key];
  return isRecord(value) ? value : null;
}

function normalizeProviderSettings(
  source: Partial<ProviderSettings> | null | undefined,
  fallback: ProviderSettings,
  options: { allowApiKey: boolean }
): ProviderSettings {
  return {
    apiKey:
      options.allowApiKey && typeof source?.apiKey === 'string'
        ? source.apiKey
        : fallback.apiKey,
    baseUrl:
      typeof source?.baseUrl === 'string' && source.baseUrl.trim()
        ? source.baseUrl
        : fallback.baseUrl,
    model:
      typeof source?.model === 'string' && source.model.trim()
        ? source.model
        : fallback.model,
  };
}

export function normalizeRuntimeAppConfig(value: unknown): RuntimeAppConfig {
  const envelope = isRecord(value) ? (value as StorageEnvelope) : {};
  const state = isRecord(envelope.state)
    ? envelope.state
    : isRecord(value)
      ? (value as Partial<RuntimeAppConfig>)
      : {};
  const stateRecord = state as Record<string, unknown>;
  const providersRecord = getRecordEntry(stateRecord, 'providers') ?? {};

  const legacyProvider =
    typeof state.provider === 'string' ? state.provider : undefined;
  const provider =
    legacyProvider === 'ollama' ? 'ollama' : 'openai-compatible';

  const selectedLegacyProvider =
    legacyProvider &&
    legacyProvider !== 'ollama' &&
    LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS.includes(
      legacyProvider as (typeof LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS)[number]
    )
      ? legacyProvider
      : null;

  const openaiProviderCandidates = [
    selectedLegacyProvider,
    ...LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS,
  ].reduce<string[]>((candidates, candidate) => {
    if (
      typeof candidate === 'string' &&
      !candidates.includes(candidate)
    ) {
      candidates.push(candidate);
    }
    return candidates;
  }, []);

  const openaiSource =
    (isRecord(state.openaiCompatible)
      ? (state.openaiCompatible as Partial<ProviderSettings>)
      : null) ??
    openaiProviderCandidates
      .map(candidate => getRecordEntry(providersRecord, candidate))
      .find((candidate): candidate is Record<string, unknown> => candidate !== null);

  const ollamaSource =
    (isRecord(state.ollama)
      ? (state.ollama as Partial<ProviderSettings>)
      : null) ??
    getRecordEntry(providersRecord, 'ollama');

  return {
    enabled:
      typeof state.enabled === 'boolean'
        ? state.enabled
        : DEFAULT_RUNTIME_APP_CONFIG.enabled,
    provider,
    openaiCompatible: normalizeProviderSettings(
      openaiSource,
      DEFAULT_OPENAI_COMPATIBLE_CONFIG,
      { allowApiKey: true }
    ),
    ollama: normalizeProviderSettings(ollamaSource, DEFAULT_OLLAMA_CONFIG, {
      allowApiKey: false,
    }),
    targetLanguage:
      typeof state.targetLanguage === 'string'
        ? state.targetLanguage
        : DEFAULT_RUNTIME_APP_CONFIG.targetLanguage,
    translationStylePreset: isTranslationStylePreset(
      state.translationStylePreset
    )
      ? state.translationStylePreset
      : DEFAULT_RUNTIME_APP_CONFIG.translationStylePreset,
    autoContinueEnabled:
      typeof state.autoContinueEnabled === 'boolean'
        ? state.autoContinueEnabled
        : DEFAULT_RUNTIME_APP_CONFIG.autoContinueEnabled,
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
