/**
 * 智能缓存管理器
 * 提供多级缓存、智能失效、容量管理和LRU算法
 */

// ==================== 缓存配置 ====================

export interface CacheConfig {
  maxSize: number;
  maxAge: number; // 毫秒
  enableCompression: boolean;
  enableEncryption: boolean;
  enableLRU: boolean;
  enablePredictiveLoading: boolean;
  enableBackgroundRefresh: boolean;
  compressionThreshold: number; // 字节
  encryptionThreshold: number; // 字节
}

// ==================== 缓存项 ====================

export interface CacheItem<T = any> {
  key: string;
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  size: number;
  compressed: boolean;
  encrypted: boolean;
  metadata?: Record<string, any>;
}

// ==================== 缓存统计 ====================

export interface CacheStats {
  totalItems: number;
  totalSize: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  averageAccessTime: number;
  compressionRatio: number;
  memoryUsage: number;
}

// ==================== 缓存级别 ====================

export enum CacheLevel {
  MEMORY = 'memory',
  SESSION = 'session',
  PERSISTENT = 'persistent',
}

// ==================== 智能缓存管理器 ====================

export class IntelligentCacheManager<T = any> {
  private memoryCache: Map<string, CacheItem<T>> = new Map();
  private sessionCache: Map<string, CacheItem<T>> = new Map();
  private persistentCache: Map<string, CacheItem<T>> = new Map();
  
