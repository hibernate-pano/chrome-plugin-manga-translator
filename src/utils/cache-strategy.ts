import { IntelligentCache } from './intelligent-cache';
import { performanceMonitor } from './performance-monitor';

/**
 * 缓存策略接口
 */
export interface CacheStrategy {
  name: string;
  description: string;
  shouldCache(key: string, data: any, context: CacheContext): boolean;
  getTTL(key: string, data: any, context: CacheContext): number;
  getPriority(key: string, data: any, context: CacheContext): number;
  getTags(key: string, data: any, context: CacheContext): string[];
}

/**
 * 缓存上下文
 */
export interface CacheContext {
  operation: 'translation' | 'ocr' | 'config';
  dataSize: number;
  frequency: number;
  userPreferences: any;
  systemLoad: number;
}

/**
 * 翻译缓存策略
 */
export class TranslationCacheStrategy implements CacheStrategy {
  name = 'translation';
  description = '翻译结果缓存策略';

  shouldCache(_key: string, _data: any, context: CacheContext): boolean {
    // 总是缓存翻译结果，除非数据过大
    if (context.dataSize > 1024 * 1024) { // 1MB
      return false;
    }

    // 如果是常用文本，优先缓存
    if (context.frequency > 5) {
      return true;
    }

    // 如果系统负载高，减少缓存
    if (context.systemLoad > 0.8) {
      return context.dataSize < 10 * 1024; // 只缓存小于10KB的数据
    }

    return true;
  }

  getTTL(_key: string, _data: any, context: CacheContext): number {
    const baseTTL = 24 * 60 * 60 * 1000; // 24小时

    // 根据访问频率调整TTL
    if (context.frequency > 10) {
      return baseTTL * 7; // 高频访问，缓存7天
    } else if (context.frequency > 5) {
      return baseTTL * 3; // 中频访问，缓存3天
    } else if (context.frequency < 2) {
      return baseTTL * 0.5; // 低频访问，缓存12小时
    }

    return baseTTL;
  }

  getPriority(_key: string, _data: any, context: CacheContext): number {
    let priority = 1;

    // 根据访问频率调整优先级
    priority += Math.min(context.frequency / 10, 5);

    // 小数据优先级更高
    if (context.dataSize < 1024) {
      priority += 2;
    } else if (context.dataSize < 10 * 1024) {
      priority += 1;
    }

    return Math.min(priority, 10);
  }

  getTags(_key: string, _data: any, context: CacheContext): string[] {
    const tags = ['translation'];

    // 根据数据大小添加标签
    if (context.dataSize > 100 * 1024) {
      tags.push('large');
    } else if (context.dataSize < 1024) {
      tags.push('small');
    }

    // 根据频率添加标签
    if (context.frequency > 10) {
      tags.push('hot');
    } else if (context.frequency < 2) {
      tags.push('cold');
    }

    return tags;
  }
}

/**
 * OCR缓存策略
 */
export class OCRCacheStrategy implements CacheStrategy {
  name = 'ocr';
  description = 'OCR结果缓存策略';

  shouldCache(_key: string, _data: any, context: CacheContext): boolean {
    // OCR结果通常比较稳定，积极缓存
    if (context.dataSize > 5 * 1024 * 1024) { // 5MB
      return false;
    }

    // 如果检测到的文本区域很多，优先缓存
    if (Array.isArray(_data) && _data.length > 10) {
      return true;
    }

    return true;
  }

  getTTL(_key: string, _data: any, context: CacheContext): number {
    const baseTTL = 7 * 24 * 60 * 60 * 1000; // 7天

    // OCR结果相对稳定，可以缓存更长时间
    if (context.frequency > 3) {
      return baseTTL * 2; // 高频图片，缓存14天
    }

    return baseTTL;
  }

  getPriority(_key: string, data: any, context: CacheContext): number {
    let priority = 2; // OCR比翻译优先级稍高

    // 根据检测到的文本区域数量调整优先级
    if (Array.isArray(data)) {
      priority += Math.min(data.length / 5, 3);
    }

    // 根据访问频率调整
    priority += Math.min(context.frequency / 5, 2);

    return Math.min(priority, 10);
  }

  getTags(_key: string, data: any, context: CacheContext): string[] {
    const tags = ['ocr'];

    // 根据检测结果添加标签
    if (Array.isArray(data)) {
      if (data.length > 20) {
        tags.push('complex');
      } else if (data.length < 5) {
        tags.push('simple');
      }
    }

    // 根据频率添加标签
    if (context.frequency > 5) {
      tags.push('frequent');
    }

    return tags;
  }
}

/**
 * 配置缓存策略
 */
export class ConfigCacheStrategy implements CacheStrategy {
  name = 'config';
  description = '配置数据缓存策略';

  shouldCache(_key: string, _data: any, _context: CacheContext): boolean {
    // 配置数据总是缓存
    return true;
  }

  getTTL(_key: string, _data: any, _context: CacheContext): number {
    // 配置数据缓存30天
    return 30 * 24 * 60 * 60 * 1000;
  }

  getPriority(_key: string, _data: any, _context: CacheContext): number {
    // 配置数据最高优先级
    return 10;
  }

  getTags(_key: string, _data: any, _context: CacheContext): string[] {
    return ['config', 'persistent'];
  }
}

/**
 * 缓存策略管理器
 */
export class CacheStrategyManager {
  private strategies: Map<string, CacheStrategy> = new Map();
  private cache: IntelligentCache;
  private accessFrequency: Map<string, number> = new Map();

