import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// API提供者配置接口
export interface ProviderConfig {
  apiKey: string;
  apiBaseUrl: string;
  visionModel: string;
  chatModel: string;
  temperature: number;
  maxTokens: number;
}

// OCR设置接口
export interface OCRSettings {
  preferredMethod: 'auto' | 'tesseract' | 'local';
  tesseract: {
    language: string;
    preprocess: boolean;
    workerCount: number;
  };
}

// 高级设置接口
export interface AdvancedSettings {
  useLocalOcr: boolean;
  cacheResults: boolean;
  maxCacheSize: number;
  debugMode: boolean;
  apiTimeout: number;
  maxConcurrentRequests: number;
  imagePreprocessing: 'none' | 'enhance' | 'denoise';
  showOriginalText: boolean;
  translationPrompt: string;
  useCorsProxy: boolean;
  corsProxyType: 'corsproxy' | 'allorigins' | 'custom';
  customCorsProxy: string;
  renderType: 'overlay' | 'replace';
}

// 配置状态接口
export interface ConfigState {
  // API提供者配置
  providerType: string;
  providerConfig: Record<string, ProviderConfig>;
  
  // OCR设置
  ocrSettings: OCRSettings;
  
  // 样式配置
  styleLevel: number;
  fontFamily: string;
  fontSize: string;
  fontColor: string;
  backgroundColor: string;
  
  // 快捷键配置
  shortcuts: Record<string, string>;
  
  // 高级设置
  advancedSettings: AdvancedSettings;
}

// 配置操作接口
export interface ConfigActions {
  // API提供者操作
  setProviderType: (providerType: string) => void;
  updateProviderConfig: (providerType: string, config: Partial<ProviderConfig>) => void;
  setProviderApiKey: (providerType: string, apiKey: string) => void;
  
  // OCR设置操作
  updateOCRSettings: (settings: Partial<OCRSettings>) => void;
  
  // 样式配置操作
  setStyleLevel: (level: number) => void;
  setFontFamily: (fontFamily: string) => void;
  setFontSize: (fontSize: string) => void;
  setFontColor: (fontColor: string) => void;
  setBackgroundColor: (backgroundColor: string) => void;
  
  // 快捷键操作
  updateShortcuts: (shortcuts: Partial<Record<string, string>>) => void;
  
  // 高级设置操作
  updateAdvancedSettings: (settings: Partial<AdvancedSettings>) => void;
  
  // 批量更新
  updateConfig: (config: Partial<ConfigState>) => void;
  resetToDefaults: () => void;
  
  // 获取活跃提供者配置
  getActiveProviderConfig: () => ProviderConfig;
}

// 默认配置
const DEFAULT_CONFIG: ConfigState = {
  providerType: 'openai',
  providerConfig: {
    openai: {
      apiKey: '',
      apiBaseUrl: 'https://api.openai.com/v1',
      visionModel: 'gpt-4-vision-preview',
      chatModel: 'gpt-3.5-turbo',
      temperature: 0.3,
      maxTokens: 1000,
    },
    deepseek: {
      apiKey: '',
      apiBaseUrl: 'https://api.deepseek.com/v1',
      visionModel: 'deepseek-vl',
      chatModel: 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 1000,
    },
    claude: {
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com/v1',
      visionModel: 'claude-3-opus-20240229',
      chatModel: 'claude-3-haiku-20240307',
      temperature: 0.3,
      maxTokens: 1000,
    },
    anthropic: {
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com/v1',
      visionModel: 'claude-3-opus-20240229',
      chatModel: 'claude-3-haiku-20240307',
      temperature: 0.3,
      maxTokens: 1000,
    },
    openrouter: {
      apiKey: '',
      apiBaseUrl: 'https://openrouter.ai/api/v1',
      visionModel: 'anthropic/claude-3-opus',
      chatModel: 'anthropic/claude-3-haiku',
      temperature: 0.3,
      maxTokens: 1000,
    },
  },
  ocrSettings: {
    preferredMethod: 'auto',
    tesseract: {
      language: 'jpn',
      preprocess: true,
      workerCount: 1,
    },
  },
  styleLevel: 50,
  fontFamily: '',
  fontSize: 'auto',
  fontColor: 'auto',
  backgroundColor: 'auto',
  shortcuts: {
    toggleTranslation: 'Alt+T',
    translateSelected: 'Alt+S',
  },
  advancedSettings: {
    useLocalOcr: false,
    cacheResults: true,
    maxCacheSize: 50,
    debugMode: false,
    apiTimeout: 30,
    maxConcurrentRequests: 3,
    imagePreprocessing: 'none',
    showOriginalText: false,
    translationPrompt: '',
    useCorsProxy: true,
    corsProxyType: 'corsproxy',
    customCorsProxy: '',
    renderType: 'overlay',
  },
};

// Chrome Storage 适配器（与 translation store 共享）
const chromeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const result = await chrome.storage.sync.get([name]);
      return result[name] ? JSON.stringify(result[name]) : null;
    } catch (error) {
      console.error('Chrome storage getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsedValue = JSON.parse(value);
      await chrome.storage.sync.set({ [name]: parsedValue });
    } catch (error) {
      console.error('Chrome storage setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await chrome.storage.sync.remove([name]);
    } catch (error) {
      console.error('Chrome storage removeItem error:', error);
    }
  },
};

// 创建配置状态store
export const useConfigStore = create<ConfigState & ConfigActions>()(
  persist(
    (set, get) => ({
      ...DEFAULT_CONFIG,

      // API提供者操作
      setProviderType: (providerType) => set({ providerType }),
      
      updateProviderConfig: (providerType, config) =>
        set((state) => ({
          providerConfig: {
            ...state.providerConfig,
            [providerType]: {
              ...state.providerConfig[providerType],
              ...config,
            },
          },
        })),

      setProviderApiKey: (providerType, apiKey) =>
        set((state) => ({
          providerConfig: {
            ...state.providerConfig,
            [providerType]: {
              ...state.providerConfig[providerType],
              apiKey,
            },
          },
        })),

      // OCR设置操作
      updateOCRSettings: (settings) =>
        set((state) => ({
          ocrSettings: {
            ...state.ocrSettings,
            ...settings,
            tesseract: {
              ...state.ocrSettings.tesseract,
              ...(settings.tesseract || {}),
            },
          },
        })),

      // 样式配置操作
      setStyleLevel: (styleLevel) => set({ styleLevel }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontSize: (fontSize) => set({ fontSize }),
      setFontColor: (fontColor) => set({ fontColor }),
      setBackgroundColor: (backgroundColor) => set({ backgroundColor }),

      // 快捷键操作
      updateShortcuts: (shortcuts) =>
        set((state) => ({
          shortcuts: { ...state.shortcuts, ...shortcuts },
        })),

      // 高级设置操作
      updateAdvancedSettings: (settings) =>
        set((state) => ({
          advancedSettings: { ...state.advancedSettings, ...settings },
        })),

      // 批量更新
      updateConfig: (config) => set((state) => ({ ...state, ...config })),
      
      resetToDefaults: () => set(DEFAULT_CONFIG),

      // 获取活跃提供者配置
      getActiveProviderConfig: () => {
        const state = get();
        return state.providerConfig[state.providerType] || state.providerConfig.openai;
      },
    }),
    {
      name: 'manga-translator-config',
      storage: createJSONStorage(() => chromeStorage),
    }
  )
);