  private config: CacheConfig;
  private stats: CacheStats;
  private accessPatterns: Map<string, number[]> = new Map();
  private backgroundRefreshTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 1000,
      maxAge: 24 * 60 * 60 * 1000, // 24小时
      enableCompression: true,
      enableEncryption: false,
      enableLRU: true,
      enablePredictiveLoading: true,
      enableBackgroundRefresh: true,
      compressionThreshold: 1024, // 1KB
      encryptionThreshold: 1024 * 10, // 10KB
      ...config,
    };

    this.stats = this.initializeStats();
    this.loadFromStorage();
    this.startBackgroundRefresh();
  }

  // ==================== 核心缓存操作 ====================

  /**
   * 设置缓存项
   */
  set(key: string, value: T, level: CacheLevel = CacheLevel.MEMORY, metadata?: Record<string, any>): void {
    const cache = this.getCacheByLevel(level);
    const item: CacheItem<T> = {
      key,
      value: this.cloneData(value),
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
      size: this.calculateSize(value),
      compressed: false,
      encrypted: false,
      metadata,
    };

    // 应用压缩和加密
    this.processItem(item);

    // 检查容量限制
    this.ensureCapacity(level);

    cache.set(key, item);
    this.updateStats();
    this.saveToStorage();
  }

  /**
   * 获取缓存项
   */
  get(key: string, level: CacheLevel = CacheLevel.MEMORY): T | null {
    const cache = this.getCacheByLevel(level);
    const item = cache.get(key);

    if (!item) {
      this.stats.missCount++;
      this.updateStats();
      return null;
    }

    // 检查是否过期
    if (this.isExpired(item)) {
      cache.delete(key);
      this.stats.missCount++;
      this.updateStats();
      return null;
    }

    // 更新访问统计
    item.accessCount++;
    item.lastAccess = Date.now();
    this.stats.hitCount++;

    // 记录访问模式
    this.recordAccessPattern(key);

    // 如果启用LRU，移动到末尾
    if (this.config.enableLRU) {
      cache.delete(key);
      cache.set(key, item);
    }

    this.updateStats();
    return this.cloneData(item.value);
  }

  /**
   * 检查缓存是否存在
   */
  has(key: string, level: CacheLevel = CacheLevel.MEMORY): boolean {
    const cache = this.getCacheByLevel(level);
    const item = cache.get(key);
    
    if (!item) {
      return false;
    }

    if (this.isExpired(item)) {
      cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存项
   */
  delete(key: string, level: CacheLevel = CacheLevel.MEMORY): boolean {
    const cache = this.getCacheByLevel(level);
    const deleted = cache.delete(key);
    
    if (deleted) {
      this.updateStats();
      this.saveToStorage();
    }

    return deleted;
  }

  /**
   * 清空缓存
   */
  clear(level?: CacheLevel): void {
    if (level) {
      const cache = this.getCacheByLevel(level);
      cache.clear();
    } else {
      this.memoryCache.clear();
      this.sessionCache.clear();
      this.persistentCache.clear();
    }

    this.updateStats();
    this.saveToStorage();
  }

  // ==================== 高级功能 ====================

  /**
   * 批量设置缓存
   */
  setBatch(items: Array<{ key: string; value: T; level?: CacheLevel; metadata?: Record<string, any> }>): void {
    for (const item of items) {
      this.set(item.key, item.value, item.level || CacheLevel.MEMORY, item.metadata);
    }
  }

  /**
   * 批量获取缓存
   */
  getBatch(keys: string[], level: CacheLevel = CacheLevel.MEMORY): Map<string, T | null> {
    const result = new Map<string, T | null>();
    
    for (const key of keys) {
      result.set(key, this.get(key, level));
    }

    return result;
  }

  /**
   * 预加载缓存
   */
  async preload(keys: string[], loader: (key: string) => Promise<T>, level: CacheLevel = CacheLevel.MEMORY): Promise<void> {
    const promises = keys.map(async (key) => {
      if (!this.has(key, level)) {
        try {
          const value = await loader(key);
          this.set(key, value, level);
        } catch (error) {
          console.error(`Preload failed for key ${key}:`, error);
        }
      }
    });

    await Promise.all(promises);
  }

  /**
   * 智能预加载（基于访问模式）
   */
  async smartPreload(loader: (key: string) => Promise<T>, level: CacheLevel = CacheLevel.MEMORY): Promise<void> {
    const patterns = this.analyzeAccessPatterns();
    const predictedKeys = this.predictNextKeys(patterns);
    
    await this.preload(predictedKeys, loader, level);
  }

  /**
   * 缓存预热
   */
  async warmup(keys: string[], loader: (key: string) => Promise<T>, level: CacheLevel = CacheLevel.MEMORY): Promise<void> {
    console.log(`Warming up cache with ${keys.length} items...`);
    
    const startTime = Date.now();
    await this.preload(keys, loader, level);
    
    const duration = Date.now() - startTime;
    console.log(`Cache warmup completed in ${duration}ms`);
  }

  // ==================== 缓存优化 ====================

  /**
   * 压缩缓存
   */
  compressCache(): void {
    if (!this.config.enableCompression) {
      return;
    }

    const allCaches = [this.memoryCache, this.sessionCache, this.persistentCache];
    
    for (const cache of allCaches) {
      for (const [_key, item] of cache) {
        if (!item.compressed && item.size > this.config.compressionThreshold) {
          item.value = this.compress(item.value);
          item.compressed = true;
          item.size = this.calculateSize(item.value);
        }
      }
    }

    this.updateStats();
    this.saveToStorage();
  }

  /**
   * 清理过期缓存
   */
  cleanupExpired(): number {
    let cleanedCount = 0;
    const allCaches = [this.memoryCache, this.sessionCache, this.persistentCache];
    
    for (const cache of allCaches) {
      for (const [key, item] of cache) {
        if (this.isExpired(item)) {
          cache.delete(key);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.updateStats();
      this.saveToStorage();
    }

    return cleanedCount;
  }

  /**
   * 优化缓存大小
   */
  optimizeSize(): void {
    const allCaches = [this.memoryCache, this.sessionCache, this.persistentCache];
    
    for (const cache of allCaches) {
      if (cache.size > this.config.maxSize) {
        // 使用LRU策略删除最久未访问的项目
        const items = Array.from(cache.entries());
        items.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
        
        const toDelete = items.slice(0, cache.size - this.config.maxSize);
        for (const [key] of toDelete) {
          cache.delete(key);
        }
      }
    }

    this.updateStats();
    this.saveToStorage();
  }

  // ==================== 统计分析 ====================

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 获取访问模式分析
   */
  getAccessPatterns(): Map<string, number[]> {
    return new Map(this.accessPatterns);
  }

  /**
   * 获取缓存使用情况
   */
  getUsageReport(): {
    memory: { size: number; items: number };
    session: { size: number; items: number };
    persistent: { size: number; items: number };
    total: { size: number; items: number };
  } {
    const memory = this.getCacheStats(this.memoryCache);
    const session = this.getCacheStats(this.sessionCache);
    const persistent = this.getCacheStats(this.persistentCache);
    
    return {
      memory,
      session,
      persistent,
      total: {
        size: memory.size + session.size + persistent.size,
        items: memory.items + session.items + persistent.items,
      },
    };
  }

  // ==================== 工具方法 ====================

  /**
   * 获取指定级别的缓存
   */
  private getCacheByLevel(level: CacheLevel): Map<string, CacheItem<T>> {
    switch (level) {
      case CacheLevel.MEMORY:
        return this.memoryCache;
      case CacheLevel.SESSION:
        return this.sessionCache;
      case CacheLevel.PERSISTENT:
        return this.persistentCache;
      default:
        return this.memoryCache;
    }
  }

  /**
   * 检查缓存项是否过期
   */
  private isExpired(item: CacheItem<T>): boolean {
    return Date.now() - item.timestamp > this.config.maxAge;
  }

  /**
   * 确保缓存容量
   */
  private ensureCapacity(level: CacheLevel): void {
    const cache = this.getCacheByLevel(level);
    
    if (cache.size >= this.config.maxSize) {
      // 删除最久未访问的项目
      const items = Array.from(cache.entries());
      items.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      const firstItem = items[0];
      if (firstItem) {
        cache.delete(firstItem[0]);
      }
    }
  }

  /**
   * 处理缓存项（压缩/加密）
   */
  private processItem(item: CacheItem<T>): void {
    if (this.config.enableCompression && item.size > this.config.compressionThreshold) {
      item.value = this.compress(item.value);
      item.compressed = true;
      item.size = this.calculateSize(item.value);
    }

    if (this.config.enableEncryption && item.size > this.config.encryptionThreshold) {
      item.value = this.encrypt(item.value);
      item.encrypted = true;
      item.size = this.calculateSize(item.value);
    }
  }

  /**
   * 计算数据大小
   */
  private calculateSize(data: any): number {
    try {
      return JSON.stringify(data).length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 克隆数据
   */
  private cloneData<T>(data: T): T {
    try {
      return JSON.parse(JSON.stringify(data));
    } catch (error) {
      return data;
    }
  }

  /**
   * 压缩数据
   */
  private compress(data: any): any {
    try {
      const serialized = JSON.stringify(data);
      // 简单的压缩：移除不必要的空格
      const compressed = serialized.replace(/\s+/g, ' ').trim();
      return JSON.parse(compressed);
    } catch (error) {
      return data;
    }
  }

  /**
   * 加密数据
   */
  private encrypt(data: any): any {
    try {
      const serialized = JSON.stringify(data);
      const encrypted = btoa(serialized);
      return { encrypted, type: 'encrypted' };
    } catch (error) {
      return data;
    }
  }

  /**
   * 记录访问模式
   */
  private recordAccessPattern(key: string): void {
    const now = Date.now();
    const pattern = this.accessPatterns.get(key) || [];
    pattern.push(now);
    
    // 只保留最近100次访问记录
    if (pattern.length > 100) {
      pattern.splice(0, pattern.length - 100);
    }
    
    this.accessPatterns.set(key, pattern);
  }

  /**
   * 分析访问模式
   */
  private analyzeAccessPatterns(): Map<string, number[]> {
    return new Map(this.accessPatterns);
  }

  /**
   * 预测下一个可能访问的键
   */
  private predictNextKeys(patterns: Map<string, number[]>): string[] {
    const predictions: string[] = [];
    const now = Date.now();
    const timeWindow = 5 * 60 * 1000; // 5分钟

    for (const [key, pattern] of patterns) {
      const recentAccesses = pattern.filter(time => now - time < timeWindow);
      if (recentAccesses.length > 0) {
        predictions.push(key);
      }
    }

    return predictions.slice(0, 10); // 最多预测10个键
  }

  /**
   * 初始化统计信息
   */
  private initializeStats(): CacheStats {
    return {
      totalItems: 0,
      totalSize: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: 0,
      averageAccessTime: 0,
      compressionRatio: 0,
      memoryUsage: 0,
    };
  }

  /**
   * 更新统计信息
   */
  private updateStats(): void {
    const allCaches = [this.memoryCache, this.sessionCache, this.persistentCache];
    
    this.stats.totalItems = allCaches.reduce((sum, cache) => sum + cache.size, 0);
    this.stats.totalSize = allCaches.reduce((sum, cache) => {
      return sum + Array.from(cache.values()).reduce((cacheSum, item) => cacheSum + item.size, 0);
    }, 0);
    
    const totalRequests = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = totalRequests > 0 ? this.stats.hitCount / totalRequests : 0;
    
    this.stats.memoryUsage = this.estimateMemoryUsage();
  }

  /**
   * 获取缓存统计
   */
  private getCacheStats(cache: Map<string, CacheItem<T>>): { size: number; items: number } {
    const items = Array.from(cache.values());
    return {
      size: items.reduce((sum, item) => sum + item.size, 0),
      items: items.length,
    };
  }

  /**
   * 估算内存使用量
   */
  private estimateMemoryUsage(): number {
    try {
      const allData = {
        memoryCache: Array.from(this.memoryCache.entries()),
        sessionCache: Array.from(this.sessionCache.entries()),
        persistentCache: Array.from(this.persistentCache.entries()),
        accessPatterns: Array.from(this.accessPatterns.entries()),
      };
      
      return JSON.stringify(allData).length * 2; // 粗略估算
    } catch (error) {
      return 0;
    }
  }

  /**
   * 启动后台刷新
   */
  private startBackgroundRefresh(): void {
    if (this.config.enableBackgroundRefresh) {
      this.backgroundRefreshTimer = setInterval(() => {
        this.cleanupExpired();
        this.optimizeSize();
      }, 5 * 60 * 1000); // 每5分钟执行一次
    }
  }

  /**
   * 保存到存储
   */
  private saveToStorage(): void {
    try {
      const data = {
        memoryCache: Array.from(this.memoryCache.entries()),
        sessionCache: Array.from(this.sessionCache.entries()),
        persistentCache: Array.from(this.persistentCache.entries()),
        accessPatterns: Array.from(this.accessPatterns.entries()),
        stats: this.stats,
        timestamp: Date.now(),
      };

      localStorage.setItem('manga-translator-cache', JSON.stringify(data));
    } catch (error) {
      console.error('Save cache to storage failed:', error);
    }
  }

  /**
   * 从存储加载
   */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem('manga-translator-cache');
      if (!data) return;

      const parsed = JSON.parse(data);
      
      if (parsed.memoryCache) {
        this.memoryCache = new Map(parsed.memoryCache);
      }
      if (parsed.sessionCache) {
        this.sessionCache = new Map(parsed.sessionCache);
      }
      if (parsed.persistentCache) {
        this.persistentCache = new Map(parsed.persistentCache);
      }
      if (parsed.accessPatterns) {
        this.accessPatterns = new Map(parsed.accessPatterns);
      }
      if (parsed.stats) {
        this.stats = { ...this.stats, ...parsed.stats };
      }
    } catch (error) {
      console.error('Load cache from storage failed:', error);
    }
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    if (this.backgroundRefreshTimer) {
      clearInterval(this.backgroundRefreshTimer);
      this.backgroundRefreshTimer = null;
    }
    
    this.memoryCache.clear();
    this.sessionCache.clear();
    this.persistentCache.clear();
    this.accessPatterns.clear();
  }
}

// ==================== 导出 ==================== 