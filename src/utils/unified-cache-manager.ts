import { IntelligentCache } from './intelligent-cache';
import { CacheStrategyManager } from './cache-strategy';
import { useCacheStore } from '../stores/cache';
import { performanceMonitor } from './performance-monitor';

/**
 * 统一缓存管理器
 * 协调多层缓存架构，提供智能缓存策略
 */
export class UnifiedCacheManager {
  private static instance: UnifiedCacheManager;
  private intelligentCache: IntelligentCache;
  private strategyManager: CacheStrategyManager;
  private offlineCache: Map<string, any> = new Map();
  private cacheHitStats: Map<string, { hits: number; misses: number }> = new Map();

  private constructor() {
    this.intelligentCache = new IntelligentCache({
      maxSize: 50 * 1024 * 1024, // 50MB内存缓存
      defaultTTL: 2 * 60 * 60 * 1000, // 2小时默认TTL
      maxItems: 5000,
      cleanupInterval: 10 * 60 * 1000, // 10分钟清理间隔
    });

    this.strategyManager = new CacheStrategyManager();
    this.initializeOfflineSupport();
  }

  static getInstance(): UnifiedCacheManager {
    if (!UnifiedCacheManager.instance) {
      UnifiedCacheManager.instance = new UnifiedCacheManager();
    }
    return UnifiedCacheManager.instance;
  }

