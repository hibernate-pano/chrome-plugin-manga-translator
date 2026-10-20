/**
 * The build-time provider configuration, credentials included.
 *
 * This module is for the privileged contexts: the service worker, the
 * Settings page, the popup. It is NOT for the content script.
 *
 * The content script is injected into every page the user visits, so a key
 * that reaches its bundle is a key in every page. The split between this
 * module and `@/shared/app-config` is what keeps that from happening:
 * `app-config` holds the endpoint and the model -- which the redacted
 * snapshot deliberately keeps, because the cache key is built from them --
 * and this module holds the key.
 *
 * `scripts/check-release-consistency.mjs` fails the build if a key reaches
 * `dist/content.js`, so the boundary is checked rather than assumed.
 */

import {
  DEFAULT_LM_STUDIO_CONFIG,
  DEFAULT_OLLAMA_CONFIG,
  DEFAULT_OPENAI_COMPATIBLE_CONFIG,
  DEFAULT_RUNTIME_APP_CONFIG,
  normalizeHostList,
  type ProviderSettings,
  type RuntimeAppConfig,
} from './app-config';
import { ENV_CREDENTIALS } from './env-credentials';
import type { TranslationStylePreset } from '@/utils/translation-style';

/**
 * The provider settings a personal build ships with.
 *
 * The key is the one from `.env` at build time; the endpoint and the model
 * are the same ones the credential-free defaults carry.
 */
export const PRELOADED_OPENAI_COMPATIBLE_CONFIG: ProviderSettings = {
  ...DEFAULT_OPENAI_COMPATIBLE_CONFIG,
  apiKey: ENV_CREDENTIALS.minimax.apiKey,
};

export const PRELOADED_OLLAMA_CONFIG: ProviderSettings = {
  ...DEFAULT_OLLAMA_CONFIG,
  apiKey: ENV_CREDENTIALS.ollama.apiKey,
};

/**
 * LM Studio is a local, keyless server, so it has no build-time credential
 * to preload. It is spelled out here rather than left to the generic
 * defaults so that the list of "what a personal build ships with" stays
 * complete at a glance.
 */
export const PRELOADED_LM_STUDIO_CONFIG: ProviderSettings = {
  ...DEFAULT_LM_STUDIO_CONFIG,
  apiKey: '',
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
    value === 'concise-bubble' ||
    value === 'preserve-original'
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
      options.allowApiKey &&
      typeof source?.apiKey === 'string' &&
      source.apiKey.trim()
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
    legacyProvider === 'ollama'
      ? 'ollama'
      : legacyProvider === 'lm-studio'
        ? 'lm-studio'
        : 'openai-compatible';

  const selectedLegacyProvider =
    legacyProvider &&
    legacyProvider !== 'ollama' &&
    legacyProvider !== 'lm-studio' &&
    LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS.includes(
      legacyProvider as (typeof LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS)[number]
    )
      ? legacyProvider
      : null;

  const openaiProviderCandidates = [
    selectedLegacyProvider,
    ...LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS,
  ].reduce<string[]>((candidates, candidate) => {
    if (typeof candidate === 'string' && !candidates.includes(candidate)) {
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
      .find(
        (candidate): candidate is Record<string, unknown> => candidate !== null
      );

  const ollamaSource =
    (isRecord(state.ollama)
      ? (state.ollama as Partial<ProviderSettings>)
      : null) ?? getRecordEntry(providersRecord, 'ollama');

  const lmStudioSource =
    (isRecord(state.lmStudio)
      ? (state.lmStudio as Partial<ProviderSettings>)
      : null) ?? getRecordEntry(providersRecord, 'lm-studio');

  return {
    enabled:
      typeof state.enabled === 'boolean'
        ? state.enabled
        : DEFAULT_RUNTIME_APP_CONFIG.enabled,
    provider,
    // A runtime key entered in Settings takes precedence. If none exists,
    // the build-time .env default is used for zero-config personal builds.
    openaiCompatible: normalizeProviderSettings(
      openaiSource,
      PRELOADED_OPENAI_COMPATIBLE_CONFIG,
      { allowApiKey: true }
    ),
    ollama: normalizeProviderSettings(ollamaSource, PRELOADED_OLLAMA_CONFIG, {
      allowApiKey: false,
    }),
    lmStudio: normalizeProviderSettings(
      lmStudioSource,
      PRELOADED_LM_STUDIO_CONFIG,
      {
        allowApiKey: false,
      }
    ),
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
    autoTranslateHosts: normalizeHostList(state.autoTranslateHosts),
    onboardingCompleted:
      typeof state.onboardingCompleted === 'boolean'
        ? state.onboardingCompleted
        : DEFAULT_RUNTIME_APP_CONFIG.onboardingCompleted,
  };
}
