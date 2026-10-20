/**
 * The redacted configuration a content script is allowed to see.
 *
 * The service worker is the only context allowed to hold a plaintext API key.
 * A content script is injected into every page the user visits, so it may not
 * hold the key — not even obfuscated, and not even for the length of a single
 * request.
 *
 * This module is the contract for that boundary:
 *
 * - `buildContentConfigSnapshot()` turns the worker's authoritative config
 *   into a snapshot with every credential replaced by a boolean.
 * - The content script works from the snapshot alone.
 *
 * The snapshot deliberately keeps the *endpoint* (`baseUrl`) and the *model*
 * name: they are not credentials, and the translation cache key is built from
 * them, so dropping them would make the cache serve one endpoint's
 * translation to another.
 */
import { DEFAULT_CONFIG, normalizeHostList } from './app-config';
import type { ProviderType } from '@/providers/base';
import type { TranslationStylePreset } from '@/utils/translation-style';

export const CONTENT_PROVIDER_TYPES: readonly ProviderType[] = [
  'openai-compatible',
  'ollama',
  'lm-studio',
];

/**
 * Where a provider's settings live in the persisted config.
 *
 * The current shape is `providers[<type>]`, but older releases stored one
 * flat key per provider, and both are still on disk for some users.
 */
const PROVIDER_SETTING_KEYS: Record<ProviderType, readonly string[]> = {
  'openai-compatible': ['openaiCompatible', 'openai-compatible'],
  ollama: ['ollama'],
  'lm-studio': ['lmStudio', 'lm-studio'],
};

interface ContentProviderConfig {
  /** The endpoint the provider is called on. Not a credential. */
  baseUrl: string;
  /** The model name. */
  model: string;
  /**
   * Whether an API key is configured.
   *
   * The key itself never leaves the worker: the content script only needs to
   * know whether there is one, so it can tell the user "fill in your API key"
   * instead of "your API key is invalid".
   */
  hasApiKey: boolean;
}

export interface ContentConfigSnapshot {
  /** The master switch. */
  enabled: boolean;
  /** The provider the user selected. */
  provider: ProviderType;
  /** Per-provider settings, without the credentials. */
  providers: Record<ProviderType, ContentProviderConfig>;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  autoContinueEnabled: boolean;
  autoTranslateHosts: string[];
  cacheEnabled: boolean;
  parallelLimit: number;
  regionBatchSize: number;
  translationPipeline: 'hybrid-regions' | 'full-image-vlm';
  fallbackToFullImage: boolean;
  maxImageSize: number;
  overlayStyle: {
    backgroundColor: string;
    textColor: string;
    minFontSize: number;
    maxFontSize: number;
    verticalText: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The persisted config is wrapped in a `{ state, version }` envelope, but the
 * worker hands out a flat, normalised record. Both shapes have to work.
 */
function extractState(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    return {};
  }
  const state = raw['state'];
  return isRecord(state) ? state : raw;
}

/**
 * The provider named by a stored value, or the default when it names none.
 *
 * The worker and the content script both read the provider out of a config
 * record, and they had two copies of this function. They agreed by luck:
 * the worker's fallback was the literal `'openai-compatible'` and the
 * content script's was `DEFAULT_CONFIG.provider`, which happens to be the
 * same string today. One definition, so a future default change cannot
 * silently split the two.
 */
export function readProviderType(value: unknown): ProviderType {
  return CONTENT_PROVIDER_TYPES.includes(value as ProviderType)
    ? (value as ProviderType)
    : DEFAULT_CONFIG.provider;
}

function readProviderSettings(
  state: Record<string, unknown>,
  type: ProviderType
): Record<string, unknown> {
  const providers = isRecord(state['providers']) ? state['providers'] : {};
  const direct = providers[type];
  if (isRecord(direct)) {
    return direct;
  }
  for (const key of PROVIDER_SETTING_KEYS[type]) {
    const legacy = state[key];
    if (isRecord(legacy)) {
      return legacy;
    }
  }
  return {};
}

function readOverlayStyle(
  value: unknown
): ContentConfigSnapshot['overlayStyle'] {
  const fallback = DEFAULT_CONFIG.overlayStyle;
  if (!isRecord(value)) {
    return { ...fallback };
  }
  return {
    backgroundColor: readString(
      value['backgroundColor'],
      fallback.backgroundColor
    ),
    textColor: readString(value['textColor'], fallback.textColor),
    minFontSize: readNumber(value['minFontSize'], fallback.minFontSize),
    maxFontSize: readNumber(value['maxFontSize'], fallback.maxFontSize),
    verticalText: readBoolean(value['verticalText'], fallback.verticalText),
  };
}

/**
 * Is a key configured?
 *
 * The value may be a plaintext key (in the worker) or an obfuscated one (in
 * storage); both are non-empty when a key exists, and the content script only
 * ever sees the boolean.
 */
function hasApiKey(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Build the snapshot the content script works from.
 *
 * The API key is *replaced*, never copied: there is no code path from here to
 * a plaintext credential.
 */
export function buildContentConfigSnapshot(
  raw: unknown
): ContentConfigSnapshot {
  const state = extractState(raw);

  const providers = {} as Record<ProviderType, ContentProviderConfig>;
  for (const type of CONTENT_PROVIDER_TYPES) {
    const settings = readProviderSettings(state, type);
    const fallback = DEFAULT_CONFIG.providers[type];
    providers[type] = {
      baseUrl: readString(settings['baseUrl'], fallback.baseUrl),
      model: readString(settings['model'], fallback.model),
      hasApiKey: hasApiKey(settings['apiKey']),
    };
  }

  const pipeline = state['translationPipeline'];
  const stylePreset = state['translationStylePreset'];

  return {
    enabled: readBoolean(state['enabled'], DEFAULT_CONFIG.enabled),
    provider: readProviderType(state['provider']),
    providers,
    targetLanguage: readString(
      state['targetLanguage'],
      DEFAULT_CONFIG.targetLanguage
    ),
    translationStylePreset:
      stylePreset === 'faithful' ||
      stylePreset === 'natural-zh' ||
      stylePreset === 'concise-bubble' ||
      stylePreset === 'preserve-original'
        ? stylePreset
        : DEFAULT_CONFIG.translationStylePreset,
    autoContinueEnabled: readBoolean(
      state['autoContinueEnabled'],
      DEFAULT_CONFIG.autoContinueEnabled
    ),
    autoTranslateHosts: normalizeHostList(state['autoTranslateHosts']),
    cacheEnabled: readBoolean(
      state['cacheEnabled'],
      DEFAULT_CONFIG.cacheEnabled
    ),
    parallelLimit: readNumber(
      state['parallelLimit'],
      DEFAULT_CONFIG.parallelLimit
    ),
    regionBatchSize: readNumber(
      state['regionBatchSize'],
      DEFAULT_CONFIG.regionBatchSize
    ),
    translationPipeline:
      pipeline === 'hybrid-regions' || pipeline === 'full-image-vlm'
        ? pipeline
        : DEFAULT_CONFIG.translationPipeline,
    fallbackToFullImage: readBoolean(
      state['fallbackToFullImage'],
      DEFAULT_CONFIG.fallbackToFullImage
    ),
    maxImageSize: readNumber(
      state['maxImageSize'],
      DEFAULT_CONFIG.maxImageSize
    ),
    overlayStyle: readOverlayStyle(state['overlayStyle']),
  };
}
