import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';
import {
  APP_CONFIG_STORAGE_KEY,
  DEFAULT_CONFIG as SHARED_DEFAULT_CONFIG,
  DEFAULT_OPENAI_COMPATIBLE_CONFIG,
  DEFAULT_OLLAMA_CONFIG,
  DEFAULT_LM_STUDIO_CONFIG,
  normalizeRuntimeAppConfig,
  normalizeHostEntry,
  normalizeHostList,
  type RuntimeAppConfig,
  type ProviderSettings as RuntimeProviderSettings,
} from '@/shared/app-config';
import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';
import { obfuscateAllApiKeys, deobfuscateAllApiKeys } from '@/utils/crypto';
import { isConfigValueEqual, pickConfigFields } from '@/stores/config-equality';

export interface ProviderSettings extends RuntimeProviderSettings {}

export interface ProvidersConfig {
  'openai-compatible': ProviderSettings;
  ollama: ProviderSettings;
  'lm-studio': ProviderSettings;
}

export interface OverlayStyleConfig {
  backgroundColor: string;
  textColor: string;
  minFontSize: number;
  maxFontSize: number;
  verticalText: boolean;
}

export interface AppConfigState extends RuntimeAppConfig {
  providers: ProvidersConfig;
  maxImageSize: number;
  parallelLimit: number;
  cacheEnabled: boolean;
  autoContinueEnabled: boolean;
  autoTranslateHosts: string[];
  readingMode: 'panel';
  renderMode: 'anchors-only' | 'strong-overlay-compat';
  translationPipeline: 'hybrid-regions' | 'full-image-vlm';
  regionBatchSize: number;
  fallbackToFullImage: boolean;
  overlayStyle: OverlayStyleConfig;
}

export interface AppConfigActions {
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  setProvider: (provider: ProviderType) => void;
  updateProviderSettings: (
    provider: ProviderType,
    settings: Partial<ProviderSettings>
  ) => void;
  setProviderApiKey: (provider: ProviderType, apiKey: string) => void;
  setTargetLanguage: (language: string) => void;
  setMaxImageSize: (size: number) => void;
  setParallelLimit: (limit: number) => void;
  setCacheEnabled: (enabled: boolean) => void;
  setAutoContinueEnabled: (enabled: boolean) => void;
  setAutoTranslateHosts: (hosts: string[]) => void;
  addAutoTranslateHost: (host: string) => boolean;
  removeAutoTranslateHost: (host: string) => void;
  setTranslationStylePreset: (preset: TranslationStylePreset) => void;
  setReadingMode: (mode: 'panel') => void;
  setRenderMode: (mode: 'anchors-only' | 'strong-overlay-compat') => void;
  setTranslationPipeline: (
    pipeline: 'hybrid-regions' | 'full-image-vlm'
  ) => void;
  setRegionBatchSize: (size: number) => void;
  setFallbackToFullImage: (enabled: boolean) => void;
  setOverlayStyle: (style: Partial<OverlayStyleConfig>) => void;
  setVerticalText: (enabled: boolean) => void;
  getActiveProviderSettings: () => ProviderSettings;
  isProviderConfigured: (provider?: ProviderType) => boolean;
  getRuntimeConfig: () => RuntimeAppConfig;
  setOnboardingCompleted: (completed: boolean) => void;
  resetToDefaults: () => void;
}

/**
 * 重命名为 LOCAL_DEFAULT_CONFIG，避免与 @/shared/app-config 的 DEFAULT_CONFIG 冲突
 * 仅在 store 内部使用，外部使用时应引用共享的 DEFAULT_CONFIG
 */
