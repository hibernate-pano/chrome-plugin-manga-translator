import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ProviderType, Language, TranslationMode, Theme } from '@/types';

// ==================== 配置接口定义 ====================

export interface ProviderConfig {
  apiKey: string;
  apiBaseUrl?: string;
  visionModel?: string;
  chatModel?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OCRSettings {
  preferredMethod: 'auto' | 'tesseract' | 'local';
  language: string;
  preprocess: boolean;
  workerCount: number;
}

export interface StyleConfig {
  fontFamily: string;
  fontSize: string;
  fontColor: string;
  backgroundColor: string;
  styleLevel: number;
}

export interface ShortcutConfig {
  toggleTranslation: string;
  translateSelected: string;
  openSettings: string;
  clearTranslations: string;
}

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

export interface AppConfig {
  // 基础设置
  enabled: boolean;
  providerType: ProviderType;
  targetLanguage: Language;
  theme: Theme;
  mode: TranslationMode;
  
  // 提供者配置
  providerConfig: Record<ProviderType, ProviderConfig>;
  
  // 功能配置
  ocrSettings: OCRSettings;
  styleConfig: StyleConfig;
  shortcuts: ShortcutConfig;
  advancedSettings: AdvancedSettings;
}

// ==================== 默认配置 ====================

const DEFAULT_PROVIDER_CONFIG: Record<ProviderType, ProviderConfig> = {
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
  qwen: {
    apiKey: '',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    visionModel: 'qwen-vl-plus',
    chatModel: 'qwen-turbo',
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
};

const DEFAULT_CONFIG: AppConfig = {
  // 基础设置
  enabled: false,
  providerType: 'openai',
  targetLanguage: 'zh-CN',
  theme: 'system',
  mode: 'manual',
  
  // 提供者配置
  providerConfig: DEFAULT_PROVIDER_CONFIG,
  
  // OCR设置
  ocrSettings: {
    preferredMethod: 'auto',
    language: 'jpn',
    preprocess: true,
    workerCount: 1,
  },
  
  // 样式配置
  styleConfig: {
    fontFamily: '',
    fontSize: 'auto',
    fontColor: 'auto',
    backgroundColor: 'auto',
    styleLevel: 50,
  },
  
  // 快捷键配置
  shortcuts: {
    toggleTranslation: 'Alt+T',
    translateSelected: 'Alt+S',
    openSettings: 'Alt+O',
    clearTranslations: 'Alt+C',
  },
  
  // 高级设置
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

// ==================== 配置验证 ====================

export class ConfigValidator {
  static validateProviderConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    
    if (!config.apiKey) {
      errors.push('API密钥不能为空');
    }
    
    if (config.temperature && (config.temperature < 0 || config.temperature > 2)) {
      errors.push('温度值必须在0-2之间');
    }
    
    if (config.maxTokens && (config.maxTokens < 1 || config.maxTokens > 4000)) {
      errors.push('最大令牌数必须在1-4000之间');
    }
    
    return errors;
  }
  
  static validateOCRSettings(settings: OCRSettings): string[] {
    const errors: string[] = [];
    
    if (settings.workerCount < 1 || settings.workerCount > 4) {
      errors.push('工作线程数必须在1-4之间');
    }
    
    return errors;
  }
  
  static validateAdvancedSettings(settings: AdvancedSettings): string[] {
    const errors: string[] = [];
    
    if (settings.maxCacheSize < 1 || settings.maxCacheSize > 1000) {
      errors.push('最大缓存大小必须在1-1000之间');
    }
    
    if (settings.apiTimeout < 5 || settings.apiTimeout > 300) {
      errors.push('API超时时间必须在5-300秒之间');
    }
    
    if (settings.maxConcurrentRequests < 1 || settings.maxConcurrentRequests > 10) {
      errors.push('最大并发请求数必须在1-10之间');
    }
    
    return errors;
  }
}

// ==================== Chrome Storage 适配器 ====================

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

// ==================== 配置Store ====================

interface ConfigState extends AppConfig {
  // 状态
  isLoading: boolean;
  error: string | null;
  
  // 基础操作
  setEnabled: (enabled: boolean) => void;
  setProviderType: (providerType: ProviderType) => void;
  setTargetLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  setMode: (mode: TranslationMode) => void;
  
  // 提供者配置操作
  updateProviderConfig: (providerType: ProviderType, config: Partial<ProviderConfig>) => void;
  setProviderApiKey: (providerType: ProviderType, apiKey: string) => void;
  validateProvider: (providerType: ProviderType) => string[];
  
  // OCR设置操作
  updateOCRSettings: (settings: Partial<OCRSettings>) => void;
  validateOCRSettings: () => string[];
  
  // 样式配置操作
  updateStyleConfig: (config: Partial<StyleConfig>) => void;
  
  // 快捷键操作
  updateShortcuts: (shortcuts: Partial<ShortcutConfig>) => void;
  
  // 高级设置操作
  updateAdvancedSettings: (settings: Partial<AdvancedSettings>) => void;
  validateAdvancedSettings: () => string[];
  
  // 批量操作
  updateConfig: (config: Partial<AppConfig>) => void;
  resetToDefaults: () => void;
  
  // 工具方法
  getActiveProviderConfig: () => ProviderConfig;
  getActiveProviderApiKey: () => string;
  isProviderConfigured: (providerType: ProviderType) => boolean;
  getAllValidationErrors: () => string[];
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_CONFIG,
      isLoading: false,
      error: null,

      // 基础操作
      setEnabled: (enabled) => set({ enabled }),
      setProviderType: (providerType) => set({ providerType }),
      setTargetLanguage: (targetLanguage) => set({ targetLanguage }),
      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),

      // 提供者配置操作
      updateProviderConfig: (providerType, config) =>
        set((state) => {
          const currentConfig = state.providerConfig[providerType] || {};
          const updatedConfig = { ...currentConfig, ...config };

          return {
            providerConfig: {
              ...state.providerConfig,
              [providerType]: updatedConfig as ProviderConfig,
            },
          };
        }),

      setProviderApiKey: (providerType, apiKey) =>
        set((state) => {
          const currentConfig = state.providerConfig[providerType] || {};
          const updatedConfig = { ...currentConfig, apiKey };

          return {
            providerConfig: {
              ...state.providerConfig,
              [providerType]: updatedConfig as ProviderConfig,
            },
          };
        }),

      validateProvider: (providerType) => {
        const state = get();
        const config = state.providerConfig[providerType];
        return config ? ConfigValidator.validateProviderConfig(config) : ['提供者配置不存在'];
      },

      // OCR设置操作
      updateOCRSettings: (settings) =>
        set((state) => ({
          ocrSettings: { ...state.ocrSettings, ...settings },
        })),

      validateOCRSettings: () => {
        const state = get();
        return ConfigValidator.validateOCRSettings(state.ocrSettings);
      },

      // 样式配置操作
      updateStyleConfig: (config) =>
        set((state) => ({
          styleConfig: { ...state.styleConfig, ...config },
        })),

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

      validateAdvancedSettings: () => {
        const state = get();
        return ConfigValidator.validateAdvancedSettings(state.advancedSettings);
      },

      // 批量操作
      updateConfig: (config) => set((state) => ({ ...state, ...config })),

      resetToDefaults: () => set({ ...DEFAULT_CONFIG, isLoading: false, error: null }),

      // 工具方法
      getActiveProviderConfig: () => {
        const state = get();
        const config = state.providerConfig[state.providerType];
        return config || DEFAULT_PROVIDER_CONFIG.openai;
      },

      getActiveProviderApiKey: () => {
        const state = get();
        const config = state.providerConfig[state.providerType];
        return config?.apiKey || '';
      },

      isProviderConfigured: (providerType) => {
        const state = get();
        const config = state.providerConfig[providerType];
        return !!(config && config.apiKey);
      },

      getAllValidationErrors: () => {
        const state = get();
        const errors: string[] = [];
        
        // 验证当前提供者
        errors.push(...state.validateProvider(state.providerType));
        
        // 验证OCR设置
        errors.push(...state.validateOCRSettings());
        
        // 验证高级设置
        errors.push(...state.validateAdvancedSettings());
        
        return errors;
      },
    }),
    {
      name: 'manga-translator-config-v2',
      storage: createJSONStorage(() => chromeStorage),
    }
  )
); 