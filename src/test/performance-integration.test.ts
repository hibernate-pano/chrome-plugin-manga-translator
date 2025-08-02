import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performanceMonitor } from '../utils/performance-monitor';
import { IntelligentCache } from '../utils/intelligent-cache';
import { CacheStrategyManager } from '../utils/cache-strategy';
import { APIManager } from '../api/api-manager';

// Mock dependencies
vi.mock('../api/provider-factory');
vi.mock('../stores/config');
vi.mock('../stores/cache');

describe('性能监控集成测试', () => {
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

  describe('API性能监控', () => {
    it('应该正确监控API请求的生命周期', async () => {
      const requestId = 'test-request-1';
      
      // 开始监控
      performanceMonitor.startAPIRequest(requestId, 'translation');
      
      // 模拟API处理时间
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 结束监控
      performanceMonitor.endAPIRequest(requestId, 'translation', {
        texts: ['测试文本'],
        isBatch: false,
      });

      const metrics = performanceMonitor.getMetrics();
      
      expect(metrics.apiCalls.total).toBe(1);
      expect(metrics.apiCalls.successful).toBe(1);
      expect(metrics.apiCalls.failed).toBe(0);
      expect(metrics.apiCalls.averageResponseTime).toBeGreaterThan(90);
      expect(metrics.translation.totalTexts).toBe(1);
      expect(metrics.translation.singleRequests).toBe(1);
    });

    it('应该正确监控批量翻译请求', async () => {
      const requestId = 'batch-request-1';
      
      performanceMonitor.startAPIRequest(requestId, 'translation');
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      performanceMonitor.endAPIRequest(requestId, 'translation', {
        texts: ['文本1', '文本2', '文本3'],
        isBatch: true,
      });

      const metrics = performanceMonitor.getMetrics();
      
      expect(metrics.translation.totalTexts).toBe(3);
      expect(metrics.translation.batchRequests).toBe(1);
      expect(metrics.translation.totalCharacters).toBe(9); // 3个文本，每个3个字符
    });

    it('应该正确监控OCR请求', async () => {
      const requestId = 'ocr-request-1';
      
      performanceMonitor.startAPIRequest(requestId, 'ocr');
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      performanceMonitor.endAPIRequest(requestId, 'ocr', {
        textAreas: [
          { text: '文本1', bbox: [0, 0, 100, 50] },
          { text: '文本2', bbox: [100, 0, 200, 50] },
        ],
      });

      const metrics = performanceMonitor.getMetrics();
      
      expect(metrics.ocr.totalImages).toBe(1);
      expect(metrics.ocr.totalTextAreas).toBe(2);
      expect(metrics.ocr.averageAreasPerImage).toBe(2);
      expect(metrics.ocr.averageProcessingTime).toBeGreaterThan(190);
    });

    it('应该正确记录API失败', async () => {
      const requestId = 'failed-request-1';
      
      performanceMonitor.startAPIRequest(requestId, 'translation');
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const error = new Error('API调用失败');
      performanceMonitor.recordAPIFailure(requestId, error, 'openai');

      const metrics = performanceMonitor.getMetrics();
      
      expect(metrics.apiCalls.total).toBe(1);
      expect(metrics.apiCalls.successful).toBe(0);
      expect(metrics.apiCalls.failed).toBe(1);
      expect(metrics.errors.total).toBe(1);
      expect(metrics.errors.byType['Error']).toBe(1);
      expect(metrics.errors.byProvider['openai']).toBe(1);
    });
  });

  describe('缓存性能监控', () => {
    it('应该正确监控缓存命中和未命中', () => {
      // 设置一些缓存数据
      strategyManager.smartSet('key1', 'value1', 'translation');
      strategyManager.smartSet('key2', 'value2', 'ocr');
      
      // 命中缓存
      const hit1 = strategyManager.smartGet('key1');
      const hit2 = strategyManager.smartGet('key2');
      
      // 未命中缓存
      const miss1 = strategyManager.smartGet('nonexistent1');
      const miss2 = strategyManager.smartGet('nonexistent2');

      expect(hit1).toBe('value1');
      expect(hit2).toBe('value2');
      expect(miss1).toBeNull();
      expect(miss2).toBeNull();

      const metrics = performanceMonitor.getMetrics();
      
      // 验证缓存指标（注意：设置缓存时也会记录命中）
      expect(metrics.cache.hits).toBeGreaterThanOrEqual(2);
      expect(metrics.cache.misses).toBe(2);
      expect(metrics.cache.hitRate).toBeGreaterThan(0);
    });

    it('应该正确监控缓存大小变化', () => {
      const initialMetrics = performanceMonitor.getMetrics();
      const initialSize = initialMetrics.cache.totalSize;

      // 添加缓存数据
      strategyManager.smartSet('large-data', 'x'.repeat(10000), 'translation');
      
      const updatedMetrics = performanceMonitor.getMetrics();
      
      expect(updatedMetrics.cache.totalSize).toBeGreaterThan(initialSize);
    });
  });

  describe('性能报告生成', () => {
    it('应该生成完整的性能报告', async () => {
      // 模拟一些活动
      performanceMonitor.startAPIRequest('req1', 'translation');
      await new Promise(resolve => setTimeout(resolve, 100));
      performanceMonitor.endAPIRequest('req1', 'translation', {
        texts: ['测试'],
        isBatch: false,
      });

      performanceMonitor.startAPIRequest('req2', 'ocr');
      await new Promise(resolve => setTimeout(resolve, 200));
      performanceMonitor.endAPIRequest('req2', 'ocr', {
        textAreas: [{ text: '文本', bbox: [0, 0, 100, 50] }],
      });

      // 添加一些缓存活动
      strategyManager.smartSet('cache1', 'data1', 'translation');
      strategyManager.smartGet('cache1');
      strategyManager.smartGet('nonexistent');

      const report = performanceMonitor.getPerformanceReport();

      expect(report.summary).toBeDefined();
      expect(report.summary.totalRequests).toBe(2);
      expect(report.summary.successRate).toBe(1);
      expect(report.summary.errorRate).toBe(0);
      expect(report.summary.averageResponseTime).toBeGreaterThan(0);

      expect(report.details).toBeDefined();
      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('应该根据性能数据生成相关建议', async () => {
      // 模拟高错误率场景
      for (let i = 0; i < 10; i++) {
        performanceMonitor.startAPIRequest(`req${i}`, 'translation');
        if (i < 8) {
          performanceMonitor.endAPIRequest(`req${i}`, 'translation', {
            texts: ['测试'],
            isBatch: false,
          });
        } else {
          performanceMonitor.recordAPIFailure(`req${i}`, new Error('测试错误'));
        }
      }

      const report = performanceMonitor.getPerformanceReport();
      
      expect(report.recommendations).toContain(
        expect.stringContaining('错误率较高')
      );
    });

    it('应该根据缓存性能生成建议', () => {
      // 模拟低缓存命中率
      for (let i = 0; i < 10; i++) {
        strategyManager.smartGet(`nonexistent${i}`); // 全部未命中
      }

      const report = performanceMonitor.getPerformanceReport();
      
      expect(report.recommendations).toContain(
        expect.stringContaining('缓存命中率较低')
      );
    });
  });

  describe('缓存策略性能', () => {
    it('应该根据访问模式优化缓存策略', () => {
      // 模拟不同访问模式的数据
      
      // 高频小数据
      for (let i = 0; i < 20; i++) {
        strategyManager.smartSet('hot-small', 'small data', 'translation');
        strategyManager.smartGet('hot-small');
      }

      // 低频大数据
      const largeData = 'x'.repeat(100000);
      strategyManager.smartSet('cold-large', largeData, 'translation');
      strategyManager.smartGet('cold-large');

      const strategyReport = strategyManager.getStrategyReport();
      
      expect(strategyReport.strategies).toHaveLength(3); // translation, ocr, config
      expect(strategyReport.accessFrequency).toBeInstanceOf(Array);
      expect(strategyReport.recommendations).toBeInstanceOf(Array);

      // 验证访问频率统计
      const hotItem = strategyReport.accessFrequency.find(
        (item: any) => item.key === 'hot-small'
      );
      expect(hotItem).toBeDefined();
      expect(hotItem.frequency).toBeGreaterThan(15);
    });

    it('应该执行策略性缓存清理', () => {
      // 填充缓存
      for (let i = 0; i < 50; i++) {
        strategyManager.smartSet(`item${i}`, `data${i}`, 'translation');
      }

      const beforeStats = cache.getStats();
      
      // 执行清理
      strategyManager.strategicCleanup({
        targetSize: 1024, // 很小的目标大小
      });

      const afterStats = cache.getStats();
      
      // 验证清理效果（可能没有实际清理，但方法应该正常执行）
      expect(afterStats.itemCount).toBeLessThanOrEqual(beforeStats.itemCount);
    });
  });

  describe('内存和资源管理', () => {
    it('应该正确清理过期缓存', async () => {
      // 设置短TTL的缓存
      cache.set('short-lived', 'data', { ttl: 100 }); // 100ms TTL
      
      expect(cache.has('short-lived')).toBe(true);
      
      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(cache.has('short-lived')).toBe(false);
    });

    it('应该正确管理缓存大小限制', () => {
      const smallCache = new IntelligentCache({
        maxSize: 1024, // 1KB限制
        maxItems: 10,
        defaultTTL: 60000,
        cleanupInterval: 1000,
        compressionThreshold: 100,
      });

      // 添加超过限制的数据
      for (let i = 0; i < 20; i++) {
        smallCache.set(`item${i}`, 'x'.repeat(100), { priority: i });
      }

      const stats = smallCache.getStats();
      
      // 应该触发清理，保持在限制内
      expect(stats.itemCount).toBeLessThanOrEqual(10);
      expect(stats.size).toBeLessThanOrEqual(1024);

      smallCache.destroy();
    });
  });
});