const LOCAL_DEFAULT_CONFIG: AppConfigState = {
  enabled: SHARED_DEFAULT_CONFIG.enabled,
  provider: SHARED_DEFAULT_CONFIG.provider,
  openaiCompatible: SHARED_DEFAULT_CONFIG.openaiCompatible,
  ollama: SHARED_DEFAULT_CONFIG.ollama,
  lmStudio: SHARED_DEFAULT_CONFIG.lmStudio,
  providers: SHARED_DEFAULT_CONFIG.providers,
  targetLanguage: SHARED_DEFAULT_CONFIG.targetLanguage,
  maxImageSize: SHARED_DEFAULT_CONFIG.maxImageSize,
  parallelLimit: SHARED_DEFAULT_CONFIG.parallelLimit,
  cacheEnabled: SHARED_DEFAULT_CONFIG.cacheEnabled,
  autoContinueEnabled: SHARED_DEFAULT_CONFIG.autoContinueEnabled,
  autoTranslateHosts: SHARED_DEFAULT_CONFIG.autoTranslateHosts,
  translationStylePreset:
    SHARED_DEFAULT_CONFIG.translationStylePreset ??
    DEFAULT_TRANSLATION_STYLE_PRESET,
  readingMode: SHARED_DEFAULT_CONFIG.readingMode,
  renderMode: SHARED_DEFAULT_CONFIG.renderMode as
    | 'anchors-only'
    | 'strong-overlay-compat',
  translationPipeline: SHARED_DEFAULT_CONFIG.translationPipeline as
    | 'hybrid-regions'
    | 'full-image-vlm',
  regionBatchSize: SHARED_DEFAULT_CONFIG.regionBatchSize,
  fallbackToFullImage: SHARED_DEFAULT_CONFIG.fallbackToFullImage,
  overlayStyle: SHARED_DEFAULT_CONFIG.overlayStyle,
  onboardingCompleted: SHARED_DEFAULT_CONFIG.onboardingCompleted,
};

/**
 * Legacy v1 (pre-v0.3.2) state had providers keyed by the old provider names
 * (openai, siliconflow, dashscope, claude, deepseek, nvidia). v0.3.2 consolidates
 * to openai-compatible / ollama / lm-studio. This set is the source of truth
 * for the remap step; matches LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS in
 * src/shared/app-config.ts.
 */
const LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS: readonly string[] = [
  'openai',
  'siliconflow',
  'dashscope',
  'claude',
  'deepseek',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The persisted field whitelist.
 *
 * This single list is used for three things that must never drift apart:
 *   1. what `partialize` writes,
 *   2. what the storage-change listener compares,
 *   3. what a trusted external write is allowed to overwrite.
 *
 * Keeping them separate is what allowed the v1.3.x write storm: `partialize`
 * wrote 19 fields while the listener compared against all 42 runtime keys.
 */
export const PERSISTED_CONFIG_FIELDS = [
  'enabled',
  'provider',
  'openaiCompatible',
  'ollama',
  'lmStudio',
  'providers',
  'targetLanguage',
  'maxImageSize',
  'parallelLimit',
  'cacheEnabled',
  'autoContinueEnabled',
  'autoTranslateHosts',
  'translationStylePreset',
  'readingMode',
  'renderMode',
  'translationPipeline',
  'regionBatchSize',
  'fallbackToFullImage',
  'overlayStyle',
  'onboardingCompleted',
] as const satisfies readonly (keyof AppConfigState)[];

function pickLegacyProviderEntry(
  providersRecord: Record<string, unknown>,
  preferredKey: string | undefined
): Record<string, unknown> | null {
  const candidates = [
    preferredKey,
    ...LEGACY_OPENAI_COMPATIBLE_PROVIDER_KEYS,
  ].filter((key): key is string => typeof key === 'string');

  for (const key of candidates) {
    const entry = providersRecord[key];
    if (isRecord(entry)) {
      return entry;
    }
  }
  return null;
}

/**
 * Migration for persisted config (v0 → v1 → v2 → v3).
 *
 * v0.3.1 persisted state:
 *   { provider: 'openai' | 'ollama' | 'siliconflow' | ...,
 *     providers: { openai: {...}, ollama: {...} }, ... }
 *
 * v0.3.2 persisted state:
 *   { provider: 'openai-compatible' | 'ollama' | 'lm-studio',
 *     openaiCompatible: {...}, ollama: {...}, lmStudio: {...},
 *     providers: { 'openai-compatible': {...}, ollama: {...}, 'lm-studio': {...} } }
 *
 * v0.4.0 persisted state adds `onboardingCompleted`. Existing users who
 * upgrade from v2 are marked as `onboardingCompleted: true` automatically
 * so they are not re-prompted.
 *
 * We rebuild providers and the top-level provider fields from the legacy
 * shape so v0.3.1 users do not get undefined on providers['openai-compatible']
 * / providers['lm-studio'].
 */
function migratePersistedConfig(
  persistedState: unknown,
  version: number | undefined
): unknown {
  if (!isRecord(persistedState)) {
    return persistedState;
  }

  // Already on v3 — pass through.
  if ((version ?? 0) >= 3) {
    return persistedState;
  }

  // Upgrading from v2 → v3: onboardingCompleted was introduced in v0.4.0.
  // Existing users have already configured the extension, so we mark
  // onboarding as completed on upgrade to avoid re-prompting them.
  if ((version ?? 0) === 2) {
    return isRecord(persistedState['state'])
      ? {
          ...persistedState,
          state: {
            ...(persistedState['state'] as Record<string, unknown>),
            onboardingCompleted: true,
          },
          version: 3,
        }
      : {
          ...persistedState,
          onboardingCompleted: true,
          version: 3,
        };
  }

  // Zustand wraps the partialized state in { state, version } when writing.
  // Storage adapters may also return the raw value, so handle both shapes.
  const innerStateValue = persistedState['state'];
  const inner: Record<string, unknown> = isRecord(innerStateValue)
    ? (innerStateValue as Record<string, unknown>)
    : persistedState;

  // Use the shared normalizer to rebuild the top-level provider fields
  // (openaiCompatible, ollama, lmStudio, provider, etc.). It already handles
  // remapping legacy provider names and merging settings.
  const normalized = normalizeRuntimeAppConfig(inner);

  // Rebuild the `providers` map. The normalizer gives us the new top-level
  // provider settings, but `providers[provider]` is the map that consumers
  // (Popup/Options UI) actually read. We must rebuild it from the legacy
  // shape, not from the partialized v2 state (which is what triggered the bug).
  const innerProvidersValue = inner['providers'];
  const legacyProvidersRecord = isRecord(innerProvidersValue)
    ? (innerProvidersValue as Record<string, unknown>)
    : {};

  const previousProvider =
    typeof inner['provider'] === 'string'
      ? (inner['provider'] as string)
      : undefined;
  const openaiEntry = pickLegacyProviderEntry(
    legacyProvidersRecord,
    previousProvider
  );

  function asProviderSettingsOrNull(value: unknown): ProviderSettings | null {
    if (!isRecord(value)) return null;
    return value as unknown as ProviderSettings;
  }

  const newProviders: ProvidersConfig = {
    'openai-compatible': asProviderSettingsOrNull(
      legacyProvidersRecord['openai-compatible']
    ) ??
      (openaiEntry as ProviderSettings | null) ??
      normalized.openaiCompatible ?? { ...DEFAULT_OPENAI_COMPATIBLE_CONFIG },
    ollama: asProviderSettingsOrNull(legacyProvidersRecord['ollama']) ??
      normalized.ollama ?? { ...DEFAULT_OLLAMA_CONFIG },
    'lm-studio': asProviderSettingsOrNull(legacyProvidersRecord['lm-studio']) ??
      normalized.lmStudio ?? { ...DEFAULT_LM_STUDIO_CONFIG },
  };

  const migratedState: Record<string, unknown> = {
    ...inner,
    ...normalized,
    providers: newProviders,
  };

  return isRecord(persistedState['state'])
    ? { ...persistedState, state: migratedState, version: 2 }
    : { state: migratedState, version: 2 };
}

/**
 * Defensive merge used in addition to `migrate`. If a future code path
 * writes a partial state missing some provider keys, this guarantees the
 * three new provider entries always exist.
 *
 * Generic in S so zustand can keep its S type inference for the create<>
 * call. Without the generic, S would narrow to AppConfigState and break the
 * AppConfigActions inference for the store actions.
 */
function mergePersistedConfig<S extends AppConfigState>(
  persisted: unknown,
  current: S
): S {
  // migratePersistedConfig returns the zustand envelope { state, version }.
  // Unwrap it so we read from the migrated state, not the envelope.
  const envelopeState = isRecord(persisted) ? persisted['state'] : undefined;
  const baseCandidate: unknown = isRecord(envelopeState)
    ? envelopeState
    : persisted;
  const base = isRecord(baseCandidate)
    ? (baseCandidate as Partial<AppConfigState>)
    : {};

  const asProviderSettings = (value: unknown): ProviderSettings | undefined =>
    isRecord(value) ? (value as unknown as ProviderSettings) : undefined;

  /**
   * Coerce a persisted provider field to a usable string.
   *
   * Storage is user-writable and hand-editable, so `apiKey: 123` can arrive
   * from a corrupted or tampered snapshot. Calling `.trim()` on it directly
   * threw inside zustand's `merge`, which aborted hydration for the whole
   * snapshot and silently left the store on defaults — a single bad field
   * discarded every good one next to it.
   */
  const trimmedString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

  const persistedProviders = isRecord(base.providers)
    ? (base.providers as Record<string, unknown>)
    : {};

  // Runtime input wins, then the build-time default. This preserves:
  // - zero-config personal builds where .env supplied a key;
  // - user-entered keys and custom endpoints in public builds;
  // - old persisted settings without resurrecting a stale build key.
  const mergeProvider = (
    fallback: ProviderSettings,
    currentValue: ProviderSettings | undefined,
    persistedValue: ProviderSettings | undefined
  ): ProviderSettings => ({
    apiKey:
      trimmedString(persistedValue?.apiKey) ||
      trimmedString(currentValue?.apiKey) ||
      fallback.apiKey,
    baseUrl:
      trimmedString(persistedValue?.baseUrl) ||
      trimmedString(currentValue?.baseUrl) ||
      fallback.baseUrl,
    model:
      trimmedString(persistedValue?.model) ||
      trimmedString(currentValue?.model) ||
      fallback.model,
  });

  const nextOpenaiCompatible = mergeProvider(
    DEFAULT_OPENAI_COMPATIBLE_CONFIG,
    current.openaiCompatible,
    asProviderSettings(base.openaiCompatible) ??
      asProviderSettings(persistedProviders['openai-compatible'])
  );
  const nextOllama = mergeProvider(
    DEFAULT_OLLAMA_CONFIG,
    current.ollama,
    asProviderSettings(base.ollama) ??
      asProviderSettings(persistedProviders['ollama'])
  );
  const nextLmStudio = mergeProvider(
    DEFAULT_LM_STUDIO_CONFIG,
    current.lmStudio,
    asProviderSettings(base.lmStudio) ??
      asProviderSettings(persistedProviders['lm-studio'])
  );

  // v1.1.1: reuse field references when merged equals current so persist
  // doesn't churn the storage listener into a feedback loop on every
  // rehydrate (regression guard for the page-freeze bug).
  const sameProvider = (
    next: ProviderSettings,
    prev: ProviderSettings | undefined
  ): ProviderSettings =>
    prev !== undefined &&
    prev.apiKey === next.apiKey &&
    prev.baseUrl === next.baseUrl &&
    prev.model === next.model
      ? prev
      : next;

  const prevProviders = current.providers;
  const providers: ProvidersConfig = {
    'openai-compatible': sameProvider(
      nextOpenaiCompatible,
      prevProviders['openai-compatible']
    ),
    ollama: sameProvider(nextOllama, prevProviders.ollama),
    'lm-studio': sameProvider(nextLmStudio, prevProviders['lm-studio']),
  };

  const merged: AppConfigState = {
    ...current,
    ...base,
    openaiCompatible: sameProvider(
      nextOpenaiCompatible,
      current.openaiCompatible
    ),
    ollama: sameProvider(nextOllama, current.ollama),
    lmStudio: sameProvider(nextLmStudio, current.lmStudio),
    providers,
  };

  return merged as S;
}

const chromeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      let dataStr = null;
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get([name]);
        dataStr = result[name] ? JSON.stringify(result[name]) : null;
      } else {
        dataStr = localStorage.getItem(name);
      }
      if (!dataStr) return null;

      const parsed = JSON.parse(dataStr);
      if (parsed && parsed.state) {
        deobfuscateAllApiKeys(parsed.state);
      } else {
        deobfuscateAllApiKeys(parsed);
      }
      return JSON.stringify(parsed);
    } catch (error) {
      console.error('[ConfigStore] getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsedValue = JSON.parse(value);
      if (parsedValue && parsedValue.state) {
        // Remember the pre-obfuscation shape: the echo we get back is
        // deobfuscated before comparison, so the two forms must match.
        rememberSelfWrite(parsedValue.state);
        obfuscateAllApiKeys(parsedValue.state);
      } else {
        rememberSelfWrite(parsedValue);
        obfuscateAllApiKeys(parsedValue);
      }

      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [name]: parsedValue });
      } else {
        localStorage.setItem(name, JSON.stringify(parsedValue));
      }
    } catch (error) {
      console.error('[ConfigStore] setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove([name]);
      } else {
        localStorage.removeItem(name);
      }
    } catch (error) {
      console.error('[ConfigStore] removeItem error:', error);
    }
  },
};

