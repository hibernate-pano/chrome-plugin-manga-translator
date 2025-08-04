/**
 * 性能基准测试工具
 * 用于测试和比较不同配置下的性能表现
 */

import { performanceMonitor } from './performance-monitor';
import { IntelligentCache } from './intelligent-cache';
import { CacheStrategyManager } from './cache-strategy';
// import { APIManager } from '../api/api-manager';

export interface BenchmarkConfig {
  name: string;
  description: string;
  iterations: number;
  warmupIterations: number;
  testData: any[];
  cacheConfig?: any;
  apiConfig?: any;
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  metrics: {
    averageTime: number;
    minTime: number;
    maxTime: number;
    totalTime: number;
    throughput: number;
    memoryUsage: number;
    cacheHitRate: number;
    errorRate: number;
  };
  details: {
    iterations: number[];
    errors: string[];
    warnings: string[];
  };
}

export interface ComparisonResult {
  baseline: BenchmarkResult;
  comparison: BenchmarkResult;
  improvement: {
    averageTime: number;
    throughput: number;
    memoryUsage: number;
    cacheHitRate: number;
  };
  recommendation: string;
}

/**
 * 性能基准测试器
 */
export class PerformanceBenchmark {
  private results: Map<string, BenchmarkResult> = new Map();

  /**
   * 运行单个基准测试
   */
  async runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
    console.log(`开始基准测试: ${config.name}`);

    // 重置性能监控器
    performanceMonitor.reset();

    // 初始化测试环境
    const cache = config.cacheConfig ? new IntelligentCache(config.cacheConfig) : null;
    const strategyManager = cache ? new CacheStrategyManager(cache) : null;

