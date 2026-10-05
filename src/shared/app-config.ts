import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';
import { ENV_CONFIG } from './env-config';

export const APP_CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface RuntimeAppConfig {
  enabled: boolean;
  provider: 'openai-compatible' | 'ollama' | 'lm-studio';
  openaiCompatible: ProviderSettings;
  ollama: ProviderSettings;
  lmStudio: ProviderSettings;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  /**
   * Continue translating images that load later, within a page that has
   * already been translated.
   */
  autoContinueEnabled: boolean;
  /**
   * Sites where a page is translated automatically on load.
   *
   * Empty by default, and deliberately so: `chrome.tabs.onUpdated` used to
   * fire a full-page translation on every navigation once the extension was
   * enabled, with `<all_urls>` host permission and no site control. That sent
   * large images from banking, webmail and intranet pages to a third-party
   * vision endpoint and billed for them. Automatic translation is now opt-in
   * per host; the manual actions (popup button, context menu) still work
   * anywhere.
   *
   * Entries are bare hostnames (`example.com`). A leading `*.` matches
   * subdomains (`*.example.com`).
   */
  autoTranslateHosts: string[];
  /**
   * First-run onboarding completed flag.
   *
   * The extension ships with `enabled=false` and `onboardingCompleted=false`.
   * New users see a 3-step onboarding modal in the Options page on first
   * install. Until they complete it (or skip it explicitly), the extension
   * will not auto-translate and the user will not be billed for VLM calls.
   */
  onboardingCompleted: boolean;
}

export const DEFAULT_OPENAI_COMPATIBLE_CONFIG: ProviderSettings = {
  // v1.1.1: values injected at build time from .env via
  // scripts/inject-env-config.mjs into the gitignored
  // src/shared/env-config.generated.ts. If .env is missing the build
  // falls back to the MiniMax defaults below so a fresh checkout still
  // produces a valid (but unauthenticated) bundle.
  apiKey: ENV_CONFIG.minimax.apiKey || '',
  baseUrl: ENV_CONFIG.minimax.baseUrl || 'https://api.minimaxi.com/v1',
  model: ENV_CONFIG.minimax.model || 'MiniMax-M3',
};

export const DEFAULT_OLLAMA_CONFIG: ProviderSettings = {
  // v1.1.1: Ollama host + model are also injected from .env (OLLAMA_HOST /
  // OLLAMA_MODEL). Fallback to localhost + llava when the .env does not
  // provide them, so a fresh checkout still runs against the local daemon.
  apiKey: '',
  baseUrl: ENV_CONFIG.ollama.baseUrl || 'http://localhost:11434',
  model: ENV_CONFIG.ollama.model || 'llava',
};

export const DEFAULT_LM_STUDIO_CONFIG: ProviderSettings = {
  apiKey: '',
  baseUrl: 'http://localhost:1234/v1',
  model: '',
};

export const DEFAULT_RUNTIME_APP_CONFIG: RuntimeAppConfig = {
  enabled: false,
  provider: 'openai-compatible',
  openaiCompatible: DEFAULT_OPENAI_COMPATIBLE_CONFIG,
  ollama: DEFAULT_OLLAMA_CONFIG,
  lmStudio: DEFAULT_LM_STUDIO_CONFIG,
  targetLanguage: 'zh-CN',
  translationStylePreset: DEFAULT_TRANSLATION_STYLE_PRESET,
  autoContinueEnabled: true,
  autoTranslateHosts: [],
  // New users must explicitly complete (or skip) the onboarding modal
  // before the extension will run translations. This protects them
  // from being billed for VLM calls without their consent.
  onboardingCompleted: false,
};

/**
 * 合并了 background.ts 和 config-v2.ts 所有字段的完整默认配置
 * 包含 RuntimeAppConfig 的所有字段 + UI/行为配置
 */