  constructor(cache: IntelligentCache) {
    this.cache = cache;
    this.registerDefaultStrategies();
  }

  /**
   * 注册默认策略
   */
  private registerDefaultStrategies(): void {
    this.registerStrategy(new TranslationCacheStrategy());
    this.registerStrategy(new OCRCacheStrategy());
    this.registerStrategy(new ConfigCacheStrategy());
  }

  /**
   * 注册缓存策略
   */
  registerStrategy(strategy: CacheStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * 智能缓存设置
   */
  smartSet<T>(
    key: string,
    data: T,
    operation: 'translation' | 'ocr' | 'config',
    options: {
      userPreferences?: any;
      forceStrategy?: string;
    } = {}
  ): void {
    // 获取策略
    const strategyName = options.forceStrategy || operation;
    const strategy = this.strategies.get(strategyName);

    if (!strategy) {
      console.warn(`未找到缓存策略: ${strategyName}`);
      return;
    }

    // 构建缓存上下文
    const context: CacheContext = {
      operation,
      dataSize: this.calculateDataSize(data),
      frequency: this.getAccessFrequency(key),
      userPreferences: options.userPreferences || {},
      systemLoad: this.getSystemLoad(),
    };

    // 检查是否应该缓存
    if (!strategy.shouldCache(key, data, context)) {
      console.debug(`策略决定不缓存: ${key}`);
      return;
    }

    // 获取缓存参数
    const ttl = strategy.getTTL(key, data, context);
    const priority = strategy.getPriority(key, data, context);
    const tags = strategy.getTags(key, data, context);

    // 设置缓存
    this.cache.set(key, data, {
      ttl,
      priority,
      tags,
      compress: context.dataSize > 1024, // 大于1KB的数据进行压缩
    });

    // 记录访问
    this.recordAccess(key);

    console.debug(`智能缓存设置: ${key}, TTL: ${ttl}ms, 优先级: ${priority}, 标签: ${tags.join(',')}`);
  }

  /**
   * 智能缓存获取
   */
  smartGet<T>(key: string): T | null {
    const result = this.cache.get<T>(key);

    if (result !== null) {
      this.recordAccess(key);
    }

    return result;
  }

  /**
   * 根据策略清理缓存
   */
  strategicCleanup(options: {
    maxAge?: number;
    minPriority?: number;
    excludeTags?: string[];
    targetSize?: number;
  } = {}): void {
    const {
      maxAge: _maxAge = 7 * 24 * 60 * 60 * 1000, // 7天
      minPriority: _minPriority = 1,
      excludeTags = ['config', 'persistent'],
      targetSize = 50 * 1024 * 1024, // 50MB
    } = options;

    // 获取当前缓存统计
    const stats = this.cache.getStats();

    if (stats.size <= targetSize) {
      console.debug('缓存大小在目标范围内，无需清理');
      return;
    }

    // 清理过期和低优先级的缓存
    let cleanedCount = 0;

    // 这里需要扩展IntelligentCache以支持按条件清理
    // 暂时使用标签清理
    const tagsToClean = ['cold', 'large'];
    for (const tag of tagsToClean) {
      if (!excludeTags.includes(tag)) {
        const cleared = this.cache.clearByTags([tag]);
        cleanedCount += cleared;
      }
    }

    console.log(`策略性清理完成，清理了 ${cleanedCount} 个缓存项`);
  }

  /**
   * 获取缓存策略报告
   */
  getStrategyReport(): {
    strategies: Array<{ name: string; description: string }>;
    accessFrequency: Array<{ key: string; frequency: number }>;
    recommendations: string[];
  } {
    const strategies = Array.from(this.strategies.values()).map(s => ({
      name: s.name,
      description: s.description,
    }));

    const accessFrequency = Array.from(this.accessFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([key, frequency]) => ({ key, frequency }));

    const recommendations = this.generateRecommendations();

    return {
      strategies,
      accessFrequency,
      recommendations,
    };
  }

  /**
   * 计算数据大小
   */
  private calculateDataSize(data: any): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  /**
   * 获取访问频率
   */
  private getAccessFrequency(key: string): number {
    return this.accessFrequency.get(key) || 0;
  }

  /**
   * 记录访问
   */
  private recordAccess(key: string): void {
    const current = this.accessFrequency.get(key) || 0;
    this.accessFrequency.set(key, current + 1);
  }

  /**
   * 获取系统负载（简化实现）
   */
  private getSystemLoad(): number {
    // 简化的系统负载计算
    const metrics = performanceMonitor.getMetrics();
    const errorRate = metrics.apiCalls.total > 0 ?
      metrics.apiCalls.failed / metrics.apiCalls.total : 0;

    return Math.min(errorRate * 2 + (metrics.apiCalls.averageResponseTime / 10000), 1);
  }

  /**
   * 生成优化建议
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const stats = this.cache.getStats();

    if (stats.hitRate < 0.5) {
      recommendations.push('缓存命中率较低，建议调整缓存策略或增加TTL');
    }

    if (stats.size > 100 * 1024 * 1024) { // 100MB
      recommendations.push('缓存大小较大，建议启用自动清理或减少缓存时间');
    }

    const hotKeys = Array.from(this.accessFrequency.entries())
      .filter(([, freq]) => freq > 10)
      .length;

    if (hotKeys > 100) {
      recommendations.push('热点数据较多，建议优化缓存分层策略');
    }

    return recommendations;
  }
}
