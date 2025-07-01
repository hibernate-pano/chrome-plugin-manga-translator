/**
 * 默认配置
 * 作为配置的Single Source of Truth
 */
export const DEFAULT_CONFIG = {
  // API提供者配置
  providerType: 'openai',
  providerConfig: {
    openai: {
      apiKey: '', // 不提供默认密钥，需要用户自行设置
      apiBaseUrl: 'https://api.openai.com/v1',
      visionModel: 'gpt-4-vision-preview',
      chatModel: 'gpt-3.5-turbo',
      temperature: 0.3,
      maxTokens: 1000
    },
    deepseek: {
      apiKey: '',
      apiBaseUrl: 'https://api.deepseek.com/v1',
      visionModel: 'deepseek-vl',
      chatModel: 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 1000
    },
    claude: {
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com',
      model: 'claude-3-opus-20240229',
      temperature: 0.3,
      maxTokens: 1000
    },
    qwen: {
      apiKey: '',
      apiBaseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-VL-32B-Instruct',
      temperature: 0.3,
      maxTokens: 1000
    }
  },
  
  // OCR提供者配置
  ocrSettings: {
    preferredMethod: 'auto',
    tesseract: {
      language: 'jpn',
      preprocess: true,
      workerCount: 1
    }
  },
  
  // 常规配置
  targetLanguage: 'zh-CN',
  enabled: false,
  mode: 'manual',
  styleLevel: 50,
  
  // 样式配置
  fontFamily: '',
  fontSize: 'auto',
  fontColor: 'auto',
  backgroundColor: 'auto',
  
  // 快捷键配置
  shortcuts: {
    toggleTranslation: 'Alt+T',
    translateSelected: 'Alt+S',
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
    renderType: 'overlay'
  }
}; 