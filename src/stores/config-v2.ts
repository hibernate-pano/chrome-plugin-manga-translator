import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';
import {
  APP_CONFIG_STORAGE_KEY,
  DEFAULT_RUNTIME_APP_CONFIG,
  type RuntimeAppConfig,
  type ServerConfig as RuntimeServerConfig,
} from '@/shared/app-config';
import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';

export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AppServerConfig extends RuntimeServerConfig {
  enabled: boolean;
}

export type ServerConfig = AppServerConfig;

export interface ProvidersConfig {
  siliconflow: ProviderSettings;
  dashscope: ProviderSettings;
  openai: ProviderSettings;
  claude: ProviderSettings;
  deepseek: ProviderSettings;
  ollama: ProviderSettings;
}

export interface AppConfigState extends RuntimeAppConfig {
  executionMode: 'server' | 'provider-direct';
  provider: ProviderType;
  server: AppServerConfig;
  providers: ProvidersConfig;
  maxImageSize: number;
  parallelLimit: number;
  cacheEnabled: boolean;
  readingMode: 'panel';
  renderMode: 'anchors-only' | 'strong-overlay-compat';
  translationPipeline: 'hybrid-regions' | 'full-image-vlm';
  regionBatchSize: number;
  fallbackToFullImage: boolean;
}

export interface AppConfigActions {
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  setExecutionMode: (mode: 'server' | 'provider-direct') => void;
  updateServerConfig: (config: Partial<AppServerConfig>) => void;
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
  isServerConfigured: () => boolean;
  getRuntimeConfig: () => RuntimeAppConfig;
  resetToDefaults: () => void;
}

const DEFAULT_PROVIDERS: ProvidersConfig = {
  siliconflow: {
    apiKey: '',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: '',
  },
  dashscope: {
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
  },
  claude: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    model: '',
  },
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: '',
  },
  ollama: {
    apiKey: '', // Not needed for Ollama
    baseUrl: 'http://localhost:11434',
    model: '',
  },
};

const DEFAULT_CONFIG: AppConfigState = {
  enabled: DEFAULT_RUNTIME_APP_CONFIG.enabled,
  executionMode: 'server',
  provider: 'siliconflow',
  server: {
    enabled: true,
    ...DEFAULT_RUNTIME_APP_CONFIG.server,
  },
  providers: DEFAULT_PROVIDERS,
  targetLanguage: DEFAULT_RUNTIME_APP_CONFIG.targetLanguage,
  maxImageSize: 1920,
  parallelLimit: 3,
  cacheEnabled: true,
  translationStylePreset:
    DEFAULT_RUNTIME_APP_CONFIG.translationStylePreset ??
    DEFAULT_TRANSLATION_STYLE_PRESET,
  readingMode: 'panel',
  renderMode: 'strong-overlay-compat',
  translationPipeline: 'full-image-vlm',
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
      setExecutionMode: executionMode => set({ executionMode }),
      updateServerConfig: server =>
        set(state => ({
          server: {
            ...state.server,
            ...server,
          },
        })),
      setProvider: (provider) => set({ provider }),
      updateProviderSettings: (provider, settings) =>
        set(state => ({
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
      isServerConfigured: () => {
        const state = get();
        return !!state.server.baseUrl.trim();
      },
      getRuntimeConfig: () => {
        const state = get();
        return {
          enabled: state.enabled,
          server: state.server,
          targetLanguage: state.targetLanguage,
          translationStylePreset: state.translationStylePreset,
        };
      },
      resetToDefaults: () => set(DEFAULT_CONFIG),
    }),
    {
      name: APP_CONFIG_STORAGE_KEY,
      storage: createJSONStorage(() => chromeStorage),
      partialize: state => ({
        enabled: state.enabled,
        executionMode: state.executionMode,
        provider: state.provider,
        server: state.server,
        providers: state.providers,
        targetLanguage: state.targetLanguage,
        maxImageSize: state.maxImageSize,
        parallelLimit: state.parallelLimit,
        cacheEnabled: state.cacheEnabled,
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
