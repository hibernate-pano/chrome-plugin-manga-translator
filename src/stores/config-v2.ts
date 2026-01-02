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

// ==================== Type Definitions ====================

/**
 * Provider-specific configuration
 */
export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * All provider configurations
 */
export interface ProvidersConfig {
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
  
  /** Current active provider */
  provider: ProviderType;
  
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
}

/**
 * Configuration actions
 */
export interface AppConfigActions {
  // Toggle operations
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  
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
  
  // Utility operations
  getActiveProviderSettings: () => ProviderSettings;
  isProviderConfigured: (provider?: ProviderType) => boolean;
  resetToDefaults: () => void;
}

// ==================== Default Configuration ====================

const DEFAULT_PROVIDERS: ProvidersConfig = {
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  claude: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
  },
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  ollama: {
    apiKey: '', // Not needed for Ollama
    baseUrl: 'http://localhost:11434',
    model: 'llava',
  },
};

const DEFAULT_CONFIG: AppConfigState = {
  enabled: false,
  provider: 'openai',
  providers: DEFAULT_PROVIDERS,
  targetLanguage: 'zh-CN',
  maxImageSize: 1920,
  parallelLimit: 3,
  cacheEnabled: true,
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
      
      resetToDefaults: () => set(DEFAULT_CONFIG),
    }),
    {
      name: 'manga-translator-config-v2',
      storage: createJSONStorage(() => chromeStorage),
      // Only persist essential configuration, not derived state
      partialize: (state) => ({
        enabled: state.enabled,
        provider: state.provider,
        providers: state.providers,
        targetLanguage: state.targetLanguage,
        maxImageSize: state.maxImageSize,
        parallelLimit: state.parallelLimit,
        cacheEnabled: state.cacheEnabled,
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