export const DEFAULT_CONFIG: Readonly<{
  enabled: boolean;
  provider: 'openai-compatible' | 'ollama' | 'lm-studio';
  openaiCompatible: ProviderSettings;
  ollama: ProviderSettings;
  lmStudio: ProviderSettings;
  providers: {
    'openai-compatible': ProviderSettings;
    ollama: ProviderSettings;
    'lm-studio': ProviderSettings;
  };
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  /**
   * Continue translating images that load later, within a page that has
   * already been translated.
   */
  autoContinueEnabled: boolean;
  /**
   * Sites where a page is translated automatically on load.
   *
   * Empty by default, and deliberately so: `chrome.tabs.onUpdated` used to
   * fire a full-page translation on every navigation once the extension was
   * enabled, with `<all_urls>` host permission and no site control. That sent
   * large images from banking, webmail and intranet pages to a third-party
   * vision endpoint and billed for them. Automatic translation is now opt-in
   * per host; the manual actions (popup button, context menu) still work
   * anywhere.
   *
   * Entries are bare hostnames (`example.com`). A leading `*.` matches
   * subdomains (`*.example.com`).
   */
  autoTranslateHosts: string[];
  onboardingCompleted: boolean;
  maxImageSize: number;
  parallelLimit: number;
  cacheEnabled: boolean;
  readingMode: 'panel';
  renderMode: 'strong-overlay-compat' | 'anchors-only';
  translationPipeline: 'hybrid-regions' | 'full-image-vlm';
  regionBatchSize: number;
  fallbackToFullImage: boolean;
  overlayStyle: {
    backgroundColor: string;
    textColor: string;
    minFontSize: number;
    maxFontSize: number;
    verticalText: boolean;
  };
}> = {
  // RuntimeAppConfig fields
  ...DEFAULT_RUNTIME_APP_CONFIG,
  providers: {
    'openai-compatible': { ...DEFAULT_OPENAI_COMPATIBLE_CONFIG },
    ollama: { ...DEFAULT_OLLAMA_CONFIG },
    'lm-studio': { ...DEFAULT_LM_STUDIO_CONFIG },
  },
  // UI/behavior fields (from background.ts DEFAULT_CONFIG)
  maxImageSize: 1024,
  parallelLimit: 3,
  cacheEnabled: true,
  readingMode: 'panel',
  renderMode: 'strong-overlay-compat',
  // Default to full-image-vlm — single VLM pass over the image, no Tesseract.
  // AGENTS.md states this is the default; tests were asserting hybrid-regions,
  // which contradicted both the docs and production reality (hybrid path
  // requires Tesseract.js, which is heavy and disabled for most users).
  translationPipeline: 'full-image-vlm',
  regionBatchSize: 10,
  fallbackToFullImage: true,
  // UI fields (from config-v2.ts overlayStyle)
  overlayStyle: {
    backgroundColor: 'rgba(240, 240, 235, 0.94)',
    textColor: '#111111',
    minFontSize: 10,
    maxFontSize: 22,
    verticalText: false,
  },
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

/**
 * Normalise a list of hostnames: trimmed, lower-cased, de-duplicated, with
 * any scheme or path stripped so `https://Example.com/reader` and
 * `example.com` do not both get stored.
 */
export function normalizeHostList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const host = normalizeHostEntry(entry);
    if (host && !seen.has(host)) {
      seen.add(host);
      out.push(host);
    }
  }
  return out;
}

/**
 * Reduce arbitrary user input to a bare hostname, preserving an optional
 * leading `*.` wildcard.
 *
 * A port the user typed is kept, so `localhost:8080` scopes to that listener
 * instead of silently widening to every service on the machine. An entry with
 * no port matches any port, which is the usual intent for a domain and keeps
 * existing entries working.
 */
export function normalizeHostEntry(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const wildcard = trimmed.startsWith('*.');
  const body = wildcard ? trimmed.slice(2) : trimmed;
  let host = body;
  let port = '';
  try {
    if (body.includes('://') || body.includes('/')) {
      const parsed = new URL(body.includes('://') ? body : `https://${body}`);
      host = parsed.hostname;
      port = parsed.port;
    } else if (body.includes(':') && !body.includes(']')) {
      const separator = body.indexOf(':');
      host = body.slice(0, separator);
      const candidate = body.slice(separator + 1);
      // Only a run of digits is a port. Anything else means the entry is not a
      // host:port pair, so reject it rather than guess which half the user
      // meant to keep.
      if (!/^\d+$/.test(candidate)) {
        return null;
      }
      port = candidate;
    }
  } catch {
    return null;
  }
  host = host.replace(/^\.+|\.+$/g, '');
  if (!host || !/^[a-z0-9.*-]+$/.test(host)) {
    return null;
  }
  // `*.com` passes the shape check above but is not a scope anyone means: it
  // matches every .com site on the internet, turning an opt-in allowlist into
  // a near-universal one through a single typo. A wildcard needs at least one
  // label below the TLD; `*.localhost` is the dotless base that stays useful.
  if (wildcard && !host.includes('.') && host !== 'localhost') {
    return null;
  }
  const scoped = port ? `${host}:${port}` : host;
  return wildcard ? `*.${scoped}` : scoped;
}

/**
 * Should a page at `url` be translated automatically on load?
 *
 * Matching is by hostname, plus the port when the entry names one. An exact
 * entry never covers look-alike suffixes, because `example.com` must not
 * authorise `notexample.com`.
 */
export function hostMatchesAllowlist(
  url: string,
  hosts: readonly string[]
): boolean {
  if (hosts.length === 0) {
    return false;
  }
  let hostname = '';
  let port = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    hostname = parsed.hostname.toLowerCase();
    // `new URL('https://example.com').port` is empty even though the effective
    // port is 443, so an entry written as `example.com:443` would never match.
    // Fill in the scheme default before comparing.
    port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  } catch {
    return false;
  }
  return hosts.some(entry => {
    const wildcard = entry.startsWith('*.');
    const body = wildcard ? entry.slice(2) : entry;
    const separator = body.indexOf(':');
    const entryHost = separator === -1 ? body : body.slice(0, separator);
    const entryPort = separator === -1 ? '' : body.slice(separator + 1);

    // A port-scoped entry matches only that port. Ignoring it would let an
    // entry written for one local service auto-translate everything else on
    // the host, including admin interfaces whose images would then be sent to
    // the configured vision provider.
    if (entryPort && entryPort !== port) {
      return false;
    }
    if (wildcard) {
      return hostname === entryHost || hostname.endsWith(`.${entryHost}`);
    }
    return hostname === entryHost;
  });
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
      DEFAULT_OPENAI_COMPATIBLE_CONFIG,
      { allowApiKey: true }
    ),
    ollama: normalizeProviderSettings(ollamaSource, DEFAULT_OLLAMA_CONFIG, {
      allowApiKey: false,
    }),
    lmStudio: normalizeProviderSettings(
      lmStudioSource,
      DEFAULT_LM_STUDIO_CONFIG,
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

export async function loadRuntimeAppConfig(): Promise<RuntimeAppConfig> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get([APP_CONFIG_STORAGE_KEY]);
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
