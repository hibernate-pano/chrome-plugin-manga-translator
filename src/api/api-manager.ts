import { AIProvider, TranslationRequest } from './base-provider.d';
import { ProviderFactory, ProviderType } from './provider-factory.js';

// 扩展接口以支持文字检测
interface ExtendedAIProvider extends AIProvider {
  detectText?(imageData: string, options?: any): Promise<any>;
}

// 错误类型枚举
enum APIErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// API错误类
class APIError extends Error {
  public type: APIErrorType;
  public statusCode?: number;
  public retryable: boolean;
  public rawError?: any;

  constructor(message: string, type: APIErrorType, retryable: boolean = false, statusCode?: number, rawError?: any) {
    super(message);
    this.name = 'APIError';
    this.type = type;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.rawError = rawError;
  }
}

// 日志级别枚举
enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

import { useConfigStore } from '../stores/config';
import { useCacheStore } from '../stores/cache';
import { useHistoryStore } from '../stores/history';

/**
 * API管理器 - 统一管理所有API调用
 * 提供缓存、重试、批处理等优化功能
 */
export class APIManager {
  private static instance: APIManager;
  private currentProvider: ExtendedAIProvider | null = null;
  private requestQueue: Map<string, Promise<any>> = new Map();
  private requestCache: Map<string, { data: any; timestamp: number }> = new Map();
  private batchQueue: Array<{ id: string; request: any; resolve: Function; reject: Function }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  
  // 配置常量（可以从配置中读取）
  private readonly BATCH_DELAY = 100; // 100ms批处理延迟
  private readonly MAX_BATCH_SIZE = 10; // 最大批处理大小
  private maxRetries = 3; // 最大重试次数（可从配置读取）
  private readonly BASE_RETRY_DELAY = 1000; // 基础重试延迟
  private readonly MAX_RETRY_DELAY = 5000; // 最大重试延迟
  private requestTimeout = 30000; // 请求超时时间（ms，可从配置读取）
  
  // 限流相关
  private requestCount = 0;
  private lastRequestTime = 0;
  private readonly RATE_LIMIT_WINDOW = 60000; // 限流窗口（ms）
  private maxRequestsPerWindow = 60; // 每个窗口最大请求数（可从配置读取）
  
  // 并发控制
  private maxConcurrency = 5; // 最大并发请求数（可从配置读取）
  
  // 监控相关
  private requestStats = {
    total: 0,
    success: 0,
    failed: 0,
    retried: 0,
    cached: 0
  };

  private constructor() { }

