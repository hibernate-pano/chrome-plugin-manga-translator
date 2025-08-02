import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CacheStrategyManager,
  TranslationCacheStrategy,
  OCRCacheStrategy,
  ConfigCacheStrategy,
  CacheContext
} from '../utils/cache-strategy';
import { IntelligentCache } from '../utils/intelligent-cache';

// Mock performance monitor
vi.mock('../utils/performance-monitor', () => ({
  performanceMonitor: {
    getMetrics: vi.fn().mockReturnValue({
      apiCalls: {
        total: 100,
        failed: 5,
        averageResponseTime: 1000,
      },
      cache: {
        hits: 80,
        misses: 20,
        hitRate: 0.8,
        totalSize: 1024 * 1024,
      },
    }),
    updateCacheSize: vi.fn(),
    recordCacheHit: vi.fn(),
    recordCacheMiss: vi.fn(),
  },
}));

describe('缓存策略测试', () => {
  let cache: IntelligentCache;
  let strategyManager: CacheStrategyManager;

  beforeEach(() => {
    cache = new IntelligentCache({
      maxSize: 10 * 1024 * 1024, // 10MB
      defaultTTL: 24 * 60 * 60 * 1000, // 24小时
      maxItems: 1000,
      cleanupInterval: 60 * 1000, // 1分钟
      compressionThreshold: 1024,
    });
    strategyManager = new CacheStrategyManager(cache);
  });

  describe('翻译缓存策略', () => {
    let strategy: TranslationCacheStrategy;

    beforeEach(() => {
      strategy = new TranslationCacheStrategy();
    });

    it('应该正确判断是否缓存翻译结果', () => {
      const context: CacheContext = {
        operation: 'translation',
        dataSize: 1024,
        frequency: 3,
        userPreferences: {},
        systemLoad: 0.3,
      };

      expect(strategy.shouldCache('test', 'translated text', context)).toBe(true);

      // 数据过大时不缓存
      context.dataSize = 2 * 1024 * 1024; // 2MB
      expect(strategy.shouldCache('test', 'translated text', context)).toBe(false);

      // 系统负载高时只缓存小数据
      context.dataSize = 20 * 1024; // 20KB
      context.systemLoad = 0.9;
      expect(strategy.shouldCache('test', 'translated text', context)).toBe(false);

      context.dataSize = 5 * 1024; // 5KB
      expect(strategy.shouldCache('test', 'translated text', context)).toBe(true);
    });

    it('应该根据频率调整TTL', () => {
      const baseContext: CacheContext = {
        operation: 'translation',
        dataSize: 1024,
        frequency: 1,
        userPreferences: {},
        systemLoad: 0.3,
      };

      // 低频访问
      const lowFreqTTL = strategy.getTTL('test', 'text', { ...baseContext, frequency: 1 });
      expect(lowFreqTTL).toBe(12 * 60 * 60 * 1000); // 12小时

      // 中频访问
      const midFreqTTL = strategy.getTTL('test', 'text', { ...baseContext, frequency: 7 });
      expect(midFreqTTL).toBe(3 * 24 * 60 * 60 * 1000); // 3天

      // 高频访问
      const highFreqTTL = strategy.getTTL('test', 'text', { ...baseContext, frequency: 15 });
      expect(highFreqTTL).toBe(7 * 24 * 60 * 60 * 1000); // 7天
    });

    it('应该根据数据大小和频率调整优先级', () => {
      const baseContext: CacheContext = {
        operation: 'translation',
        dataSize: 1024,
        frequency: 5,
        userPreferences: {},
        systemLoad: 0.3,
      };

      // 小数据，高频访问
      const smallHighFreq = strategy.getPriority('test', 'text', {
        ...baseContext,
        dataSize: 500,
        frequency: 20
      });
      expect(smallHighFreq).toBeGreaterThanOrEqual(5); // 1 + 2(频率) + 2(小数据) = 5

      // 大数据，低频访问
      const largeLowFreq = strategy.getPriority('test', 'text', {
        ...baseContext,
        dataSize: 50 * 1024,
        frequency: 1
      });
      expect(largeLowFreq).toBeLessThanOrEqual(2); // 1 + 0.1(频率) + 0(大数据) ≈ 1.1
    });

    it('应该根据数据特征生成标签', () => {
      const baseContext: CacheContext = {
        operation: 'translation',
        dataSize: 1024,
        frequency: 5,
        userPreferences: {},
        systemLoad: 0.3,
      };

      // 小数据，高频访问
      const smallHotTags = strategy.getTags('test', 'text', {
        ...baseContext,
        dataSize: 500,
        frequency: 15
      });
      expect(smallHotTags).toContain('translation');
      expect(smallHotTags).toContain('small');
      expect(smallHotTags).toContain('hot');

      // 大数据，低频访问
      const largeColdTags = strategy.getTags('test', 'text', {
        ...baseContext,
        dataSize: 200 * 1024,
        frequency: 1
      });
      expect(largeColdTags).toContain('translation');
      expect(largeColdTags).toContain('large');
      expect(largeColdTags).toContain('cold');
    });
  });

  describe('OCR缓存策略', () => {
    let strategy: OCRCacheStrategy;

    beforeEach(() => {
      strategy = new OCRCacheStrategy();
    });

    it('应该正确判断是否缓存OCR结果', () => {
      const context: CacheContext = {
        operation: 'ocr',
        dataSize: 1024,
        frequency: 2,
        userPreferences: {},
        systemLoad: 0.3,
      };

      const ocrData = [
        { text: 'text1', bbox: [0, 0, 100, 50] },
        { text: 'text2', bbox: [100, 0, 200, 50] },
      ];

      expect(strategy.shouldCache('test', ocrData, context)).toBe(true);

      // 数据过大时不缓存
      context.dataSize = 6 * 1024 * 1024; // 6MB
      expect(strategy.shouldCache('test', ocrData, context)).toBe(false);

      // 检测到很多文本区域时优先缓存
      context.dataSize = 1024;
      const manyTextAreas = Array(15).fill({ text: 'text', bbox: [0, 0, 100, 50] });
      expect(strategy.shouldCache('test', manyTextAreas, context)).toBe(true);
    });

    it('应该为OCR结果设置较长的TTL', () => {
      const context: CacheContext = {
        operation: 'ocr',
        dataSize: 1024,
        frequency: 2,
        userPreferences: {},
        systemLoad: 0.3,
      };

      const ttl = strategy.getTTL('test', [], context);
      expect(ttl).toBe(7 * 24 * 60 * 60 * 1000); // 7天

      // 高频图片缓存更长时间
      const highFreqTTL = strategy.getTTL('test', [], { ...context, frequency: 5 });
      expect(highFreqTTL).toBe(14 * 24 * 60 * 60 * 1000); // 14天
    });

    it('应该根据文本区域数量调整优先级', () => {
      const context: CacheContext = {
        operation: 'ocr',
        dataSize: 1024,
        frequency: 2,
        userPreferences: {},
        systemLoad: 0.3,
      };

      // 简单OCR结果
      const simplePriority = strategy.getPriority('test', [{ text: 'text' }], context);

      // 复杂OCR结果
      const complexData = Array(20).fill({ text: 'text', bbox: [0, 0, 100, 50] });
      const complexPriority = strategy.getPriority('test', complexData, context);

      expect(complexPriority).toBeGreaterThan(simplePriority);
    });
  });

  describe('配置缓存策略', () => {
    let strategy: ConfigCacheStrategy;

    beforeEach(() => {
      strategy = new ConfigCacheStrategy();
    });

    it('应该总是缓存配置数据', () => {
      const context: CacheContext = {
        operation: 'config',
        dataSize: 1024,
        frequency: 1,
        userPreferences: {},
        systemLoad: 0.9,
      };

      expect(strategy.shouldCache('test', { setting: 'value' }, context)).toBe(true);
    });

    it('应该为配置数据设置长TTL和高优先级', () => {
      const context: CacheContext = {
        operation: 'config',
        dataSize: 1024,
        frequency: 1,
        userPreferences: {},
        systemLoad: 0.3,
      };

      const ttl = strategy.getTTL('test', {}, context);
      expect(ttl).toBe(30 * 24 * 60 * 60 * 1000); // 30天

      const priority = strategy.getPriority('test', {}, context);
      expect(priority).toBe(10); // 最高优先级
    });

    it('应该为配置数据添加持久化标签', () => {
      const context: CacheContext = {
        operation: 'config',
        dataSize: 1024,
        frequency: 1,
        userPreferences: {},
        systemLoad: 0.3,
      };

      const tags = strategy.getTags('test', {}, context);
      expect(tags).toContain('config');
      expect(tags).toContain('persistent');
    });
  });

  describe('缓存策略管理器', () => {
    it('应该正确注册和使用策略', () => {
      // 测试翻译缓存
      strategyManager.smartSet('translation_key', '翻译结果', 'translation');
      const result = strategyManager.smartGet('translation_key');
      expect(result).toBe('翻译结果');

      // 测试OCR缓存
      const ocrData = [{ text: 'OCR文本', bbox: [0, 0, 100, 50] }];
      strategyManager.smartSet('ocr_key', ocrData, 'ocr');
      const ocrResult = strategyManager.smartGet('ocr_key');
      expect(ocrResult).toEqual(ocrData);

      // 测试配置缓存
      const configData = { apiKey: 'test-key', provider: 'openai' };
      strategyManager.smartSet('config_key', configData, 'config');
      const configResult = strategyManager.smartGet('config_key');
      expect(configResult).toEqual(configData);
    });

    it('应该生成策略报告', () => {
      // 添加一些缓存数据
      strategyManager.smartSet('key1', 'data1', 'translation');
      strategyManager.smartSet('key2', 'data2', 'ocr');
      strategyManager.smartSet('key3', 'data3', 'config');

      // 模拟一些访问
      strategyManager.smartGet('key1');
      strategyManager.smartGet('key1');
      strategyManager.smartGet('key2');

      const report = strategyManager.getStrategyReport();

      expect(report.strategies).toHaveLength(3);
      expect(report.strategies.map(s => s.name)).toContain('translation');
      expect(report.strategies.map(s => s.name)).toContain('ocr');
      expect(report.strategies.map(s => s.name)).toContain('config');

      expect(report.accessFrequency).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
    });

    it('应该执行策略性清理', () => {
      // 添加一些测试数据
      for (let i = 0; i < 10; i++) {
        strategyManager.smartSet(`key${i}`, `data${i}`, 'translation');
      }

      const initialStats = cache.getStats();

      // 执行清理
      strategyManager.strategicCleanup({
        targetSize: 1024, // 很小的目标大小，强制清理
      });

      // 验证清理效果（这里主要验证方法能正常执行）
      expect(() => strategyManager.strategicCleanup()).not.toThrow();
    });
  });
});
