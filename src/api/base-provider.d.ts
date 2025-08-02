/**
 * AI提供者基类的TypeScript声明文件
 */

export interface TranslationRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  context?: string;
}

export interface TranslationResponse {
  translatedText: string;
  confidence?: number;
  sourceLanguage?: string;
  targetLanguage: string;
}

export interface ValidationResult {
  isValid: boolean;
  message: string;
}

export interface ProviderFeatures {
  batchTranslation?: boolean;
  languageDetection?: boolean;
  contextAware?: boolean;
  maxTextLength?: number;
  supportedLanguages?: string[];
}

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  [key: string]: any;
}

/**
 * AI提供者抽象基类
 */
export abstract class AIProvider {
  public name: string;
  public config: ProviderConfig;
  public supportedFeatures: ProviderFeatures;

  constructor(name: string, config: ProviderConfig);

  /**
   * 初始化提供者
   */
  abstract initialize(): Promise<void>;

  /**
   * 翻译文本
   */
  abstract translateText(request: TranslationRequest): Promise<TranslationResponse>;

  /**
   * 批量翻译
   */
  abstract translateBatch?(requests: TranslationRequest[]): Promise<TranslationResponse[]>;

  /**
   * 检测语言
   */
  abstract detectLanguage?(text: string): Promise<string>;

  /**
   * 验证配置
   */
  abstract validateConfig(): Promise<ValidationResult>;

  /**
   * 获取支持的语言列表
   */
  abstract getSupportedLanguages(): Promise<string[]>;

  /**
   * 终止提供者
   */
  abstract terminate(): Promise<void>;

  /**
   * 获取提供者信息
   */
  getInfo(): {
    name: string;
    features: ProviderFeatures;
    config: Partial<ProviderConfig>;
  };

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ProviderConfig>): void;

  /**
   * 检查是否支持某个功能
   */
  supportsFeature(feature: keyof ProviderFeatures): boolean;
}