export const useAppConfigStore = create<AppConfigState & AppConfigActions>()(
  persist(
    (set, get) => ({
      ...LOCAL_DEFAULT_CONFIG,
      setEnabled: enabled => set({ enabled }),
      toggleEnabled: () => set(state => ({ enabled: !state.enabled })),
      setProvider: provider => set({ provider }),
      updateProviderSettings: (provider, settings) =>
        set(state => ({
          ...(provider === 'openai-compatible'
            ? {
                openaiCompatible: {
                  ...state.openaiCompatible,
                  ...settings,
                },
              }
            : provider === 'ollama'
              ? {
                  ollama: {
                    ...state.ollama,
                    ...settings,
                  },
                }
              : {
                  lmStudio: {
                    ...state.lmStudio,
                    ...settings,
                  },
                }),
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              ...settings,
            },
          },
        })),
      setProviderApiKey: (provider, apiKey) =>
        set(state => ({
          ...(provider === 'openai-compatible'
            ? {
                openaiCompatible: {
                  ...state.openaiCompatible,
                  apiKey,
                },
              }
            : provider === 'ollama'
              ? {
                  ollama: {
                    ...state.ollama,
                    apiKey,
                  },
                }
              : {
                  lmStudio: {
                    ...state.lmStudio,
                    apiKey,
                  },
                }),
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              apiKey,
            },
          },
        })),
      setTargetLanguage: targetLanguage => set({ targetLanguage }),
      setMaxImageSize: maxImageSize => set({ maxImageSize }),
      setParallelLimit: parallelLimit => set({ parallelLimit }),
      setCacheEnabled: cacheEnabled => set({ cacheEnabled }),
      setAutoContinueEnabled: autoContinueEnabled =>
        set({ autoContinueEnabled }),
      setAutoTranslateHosts: hosts =>
        set({ autoTranslateHosts: normalizeHostList(hosts) }),
      addAutoTranslateHost: host => {
        const normalized = normalizeHostEntry(host);
        if (!normalized) {
          return false;
        }
        set(state => ({
          autoTranslateHosts: normalizeHostList([
            ...state.autoTranslateHosts,
            normalized,
          ]),
        }));
        return true;
      },
      removeAutoTranslateHost: host => {
        const normalized = normalizeHostEntry(host);
        set(state => ({
          autoTranslateHosts: state.autoTranslateHosts.filter(
            entry => entry !== normalized
          ),
        }));
      },
      setTranslationStylePreset: translationStylePreset =>
        set({ translationStylePreset }),
      setReadingMode: readingMode => set({ readingMode }),
      setRenderMode: renderMode => set({ renderMode }),
      setTranslationPipeline: translationPipeline =>
        set({ translationPipeline }),
      setRegionBatchSize: regionBatchSize => set({ regionBatchSize }),
      setFallbackToFullImage: fallbackToFullImage =>
        set({ fallbackToFullImage }),
      setOverlayStyle: style =>
        set(state => ({
          overlayStyle: { ...state.overlayStyle, ...style },
        })),
      setVerticalText: enabled =>
        set(state => ({
          overlayStyle: { ...state.overlayStyle, verticalText: enabled },
        })),
      getActiveProviderSettings: () => {
        const state = get();
        return state.providers[state.provider];
      },
      isProviderConfigured: (provider?: ProviderType) => {
        const state = get();
        const targetProvider = provider || state.provider;
        const settings = state.providers[targetProvider];
        if (targetProvider === 'ollama' || targetProvider === 'lm-studio') {
          return !!settings.baseUrl;
        }
        return !!settings.apiKey;
      },
      getRuntimeConfig: () => {
        const state = get();
        return {
          enabled: state.enabled,
          provider: state.provider,
          openaiCompatible: state.openaiCompatible,
          ollama: state.ollama,
          lmStudio: state.lmStudio,
          targetLanguage: state.targetLanguage,
          translationStylePreset: state.translationStylePreset,
          autoContinueEnabled: state.autoContinueEnabled,
          autoTranslateHosts: state.autoTranslateHosts,
          onboardingCompleted: state.onboardingCompleted,
        };
      },
      setOnboardingCompleted: completed =>
        set({ onboardingCompleted: completed }),
      resetToDefaults: () => set(LOCAL_DEFAULT_CONFIG),
    }),
    {
      name: APP_CONFIG_STORAGE_KEY,
      storage: createJSONStorage(() => chromeStorage),
      version: 3,
      migrate: migratePersistedConfig,
      merge: mergePersistedConfig,
      partialize: state => {
        // Do not persist the build-time .env key. User-entered overrides are
        // persisted locally and obfuscated by the storage adapter above.
        const serializeProvider = (
          settings: ProviderSettings,
          buildDefaultKey: string
        ): ProviderSettings => ({
          ...settings,
          apiKey: settings.apiKey === buildDefaultKey ? '' : settings.apiKey,
        });
        const snapshot: Record<string, unknown> = pickConfigFields(
          state,
          PERSISTED_CONFIG_FIELDS
        );

        snapshot['openaiCompatible'] = serializeProvider(
          state.openaiCompatible,
          DEFAULT_OPENAI_COMPATIBLE_CONFIG.apiKey
        );
        snapshot['ollama'] = serializeProvider(
          state.ollama,
          DEFAULT_OLLAMA_CONFIG.apiKey
        );
        snapshot['lmStudio'] = serializeProvider(
          state.lmStudio,
          DEFAULT_LM_STUDIO_CONFIG.apiKey
        );
        snapshot['providers'] = {
          'openai-compatible': serializeProvider(
            state.providers['openai-compatible'],
            DEFAULT_OPENAI_COMPATIBLE_CONFIG.apiKey
          ),
          ollama: serializeProvider(
            state.providers.ollama,
            DEFAULT_OLLAMA_CONFIG.apiKey
          ),
          'lm-studio': serializeProvider(
            state.providers['lm-studio'],
            DEFAULT_LM_STUDIO_CONFIG.apiKey
          ),
        };

        return snapshot;
      },
    }
  )
);

