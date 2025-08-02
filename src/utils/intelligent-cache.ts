import { performanceMonitor } from './performance-monitor';

/**
 * 缓存项接口
 */
export interface CacheItem<T = any> {
  data: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
  priority: number;
  tags: string[];
}

/**
 * 缓存配置接口
 */
export interface CacheConfig {
  maxSize: number; // 最大缓存大小（字节）
  defaultTTL: number; // 默认TTL（毫秒）
  maxItems: number; // 最大缓存项数量
  cleanupInterval: number; // 清理间隔（毫秒）
  compressionThreshold: number; // 压缩阈值（字节）
}

/**
 * 智能缓存管理器
 * 支持LRU、LFU、TTL、优先级、压缩等多种策略
 */
export class IntelligentCache {
  private cache: Map<string, CacheItem> = new Map();
  private config: CacheConfig;
  private currentSize: number = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private accessHistory: Map<string, number[]> = new Map(); // 访问历史用于预测

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 100 * 1024 * 1024, // 100MB
      defaultTTL: 24 * 60 * 60 * 1000, // 24小时
      maxItems: 10000,
      cleanupInterval: 5 * 60 * 1000, // 5分钟
      compressionThreshold: 1024, // 1KB
      ...config,
    };

    this.startCleanupTimer();
  }

  /**
   * 设置缓存项
   */
  set<T>(
    key: string, 
    data: T, 
    options: {
      ttl?: number;
      priority?: number;
      tags?: string[];
      compress?: boolean;
    } = {}
  ): void {
    const {
      ttl = this.config.defaultTTL,
      priority = 1,
      tags = [],
      compress = false,
    } = options;

    // 计算数据大小
    const serializedData = JSON.stringify(data);
    let finalData: any = data;
    let size = new Blob([serializedData]).size;

    // 压缩大数据
    if (compress || size > this.config.compressionThreshold) {
      try {
        finalData = this.compressData(serializedData);
        size = new Blob([finalData]).size;
      } catch (error) {
        console.warn('数据压缩失败，使用原始数据:', error);
      }
    }

    const now = Date.now();
    const item: CacheItem<T> = {
      data: finalData,
      timestamp: now,
      accessCount: 1,
      lastAccessed: now,
      size,
      priority,
      tags,
    };

    // 检查是否需要清理空间
    if (this.needsCleanup(size)) {
      this.cleanup(size);
    }

    // 更新现有项或添加新项
    const existingItem = this.cache.get(key);
    if (existingItem) {
      this.currentSize -= existingItem.size;
    }

    this.cache.set(key, item);
    this.currentSize += size;

    // 记录访问历史
    this.recordAccess(key);

    // 更新性能监控
    performanceMonitor.updateCacheSize(this.currentSize);
  }

  /**
   * 获取缓存项
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) {
      performanceMonitor.recordCacheMiss();
      return null;
    }

    // 检查TTL
    if (this.isExpired(item)) {
      this.delete(key);
      performanceMonitor.recordCacheMiss();
      return null;
    }

    // 更新访问信息
    item.accessCount++;
    item.lastAccessed = Date.now();

    // 记录访问历史
    this.recordAccess(key);

    performanceMonitor.recordCacheHit();

    // 解压缩数据（如果需要）
    try {
      return this.isCompressed(item.data) ? 
        JSON.parse(this.decompressData(item.data)) : item.data;
    } catch (error) {
      console.error('缓存数据解压失败:', error);
      this.delete(key);
      return null;
    }
  }

  /**
   * 删除缓存项
   */
  delete(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    this.cache.delete(key);
    this.currentSize -= item.size;
    this.accessHistory.delete(key);

    performanceMonitor.updateCacheSize(this.currentSize);
    return true;
  }

  /**
   * 检查缓存项是否存在且未过期
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    if (this.isExpired(item)) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 根据标签清理缓存
   */
  clearByTags(tags: string[]): number {
    let cleared = 0;
    
    for (const [key, item] of this.cache.entries()) {
      if (item.tags.some(tag => tags.includes(tag))) {
        this.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessHistory.clear();
    this.currentSize = 0;
    performanceMonitor.updateCacheSize(0);
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    itemCount: number;
    hitRate: number;
    averageItemSize: number;
    topKeys: Array<{ key: string; accessCount: number; size: number }>;
  } {
    const items = Array.from(this.cache.entries());
    const totalAccess = items.reduce((sum, [, item]) => sum + item.accessCount, 0);
    
    // 获取访问最频繁的键
    const topKeys = items
      .sort((a, b) => b[1].accessCount - a[1].accessCount)
      .slice(0, 10)
      .map(([key, item]) => ({
        key,
        accessCount: item.accessCount,
        size: item.size,
      }));

    return {
      size: this.currentSize,
      itemCount: this.cache.size,
      hitRate: performanceMonitor.getMetrics().cache.hitRate,
      averageItemSize: this.cache.size > 0 ? this.currentSize / this.cache.size : 0,
      topKeys,
    };
  }

  /**
   * 预测性预加载
   */
  predictAndPreload(currentKey: string, preloadFunction: (key: string) => Promise<any>): void {
    const history = this.accessHistory.get(currentKey) || [];
    
    // 简单的预测算法：基于访问模式预测下一个可能访问的键
    if (history.length >= 2) {
      const pattern = this.findAccessPattern(history);
      if (pattern) {
        // 异步预加载预测的键
        setTimeout(() => {
          preloadFunction(pattern).catch(error => {
            console.debug('预加载失败:', error);
          });
        }, 100);
      }
    }
  }

  /**
   * 检查是否需要清理空间
   */
  private needsCleanup(newItemSize: number): boolean {
    return (
      this.currentSize + newItemSize > this.config.maxSize ||
      this.cache.size >= this.config.maxItems
    );
  }

  /**
   * 智能清理缓存
   */
  private cleanup(requiredSpace: number = 0): void {
    const items = Array.from(this.cache.entries());
    
    // 计算每个项的清理优先级分数（越低越优先清理）
    const scoredItems = items.map(([key, item]) => {
      const age = Date.now() - item.timestamp;
      const timeSinceAccess = Date.now() - item.lastAccessed;
      
      // 综合评分：考虑优先级、访问频率、时间因素
      const score = 
        item.priority * 1000 + // 优先级权重
        item.accessCount * 100 + // 访问频率权重
        Math.max(0, this.config.defaultTTL - age) / 1000 + // 剩余TTL权重
        Math.max(0, 3600000 - timeSinceAccess) / 1000; // 最近访问权重

      return { key, item, score };
    });

    // 按分数排序，分数低的优先清理
    scoredItems.sort((a, b) => a.score - b.score);

    let freedSpace = 0;
    let targetSpace = requiredSpace || this.config.maxSize * 0.2; // 清理20%空间

    for (const { key } of scoredItems) {
      if (freedSpace >= targetSpace) break;
      
      const item = this.cache.get(key);
      if (item) {
        freedSpace += item.size;
        this.delete(key);
      }
    }

    console.log(`缓存清理完成，释放空间: ${freedSpace} 字节`);
  }

  /**
   * 检查项是否过期
   */
  private isExpired(item: CacheItem): boolean {
    return Date.now() - item.timestamp > this.config.defaultTTL;
  }

  /**
   * 记录访问历史
   */
  private recordAccess(key: string): void {
    const history = this.accessHistory.get(key) || [];
    history.push(Date.now());
    
    // 只保留最近的访问记录
    if (history.length > 10) {
      history.shift();
    }
    
    this.accessHistory.set(key, history);
  }

  /**
   * 查找访问模式
   */
  private findAccessPattern(history: number[]): string | null {
    // 简化的模式识别：这里可以实现更复杂的算法
    // 目前只是一个占位符实现
    return null;
  }

  /**
   * 压缩数据
   */
  private compressData(data: string): string {
    // 简单的压缩实现（实际项目中可以使用更好的压缩算法）
    try {
      return btoa(data);
    } catch (error) {
      return data;
    }
  }

  /**
   * 解压数据
   */
  private decompressData(data: string): string {
    try {
      return atob(data);
    } catch (error) {
      return data;
    }
  }

  /**
   * 检查数据是否被压缩
   */
  private isCompressed(data: any): boolean {
    return typeof data === 'string' && data.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data);
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * 停止清理定时器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}