  /**
   * 智能缓存设置
   */
  async set<T>(
    key: string,
    data: T,
    operation: 'translation' | 'ocr' | 'config',
    options: {
      forceStrategy?: string;
      userPreferences?: any;
      priority?: number;
      tags?: string[];
      enableOffline?: boolean;
    } = {}
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // 1. 设置内存缓存（使用智能策略）
      this.strategyManager.smartSet(key, data, operation, {
        userPreferences: options.userPreferences,
        forceStrategy: options.forceStrategy,
      });

      // 2. 设置持久化缓存（Zustand store）
      const cacheStore = useCacheStore.getState();
      const ttl = this.calculateTTL(key, data, operation);

      switch (operation) {
        case 'translation':
          cacheStore.setTranslationCache(key, data, ttl);
          break;
        case 'ocr':
          cacheStore.setOCRCache(key, data, ttl);
          break;
        case 'config':
          // 配置数据通常不需要TTL
          break;
      }

      // 3. 离线缓存（如果启用）
      if (options.enableOffline) {
        this.offlineCache.set(key, {
          data,
          timestamp: Date.now(),
          operation,
        });
      }

      // 4. 记录性能指标
      const duration = performance.now() - startTime;
      performanceMonitor.recordCacheOperation('set', operation, duration, true);

      console.debug(`统一缓存设置成功: ${key} (${operation}), 耗时: ${duration.toFixed(2)}ms`);
    } catch (error) {
      const duration = performance.now() - startTime;
      performanceMonitor.recordCacheOperation('set', operation, duration, false);
      console.error('统一缓存设置失败:', error);
      throw error;
    }
  }

  /**
   * 智能缓存获取
   */
  async get<T>(
    key: string,
    operation: 'translation' | 'ocr' | 'config',
    options: {
      fallbackToOffline?: boolean;
      updateStats?: boolean;
    } = {}
  ): Promise<T | null> {
    const startTime = performance.now();
    const { fallbackToOffline = true, updateStats = true } = options;

    try {
      // 1. 尝试从内存缓存获取
      let result = this.strategyManager.smartGet<T>(key);
      if (result !== null) {
        this.recordCacheHit(key, 'memory');
        const duration = performance.now() - startTime;
        performanceMonitor.recordCacheOperation('get', operation, duration, true);
        return result;
      }

      // 2. 尝试从持久化缓存获取
      const cacheStore = useCacheStore.getState();
      switch (operation) {
        case 'translation':
          result = cacheStore.getTranslationCache(key);
          break;
        case 'ocr':
          result = cacheStore.getOCRCache(key);
          break;
        case 'config':
          // 配置数据从其他地方获取
          break;
      }

      if (result !== null) {
        // 将数据重新加载到内存缓存
        this.intelligentCache.set(key, result);
        this.recordCacheHit(key, 'persistent');
        const duration = performance.now() - startTime;
        performanceMonitor.recordCacheOperation('get', operation, duration, true);
        return result;
      }

      // 3. 尝试从离线缓存获取
      if (fallbackToOffline && this.offlineCache.has(key)) {
        const offlineItem = this.offlineCache.get(key);
        if (offlineItem && offlineItem.operation === operation) {
          this.recordCacheHit(key, 'offline');
          const duration = performance.now() - startTime;
          performanceMonitor.recordCacheOperation('get', operation, duration, true);
          return offlineItem.data;
        }
      }

      // 4. 缓存未命中
      this.recordCacheMiss(key);
      const duration = performance.now() - startTime;
      performanceMonitor.recordCacheOperation('get', operation, duration, false);
      return null;
    } catch (error) {
      const duration = performance.now() - startTime;
      performanceMonitor.recordCacheOperation('get', operation, duration, false);
      console.error('统一缓存获取失败:', error);
      return null;
    }
  }

  /**
   * 预热缓存
   */
  async warmupCache(
    type: 'translation' | 'ocr' | 'common',
    data: {
      commonTexts?: string[];
      targetLanguages?: string[];
      imageHashes?: string[];
      userPreferences?: any;
    }
  ): Promise<void> {
    console.log(`开始缓存预热: ${type}`);
    const startTime = performance.now();

    try {
      switch (type) {
        case 'translation':
          await this.warmupTranslationCache(data);
          break;
        case 'ocr':
          await this.warmupOCRCache(data);
          break;
        case 'common':
          await this.warmupCommonCache(data);
          break;
      }

      const duration = performance.now() - startTime;
      console.log(`缓存预热完成: ${type}, 耗时: ${duration.toFixed(2)}ms`);
    } catch (error) {
      console.error('缓存预热失败:', error);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    memory: any;
    persistent: any;
    offline: any;
    hitRates: Record<string, { hitRate: number; totalRequests: number }>;
  } {
    const persistentStats = useCacheStore.getState().getCacheStats();
    
    const hitRates: Record<string, { hitRate: number; totalRequests: number }> = {};
    this.cacheHitStats.forEach((stats, key) => {
      const totalRequests = stats.hits + stats.misses;
      hitRates[key] = {
        hitRate: totalRequests > 0 ? stats.hits / totalRequests : 0,
        totalRequests,
      };
    });

    return {
      memory: this.intelligentCache.getStats(),
      persistent: persistentStats,
      offline: {
        size: this.offlineCache.size,
        keys: Array.from(this.offlineCache.keys()),
      },
      hitRates,
    };
  }

  /**
   * 清理过期缓存
   */
  async cleanup(options: {
    aggressive?: boolean;
    maxAge?: number;
    targetSize?: number;
  } = {}): Promise<void> {
    const { aggressive = false, maxAge, targetSize } = options;

    // 清理内存缓存
    this.intelligentCache.cleanup();

    // 清理持久化缓存
    const cacheStore = useCacheStore.getState();
    cacheStore.cleanExpiredCache();

    // 清理离线缓存
    if (aggressive || maxAge) {
      const cutoffTime = Date.now() - (maxAge || 7 * 24 * 60 * 60 * 1000); // 默认7天
      for (const [key, item] of this.offlineCache.entries()) {
        if (item.timestamp < cutoffTime) {
          this.offlineCache.delete(key);
        }
      }
    }

    console.log('缓存清理完成');
  }

  /**
   * 初始化离线支持
   */
  private initializeOfflineSupport(): void {
    // 监听网络状态变化
    if (typeof window !== 'undefined' && 'navigator' in window) {
      window.addEventListener('online', () => {
        console.log('网络已连接，同步离线缓存');
        this.syncOfflineCache();
      });

      window.addEventListener('offline', () => {
        console.log('网络已断开，启用离线模式');
      });
    }
  }

  /**
   * 同步离线缓存
   */
  private async syncOfflineCache(): Promise<void> {
    // 将离线缓存中的数据同步到持久化缓存
    for (const [key, item] of this.offlineCache.entries()) {
      try {
        await this.set(key, item.data, item.operation, { enableOffline: false });
      } catch (error) {
        console.error(`同步离线缓存失败: ${key}`, error);
      }
    }
  }

  /**
   * 计算TTL
   */
  private calculateTTL(key: string, data: any, operation: string): number {
    // 基于操作类型和数据特征计算TTL
    const baseTime = {
      translation: 24 * 60 * 60 * 1000, // 24小时
      ocr: 7 * 24 * 60 * 60 * 1000, // 7天
      config: 30 * 24 * 60 * 60 * 1000, // 30天
    };

    return baseTime[operation as keyof typeof baseTime] || baseTime.translation;
  }

  /**
   * 记录缓存命中
   */
  private recordCacheHit(key: string, source: 'memory' | 'persistent' | 'offline'): void {
    const stats = this.cacheHitStats.get(key) || { hits: 0, misses: 0 };
    stats.hits++;
    this.cacheHitStats.set(key, stats);
    console.debug(`缓存命中: ${key} (${source})`);
  }

  /**
   * 记录缓存未命中
   */
  private recordCacheMiss(key: string): void {
    const stats = this.cacheHitStats.get(key) || { hits: 0, misses: 0 };
    stats.misses++;
    this.cacheHitStats.set(key, stats);
    console.debug(`缓存未命中: ${key}`);
  }

  /**
   * 预热翻译缓存
   */
  private async warmupTranslationCache(data: any): Promise<void> {
    // 实现翻译缓存预热逻辑
    // 这里可以预加载常用文本的翻译结果
  }

  /**
   * 预热OCR缓存
   */
  private async warmupOCRCache(data: any): Promise<void> {
    // 实现OCR缓存预热逻辑
    // 这里可以预加载常见图像的OCR结果
  }

  /**
   * 预热通用缓存
   */
  private async warmupCommonCache(data: any): Promise<void> {
    // 实现通用缓存预热逻辑
    // 这里可以预加载用户偏好设置等
  }
}

// 导出单例实例
export const unifiedCacheManager = UnifiedCacheManager.getInstance();