  /**
   * 获取单例实例
   */
  static getInstance(): APIManager {
    if (!APIManager.instance) {
      APIManager.instance = new APIManager();
    }
    return APIManager.instance;
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logMessage, data);
        break;
      case LogLevel.INFO:
        console.info(logMessage, data);
        break;
      case LogLevel.WARN:
        console.warn(logMessage, data);
        break;
      case LogLevel.ERROR:
        console.error(logMessage, data);
        break;
    }
  }

  /**
   * 初始化API管理器
   */
  async initialize(): Promise<void> {
    this.log(LogLevel.INFO, '初始化API管理器');
    try {
      const configStore = useConfigStore.getState();
      const { providerType, providerConfig, advancedSettings } = configStore;

      if (!providerType || !providerConfig[providerType]) {
        throw new Error('未配置API提供者');
      }

      // 从配置中读取API设置
      if (advancedSettings) {
        if (advancedSettings.apiTimeout) {
          this.requestTimeout = advancedSettings.apiTimeout * 1000; // 转换为毫秒
        }
        
        // 读取并发请求限制（用于限流）
        if (advancedSettings.maxConcurrentRequests) {
          this.maxRequestsPerWindow = advancedSettings.maxConcurrentRequests * 20; // 转换为每分钟请求数
          this.maxConcurrency = advancedSettings.maxConcurrentRequests; // 设置并发数
        }
        
        // 可以根据需要添加重试次数配置
        // this.maxRetries = advancedSettings.maxRetries || 3;
      }

      // 创建提供者实例
      this.currentProvider = ProviderFactory.createProvider(
        providerType as ProviderType,
        providerConfig[providerType]
      );

      // 初始化提供者
      await this.currentProvider.initialize();

      this.log(LogLevel.INFO, `API管理器已初始化，当前提供者: ${providerType}`, {
        timeout: this.requestTimeout,
        maxRetries: this.maxRetries
      });
    } catch (error) {
      this.log(LogLevel.ERROR, 'API管理器初始化失败', error);
      throw error;
    }
  }

  /**
   * 切换API提供者
   */
  async switchProvider(providerType: ProviderType, config: any): Promise<void> {
    this.log(LogLevel.INFO, `切换API提供者到: ${providerType}`);
    try {
      // 终止当前提供者
      if (this.currentProvider) {
        await this.currentProvider.terminate();
      }

      // 创建新提供者
      this.currentProvider = ProviderFactory.createProvider(providerType, config);
      await this.currentProvider.initialize();

      this.log(LogLevel.INFO, `已切换到提供者: ${providerType}`);
    } catch (error) {
      this.log(LogLevel.ERROR, '切换提供者失败', error);
      throw error;
    }
  }

  /**
   * 检测图像中的文字（带缓存）
   */
  async detectText(imageData: string, options: any = {}): Promise<any> {
    if (!this.currentProvider) {
      throw new Error('API提供者未初始化');
    }

    // 生成缓存键
    const cacheKey = this.generateCacheKey('detectText', { imageData, options });

    // 检查缓存
    const cacheStore = useCacheStore.getState();
    const cached = cacheStore.getOCRCache(cacheKey);
    if (cached && !this.isCacheExpired(cached.timestamp)) {
      this.log(LogLevel.DEBUG, '使用缓存的OCR结果', { cacheKey });
      this.requestStats.cached++;
      return cached.data;
    }

    // 检查是否有相同的请求正在进行
    if (this.requestQueue.has(cacheKey)) {
      this.log(LogLevel.DEBUG, '等待相同的OCR请求完成', { cacheKey });
      return this.requestQueue.get(cacheKey);
    }

    // 创建新请求
    const requestPromise = this.executeDetectText(imageData, options);
    this.requestQueue.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 缓存结果
      cacheStore.setOCRCache(cacheKey, result);

      return result;
    } finally {
      this.requestQueue.delete(cacheKey);
    }
  }

  /**
   * 翻译文本（支持批处理）
   */
  async translateText(
    text: string | string[],
    targetLang: string,
    options: any = {}
  ): Promise<string | string[]> {
    if (!this.currentProvider) {
      throw new Error('API提供者未初始化');
    }

    this.log(LogLevel.DEBUG, '开始翻译文本', { text: Array.isArray(text) ? text.length : 1, targetLang });
    
    const isArray = Array.isArray(text);
    const texts = isArray ? text : [text];

    // 检查缓存
    const cachedResults: (string | null)[] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    const cacheStore = useCacheStore.getState();

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text) continue;

      const cacheKey = this.generateCacheKey('translateText', {
        text,
        targetLang,
        options
      });

      const cached = cacheStore.getTranslationCache(cacheKey);
      if (cached && !this.isCacheExpired(cached.timestamp)) {
        cachedResults[i] = cached.data;
        this.requestStats.cached++;
      } else {
        cachedResults[i] = null;
        uncachedTexts.push(text);
        uncachedIndices.push(i);
      }
    }

    // 如果所有结果都有缓存，直接返回
    if (uncachedTexts.length === 0) {
      this.log(LogLevel.DEBUG, '所有翻译结果都已缓存', { count: texts.length });
      return isArray ? cachedResults as string[] : cachedResults[0] as string;
    }

    // 批处理翻译未缓存的文本
    const translatedTexts = await this.batchTranslateText(uncachedTexts, targetLang, options);

    // 合并缓存和新翻译的结果
    for (let i = 0; i < uncachedIndices.length; i++) {
      const index = uncachedIndices[i];
      const translatedText = translatedTexts[i];
      if (index !== undefined && translatedText) {
        cachedResults[index] = translatedText;

        // 缓存新的翻译结果
        const cacheKey = this.generateCacheKey('translateText', {
          text: uncachedTexts[i],
          targetLang,
          options
        });
        cacheStore.setTranslationCache(cacheKey, translatedText);
        
        // 添加到翻译历史记录
        const originalText = uncachedTexts[i];
        if (originalText) {
          const historyStore = useHistoryStore.getState();
          historyStore.addHistoryItem({
            originalText: originalText as string,
            translatedText,
            sourceLanguage: options.sourceLanguage || 'auto',
            targetLanguage: targetLang,
            provider: this.currentProvider!.name,
            isBatch: isArray,
            context: options.context,
          });
        }
      }
    }

    const result = isArray ? cachedResults as string[] : cachedResults[0] as string;
    this.log(LogLevel.DEBUG, '翻译完成', { inputCount: texts.length, outputCount: result.length || 1 });
    
    return result;
  }

  /**
   * 批量翻译文本
   */
  private async batchTranslateText(
    texts: string[],
    targetLang: string,
    options: any = {}
  ): Promise<string[]> {
    if (texts.length === 0) return [];

    this.log(LogLevel.DEBUG, '开始批处理翻译', { count: texts.length });
    
    // 如果只有一个文本，直接翻译
    if (texts.length === 1) {
      const request: TranslationRequest = {
        text: texts[0],
        targetLanguage: targetLang,
        ...options
      };
      const response = await this.executeWithRetry(
        () => this.currentProvider!.translateText(request),
        'translateText',
        { request }
      );
      return [response.translatedText];
    }

    // 批量翻译
    if (this.currentProvider!.translateBatch) {
      const requests: TranslationRequest[] = texts.map(text => ({
        text,
        targetLanguage: targetLang,
        ...options
      }));
      const responses = await this.executeWithRetry(
        () => this.currentProvider!.translateBatch!(requests),
        'translateBatch',
        { requestCount: requests.length }
      );
      return responses.map(response => response.translatedText);
    } else {
      // 如果不支持批量翻译，使用并行处理
      this.log(LogLevel.DEBUG, '当前提供者不支持批量翻译，使用并行处理', { count: texts.length });
      const results: string[] = [];
      
      // 并行处理，使用配置的并发限制
      const concurrencyLimit = this.maxConcurrency;
      for (let i = 0; i < texts.length; i += concurrencyLimit) {
        const batch = texts.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map(text => {
          const request: TranslationRequest = {
            text,
            targetLanguage: targetLang,
            ...options
          };
          return this.executeWithRetry(
            () => this.currentProvider!.translateText(request),
            'translateText',
            { request }
          );
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.map(response => response.translatedText));
      }
      
      return results;
    }
  }

  /**
   * 执行文字检测
   */
  private async executeDetectText(imageData: string, options: any): Promise<any> {
    if (!this.currentProvider!.detectText) {
      throw new Error('当前提供者不支持文字检测功能');
    }

    return this.executeWithRetry(
      () => this.currentProvider!.detectText!(imageData, options),
      'detectText',
      { imageSize: imageData.length, options }
    );
  }

  /**
   * 执行带重试的请求
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<T>,
    operation: string,
    metadata?: any
  ): Promise<T> {
    this.requestStats.total++;
    
    let lastError: APIError | undefined;
    const maxRetries = this.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.log(LogLevel.DEBUG, `执行API请求`, {
          operation,
          attempt: attempt + 1,
          maxRetries,
          ...metadata
        });

        // 检查限流
        await this.checkRateLimit();
        
        // 执行请求并添加超时（使用配置的超时时间）
        const result = await this.withTimeout(requestFn, this.requestTimeout, `${operation}请求超时`);
        
        this.log(LogLevel.DEBUG, `API请求成功`, {
          operation,
          attempt: attempt + 1,
          ...metadata
        });
        
        this.requestStats.success++;
        return result;
      } catch (error) {
        const apiError = this.parseError(error, operation);
        lastError = apiError;
        
        this.log(LogLevel.WARN, `API请求失败`, {
          operation,
          attempt: attempt + 1,
          error: apiError.message,
          errorType: apiError.type,
          retryable: apiError.retryable,
          ...metadata
        });
        
        // 检查是否可以重试
        if (!apiError.retryable || attempt >= maxRetries) {
          this.log(LogLevel.ERROR, `API请求最终失败，已达到最大重试次数`, {
            operation,
            maxRetries,
            error: apiError.message,
            errorType: apiError.type,
            ...metadata
          });
          
          this.requestStats.failed++;
          throw apiError;
        }
        
        // 计算重试延迟（指数退避）
        const delay = this.calculateRetryDelay(attempt);
        this.log(LogLevel.DEBUG, `计划重试API请求`, {
          operation,
          attempt: attempt + 1,
          delay,
          ...metadata
        });
        
        this.requestStats.retried++;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // 理论上不会执行到这里，但为了类型安全
    this.requestStats.failed++;
    throw lastError || new APIError('未知错误', APIErrorType.UNKNOWN_ERROR);
  }

  /**
   * 解析错误
   */
  private parseError(error: any, operation: string): APIError {
    this.log(LogLevel.DEBUG, `解析API错误`, { error, operation });
    
    // 网络错误
    if (error instanceof TypeError && (error.message.includes('network') || error.message.includes('fetch'))) {
      return new APIError('网络错误，请检查网络连接', APIErrorType.NETWORK_ERROR, true);
    }
    
    // 超时错误
    if (error.name === 'TimeoutError') {
      return new APIError('请求超时，请稍后重试', APIErrorType.TIMEOUT_ERROR, true);
    }
    
    // HTTP错误
    if (error.statusCode || error.response?.status) {
      const statusCode = error.statusCode || error.response.status;
      
      switch (true) {
        case statusCode === 401 || statusCode === 403:
          return new APIError('认证失败，请检查API密钥', APIErrorType.AUTH_ERROR, false, statusCode, error);
          
        case statusCode === 400:
          return new APIError('无效的请求参数', APIErrorType.INVALID_REQUEST, false, statusCode, error);
          
        case statusCode === 429:
          return new APIError('请求过于频繁，请稍后重试', APIErrorType.RATE_LIMIT_ERROR, true, statusCode, error);
          
        case statusCode >= 500 && statusCode < 600:
          return new APIError('服务器错误，请稍后重试', APIErrorType.SERVER_ERROR, true, statusCode, error);
          
        default:
          return new APIError(`HTTP错误: ${statusCode}`, APIErrorType.UNKNOWN_ERROR, false, statusCode, error);
      }
    }
    
    // 其他错误
    return new APIError(
      error.message || '未知错误',
      APIErrorType.UNKNOWN_ERROR,
      false,
      undefined,
      error
    );
  }

  /**
   * 带超时的请求执行
   */
  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    timeoutMessage: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;
    
    // 创建超时Promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(timeoutMessage);
        error.name = 'TimeoutError';
        reject(error);
      }, timeout);
    });
    
    try {
      // 使用Promise.race实现超时
      const result = await Promise.race([fn(), timeoutPromise]);
      
      // 如果请求成功，清理超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      return result;
    } catch (error) {
      // 如果发生错误，清理超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      throw error;
    }
  }

  /**
   * 检查限流
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    
    // 如果超过限流窗口，重置计数
    if (now - this.lastRequestTime > this.RATE_LIMIT_WINDOW) {
      this.requestCount = 0;
      this.lastRequestTime = now;
      return;
    }
    
    // 如果超过最大请求数，等待
    if (this.requestCount >= this.maxRequestsPerWindow) {
      const waitTime = this.RATE_LIMIT_WINDOW - (now - this.lastRequestTime);
      this.log(LogLevel.WARN, '达到限流限制，等待后重试', { waitTime });
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.lastRequestTime = Date.now();
    }
    
    this.requestCount++;
  }

  /**
   * 计算重试延迟
   */
  private calculateRetryDelay(attempt: number): number {
    // 指数退避 + 抖动
    const baseDelay = this.BASE_RETRY_DELAY * Math.pow(2, attempt);
    const jitter = Math.random() * baseDelay * 0.5; // 0-50%的抖动
    return Math.min(baseDelay + jitter, this.MAX_RETRY_DELAY);
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(operation: string, params: any): string {
    const paramsStr = JSON.stringify(params);
    const hash = this.simpleHash(paramsStr);
    return `${operation}_${hash}`;
  }

  /**
   * 简单哈希函数
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 检查缓存是否过期
   */
  private isCacheExpired(timestamp: number): boolean {
    const now = Date.now();
    const ttl = 24 * 60 * 60 * 1000; // 24小时默认TTL
    return (now - timestamp) > ttl;
  }

  /**
   * 验证当前提供者配置
   */
  async validateCurrentProvider(): Promise<{ isValid: boolean; message: string }> {
    if (!this.currentProvider) {
      return { isValid: false, message: 'API提供者未初始化' };
    }

    try {
      return await this.currentProvider.validateConfig();
    } catch (error) {
      this.log(LogLevel.ERROR, '验证提供者配置失败', { error });
      return { isValid: false, message: `验证失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * 获取当前提供者信息
   */
  getCurrentProviderInfo(): { name: string; features: any } | null {
    if (!this.currentProvider) {
      return null;
    }

    return {
      name: this.currentProvider.name,
      features: this.currentProvider.supportedFeatures,
    };
  }

  /**
   * 获取请求统计信息
   */
  getRequestStats(): typeof this.requestStats {
    return { ...this.requestStats };
  }

  /**
   * 重置请求统计信息
   */
  resetRequestStats(): void {
    this.requestStats = {
      total: 0,
      success: 0,
      failed: 0,
      retried: 0,
      cached: 0
    };
  }

  /**
   * 设置缓存
   */
  setCache(key: string, value: any): void {
    this.requestCache.set(key, {
      data: value,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取缓存
   */
  getCache(key: string): any {
    const cached = this.requestCache.get(key);
    if (cached) {
      return cached.data;
    }
    return null;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.log(LogLevel.INFO, '清理API管理器资源');
    
    // 清理批处理定时器
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // 清理请求队列
    this.requestQueue.clear();
    this.batchQueue.length = 0;

    // 终止当前提供者
    if (this.currentProvider) {
      await this.currentProvider.terminate();
      this.currentProvider = null;
    }

    // 重置统计信息
    this.resetRequestStats();

    this.log(LogLevel.INFO, 'API管理器已清理');
  }
}

// 导出单例实例
export const apiManager = APIManager.getInstance();
