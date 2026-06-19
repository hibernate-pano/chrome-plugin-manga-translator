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
  type RuntimeAppConfig,
  type ProviderSettings as RuntimeProviderSettings,
} from '@/shared/app-config';
import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';
import { obfuscateAllApiKeys, deobfuscateAllApiKeys } from '@/utils/crypto';


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
  readingMode: 'panel';
  renderMode: 'anchors-only' | 'strong-overlay-compat';
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
  setTranslationStylePreset: (preset: TranslationStylePreset) => void;
  setReadingMode: (mode: 'panel') => void;
  setRenderMode: (mode: 'anchors-only' | 'strong-overlay-compat') => void;
  setOverlayStyle: (style: Partial<OverlayStyleConfig>) => void;
  setVerticalText: (enabled: boolean) => void;
  getActiveProviderSettings: () => ProviderSettings;
  isProviderConfigured: (provider?: ProviderType) => boolean;
  getRuntimeConfig: () => RuntimeAppConfig;
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
  translationStylePreset:
    SHARED_DEFAULT_CONFIG.translationStylePreset ??
    DEFAULT_TRANSLATION_STYLE_PRESET,
  readingMode: SHARED_DEFAULT_CONFIG.readingMode,
  renderMode: SHARED_DEFAULT_CONFIG.renderMode as 'anchors-only' | 'strong-overlay-compat',
  overlayStyle: SHARED_DEFAULT_CONFIG.overlayStyle,
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
 * v0.3.2 state:
 *   { provider: 'openai-compatible' | 'ollama' | 'lm-studio',
 *     openaiCompatible: {...}, ollama: {...}, lmStudio: {...},
 *     providers: { 'openai-compatible': {...}, ollama: {...}, 'lm-studio': {...} } }
 *
 * v0.3.5 (current) state:
 *   v2 state minus translationPipeline / regionBatchSize / fallbackToFullImage
 *   (full-image-vlm is now the only supported pipeline).
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

  function asProviderSettingsOrNull(
    value: unknown
  ): ProviderSettings | null {
    if (!isRecord(value)) return null;
    return value as unknown as ProviderSettings;
  }

  const newProviders: ProvidersConfig = {
    'openai-compatible':
      asProviderSettingsOrNull(legacyProvidersRecord['openai-compatible']) ??
      (openaiEntry as ProviderSettings | null) ??
      normalized.openaiCompatible ??
      { ...DEFAULT_OPENAI_COMPATIBLE_CONFIG },
    ollama:
      asProviderSettingsOrNull(legacyProvidersRecord['ollama']) ??
      normalized.ollama ??
      { ...DEFAULT_OLLAMA_CONFIG },
    'lm-studio':
      asProviderSettingsOrNull(legacyProvidersRecord['lm-studio']) ??
      normalized.lmStudio ??
      { ...DEFAULT_LM_STUDIO_CONFIG },
  };

  const migratedState: Record<string, unknown> = {
    ...inner,
    ...normalized,
    providers: newProviders,
  };

  // v2 → v3: drop hybrid-regions pipeline fields. The full-image-vlm pipeline
  // is now the only supported path; these fields were UI-only and no longer
  // referenced by the runtime after Task 8/9/11.
  delete migratedState['translationPipeline'];
  delete migratedState['regionBatchSize'];
  delete migratedState['fallbackToFullImage'];

  return isRecord(persistedState['state'])
    ? { ...persistedState, state: migratedState, version: 3 }
    : { state: migratedState, version: 3 };
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
  const envelopeState = isRecord(persisted)
    ? persisted['state']
    : undefined;
  const baseCandidate: unknown = isRecord(envelopeState)
    ? envelopeState
    : persisted;
  const base = isRecord(baseCandidate)
    ? (baseCandidate as Partial<AppConfigState>)
    : {};
  const persistedProviders = isRecord(base.providers)
    ? (base.providers as Partial<ProvidersConfig>)
    : {};

  const providers: ProvidersConfig = {
    'openai-compatible':
      (persistedProviders['openai-compatible'] as ProviderSettings | undefined) ??
      current.providers['openai-compatible'] ??
      { ...DEFAULT_OPENAI_COMPATIBLE_CONFIG },
    ollama:
      (persistedProviders['ollama'] as ProviderSettings | undefined) ??
      current.providers.ollama ??
      { ...DEFAULT_OLLAMA_CONFIG },
    'lm-studio':
      (persistedProviders['lm-studio'] as ProviderSettings | undefined) ??
      current.providers['lm-studio'] ??
      { ...DEFAULT_LM_STUDIO_CONFIG },
  };

  return {
    ...current,
    ...base,
    providers,
  } as S;
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
        obfuscateAllApiKeys(parsedValue.state);
      } else {
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
      setEnabled: (enabled) => set({ enabled }),
      toggleEnabled: () => set(state => ({ enabled: !state.enabled })),
      setProvider: (provider) => set({ provider }),
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
      setTargetLanguage: (targetLanguage) => set({ targetLanguage }),
      setMaxImageSize: (maxImageSize) => set({ maxImageSize }),
      setParallelLimit: (parallelLimit) => set({ parallelLimit }),
      setCacheEnabled: (cacheEnabled) => set({ cacheEnabled }),
      setAutoContinueEnabled: (autoContinueEnabled) =>
        set({ autoContinueEnabled }),
      setTranslationStylePreset: (translationStylePreset) =>
        set({ translationStylePreset }),
      setReadingMode: readingMode => set({ readingMode }),
      setRenderMode: renderMode => set({ renderMode }),
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
        };
      },
      resetToDefaults: () => set(LOCAL_DEFAULT_CONFIG),
    }),
    {
      name: APP_CONFIG_STORAGE_KEY,
      storage: createJSONStorage(() => chromeStorage),
      version: 3,
      migrate: migratePersistedConfig,
      merge: mergePersistedConfig,
      partialize: state => ({
        enabled: state.enabled,
        provider: state.provider,
        openaiCompatible: state.openaiCompatible,
        ollama: state.ollama,
        lmStudio: state.lmStudio,
        providers: state.providers,
        targetLanguage: state.targetLanguage,
        maxImageSize: state.maxImageSize,
        parallelLimit: state.parallelLimit,
        cacheEnabled: state.cacheEnabled,
        autoContinueEnabled: state.autoContinueEnabled,
        translationStylePreset: state.translationStylePreset,
        readingMode: state.readingMode,
        renderMode: state.renderMode,
        overlayStyle: state.overlayStyle,
      }),
    }
  )
);

export const useTranslationEnabled = () =>
  useAppConfigStore(state => state.enabled);

export const useCurrentProvider = () =>
  useAppConfigStore(state => state.provider);

export const useTargetLanguage = () =>
  useAppConfigStore(state => state.targetLanguage);

export const useActiveProviderSettings = () => {
  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  return providers[provider];
};

export const useOverlayStyle = () =>
  useAppConfigStore(state => state.overlayStyle);

// ==================== External Storage Change Listener ====================

/**
 * Listen for external changes to chrome.storage.local and re-sync the store.
 * This handles cases where Popup/Options/Background modify storage directly,
 * ensuring all extension contexts stay in sync.
 */
let storageChangeListenerInitialized = false;

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

      // Skip re-applying our own writes (which would be a no-op anyway)
      // The store already has the latest state via persist middleware
      const newValue = configChange.newValue;
      if (!newValue) {
        return;
      }

      // Re-hydrate the store from the external change
      // Zustand persist will handle merging via its rehydration mechanism
      useAppConfigStore.setState((state) => {
        const newState = (newValue && newValue.state) ? newValue.state : newValue;
        return {
          ...state,
          ...newState,
        };
      });
    });
  }
}

// Initialize listener on module load (once)
setupStorageChangeListener();