// ==================== External Storage Change Listener ====================

/**
 * Listen for external changes to chrome.storage.local and re-sync the store.
 * This handles cases where the background script writes to storage directly
 * (e.g. setConfig in background.ts) so the Options page reflects them.
 *
 * Three defects made this listener dangerous before v1.4.0:
 *
 * 1. It fired for our own `persist` writes and applied them unconditionally.
 *    Because `partialize` rebuilds `providers` / `overlayStyle` on every call,
 *    each application produced fresh references, which re-rendered every
 *    subscriber, which wrote again: an unbounded storage write storm.
 * 2. The guard compared *key counts* (19 persisted vs 42 runtime, since the
 *    store also carries 23 actions), so it always reported "changed" and could
 *    never break the loop.
 * 3. The stored snapshot holds `obf:`-obfuscated API keys. Applying it
 *    verbatim replaced the in-memory plaintext key with the obfuscated form,
 *    which was then sent to the provider and always failed auth.
 *
 * The fix: compare by value over `PERSISTED_CONFIG_FIELDS` only, and
 * deobfuscate before applying. A self-write therefore decodes back to exactly
 * the current state and is a no-op.
 */
let storageChangeListenerInitialized = false;

/**
 * Snapshots this context recently wrote, in the order written.
 *
 * `persist` writes asynchronously, so a burst of edits can produce writes
 * whose `onChanged` notifications arrive out of order. Without this, an echo
 * of an *older* write can land after a newer edit and overwrite it: the user
 * types an API key, the hydration write's echo arrives a moment later carrying
 * the previous (empty) value, and the key silently reverts. Value comparison
 * cannot catch that, because the stale snapshot genuinely differs from the
 * current state.
 *
 * Matching the payload we wrote is unambiguous, so it is kept to a small
 * bounded ring. Entries are consumed on match; anything that does not match is
 * another context's write and is adopted.
 */
