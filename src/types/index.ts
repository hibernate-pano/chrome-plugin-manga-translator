/**
 * 全局类型定义
 * 包含所有接口、类型和枚举定义
 */

// ==================== API 相关类型 ====================

/**
 * API提供者类型
 */
export type ProviderType = 'openai' | 'deepseek' | 'claude' | 'qwen' | 'anthropic' | 'openrouter';

/**
 * API提供者配置
 */
export interface ProviderConfig {
  apiKey: string;
  apiBaseUrl?: string;
  visionModel?: string;
  chatModel?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * API请求选项
 */
export interface APIRequestOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
}

/**
 * API响应格式
 */
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: number;
}

/**
 * 翻译请求
 */
export interface TranslationRequest {
  text: string | string[];
  targetLanguage: string;
  sourceLanguage?: string;
  context?: string;
  options?: Record<string, any>;
}

/**
 * 翻译响应
 */
export interface TranslationResponse {
  translatedText: string | string[];
  confidence?: number;
  detectedLanguage?: string;
  alternatives?: string[];
  metadata?: Record<string, any>;
}

/**
 * OCR请求
 */
export interface OCRRequest {
  imageData: string;
  language?: string;
  options?: Record<string, any>;
}

/**
 * OCR响应
 */
export interface OCRResponse {
  text: string;
  confidence: number;
  boundingBoxes: BoundingBox[];
  detectedLanguage?: string;
  metadata?: Record<string, any>;
}

/**
 * 边界框
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
}

// ==================== 配置相关类型 ====================

/**
 * OCR设置
 */
export interface OCRSettings {
  preferredMethod: 'auto' | 'tesseract' | 'local';
  tesseract: {
    language: string;
    preprocess: boolean;
    workerCount: number;
  };
}

/**
 * 样式配置
 */
export interface StyleConfig {
  fontFamily: string;
  fontSize: string;
  fontColor: string;
  backgroundColor: string;
  styleLevel: number;
}

/**
 * 快捷键配置
 */
export interface ShortcutConfig {
  toggleTranslation: string;
  translateSelected: string;
  [key: string]: string;
}

/**
 * 高级设置
 */
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

/**
 * 完整配置
 */
export interface AppConfig {
  providerType: ProviderType;
  providerConfig: Record<ProviderType, ProviderConfig>;
  ocrSettings: OCRSettings;
  styleConfig: StyleConfig;
  shortcuts: ShortcutConfig;
  advancedSettings: AdvancedSettings;
}

// ==================== 状态相关类型 ====================

/**
 * 翻译状态
 */
export interface TranslationState {
  enabled: boolean;
  mode: 'manual' | 'auto';
  targetLanguage: string;
  processing: boolean;
  translatedImages: Map<string, TranslationResult>;
}

/**
 * 翻译结果
 */
export interface TranslationResult {
  originalText: string;
  translatedText: string;
  confidence: number;
  timestamp: number;
  imageUrl: string;
  boundingBoxes: BoundingBox[];
}

/**
 * 缓存项
 */
export interface CacheItem<T = any> {
  key: string;
  value: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  apiCalls: {
    total: number;
    successful: number;
    failed: number;
    averageResponseTime: number;
    totalResponseTime: number;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    totalSize: number;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
    byProvider: Record<string, number>;
  };
  translation: {
    totalTexts: number;
    totalCharacters: number;
    averageTextLength: number;
    batchRequests: number;
    singleRequests: number;
  };
  ocr: {
    totalImages: number;
    totalTextAreas: number;
    averageAreasPerImage: number;
    averageProcessingTime: number;
  };
}

// ==================== UI 相关类型 ====================

/**
 * 主题类型
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * 语言类型
 */
export type Language = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR';

/**
 * 翻译模式
 */
export type TranslationMode = 'manual' | 'auto';

/**
 * 加载状态
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

/**
 * 通知类型
 */
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/**
 * 通知配置
 */
export interface NotificationConfig {
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// ==================== 事件相关类型 ====================

/**
 * 消息类型
 */
export type MessageType = 
  | 'toggle_translation'
  | 'translate_image'
  | 'update_config'
  | 'clear_cache'
  | 'performance_report'
  | 'error_report';

/**
 * 消息数据
 */
export interface MessageData {
  type: MessageType;
  payload?: any;
  timestamp: number;
  id: string;
}

/**
 * 内容脚本消息
 */
export interface ContentScriptMessage extends MessageData {
  action: string;
  data?: any;
}

/**
 * 后台脚本消息
 */
export interface BackgroundScriptMessage extends MessageData {
  action: string;
  data?: any;
}

// ==================== 工具类型 ====================

/**
 * 深度部分类型
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 可选字段类型
 */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * 必需字段类型
 */
export type Required<T, K extends keyof T> = T & { [P in K]-?: T[P] };

/**
 * 函数类型
 */
export type FunctionType<TArgs extends any[] = any[], TReturn = any> = (...args: TArgs) => TReturn;

/**
 * 异步函数类型
 */
export type AsyncFunctionType<TArgs extends any[] = any[], TReturn = any> = (...args: TArgs) => Promise<TReturn>;

/**
 * 事件处理器类型
 */
export type EventHandler<T = Event> = (event: T) => void;

/**
 * 回调函数类型
 */
export type Callback<T = any> = (data: T) => void;

/**
 * 错误回调类型
 */
export type ErrorCallback = (error: Error) => void;

// ==================== 常量定义 ====================

/**
 * 默认配置常量
 */
export const DEFAULT_CONFIG = {
  providerType: 'openai' as ProviderType,
  targetLanguage: 'zh-CN' as Language,
  theme: 'system' as Theme,
  mode: 'manual' as TranslationMode,
  styleLevel: 50,
  maxCacheSize: 100,
  apiTimeout: 30000,
  maxConcurrentRequests: 3,
} as const;

/**
 * 支持的语言列表
 */
export const SUPPORTED_LANGUAGES: Record<Language, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
} as const;

/**
 * 支持的主题列表
 */
export const SUPPORTED_THEMES: Record<Theme, string> = {
  'light': '浅色',
  'dark': '深色',
  'system': '跟随系统',
} as const;

/**
 * 默认快捷键
 */
export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  toggleTranslation: 'Alt+T',
  translateSelected: 'Alt+S',
} as const;

// ==================== 类型守卫 ====================

/**
 * 检查是否为有效的提供者类型
 */
export function isValidProviderType(type: string): type is ProviderType {
  return ['openai', 'deepseek', 'claude', 'qwen', 'anthropic', 'openrouter'].includes(type);
}

/**
 * 检查是否为有效的语言类型
 */
export function isValidLanguage(lang: string): lang is Language {
  return Object.keys(SUPPORTED_LANGUAGES).includes(lang);
}

/**
 * 检查是否为有效的主题类型
 */
export function isValidTheme(theme: string): theme is Theme {
  return Object.keys(SUPPORTED_THEMES).includes(theme);
}

/**
 * 检查是否为有效的翻译模式
 */
export function isValidTranslationMode(mode: string): mode is TranslationMode {
  return ['manual', 'auto'].includes(mode);
}

// ==================== 类型导出 ====================

// 所有类型已经在上面定义并导出，这里不需要重复导出 