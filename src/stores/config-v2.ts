import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';
import {
  APP_CONFIG_STORAGE_KEY,
  DEFAULT_RUNTIME_APP_CONFIG,
  type RuntimeAppConfig,
  type ProviderSettings as RuntimeProviderSettings,
} from '@/shared/app-config';
import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';

export interface ProviderSettings extends RuntimeProviderSettings {}

export interface ProvidersConfig {
  'openai-compatible': ProviderSettings;
  ollama: ProviderSettings;
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
  getActiveProviderSettings: () => ProviderSettings;
  isProviderConfigured: (provider?: ProviderType) => boolean;
  getRuntimeConfig: () => RuntimeAppConfig;
  resetToDefaults: () => void;
}

const DEFAULT_PROVIDERS: ProvidersConfig = {
  'openai-compatible': {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    model: 'llava',
  },
};

const DEFAULT_CONFIG: AppConfigState = {
  enabled: DEFAULT_RUNTIME_APP_CONFIG.enabled,
  provider: DEFAULT_RUNTIME_APP_CONFIG.provider,
  openaiCompatible: DEFAULT_RUNTIME_APP_CONFIG.openaiCompatible,
  ollama: DEFAULT_RUNTIME_APP_CONFIG.ollama,
  providers: DEFAULT_PROVIDERS,
  targetLanguage: DEFAULT_RUNTIME_APP_CONFIG.targetLanguage,
  maxImageSize: 1920,
  parallelLimit: 3,
  cacheEnabled: true,
  autoContinueEnabled: DEFAULT_RUNTIME_APP_CONFIG.autoContinueEnabled,
  translationStylePreset:
    DEFAULT_RUNTIME_APP_CONFIG.translationStylePreset ??
    DEFAULT_TRANSLATION_STYLE_PRESET,
  readingMode: 'panel',
  renderMode: 'strong-overlay-compat',
  translationPipeline: 'hybrid-regions',
  regionBatchSize: 10,
  fallbackToFullImage: true,
};

const chromeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        const result = await chrome.storage.sync.get([name]);
        return result[name] ? JSON.stringify(result[name]) : null;
      }
      // Fallback to localStorage for development/testing
      return localStorage.getItem(name);
    } catch (error) {
      console.error('[ConfigStore] getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsedValue = JSON.parse(value);
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        await chrome.storage.sync.set({ [name]: parsedValue });
      } else {
        localStorage.setItem(name, value);
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
      ...DEFAULT_CONFIG,
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
            : {
                ollama: {
                  ...state.ollama,
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
            : {
                ollama: {
                  ...state.ollama,
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
      getActiveProviderSettings: () => {
        const state = get();
        return state.providers[state.provider];
      },
      isProviderConfigured: (provider?: ProviderType) => {
        const state = get();
        const targetProvider = provider || state.provider;
        const settings = state.providers[targetProvider];
        if (targetProvider === 'ollama') {
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
          targetLanguage: state.targetLanguage,
          translationStylePreset: state.translationStylePreset,
          autoContinueEnabled: state.autoContinueEnabled,
        };
      },
      resetToDefaults: () => set(DEFAULT_CONFIG),
    }),
    {
      name: APP_CONFIG_STORAGE_KEY,
      storage: createJSONStorage(() => chromeStorage),
      partialize: state => ({
        enabled: state.enabled,
        provider: state.provider,
        openaiCompatible: state.openaiCompatible,
        ollama: state.ollama,
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
