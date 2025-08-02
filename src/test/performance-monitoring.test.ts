import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  performanceMetricsCollector,
  PerformanceMetric
} from '../utils/performance-metrics';

// Mock Chrome API
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
};

// @ts-ignore
global.chrome = mockChrome;

// Mock performance API
Object.defineProperty(global, 'performance', {
  value: {
    now: vi.fn(() => Date.now()),
  },
  writable: true,
});

describe('性能监控系统测试', () => {
  beforeEach(() => {
    // 清理性能指标
    performanceMetricsCollector.cleanup(0); // 清理所有指标

    // 重置 mocks
    vi.clearAllMocks();
    mockChrome.storage.local.get.mockResolvedValue({});
    mockChrome.storage.local.set.mockResolvedValue(undefined);
  });

  describe('PerformanceMetricsCollector', () => {
    it('应该正确记录性能指标', () => {
      const metric: Omit<PerformanceMetric, 'id' | 'timestamp'> = {
        name: 'test_metric',
        value: 100,
        unit: 'ms',
        category: 'api',
        metadata: { test: true },
      };

      performanceMetricsCollector.recordMetric(metric);

      const recentMetrics = performanceMetricsCollector.getRecentMetrics(10);
      expect(recentMetrics).toHaveLength(1);
      expect(recentMetrics[0]).toMatchObject(metric);
      expect(recentMetrics[0].id).toBeDefined();
      expect(recentMetrics[0].timestamp).toBeDefined();
    });

    it('应该正确计算统计信息', () => {
      // 添加多个指标
      const metrics = [
        { name: 'api_call', value: 100, unit: 'ms', category: 'api' as const },
        { name: 'api_call', value: 200, unit: 'ms', category: 'api' as const },
        { name: 'api_call', value: 150, unit: 'ms', category: 'api' as const },
      ];

      metrics.forEach(metric => {
        performanceMetricsCollector.recordMetric(metric);
      });

      const stats = performanceMetricsCollector.getStats();
      expect(stats['api_call']).toBeDefined();
      expect(stats['api_call'].count).toBe(3);
      expect(stats['api_call'].average).toBe(150);
      expect(stats['api_call'].min).toBe(100);
      expect(stats['api_call'].max).toBe(200);
    });

    it('应该正确记录API指标', () => {
      performanceMetricsCollector.recordAPIMetric('api_response_time', 250, {
        provider: 'openai',
        endpoint: '/translate',
        method: 'POST',
        statusCode: 200,
      });

      const recentMetrics = performanceMetricsCollector.getRecentMetrics(10);
      expect(recentMetrics).toHaveLength(1);
      expect(recentMetrics[0].name).toBe('api_response_time');
      expect(recentMetrics[0].category).toBe('api');
      expect(recentMetrics[0].metadata).toMatchObject({
        provider: 'openai',
        endpoint: '/translate',
        method: 'POST',
        statusCode: 200,
      });
    });

    it('应该正确记录翻译指标', () => {
      performanceMetricsCollector.recordTranslationMetric('translation_time', 300, {
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        textLength: 50,
        provider: 'openai',
        cacheHit: false,
        qualityScore: 0.9,
      });

      const recentMetrics = performanceMetricsCollector.getRecentMetrics(10);
      expect(recentMetrics).toHaveLength(1);
      expect(recentMetrics[0].name).toBe('translation_time');
      expect(recentMetrics[0].category).toBe('translation');
      expect(recentMetrics[0].metadata).toMatchObject({
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        textLength: 50,
        provider: 'openai',
        cacheHit: false,
        qualityScore: 0.9,
      });
    });

    it('应该正确过滤指标', () => {
      const metrics = [
        { name: 'api_call', value: 100, unit: 'ms', category: 'api' as const },
        { name: 'ui_render', value: 50, unit: 'ms', category: 'ui' as const },
        { name: 'cache_hit', value: 10, unit: 'ms', category: 'cache' as const },
      ];

      metrics.forEach(metric => {
        performanceMetricsCollector.recordMetric(metric);
      });

      const apiMetrics = performanceMetricsCollector.getRecentMetrics(10, 'api');
      expect(apiMetrics).toHaveLength(1);
      expect(apiMetrics[0].category).toBe('api');

      const uiMetrics = performanceMetricsCollector.getRecentMetrics(10, 'ui');
      expect(uiMetrics).toHaveLength(1);
      expect(uiMetrics[0].category).toBe('ui');
    });

    it('应该正确清理过期指标', () => {
      // 添加一些指标
      for (let i = 0; i < 15; i++) {
        performanceMetricsCollector.recordMetric({
          name: `metric_${i}`,
          value: i * 10,
          unit: 'ms',
          category: 'api',
        });
      }

      expect(performanceMetricsCollector.getRecentMetrics(20)).toHaveLength(15);

      // 清理所有指标（使用0毫秒作为cutoff时间）
      performanceMetricsCollector.cleanup(0);

      // 清理后应该没有指标
      const remaining = performanceMetricsCollector.getRecentMetrics(20);
      expect(remaining.length).toBe(0);
    });
  });

  // React钩子测试需要在实际环境中进行
  describe('性能指标集成测试', () => {
    it('应该能够记录和检索完整的性能数据', () => {
      // 记录多种类型的指标
      performanceMetricsCollector.recordAPIMetric('api_response', 200, {
        provider: 'openai',
        endpoint: '/translate',
        method: 'POST',
        statusCode: 200,
      });

      performanceMetricsCollector.recordTranslationMetric('translation_time', 300, {
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        textLength: 50,
        provider: 'openai',
        cacheHit: false,
        qualityScore: 0.9,
      });

      const stats = performanceMetricsCollector.getStats();
      expect(stats).toHaveProperty('api_response');
      expect(stats).toHaveProperty('translation_time');

      const recentMetrics = performanceMetricsCollector.getRecentMetrics(10);
      expect(recentMetrics).toHaveLength(2);
    });
  });


});
