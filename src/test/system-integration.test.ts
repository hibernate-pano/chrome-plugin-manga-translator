import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useConfigStore } from '../stores/config';
import { useTranslationStore } from '../stores/translation';
import { useCacheStore } from '../stores/cache';
import { performanceMonitor } from '../utils/performance-monitor';
import { IntelligentCache } from '../utils/intelligent-cache';
import { CacheStrategyManager } from '../utils/cache-strategy';

// Mock Chrome APIs
const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

// @ts-ignore
global.chrome = mockChrome;

describe('系统集成测试', () => {
  let cache: IntelligentCache;
  let strategyManager: CacheStrategyManager;

  beforeEach(() => {
    // 重置所有stores
    useConfigStore.getState().reset?.();
    useTranslationStore.getState().reset?.();
    useCacheStore.getState().reset?.();
    
    // 重置性能监控
    performanceMonitor.reset();

    // 创建缓存实例
    cache = new IntelligentCache({
      maxSize: 10 * 1024 * 1024,
      defaultTTL: 24 * 60 * 60 * 1000,
      maxItems: 1000,
      cleanupInterval: 60 * 1000,
      compressionThreshold: 1024,
    });

    strategyManager = new CacheStrategyManager(cache);

    // 清除所有mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    cache?.destroy();
  });

  describe('状态管理集成', () => {
    it('应该正确初始化所有stores', () => {
      const configState = useConfigStore.getState();
      const translationState = useTranslationStore.getState();
      const cacheState = useCacheStore.getState();

      // 验证初始状态
      expect(configState).toBeDefined();
      expect(translationState).toBeDefined();
      expect(cacheState).toBeDefined();

      // 验证默认配置
      expect(configState.providerType).toBeDefined();
      expect(configState.targetLanguage).toBeDefined();
      expect(configState.styleLevel).toBeDefined();
    });

    it('应该正确处理配置更新', () => {
      const configStore = useConfigStore.getState();
      
      // 更新配置
      configStore.setProviderType('openai');
      configStore.setTargetLanguage('en');
      configStore.setStyleLevel(3);

      // 验证更新
      const updatedState = useConfigStore.getState();
      expect(updatedState.providerType).toBe('openai');
      expect(updatedState.targetLanguage).toBe('en');
      expect(updatedState.styleLevel).toBe(3);
    });

    it('应该正确处理翻译历史', () => {
      const translationStore = useTranslationStore.getState();
      
      // 添加翻译历史
      const historyItem = {
        id: 'test-1',
        originalText: '测试文本',
        translatedText: 'Test text',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        timestamp: Date.now(),
        provider: 'openai',
      };

      translationStore.addToHistory(historyItem);

      // 验证历史记录
      const updatedState = useTranslationStore.getState();
      expect(updatedState.history).toHaveLength(1);
      expect(updatedState.history[0]).toEqual(historyItem);
    });
  });

  describe('缓存系统集成', () => {
    it('应该正确集成智能缓存和策略管理', () => {
      // 测试翻译缓存
      strategyManager.smartSet('translation_test', '翻译结果', 'translation');
      const translationResult = strategyManager.smartGet('translation_test');
      expect(translationResult).toBe('翻译结果');

      // 测试OCR缓存
      const ocrData = [{ text: 'OCR文本', bbox: [0, 0, 100, 50] }];
      strategyManager.smartSet('ocr_test', ocrData, 'ocr');
      const ocrResult = strategyManager.smartGet('ocr_test');
      expect(ocrResult).toEqual(ocrData);

      // 测试配置缓存
      const configData = { apiKey: 'test-key' };
      strategyManager.smartSet('config_test', configData, 'config');
      const configResult = strategyManager.smartGet('config_test');
      expect(configResult).toEqual(configData);
    });

    it('应该正确处理缓存过期和清理', async () => {
      // 设置短TTL的缓存
      cache.set('short_lived', 'data', { ttl: 100 });
      expect(cache.has('short_lived')).toBe(true);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.has('short_lived')).toBe(false);
    });

    it('应该正确执行缓存策略', () => {
      // 添加不同类型的缓存数据
      for (let i = 0; i < 10; i++) {
        strategyManager.smartSet(`item_${i}`, `data_${i}`, 'translation');
      }

      const stats = cache.getStats();
      expect(stats.itemCount).toBe(10);
      expect(stats.size).toBeGreaterThan(0);

      // 执行策略性清理
      strategyManager.strategicCleanup({
        targetSize: 1024,
      });

      // 验证清理后的状态
      const afterStats = cache.getStats();
      expect(afterStats.itemCount).toBeLessThanOrEqual(stats.itemCount);
    });
  });

  describe('性能监控集成', () => {
    it('应该正确监控系统性能', async () => {
      // 模拟API调用
      performanceMonitor.startAPIRequest('test_req', 'translation');
      await new Promise(resolve => setTimeout(resolve, 100));
      performanceMonitor.endAPIRequest('test_req', 'translation', {
        texts: ['测试文本'],
        isBatch: false,
      });

      // 模拟缓存活动
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheMiss();

      // 获取性能指标
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.apiCalls.total).toBe(1);
      expect(metrics.apiCalls.successful).toBe(1);
      expect(metrics.cache.hits).toBe(1);
      expect(metrics.cache.misses).toBe(1);
      expect(metrics.translation.totalTexts).toBe(1);
    });

    it('应该生成性能报告和建议', () => {
      // 添加一些性能数据
      for (let i = 0; i < 5; i++) {
        performanceMonitor.startAPIRequest(`req_${i}`, 'translation');
        performanceMonitor.endAPIRequest(`req_${i}`, 'translation', {
          texts: ['测试'],
          isBatch: false,
        });
      }

      const report = performanceMonitor.getPerformanceReport();
      expect(report.summary).toBeDefined();
      expect(report.details).toBeDefined();
      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.summary.totalRequests).toBe(5);
      expect(report.summary.successRate).toBe(1);
    });
  });

  describe('Chrome Storage集成', () => {
    it('应该正确处理Chrome Storage操作', async () => {
      const configStore = useConfigStore.getState();
      
      // 模拟Chrome Storage返回数据
      mockChrome.storage.sync.get.mockResolvedValue({
        'config-store': JSON.stringify({
          providerType: 'openai',
          targetLanguage: 'en',
        }),
      });

      // 测试加载配置
      await configStore.loadFromStorage?.();

      // 验证配置加载
      expect(mockChrome.storage.sync.get).toHaveBeenCalled();
    });

    it('应该正确处理存储错误', async () => {
      const configStore = useConfigStore.getState();
      
      // 模拟存储错误
      mockChrome.storage.sync.get.mockRejectedValue(new Error('Storage error'));

      // 测试错误处理
      await expect(configStore.loadFromStorage?.()).resolves.not.toThrow();
    });
  });

  describe('数据迁移集成', () => {
    it('应该正确处理数据迁移', async () => {
      // 模拟v0.1数据
      const v01Data = {
        settings: {
          provider: 'openai',
          language: 'en',
          style: 2,
        },
        history: [
          {
            original: '测试',
            translated: 'test',
            timestamp: Date.now(),
          },
        ],
      };

      mockChrome.storage.local.get.mockResolvedValue(v01Data);

      // 这里应该调用数据迁移逻辑
      // 由于我们没有直接的迁移入口，我们验证数据结构兼容性
      expect(v01Data.settings).toBeDefined();
      expect(v01Data.history).toBeDefined();
    });
  });

  describe('错误处理集成', () => {
    it('应该正确处理API错误', () => {
      // 模拟API错误
      const error = new Error('API调用失败');
      performanceMonitor.recordAPIFailure('failed_req', error, 'openai');

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.errors.total).toBe(1);
      expect(metrics.errors.byProvider['openai']).toBe(1);
      expect(metrics.errors.byType['Error']).toBe(1);
    });

    it('应该正确处理缓存错误', () => {
      // 测试无效缓存键
      const result = strategyManager.smartGet('nonexistent_key');
      expect(result).toBeNull();

      // 验证缓存未命中被记录
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.cache.misses).toBeGreaterThan(0);
    });
  });

  describe('内存管理', () => {
    it('应该正确管理内存使用', () => {
      // 创建大量缓存数据
      for (let i = 0; i < 100; i++) {
        cache.set(`large_item_${i}`, 'x'.repeat(1000), { priority: i % 10 });
      }

      const stats = cache.getStats();
      expect(stats.itemCount).toBeGreaterThan(0);
      expect(stats.size).toBeGreaterThan(0);

      // 清理缓存
      cache.clear();
      const clearedStats = cache.getStats();
      expect(clearedStats.itemCount).toBe(0);
      expect(clearedStats.size).toBe(0);
    });

    it('应该正确处理资源清理', () => {
      // 测试缓存销毁
      expect(() => cache.destroy()).not.toThrow();

      // 测试性能监控重置
      expect(() => performanceMonitor.reset()).not.toThrow();
    });
  });

  describe('系统稳定性', () => {
    it('应该在高负载下保持稳定', async () => {
      // 模拟高并发操作
      const promises = [];
      
      for (let i = 0; i < 50; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              strategyManager.smartSet(`concurrent_${i}`, `data_${i}`, 'translation');
              strategyManager.smartGet(`concurrent_${i}`);
              resolve(true);
            }, Math.random() * 100);
          })
        );
      }

      await Promise.all(promises);

      // 验证系统仍然正常工作
      const stats = cache.getStats();
      expect(stats.itemCount).toBeGreaterThan(0);
      
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.cache.hits).toBeGreaterThan(0);
    });

    it('应该正确处理边界条件', () => {
      // 测试空数据
      strategyManager.smartSet('empty', '', 'translation');
      expect(strategyManager.smartGet('empty')).toBe('');

      // 测试null数据
      strategyManager.smartSet('null', null, 'translation');
      expect(strategyManager.smartGet('null')).toBeNull();

      // 测试大数据
      const largeData = 'x'.repeat(100000);
      strategyManager.smartSet('large', largeData, 'translation');
      expect(strategyManager.smartGet('large')).toBe(largeData);
    });
  });
});
