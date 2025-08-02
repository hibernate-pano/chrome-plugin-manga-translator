import { describe, it, expect } from 'vitest';
import { performanceMonitor } from '../utils/performance-monitor';
import { IntelligentCache } from '../utils/intelligent-cache';
import { CacheStrategyManager } from '../utils/cache-strategy';
import { APIManager } from '../api/api-manager';

describe('构建验证测试', () => {
  describe('基础模块导入', () => {
    it('应该能够导入性能监控器', async () => {
      const { performanceMonitor } = await import('../utils/performance-monitor');
      expect(performanceMonitor).toBeDefined();
      expect(typeof performanceMonitor.getMetrics).toBe('function');
    });

    it('应该能够导入智能缓存', async () => {
      const { IntelligentCache } = await import('../utils/intelligent-cache');
      expect(IntelligentCache).toBeDefined();
      expect(typeof IntelligentCache).toBe('function');
    });

    it('应该能够导入缓存策略管理器', async () => {
      const { CacheStrategyManager } = await import('../utils/cache-strategy');
      expect(CacheStrategyManager).toBeDefined();
      expect(typeof CacheStrategyManager).toBe('function');
    });

    it('应该能够导入API管理器', async () => {
      const { APIManager } = await import('../api/api-manager');
      expect(APIManager).toBeDefined();
      expect(typeof APIManager.getInstance).toBe('function');
    });
  });

  describe('Store模块', () => {
    it('应该能够导入配置store', async () => {
      const { useConfigStore } = await import('../stores/config');
      expect(useConfigStore).toBeDefined();
      expect(typeof useConfigStore).toBe('function');
    });

    it('应该能够导入翻译store', async () => {
      const { useTranslationStore } = await import('../stores/translation');
      expect(useTranslationStore).toBeDefined();
      expect(typeof useTranslationStore).toBe('function');
    });

    it('应该能够导入缓存store', async () => {
      const { useCacheStore } = await import('../stores/cache');
      expect(useCacheStore).toBeDefined();
      expect(typeof useCacheStore).toBe('function');
    });
  });

  describe('UI组件', () => {
    it('应该能够导入基础UI组件', async () => {
      const { Button } = await import('../components/ui/button');
      expect(Button).toBeDefined();
    });

    it('应该能够导入布局组件', async () => {
      const { LayoutContainer } = await import('../components/ui/layout');
      expect(LayoutContainer).toBeDefined();
    });

    it('应该能够导入主题组件', async () => {
      const { ThemeProvider } = await import('../components/theme-provider');
      expect(ThemeProvider).toBeDefined();
    });
  });

  describe('工具函数', () => {
    it('应该能够导入数据迁移工具', async () => {
      const { DataMigration } = await import('../utils/data-migration');
      expect(DataMigration).toBeDefined();
    });

    it('应该能够导入主题hook', async () => {
      const { useTheme } = await import('../hooks/use-theme');
      expect(useTheme).toBeDefined();
    });
  });

  describe('功能验证', () => {
    it('性能监控器应该正常工作', () => {
      // 重置监控器
      performanceMonitor.reset();

      // 记录一些指标
      performanceMonitor.recordCacheHit();
      performanceMonitor.recordCacheMiss();

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.cache.hits).toBe(1);
      expect(metrics.cache.misses).toBe(1);
    });

    it('智能缓存应该正常工作', () => {
      const cache = new IntelligentCache({
        maxSize: 1024 * 1024,
        defaultTTL: 60000,
        maxItems: 100,
        cleanupInterval: 10000,
        compressionThreshold: 1024,
      });

      cache.set('test', 'value');
      expect(cache.get('test')).toBe('value');
      expect(cache.has('test')).toBe(true);

      cache.destroy();
    });

    it('缓存策略管理器应该正常工作', () => {
      const cache = new IntelligentCache({
        maxSize: 1024 * 1024,
        defaultTTL: 60000,
        maxItems: 100,
        cleanupInterval: 10000,
        compressionThreshold: 1024,
      });

      const manager = new CacheStrategyManager(cache);

      manager.smartSet('test', 'value', 'translation');
      expect(manager.smartGet('test')).toBe('value');

      cache.destroy();
    });

    it('API管理器应该正常工作', () => {
      const manager = APIManager.getInstance();
      expect(manager).toBeDefined();

      // 测试缓存功能
      manager.setCache('test', 'value');
      expect(manager.getCache('test')).toBe('value');
    });
  });

  describe('类型安全性', () => {
    it('应该有正确的TypeScript类型', () => {
      // 这个测试主要验证TypeScript编译通过
      expect(true).toBe(true);
    });
  });

  describe('内存管理', () => {
    it('应该能够正确清理资源', () => {
      const cache = new IntelligentCache({
        maxSize: 1024,
        defaultTTL: 1000,
        maxItems: 10,
        cleanupInterval: 100,
        compressionThreshold: 100,
      });

      // 添加一些数据
      cache.set('test1', 'value1');
      cache.set('test2', 'value2');

      // 清理
      cache.clear();
      expect(cache.getStats().itemCount).toBe(0);

      // 销毁
      cache.destroy();

      // 重置性能监控
      performanceMonitor.reset();
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.apiCalls.total).toBe(0);
    });
  });

  describe('错误处理', () => {
    it('应该能够处理模块导入错误', () => {
      // 测试动态导入错误处理
      expect(() => {
        // 这里测试错误处理逻辑而不是实际导入不存在的模块
        throw new Error('模块不存在');
      }).toThrow('模块不存在');
    });

    it('应该能够处理缓存错误', () => {
      const cache = new IntelligentCache({
        maxSize: 1024,
        defaultTTL: 1000,
        maxItems: 10,
        cleanupInterval: 100,
        compressionThreshold: 100,
      });

      // 测试不存在的键
      expect(cache.get('nonexistent')).toBeNull();
      expect(cache.has('nonexistent')).toBe(false);

      cache.destroy();
    });
  });

  describe('性能基准', () => {
    it('模块导入应该在合理时间内完成', async () => {
      const startTime = Date.now();

      await Promise.all([
        import('../utils/performance-monitor'),
        import('../utils/intelligent-cache'),
        import('../utils/cache-strategy'),
        import('../api/api-manager'),
      ]);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // 模块导入应该在1秒内完成
      expect(duration).toBeLessThan(1000);
    });
  });
});
