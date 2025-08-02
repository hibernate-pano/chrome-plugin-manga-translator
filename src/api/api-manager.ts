import { AIProvider } from './base-provider';
import { ProviderFactory } from './provider-factory';
// import { APIErrorHandler } from '../utils/error-handler';
import { useConfigStore } from '../stores/config';
import { useCacheStore } from '../stores/cache';

/**
 * API管理器 - 统一管理所有API调用
 * 提供缓存、重试、批处理等优化功能
 */
export class APIManager {
  private static instance: APIManager;
  private currentProvider: AIProvider | null = null;
  private requestQueue: Map<string, Promise<any>> = new Map();
  private requestCache: Map<string, { data: any; timestamp: number }> = new Map();
  private batchQueue: Array<{ id: string; request: any; resolve: Function; reject: Function }> = [];
  private batchTimer: NodeJS.Timeout | null = null;
  // private readonly BATCH_DELAY = 100; // 100ms批处理延迟
  // private readonly MAX_BATCH_SIZE = 10; // 最大批处理大小

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
   * 初始化API管理器
   */
  async initialize(): Promise<void> {
    try {
      const configStore = useConfigStore.getState();
      const { providerType, providerConfig } = configStore;

      if (!providerType || !providerConfig[providerType]) {
        throw new Error('未配置API提供者');
      }

      // 创建提供者实例
      this.currentProvider = ProviderFactory.createProvider(
        providerType,
        providerConfig[providerType]
      );

      // 初始化提供者
      await this.currentProvider.initialize();

      console.log(`API管理器已初始化，当前提供者: ${providerType}`);
    } catch (error) {
      console.error('API管理器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 切换API提供者
   */
  async switchProvider(providerType: string, config: any): Promise<void> {
    try {
      // 终止当前提供者
      if (this.currentProvider) {
        await this.currentProvider.terminate();
      }

      // 创建新提供者
      this.currentProvider = ProviderFactory.createProvider(providerType, config);
      await this.currentProvider.initialize();

      console.log(`已切换到提供者: ${providerType}`);
    } catch (error) {
      console.error('切换提供者失败:', error);
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
      console.log('使用缓存的OCR结果');
      return cached.data;
    }

    // 检查是否有相同的请求正在进行
    if (this.requestQueue.has(cacheKey)) {
      console.log('等待相同的OCR请求完成');
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
      } else {
        cachedResults[i] = null;
        uncachedTexts.push(text);
        uncachedIndices.push(i);
      }
    }

    // 如果所有结果都有缓存，直接返回
    if (uncachedTexts.length === 0) {
      console.log('使用缓存的翻译结果');
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
      }
    }

    return isArray ? cachedResults as string[] : cachedResults[0] as string;
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

    // 如果只有一个文本，直接翻译
    if (texts.length === 1) {
      return [await this.currentProvider!.translateText(texts[0], targetLang, options)];
    }

    // 批量翻译
    return await this.currentProvider!.translateText(texts, targetLang, options);
  }

  /**
   * 执行文字检测
   */
  private async executeDetectText(imageData: string, options: any): Promise<any> {
    // 简化的重试逻辑，暂时不使用APIErrorHandler
    let lastError: Error;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.currentProvider!.detectText(imageData, options);
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
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

    return await this.currentProvider.validateConfig();
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

    console.log('API管理器已清理');
  }
}

// 导出单例实例
export const apiManager = APIManager.getInstance();