    const iterations: number[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 预热阶段
      console.log(`预热阶段: ${config.warmupIterations} 次迭代`);
      for (let i = 0; i < config.warmupIterations; i++) {
        await this.runSingleIteration(config, cache, strategyManager);
      }

      // 重置监控器，开始正式测试
      performanceMonitor.reset();
      const startMemory = this.getMemoryUsage();

      // 正式测试阶段
      console.log(`正式测试: ${config.iterations} 次迭代`);
      for (let i = 0; i < config.iterations; i++) {
        const startTime = performance.now();

        try {
          await this.runSingleIteration(config, cache, strategyManager);
          const endTime = performance.now();
          iterations.push(endTime - startTime);
        } catch (error) {
          errors.push(`迭代 ${i}: ${error}`);
          iterations.push(0);
        }

        // 每100次迭代检查一次内存使用
        if (i % 100 === 0 && i > 0) {
          const currentMemory = this.getMemoryUsage();
          if (currentMemory > startMemory * 2) {
            warnings.push(`内存使用量增长过快: ${currentMemory}MB`);
          }
        }
      }

      // 计算指标
      const metrics = this.calculateMetrics(iterations, startMemory, errors.length);

      const result: BenchmarkResult = {
        config,
        metrics,
        details: {
          iterations,
          errors,
          warnings,
        },
      };

      // 保存结果
      this.results.set(config.name, result);

      console.log(`基准测试完成: ${config.name}`);
      console.log(`平均时间: ${metrics.averageTime.toFixed(2)}ms`);
      console.log(`吞吐量: ${metrics.throughput.toFixed(2)} ops/sec`);

      return result;

    } finally {
      // 清理资源
      if (cache) {
        cache.destroy();
      }
    }
  }

  /**
   * 运行单次迭代
   */
  private async runSingleIteration(
    config: BenchmarkConfig,
    cache: IntelligentCache | null,
    strategyManager: CacheStrategyManager | null
  ): Promise<void> {
    // 根据配置类型执行不同的测试
    for (const data of config.testData) {
      if (config.name.includes('cache')) {
        await this.testCacheOperation(data, cache, strategyManager);
      } else if (config.name.includes('api')) {
        await this.testAPIOperation(data);
      } else {
        await this.testGenericOperation(data);
      }
    }
  }

  /**
   * 测试缓存操作
   */
  private async testCacheOperation(
    data: any,
    cache: IntelligentCache | null,
    strategyManager: CacheStrategyManager | null
  ): Promise<void> {
    if (!cache || !strategyManager) return;

    const key = `test_${data.id || Math.random()}`;
    const value = data.value || data;

    // 测试写入
    strategyManager.smartSet(key, value, 'translation');
    performanceMonitor.recordCacheHit();

    // 测试读取
    const retrieved = strategyManager.smartGet(key);
    if (retrieved) {
      performanceMonitor.recordCacheHit();
    } else {
      performanceMonitor.recordCacheMiss();
    }
  }

  /**
   * 测试API操作
   */
  private async testAPIOperation(data: any): Promise<void> {
    const startTime = performance.now();
    performanceMonitor.startAPIRequest('test-request', 'translation');

    try {
      // 模拟API调用
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

      const endTime = performance.now();
      performanceMonitor.endAPIRequest('test-request', 'translation');

    } catch (error) {
      const endTime = performance.now();
      performanceMonitor.recordAPIFailure('test-request', error as Error);
    }
  }

  /**
   * 测试通用操作
   */
  private async testGenericOperation(data: any): Promise<void> {
    // 模拟一些计算密集型操作
    let result = 0;
    for (let i = 0; i < 1000; i++) {
      result += Math.sqrt(i * (data.complexity || 1));
    }

    // 模拟异步操作
    await new Promise(resolve => setTimeout(resolve, 1));

    return Promise.resolve();
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(iterations: number[], startMemory: number, errorCount: number): any {
    const validIterations = iterations.filter(time => time > 0);
    const totalTime = validIterations.reduce((sum, time) => sum + time, 0);
    const averageTime = totalTime / validIterations.length;
    const minTime = Math.min(...validIterations);
    const maxTime = Math.max(...validIterations);
    const throughput = 1000 / averageTime; // ops per second
    const currentMemory = this.getMemoryUsage();
    const memoryUsage = currentMemory - startMemory;

    // 获取缓存指标
    const monitorMetrics = performanceMonitor.getMetrics();
    const cacheHitRate = monitorMetrics.cache.hits / (monitorMetrics.cache.hits + monitorMetrics.cache.misses) || 0;
    const errorRate = errorCount / iterations.length;

    return {
      averageTime,
      minTime,
      maxTime,
      totalTime,
      throughput,
      memoryUsage,
      cacheHitRate,
      errorRate,
    };
  }

  /**
   * 获取内存使用量
   */
  private getMemoryUsage(): number {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in window.performance) {
      return (window.performance as any).memory.usedJSHeapSize / 1024 / 1024; // MB
    }
    return 0;
  }

  /**
   * 比较两个基准测试结果
   */
  compareBenchmarks(baselineName: string, comparisonName: string): ComparisonResult | null {
    const baseline = this.results.get(baselineName);
    const comparison = this.results.get(comparisonName);

    if (!baseline || !comparison) {
      return null;
    }

    const improvement = {
      averageTime: ((baseline.metrics.averageTime - comparison.metrics.averageTime) / baseline.metrics.averageTime) * 100,
      throughput: ((comparison.metrics.throughput - baseline.metrics.throughput) / baseline.metrics.throughput) * 100,
      memoryUsage: ((baseline.metrics.memoryUsage - comparison.metrics.memoryUsage) / baseline.metrics.memoryUsage) * 100,
      cacheHitRate: ((comparison.metrics.cacheHitRate - baseline.metrics.cacheHitRate) / baseline.metrics.cacheHitRate) * 100,
    };

    let recommendation = '';
    if (improvement.averageTime > 10) {
      recommendation += '响应时间显著改善。';
    } else if (improvement.averageTime < -10) {
      recommendation += '响应时间有所下降，需要优化。';
    }

    if (improvement.throughput > 10) {
      recommendation += '吞吐量显著提升。';
    }

    if (improvement.memoryUsage > 10) {
      recommendation += '内存使用效率提升。';
    }

    if (!recommendation) {
      recommendation = '性能变化不明显，可能需要更多测试数据。';
    }

    return {
      baseline,
      comparison,
      improvement,
      recommendation,
    };
  }

  /**
   * 获取所有测试结果
   */
  getAllResults(): Map<string, BenchmarkResult> {
    return new Map(this.results);
  }

  /**
   * 清除所有结果
   */
  clearResults(): void {
    this.results.clear();
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    let report = '# 性能基准测试报告\n\n';

    for (const [name, result] of this.results) {
      report += `## ${name}\n`;
      report += `**描述**: ${result.config.description}\n`;
      report += `**迭代次数**: ${result.config.iterations}\n\n`;

      report += '### 性能指标\n';
      report += `- 平均响应时间: ${result.metrics.averageTime.toFixed(2)}ms\n`;
      report += `- 最小响应时间: ${result.metrics.minTime.toFixed(2)}ms\n`;
      report += `- 最大响应时间: ${result.metrics.maxTime.toFixed(2)}ms\n`;
      report += `- 吞吐量: ${result.metrics.throughput.toFixed(2)} ops/sec\n`;
      report += `- 内存使用: ${result.metrics.memoryUsage.toFixed(2)}MB\n`;
      report += `- 缓存命中率: ${(result.metrics.cacheHitRate * 100).toFixed(1)}%\n`;
      report += `- 错误率: ${(result.metrics.errorRate * 100).toFixed(1)}%\n\n`;

      if (result.details.errors.length > 0) {
        report += '### 错误信息\n';
        result.details.errors.forEach(error => {
          report += `- ${error}\n`;
        });
        report += '\n';
      }

      if (result.details.warnings.length > 0) {
        report += '### 警告信息\n';
        result.details.warnings.forEach(warning => {
          report += `- ${warning}\n`;
        });
        report += '\n';
      }

      report += '---\n\n';
    }

    return report;
  }
}

// 导出单例实例
export const performanceBenchmark = new PerformanceBenchmark();