const SELF_WRITE_LIMIT = 8;
const recentSelfWrites: Array<Record<string, unknown>> = [];

function rememberSelfWrite(snapshot: unknown): void {
  const fields = pickConfigFields(snapshot, PERSISTED_CONFIG_FIELDS);
  recentSelfWrites.push(fields);
  while (recentSelfWrites.length > SELF_WRITE_LIMIT) {
    recentSelfWrites.shift();
  }
}

function consumeMatchingSelfWrite(candidate: unknown): boolean {
  const index = recentSelfWrites.findIndex(entry =>
    isConfigValueEqual(
      entry,
      pickConfigFields(candidate, PERSISTED_CONFIG_FIELDS)
    )
  );
  if (index === -1) {
    return false;
  }
  recentSelfWrites.splice(index, 1);
  return true;
}

export function shallowChanged(
  candidate: Record<string, unknown>,
  current: Record<string, unknown>
): boolean {
  // Compare only the persisted field set. Extra runtime keys (actions) must
  // not influence the result, and persisted keys the candidate omits are
  // ignored so a partial external write cannot blank unrelated settings.
  const projectedCandidate = pickConfigFields(
    candidate,
    PERSISTED_CONFIG_FIELDS
  );
  const projectedCurrent = pickConfigFields(current, PERSISTED_CONFIG_FIELDS);

  return !isConfigValueEqual(projectedCandidate, projectedCurrent);
}

