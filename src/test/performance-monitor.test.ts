import { describe, it, expect, beforeEach } from 'vitest';
import { performanceMonitor } from '../utils/performance-monitor';

describe('性能监控器测试', () => {
  beforeEach(() => {
    performanceMonitor.reset();
  });

  describe('API请求监控', () => {
    it('应该正确监控API请求生命周期', async () => {
      const requestId = 'test-request';

      performanceMonitor.startAPIRequest(requestId, 'translation');

      // 模拟处理时间
      await new Promise(resolve => setTimeout(resolve, 100));

      performanceMonitor.endAPIRequest(requestId, 'translation', {
        texts: ['测试文本'],
        isBatch: false,
      });

      const metrics = performanceMonitor.getMetrics();

      expect(metrics.apiCalls.total).toBe(1);
      expect(metrics.apiCalls.successful).toBe(1);
      expect(metrics.apiCalls.failed).toBe(0);
      expect(metrics.apiCalls.averageResponseTime).toBeGreaterThan(90);
    });

    it('应该正确记录API失败', () => {
      const requestId = 'failed-request';

      performanceMonitor.startAPIRequest(requestId, 'translation');

      const error = new Error('测试错误');
      performanceMonitor.recordAPIFailure(requestId, error, 'openai');

      const metrics = performanceMonitor.getMetrics();

      expect(metrics.apiCalls.total).toBe(1);
      expect(metrics.apiCalls.failed).toBe(1);
      expect(metrics.errors.total).toBe(1);
      expect(metrics.errors.byType['Error']).toBe(1);
      expect(metrics.errors.byProvider['openai']).toBe(1);
    });
  });

  describe('缓存监控', () => {
    it('应该正确记录缓存命中和未命中', () => {
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheMiss();

      const metrics = performanceMonitor.getMetrics();

      expect(metrics.cache.hits).toBe(2);
      expect(metrics.cache.misses).toBe(1);
      expect(metrics.cache.hitRate).toBeCloseTo(2 / 3);
    });

    it('应该正确更新缓存大小', () => {
      const size = 1024 * 1024; // 1MB
      performanceMonitor.updateCacheSize(size);

      const metrics = performanceMonitor.getMetrics();

      expect(metrics.cache.totalSize).toBe(size);
    });
  });

  describe('翻译指标', () => {
    it('应该正确记录翻译指标', async () => {
      const requestId = 'translation-request';

      performanceMonitor.startAPIRequest(requestId, 'translation');

      await new Promise(resolve => setTimeout(resolve, 50));

      performanceMonitor.endAPIRequest(requestId, 'translation', {
        texts: ['文本1', '文本2', '文本3'],
        isBatch: true,
      });

      const metrics = performanceMonitor.getMetrics();

      expect(metrics.translation.totalTexts).toBe(3);
      expect(metrics.translation.totalCharacters).toBe(9); // 3个文本，每个3个字符
      expect(metrics.translation.batchRequests).toBe(1);
      expect(metrics.translation.singleRequests).toBe(0);
      expect(metrics.translation.averageTextLength).toBe(3);
    });
  });

  describe('OCR指标', () => {
    it('应该正确记录OCR指标', async () => {
      const requestId = 'ocr-request';

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
  });

  describe('性能报告', () => {
    it('应该生成完整的性能报告', async () => {
      // 添加一些测试数据
      performanceMonitor.startAPIRequest('req1', 'translation');
      await new Promise(resolve => setTimeout(resolve, 100));
      performanceMonitor.endAPIRequest('req1', 'translation', {
        texts: ['测试'],
        isBatch: false,
      });

      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheMiss();

      const report = performanceMonitor.getPerformanceReport();

      expect(report.summary).toBeDefined();
      expect(report.summary.totalRequests).toBe(1);
      expect(report.summary.successRate).toBe(1);
      expect(report.summary.errorRate).toBe(0);
      expect(report.summary.cacheHitRate).toBe(0.5);

      expect(report.details).toBeDefined();
      expect(report.recommendations).toBeInstanceOf(Array);
    });

    it('应该根据性能数据生成建议', () => {
      // 模拟高错误率
      for (let i = 0; i < 10; i++) {
        performanceMonitor.startAPIRequest(`req${i}`, 'translation');
        if (i < 2) {
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
        '错误率较高（>10%），建议检查API配置和网络连接'
      );
    });
  });

  describe('数据导出', () => {
    it('应该正确导出指标数据', async () => {
      // 添加一些测试数据
      performanceMonitor.startAPIRequest('req1', 'translation');
      await new Promise(resolve => setTimeout(resolve, 50));
      performanceMonitor.endAPIRequest('req1', 'translation', {
        texts: ['测试'],
        isBatch: false,
      });

      const exportedData = performanceMonitor.exportMetrics();

      expect(exportedData).toBeDefined();
      expect(typeof exportedData).toBe('string');

      const parsedData = JSON.parse(exportedData);
      expect(parsedData.summary).toBeDefined();
      expect(parsedData.details).toBeDefined();
      expect(parsedData.recommendations).toBeDefined();
    });
  });
});
