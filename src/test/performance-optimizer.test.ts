import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerformanceOptimizer, defaultOptimizationConfig } from '../utils/performance-optimizer';
import { performanceMonitor } from '../utils/performance-monitor';

describe('性能优化器测试', () => {
  let optimizer: PerformanceOptimizer;

  beforeEach(async () => {
    optimizer = new PerformanceOptimizer(defaultOptimizationConfig);
    await optimizer.initialize();
    performanceMonitor.reset();
  });

  afterEach(async () => {
    await optimizer.cleanup();
  });

  describe('初始化', () => {
    it('应该正确初始化优化器', async () => {
      const newOptimizer = new PerformanceOptimizer(defaultOptimizationConfig);
      await newOptimizer.initialize();

      expect(newOptimizer).toBeDefined();

      await newOptimizer.cleanup();
    });
  });

  describe('缓存优化', () => {
    it('应该能够优化缓存性能', async () => {
      // 模拟低缓存命中率
      performanceMonitor.recordCacheMiss();
      performanceMonitor.recordCacheMiss();
      performanceMonitor.recordCacheHit();

      const result = await optimizer.optimize();

      expect(result).toBeDefined();
      expect(result.applied).toBeInstanceOf(Array);
      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.metrics).toBeDefined();
    });

    it('应该提供缓存优化建议', () => {
      // 模拟低缓存命中率
      performanceMonitor.recordCacheMiss();
      performanceMonitor.recordCacheMiss();
      performanceMonitor.recordCacheHit();

      const recommendations = optimizer.getOptimizationRecommendations();

      expect(recommendations).toBeInstanceOf(Array);
      expect(recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('API优化', () => {
    it('应该能够检测API性能问题', async () => {
      // 模拟慢API响应
      performanceMonitor.startAPIRequest('test1', 'translation');
      await new Promise(resolve => setTimeout(resolve, 10));
      performanceMonitor.endAPIRequest('test1', 'translation', { texts: ['test'], isBatch: false });

      // 手动设置慢响应时间
      const metrics = performanceMonitor.getMetrics();
      metrics.apiCalls.averageResponseTime = 3000;

      const result = await optimizer.optimize();

      expect(result.recommendations.some(r => r.includes('响应时间'))).toBe(true);
    });

    it('应该能够检测API错误率', async () => {
      // 模拟API错误
      performanceMonitor.startAPIRequest('test1', 'translation');
      performanceMonitor.recordAPIFailure('test1', new Error('Test error'), 'test-provider');

      const result = await optimizer.optimize();

      expect(result.recommendations.some(r => r.includes('错误率'))).toBe(true);
    });
  });

  describe('内存优化', () => {
    it('应该能够检测内存使用情况', async () => {
      const result = await optimizer.optimize();

      expect(result).toBeDefined();
      expect(result.applied).toBeInstanceOf(Array);
    });
  });

  describe('性能改进计算', () => {
    it('应该能够计算性能改进', async () => {
      // 记录一些初始指标
      performanceMonitor.startAPIRequest('test1', 'translation');
      await new Promise(resolve => setTimeout(resolve, 10));
      performanceMonitor.endAPIRequest('test1', 'translation', { texts: ['test'], isBatch: false });
      performanceMonitor.recordCacheHit();

      const result = await optimizer.optimize();

      expect(result.metrics).toBeDefined();
      expect(result.metrics.before).toBeDefined();
      expect(result.metrics.after).toBeDefined();
      expect(result.metrics.improvement).toBeDefined();
    });

    it('应该正确计算缓存命中率改进', async () => {
      // 模拟缓存性能改进
      performanceMonitor.recordCacheMiss();
      performanceMonitor.recordCacheHit();

      const result = await optimizer.optimize();

      expect(result.metrics.improvement.cacheHitRate).toBeDefined();
    });
  });

  describe('优化建议', () => {
    it('应该基于指标提供相关建议', () => {
      // 模拟各种性能问题
      performanceMonitor.startAPIRequest('test1', 'translation');
      performanceMonitor.recordAPIFailure('test1', new Error('Test error'), 'test-provider');
      performanceMonitor.recordCacheMiss(); // 低命中率

      // 手动设置慢响应时间
      const metrics = performanceMonitor.getMetrics();
      metrics.apiCalls.averageResponseTime = 3000;

      const recommendations = optimizer.getOptimizationRecommendations();

      expect(recommendations).toBeInstanceOf(Array);
      expect(recommendations.length).toBeGreaterThan(0);

      // 应该包含相关建议
      const hasResponseTimeRecommendation = recommendations.some(r => r.includes('响应时间'));
      const hasCacheRecommendation = recommendations.some(r => r.includes('缓存'));

      expect(hasResponseTimeRecommendation || hasCacheRecommendation).toBe(true);
    });

    it('应该在性能良好时提供较少建议', async () => {
      // 重置监控器
      performanceMonitor.reset();

      // 模拟良好的性能指标
      performanceMonitor.startAPIRequest('test1', 'translation');
      await new Promise(resolve => setTimeout(resolve, 5));
      performanceMonitor.endAPIRequest('test1', 'translation', { texts: ['test'], isBatch: false });
      performanceMonitor.recordCacheHit(); // 高命中率
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheHit();

      const recommendations = optimizer.getOptimizationRecommendations();

      expect(recommendations).toBeInstanceOf(Array);
      // 性能良好时建议应该较少
      expect(recommendations.length).toBeLessThanOrEqual(3);
    });
  });

  describe('资源清理', () => {
    it('应该能够正确清理资源', async () => {
      await optimizer.cleanup();

      // 清理后应该能够重新初始化
      await optimizer.initialize();

      expect(optimizer).toBeDefined();
    });
  });

  describe('配置验证', () => {
    it('应该使用提供的配置', () => {
      const customConfig = {
        ...defaultOptimizationConfig,
        thresholds: {
          ...defaultOptimizationConfig.thresholds,
          responseTime: 1000,
        },
      };

      const customOptimizer = new PerformanceOptimizer(customConfig);

      expect(customOptimizer).toBeDefined();
    });
  });

  describe('错误处理', () => {
    it('应该能够处理优化过程中的错误', async () => {
      // 测试在没有数据的情况下进行优化
      const result = await optimizer.optimize();

      expect(result).toBeDefined();
      expect(result.applied).toBeInstanceOf(Array);
      expect(result.recommendations).toBeInstanceOf(Array);
    });
  });

  describe('实时优化', () => {
    it('应该能够连续执行优化', async () => {
      const result1 = await optimizer.optimize();
      const result2 = await optimizer.optimize();

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // 两次优化结果应该都有效
      expect(result1.applied).toBeInstanceOf(Array);
      expect(result2.applied).toBeInstanceOf(Array);
    });
  });
});
