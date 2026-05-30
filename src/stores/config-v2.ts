import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';
import {
  APP_CONFIG_STORAGE_KEY,
  DEFAULT_CONFIG as SHARED_DEFAULT_CONFIG,
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
  translationPipeline: SHARED_DEFAULT_CONFIG.translationPipeline as 'hybrid-regions' | 'full-image-vlm',
  regionBatchSize: SHARED_DEFAULT_CONFIG.regionBatchSize,
  fallbackToFullImage: SHARED_DEFAULT_CONFIG.fallbackToFullImage,
  overlayStyle: SHARED_DEFAULT_CONFIG.overlayStyle,
};

const chromeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      let dataStr = null;
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        const result = await chrome.storage.sync.get([name]);
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

      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        await chrome.storage.sync.set({ [name]: parsedValue });
      } else {
        localStorage.setItem(name, JSON.stringify(parsedValue));
      }
    } catch (error) {
      console.error('[ConfigStore] setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        await chrome.storage.sync.remove([name]);
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
      setTranslationPipeline: translationPipeline => set({ translationPipeline }),
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
        };
      },
      resetToDefaults: () => set(LOCAL_DEFAULT_CONFIG),
    }),
    {
      name: APP_CONFIG_STORAGE_KEY,
      storage: createJSONStorage(() => chromeStorage),
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
        translationPipeline: state.translationPipeline,
        regionBatchSize: state.regionBatchSize,
        fallbackToFullImage: state.fallbackToFullImage,
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
 * Listen for external changes to chrome.storage.sync and re-sync the store.
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
      if (areaName !== 'sync') {
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
