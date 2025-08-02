import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performanceMonitor } from '../utils/performance-monitor';
import { IntelligentCache } from '../utils/intelligent-cache';
import { CacheStrategyManager } from '../utils/cache-strategy';
import { APIManager } from '../api/api-manager';

// Mock dependencies
vi.mock('../api/provider-factory');
vi.mock('../stores/config');
vi.mock('../stores/cache');

describe('核心功能测试', () => {
  let cache: IntelligentCache;
  let strategyManager: CacheStrategyManager;
  let apiManager: APIManager;

  beforeEach(() => {
    // 重置性能监控器
    performanceMonitor.reset();

    // 创建缓存实例
    cache = new IntelligentCache({
      maxSize: 10 * 1024 * 1024, // 10MB
      defaultTTL: 24 * 60 * 60 * 1000, // 24小时
      maxItems: 1000,
      cleanupInterval: 60 * 1000, // 1分钟
      compressionThreshold: 1024,
    });

    // 创建策略管理器
    strategyManager = new CacheStrategyManager(cache);

    // 重置API管理器单例
    (APIManager as any).instance = null;
    apiManager = APIManager.getInstance();
  });

  afterEach(() => {
    cache.destroy();
    vi.clearAllMocks();
  });

  describe('性能监控核心功能', () => {
    it('应该正确监控API请求', async () => {
      const requestId = 'test-request';

      performanceMonitor.startAPIRequest(requestId, 'translation');
      await new Promise(resolve => setTimeout(resolve, 100));
      performanceMonitor.endAPIRequest(requestId, 'translation', {
        texts: ['测试文本'],
        isBatch: false,
      });

      const metrics = performanceMonitor.getMetrics();

      expect(metrics.apiCalls.total).toBe(1);
      expect(metrics.apiCalls.successful).toBe(1);
      expect(metrics.translation.totalTexts).toBe(1);
      expect(metrics.translation.singleRequests).toBe(1);
    });

    it('应该正确记录缓存指标', () => {
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheMiss();

      const metrics = performanceMonitor.getMetrics();

      expect(metrics.cache.hits).toBe(2);
      expect(metrics.cache.misses).toBe(1);
      expect(metrics.cache.hitRate).toBeCloseTo(2 / 3);
    });

    it('应该生成性能报告', () => {
      // 添加一些测试数据
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheMiss();

      const report = performanceMonitor.getPerformanceReport();

      expect(report.summary).toBeDefined();
      expect(report.details).toBeDefined();
      expect(report.recommendations).toBeInstanceOf(Array);
    });
  });

  describe('智能缓存核心功能', () => {
    it('应该正确存储和检索数据', () => {
      const key = 'test-key';
      const value = 'test-value';

      cache.set(key, value);
      const retrieved = cache.get(key);

      expect(retrieved).toBe(value);
      expect(cache.has(key)).toBe(true);
    });

    it('应该正确处理TTL过期', async () => {
      const key = 'ttl-test';
      const value = 'ttl-value';

      cache.set(key, value, { ttl: 100 }); // 100ms TTL
      expect(cache.has(key)).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.has(key)).toBe(false);
    });

    it('应该正确管理缓存大小', () => {
      const stats = cache.getStats();
      expect(stats).toHaveProperty('itemCount');
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('hitRate');
    });

    it('应该正确处理优先级', () => {
      cache.set('low-priority', 'data1', { priority: 1 });
      cache.set('high-priority', 'data2', { priority: 10 });

      expect(cache.get('low-priority')).toBe('data1');
      expect(cache.get('high-priority')).toBe('data2');
    });
  });

  describe('缓存策略核心功能', () => {
    it('应该根据数据类型选择策略', () => {
      // 翻译数据
      strategyManager.smartSet('translation-key', '翻译结果', 'translation');
      expect(strategyManager.smartGet('translation-key')).toBe('翻译结果');

      // OCR数据
      const ocrData = [{ text: 'OCR文本', bbox: [0, 0, 100, 50] }];
      strategyManager.smartSet('ocr-key', ocrData, 'ocr');
      expect(strategyManager.smartGet('ocr-key')).toEqual(ocrData);

      // 配置数据
      const configData = { setting: 'value' };
      strategyManager.smartSet('config-key', configData, 'config');
      expect(strategyManager.smartGet('config-key')).toEqual(configData);
    });

    it('应该生成策略报告', () => {
      // 添加一些数据
      strategyManager.smartSet('item1', 'data1', 'translation');
      strategyManager.smartSet('item2', 'data2', 'ocr');

      // 访问数据
      strategyManager.smartGet('item1');
      strategyManager.smartGet('item1'); // 再次访问增加频率

      const report = strategyManager.getStrategyReport();

      expect(report.strategies).toBeInstanceOf(Array);
      expect(report.accessFrequency).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
    });

    it('应该执行策略性清理', () => {
      // 添加一些数据
      for (let i = 0; i < 10; i++) {
        strategyManager.smartSet(`item${i}`, `data${i}`, 'translation');
      }

      const beforeStats = cache.getStats();

      strategyManager.strategicCleanup({
        targetSize: 1024,
      });

      const afterStats = cache.getStats();

      // 清理应该不会增加项目数量
      expect(afterStats.itemCount).toBeLessThanOrEqual(beforeStats.itemCount);
    });
  });

  describe('API管理器核心功能', () => {
    it('应该正确初始化', () => {
      expect(apiManager).toBeDefined();
      expect(APIManager.getInstance()).toBe(apiManager); // 单例模式
    });

    it('应该正确处理缓存', () => {
      const cacheKey = 'api-cache-test';
      const cacheValue = { result: 'cached data' };

      // 模拟缓存操作
      apiManager.setCache(cacheKey, cacheValue);
      const retrieved = apiManager.getCache(cacheKey);

      expect(retrieved).toEqual(cacheValue);
    });

    it('应该正确清理资源', () => {
      expect(() => apiManager.cleanup()).not.toThrow();
    });
  });

  describe('错误处理', () => {
    it('应该正确处理缓存错误', () => {
      // 测试不存在的键
      const result = cache.get('nonexistent-key');
      expect(result).toBeNull();

      // 测试策略管理器的错误处理
      const strategyResult = strategyManager.smartGet('nonexistent-strategy-key');
      expect(strategyResult).toBeNull();
    });

    it('应该正确记录API错误', () => {
      const error = new Error('测试错误');
      performanceMonitor.recordAPIFailure('failed-request', error, 'openai');

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.errors.total).toBe(1);
      expect(metrics.errors.byProvider['openai']).toBe(1);
    });

    it('应该正确处理无效数据', () => {
      // 测试null值
      cache.set('null-test', null);
      expect(cache.get('null-test')).toBeNull();

      // 测试undefined值
      cache.set('undefined-test', undefined);
      expect(cache.get('undefined-test')).toBeUndefined();

      // 测试空字符串
      cache.set('empty-test', '');
      expect(cache.get('empty-test')).toBe('');
    });
  });

  describe('内存管理', () => {
    it('应该正确管理内存使用', () => {
      // 添加大量数据
      for (let i = 0; i < 100; i++) {
        cache.set(`item${i}`, `data${i}`.repeat(100));
      }

      const stats = cache.getStats();
      expect(stats.itemCount).toBeGreaterThan(0);
      expect(stats.size).toBeGreaterThan(0);

      // 清理缓存
      cache.clear();
      const clearedStats = cache.getStats();
      expect(clearedStats.itemCount).toBe(0);
    });

    it('应该正确处理大数据', () => {
      const largeData = 'x'.repeat(100000); // 100KB数据
      cache.set('large-data', largeData);

      const retrieved = cache.get('large-data');
      expect(retrieved).toBe(largeData);
    });

    it('应该正确销毁资源', () => {
      expect(() => cache.destroy()).not.toThrow();
      expect(() => performanceMonitor.reset()).not.toThrow();
    });
  });

  describe('数据完整性', () => {
    it('应该保持数据一致性', () => {
      const testData = {
        string: 'test',
        number: 123,
        boolean: true,
        array: [1, 2, 3],
        object: { nested: 'value' },
      };

      cache.set('integrity-test', testData);
      const retrieved = cache.get('integrity-test');

      expect(retrieved).toEqual(testData);
    });

    it('应该正确处理并发访问', async () => {
      const promises = [];

      // 并发写入
      for (let i = 0; i < 50; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              cache.set(`concurrent${i}`, `data${i}`);
              resolve(true);
            }, Math.random() * 10);
          })
        );
      }

      await Promise.all(promises);

      // 验证数据完整性
      for (let i = 0; i < 50; i++) {
        expect(cache.get(`concurrent${i}`)).toBe(`data${i}`);
      }
    });
  });

  describe('性能基准', () => {
    it('应该在合理时间内完成操作', async () => {
      const startTime = Date.now();

      // 执行大量操作
      for (let i = 0; i < 1000; i++) {
        cache.set(`perf${i}`, `data${i}`);
        cache.get(`perf${i}`);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // 1000次操作应该在1秒内完成
      expect(duration).toBeLessThan(1000);
    });

    it('应该有效管理内存使用', () => {
      // const initialStats = cache.getStats();

      // 添加已知大小的数据
      const dataSize = 1000; // 1KB per item
      const itemCount = 100;

      for (let i = 0; i < itemCount; i++) {
        cache.set(`memory${i}`, 'x'.repeat(dataSize));
      }

      const finalStats = cache.getStats();
      const expectedMinSize = itemCount * dataSize;

      expect(finalStats.size).toBeGreaterThan(expectedMinSize * 0.8); // 允许一些开销
      expect(finalStats.itemCount).toBe(itemCount);
    });
  });
});
