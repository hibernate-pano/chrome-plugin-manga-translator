/**
 * Config Store v2 - Simplified configuration for Manga Translator v2
 * 
 * This is a streamlined version that removes OCR-related settings
 * and focuses on Vision LLM providers.
 * 
 * Requirements: 1.4, 6.2
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';
import {
  DEFAULT_TRANSLATION_STYLE_PRESET,
  type TranslationStylePreset,
} from '@/utils/translation-style';

// ==================== Type Definitions ====================

/**
 * Provider-specific configuration
 */
export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ServerConfig {
  enabled: boolean;
  baseUrl: string;
  authToken: string;
  timeoutMs: number;
}

/**
 * All provider configurations
 */
export interface ProvidersConfig {
  siliconflow: ProviderSettings;
  dashscope: ProviderSettings;
  openai: ProviderSettings;
  claude: ProviderSettings;
  deepseek: ProviderSettings;
  ollama: ProviderSettings;
}

/**
 * Application configuration state
 */
export interface AppConfigState {
  /** Translation toggle state */
  enabled: boolean;

  /** Translation execution mode */
  executionMode: 'server' | 'provider-direct';
  
  /** Current active provider */
  provider: ProviderType;

  /** Self-hosted OCR-first server configuration */
  server: ServerConfig;
  
  /** Provider-specific configurations */
  providers: ProvidersConfig;
  
  /** Target language for translation (default: 'zh-CN') */
  targetLanguage: string;
  
  /** Maximum image size in pixels before compression */
  maxImageSize: number;
  
  /** Maximum parallel translation requests */
  parallelLimit: number;
  
  /** Whether caching is enabled */
  cacheEnabled: boolean;

  /** Prompt style preset for manga translation */
  translationStylePreset: TranslationStylePreset;

  /** Reading UI mode */
  readingMode: 'panel';

  /** Render mode for translated content */
  renderMode: 'anchors-only' | 'strong-overlay-compat';

  /** Translation pipeline mode */
  translationPipeline: 'hybrid-regions' | 'full-image-vlm';

  /** Region batch size for hybrid pipeline */
  regionBatchSize: number;

  /** Whether to fallback to full-image VLM translation */
  fallbackToFullImage: boolean;
}

/**
 * Configuration actions
 */
export interface AppConfigActions {
  // Toggle operations
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  setExecutionMode: (mode: 'server' | 'provider-direct') => void;
  updateServerConfig: (config: Partial<ServerConfig>) => void;
  
  // Provider operations
  setProvider: (provider: ProviderType) => void;
  updateProviderSettings: (provider: ProviderType, settings: Partial<ProviderSettings>) => void;
  setProviderApiKey: (provider: ProviderType, apiKey: string) => void;
  
  // Language operations
  setTargetLanguage: (language: string) => void;
  
  // Performance settings
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
  
  // Utility operations
  getActiveProviderSettings: () => ProviderSettings;
  isProviderConfigured: (provider?: ProviderType) => boolean;
  isServerConfigured: () => boolean;
  resetToDefaults: () => void;
}

// ==================== Default Configuration ====================

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
  enabled: false,
  executionMode: 'server',
  provider: 'siliconflow',
  server: {
    enabled: true,
    baseUrl: 'http://127.0.0.1:8000',
    authToken: '',
    timeoutMs: 30000,
  },
  providers: DEFAULT_PROVIDERS,
  targetLanguage: 'zh-CN',
  maxImageSize: 1920,
  parallelLimit: 3,
  cacheEnabled: true,
  translationStylePreset: DEFAULT_TRANSLATION_STYLE_PRESET,
  readingMode: 'panel',
  renderMode: 'strong-overlay-compat',
  translationPipeline: 'full-image-vlm',
  regionBatchSize: 10,
  fallbackToFullImage: true,
};

// ==================== Chrome Storage Adapter ====================

/**
 * Chrome Storage adapter for Zustand persist middleware
 * Uses chrome.storage.sync for cross-device synchronization
 */
const chromeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      // Check if chrome.storage is available (extension context)
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

// ==================== Store Creation ====================

/**
 * App Configuration Store (v2)
 * 
 * Simplified store for Manga Translator v2 that focuses on:
 * - Translation toggle state
 * - Vision LLM provider configuration
 * - Target language settings
 * - Performance settings
 */
export const useAppConfigStore = create<AppConfigState & AppConfigActions>()(
  persist(
    (set, get) => ({
      // Initial state
      ...DEFAULT_CONFIG,

      // Toggle operations
      setEnabled: (enabled) => set({ enabled }),
      toggleEnabled: () => set((state) => ({ enabled: !state.enabled })),
      setExecutionMode: executionMode => set({ executionMode }),
      updateServerConfig: server =>
        set(state => ({
          server: {
            ...state.server,
            ...server,
          },
        })),

      // Provider operations
      setProvider: (provider) => set({ provider }),
      
      updateProviderSettings: (provider, settings) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              ...settings,
            },
          },
        })),
      
      setProviderApiKey: (provider, apiKey) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              apiKey,
            },
          },
        })),

      // Language operations
      setTargetLanguage: (targetLanguage) => set({ targetLanguage }),

      // Performance settings
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

      // Utility operations
      getActiveProviderSettings: () => {
        const state = get();
        return state.providers[state.provider];
      },
      
      isProviderConfigured: (provider?: ProviderType) => {
        const state = get();
        const targetProvider = provider || state.provider;
        const settings = state.providers[targetProvider];
        
        // Ollama doesn't require API key
        if (targetProvider === 'ollama') {
          return !!settings.baseUrl;
        }
        
        // Cloud providers require API key
        return !!settings.apiKey;
      },

      isServerConfigured: () => {
        const state = get();
        return state.server.enabled && !!state.server.baseUrl.trim();
      },
      
      resetToDefaults: () => set(DEFAULT_CONFIG),
    }),
    {
      name: 'manga-translator-config-v2',
      storage: createJSONStorage(() => chromeStorage),
      // Only persist essential configuration, not derived state
      partialize: (state) => ({
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

// ==================== Selector Hooks ====================

/**
 * Get current enabled state
 */
export const useTranslationEnabled = () => useAppConfigStore((state) => state.enabled);

/**
 * Get current provider type
 */
export const useCurrentProvider = () => useAppConfigStore((state) => state.provider);

/**
 * Get target language
 */
export const useTargetLanguage = () => useAppConfigStore((state) => state.targetLanguage);

/**
 * Get active provider settings
 */
export const useActiveProviderSettings = () => {
  const provider = useAppConfigStore((state) => state.provider);
  const providers = useAppConfigStore((state) => state.providers);
  return providers[provider];
};
