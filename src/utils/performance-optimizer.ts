/**
 * 性能优化器
 * 基于性能监控数据进行自动优化
 */

import { performanceMonitor } from './performance-monitor';
import { IntelligentCache } from './intelligent-cache';
import { CacheStrategyManager } from './cache-strategy';
import { apiManager } from '../api/api-manager';

export interface OptimizationConfig {
  // 缓存优化配置
  cache: {
    maxSize: number;
    defaultTTL: number;
    maxItems: number;
    cleanupInterval: number;
    compressionThreshold: number;
  };

  // API优化配置
  api: {
    retryAttempts: number;
    retryDelay: number;
    timeout: number;
    batchSize: number;
    batchDelay: number;
  };

  // 性能阈值
  thresholds: {
    responseTime: number;
    cacheHitRate: number;
    errorRate: number;
    memoryUsage: number;
  };
}

export interface OptimizationResult {
  applied: string[];
  recommendations: string[];
  metrics: {
    before: any;
    after: any;
    improvement: any;
  };
}

/**
 * 性能优化器类
 */
export class PerformanceOptimizer {
  private config: OptimizationConfig;
  private cache: IntelligentCache | null = null;
  private strategyManager: CacheStrategyManager | null = null;

  constructor(config: OptimizationConfig) {
    this.config = config;
  }

  /**
   * 初始化优化器
   */
  async initialize(): Promise<void> {
    // 初始化缓存系统
    this.cache = new IntelligentCache({
      maxSize: this.config.cache.maxSize,
      defaultTTL: this.config.cache.defaultTTL,
      maxItems: this.config.cache.maxItems,
      cleanupInterval: this.config.cache.cleanupInterval,
      compressionThreshold: this.config.cache.compressionThreshold,
    });

    this.strategyManager = new CacheStrategyManager(this.cache);
  }

  /**
   * 执行自动优化
   */
  async optimize(): Promise<OptimizationResult> {
    const beforeMetrics = performanceMonitor.getMetrics();
    const applied: string[] = [];
    const recommendations: string[] = [];

    // 1. 缓存优化
    const cacheOptimizations = await this.optimizeCache();
    applied.push(...cacheOptimizations.applied);
    recommendations.push(...cacheOptimizations.recommendations);

    // 2. API优化
    const apiOptimizations = await this.optimizeAPI();
    applied.push(...apiOptimizations.applied);
    recommendations.push(...apiOptimizations.recommendations);

    // 3. 内存优化
    const memoryOptimizations = await this.optimizeMemory();
    applied.push(...memoryOptimizations.applied);
    recommendations.push(...memoryOptimizations.recommendations);

    // 等待一段时间收集新的指标
    await new Promise(resolve => setTimeout(resolve, 1000));
    const afterMetrics = performanceMonitor.getMetrics();

    return {
      applied,
      recommendations,
      metrics: {
        before: beforeMetrics,
        after: afterMetrics,
        improvement: this.calculateImprovement(beforeMetrics, afterMetrics),
      },
    };
  }

  /**
   * 优化缓存性能
   */
  private async optimizeCache(): Promise<{ applied: string[]; recommendations: string[] }> {
    const applied: string[] = [];
    const recommendations: string[] = [];
    const metrics = performanceMonitor.getMetrics();

    // 检查缓存命中率
    const hitRate = metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses);

    if (hitRate < this.config.thresholds.cacheHitRate) {
      // 缓存命中率低，建议增加缓存大小或调整TTL
      if (this.cache) {
        const stats = this.cache.getStats();

        if (stats.memoryUsage < this.config.cache.maxSize * 0.8) {
          // 内存使用率低，可以增加缓存项数量
          this.cache.updateConfig({
            maxItems: Math.floor(this.config.cache.maxItems * 1.2),
          });
          applied.push('增加缓存项数量限制');
        }

        // 调整TTL策略
        if (this.strategyManager) {
          // 执行策略性清理
          this.strategyManager.strategicCleanup({
            maxAge: this.config.cache.defaultTTL / 2,
            priority: 'low',
          });
          applied.push('优化缓存策略');
        }
      }

      recommendations.push(`缓存命中率较低 (${(hitRate * 100).toFixed(1)}%)，建议优化缓存策略`);
    }

    // 检查缓存大小
    if (this.cache) {
      const stats = this.cache.getStats();

      if (stats.memoryUsage > this.config.cache.maxSize * 0.9) {
        // 内存使用率高，触发清理
        this.cache.cleanup();
        applied.push('执行缓存清理');
      }

      if (stats.itemCount > this.config.cache.maxItems * 0.9) {
        // 缓存项过多，优化清理策略
        this.cache.updateConfig({
          cleanupInterval: Math.max(this.config.cache.cleanupInterval / 2, 1000),
        });
        applied.push('优化缓存清理频率');
      }
    }