function setupStorageChangeListener(): void {
  if (storageChangeListenerInitialized) {
    return;
  }
  storageChangeListenerInitialized = true;

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }
      const configChange = changes[APP_CONFIG_STORAGE_KEY];
      if (!configChange) {
        return;
      }
      const newValue = configChange.newValue;
      if (!newValue) {
        return;
      }

      const candidate: Record<string, unknown> = {
        ...(isRecord(newValue) && isRecord(newValue['state'])
          ? (newValue['state'] as Record<string, unknown>)
          : (newValue as Record<string, unknown>)),
      };

      // Storage holds obfuscated keys; memory state must stay plaintext.
      deobfuscateAllApiKeys(candidate);

      // An echo of something we wrote. It may be older than current state
      // (async delivery), so drop it rather than applying it.
      if (consumeMatchingSelfWrite(candidate)) {
        return;
      }

      const current = useAppConfigStore.getState() as unknown as Record<
        string,
        unknown
      >;
      if (!shallowChanged(candidate, current)) {
        return;
      }

      // Apply only whitelisted fields so an unexpected key in storage can
      // never inject actions or overwrite internals.
      const trustedPatch = pickConfigFields(candidate, PERSISTED_CONFIG_FIELDS);
      useAppConfigStore.setState(state => ({ ...state, ...trustedPatch }));
    });
  }
}

// Initialize listener on module load (once)
setupStorageChangeListener();