    return { applied, recommendations };
  }

  /**
   * 优化API性能
   */
  private async optimizeAPI(): Promise<{ applied: string[]; recommendations: string[] }> {
    const applied: string[] = [];
    const recommendations: string[] = [];
    const metrics = performanceMonitor.getMetrics();

    // 检查API响应时间
    if (metrics.apiCalls.averageResponseTime > this.config.thresholds.responseTime) {
      recommendations.push(`API响应时间较慢 (${metrics.apiCalls.averageResponseTime}ms)，建议优化网络或切换API提供者`);
    }

    // 检查错误率
    const errorRate = metrics.errors.total / metrics.apiCalls.total;
    if (errorRate > this.config.thresholds.errorRate) {
      recommendations.push(`API错误率较高 (${(errorRate * 100).toFixed(1)}%)，建议检查API配置或网络连接`);
    }

    // 检查并发请求数
    if (metrics.apiCalls.concurrent > 10) {
      recommendations.push('并发请求数较高，建议启用请求队列管理');
    }

    return { applied, recommendations };
  }

  /**
   * 优化内存使用
   */
  private async optimizeMemory(): Promise<{ applied: string[]; recommendations: string[] }> {
    const applied: string[] = [];
    const recommendations: string[] = [];

    // 检查内存使用情况
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in window.performance) {
      const memory = (window.performance as any).memory;
      const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

      if (usageRatio > this.config.thresholds.memoryUsage) {
        // 内存使用率高，执行清理
        if (this.cache) {
          this.cache.cleanup();
          applied.push('执行内存清理');
        }

        // 建议垃圾回收
        if (window.gc) {
          window.gc();
          applied.push('触发垃圾回收');
        }

        recommendations.push(`内存使用率较高 (${(usageRatio * 100).toFixed(1)}%)，建议减少缓存大小或优化数据结构`);
      }
    }

    return { applied, recommendations };
  }

  /**
   * 计算性能改进
   */
  private calculateImprovement(before: any, after: any): any {
    const improvement: any = {};

    // 计算响应时间改进
    if (before.apiCalls.averageResponseTime && after.apiCalls.averageResponseTime) {
      improvement.responseTime = {
        before: before.apiCalls.averageResponseTime,
        after: after.apiCalls.averageResponseTime,
        change: before.apiCalls.averageResponseTime - after.apiCalls.averageResponseTime,
        percentage: ((before.apiCalls.averageResponseTime - after.apiCalls.averageResponseTime) / before.apiCalls.averageResponseTime * 100).toFixed(1),
      };
    }

    // 计算缓存命中率改进
    const beforeHitRate = before.cache.hits / (before.cache.hits + before.cache.misses) || 0;
    const afterHitRate = after.cache.hits / (after.cache.hits + after.cache.misses) || 0;

    improvement.cacheHitRate = {
      before: (beforeHitRate * 100).toFixed(1),
      after: (afterHitRate * 100).toFixed(1),
      change: ((afterHitRate - beforeHitRate) * 100).toFixed(1),
    };

    // 计算错误率改进
    const beforeErrorRate = before.errors.total / before.apiCalls.total || 0;
    const afterErrorRate = after.errors.total / after.apiCalls.total || 0;

    improvement.errorRate = {
      before: (beforeErrorRate * 100).toFixed(1),
      after: (afterErrorRate * 100).toFixed(1),
      change: ((beforeErrorRate - afterErrorRate) * 100).toFixed(1),
    };

    return improvement;
  }

  /**
   * 获取优化建议
   */
  getOptimizationRecommendations(): string[] {
    const metrics = performanceMonitor.getMetrics();
    const recommendations: string[] = [];

    // 基于当前指标生成建议
    const hitRate = metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses);
    if (hitRate < 0.8) {
      recommendations.push('考虑增加缓存大小或优化缓存策略');
    }

    if (metrics.apiCalls.averageResponseTime > 1000) {
      recommendations.push('API响应时间较慢，考虑优化网络连接或切换API提供者');
    }

    const errorRate = metrics.errors.total / metrics.apiCalls.total;
    if (errorRate > 0.05) {
      recommendations.push('API错误率较高，检查API配置和网络稳定性');
    }

    if (metrics.apiCalls.concurrent > 5) {
      recommendations.push('并发请求数较高，考虑实现请求队列管理');
    }

    return recommendations;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    if (this.cache) {
      this.cache.destroy();
      this.cache = null;
    }

    this.strategyManager = null;
  }
}

// 默认优化配置
export const defaultOptimizationConfig: OptimizationConfig = {
  cache: {
    maxSize: 50 * 1024 * 1024, // 50MB
    defaultTTL: 24 * 60 * 60 * 1000, // 24小时
    maxItems: 1000,
    cleanupInterval: 5 * 60 * 1000, // 5分钟
    compressionThreshold: 1024, // 1KB
  },
  api: {
    retryAttempts: 3,
    retryDelay: 1000,
    timeout: 30000,
    batchSize: 10,
    batchDelay: 100,
  },
  thresholds: {
    responseTime: 2000, // 2秒
    cacheHitRate: 0.8, // 80%
    errorRate: 0.05, // 5%
    memoryUsage: 0.8, // 80%
  },
};

// 导出单例实例
export const performanceOptimizer = new PerformanceOptimizer(defaultOptimizationConfig);
