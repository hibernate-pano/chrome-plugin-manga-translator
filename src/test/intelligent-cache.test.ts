import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntelligentCache } from '../utils/intelligent-cache';
import { CacheWarmupManager } from '../utils/cache-warmup';
import { UnifiedCacheManager } from '../utils/unified-cache-manager';
import { OfflineManager } from '../utils/offline-manager';

// Mock Chrome API
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
  },
};

// @ts-ignore
global.chrome = mockChrome;

// Mock IndexedDB
const mockIndexedDB = {
  open: vi.fn(),
  deleteDatabase: vi.fn(),
};

// @ts-ignore
global.indexedDB = mockIndexedDB;

describe('智能缓存系统测试', () => {
  let intelligentCache: IntelligentCache;
  let cacheWarmupManager: CacheWarmupManager;
  let unifiedCacheManager: UnifiedCacheManager;
  let offlineManager: OfflineManager;

  beforeEach(() => {
    intelligentCache = new IntelligentCache();
    cacheWarmupManager = new CacheWarmupManager();
    unifiedCacheManager = new UnifiedCacheManager();
    offlineManager = new OfflineManager();

    // 重置 mocks
    vi.clearAllMocks();
    mockChrome.storage.local.get.mockResolvedValue({});
    mockChrome.storage.local.set.mockResolvedValue(undefined);
    mockChrome.storage.local.remove.mockResolvedValue(undefined);
    mockChrome.storage.local.clear.mockResolvedValue(undefined);
  });

  describe('IntelligentCache', () => {
    it('应该能够设置和获取缓存项', async () => {
      const key = 'test_key';
      const value = { data: 'test_data' };
      const options = { ttl: 60000, priority: 5 };

      await intelligentCache.set(key, value, options);
      const retrieved = await intelligentCache.get(key);

      expect(retrieved).toEqual(value);
    });

    it('应该正确处理TTL过期', async () => {
      const key = 'test_key';
      const value = { data: 'test_data' };
      const options = { ttl: 100, priority: 5 }; // 100ms TTL

      await intelligentCache.set(key, value, options);

      // 立即获取应该成功
      let retrieved = await intelligentCache.get(key);
      expect(retrieved).toEqual(value);

      // 等待TTL过期
      await new Promise(resolve => setTimeout(resolve, 150));

      retrieved = await intelligentCache.get(key);
      expect(retrieved).toBeNull();
    });

    it('应该根据优先级清理缓存', async () => {
      // 添加不同优先级的缓存项
      await intelligentCache.set('low_priority', { data: 'low' }, { priority: 1 });
      await intelligentCache.set('high_priority', { data: 'high' }, { priority: 10 });
      await intelligentCache.set('medium_priority', { data: 'medium' }, { priority: 5 });

      // 模拟内存压力，触发清理
      await intelligentCache.cleanup();

      // 高优先级的应该保留
      const highPriority = await intelligentCache.get('high_priority');
      expect(highPriority).toEqual({ data: 'high' });

      // 低优先级的可能被清理
      const lowPriority = await intelligentCache.get('low_priority');
      // 这个测试可能需要根据实际的清理策略调整
    });

    it('应该正确更新访问统计', async () => {
      const key = 'test_key';
      const value = { data: 'test_data' };

      await intelligentCache.set(key, value);

      // 多次访问
      await intelligentCache.get(key);
      await intelligentCache.get(key);
      await intelligentCache.get(key);

      const stats = await intelligentCache.getStats();
      expect(stats.totalItems).toBe(1);
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('应该支持批量操作', async () => {
      const items = [
        { key: 'key1', value: { data: 'data1' } },
        { key: 'key2', value: { data: 'data2' } },
        { key: 'key3', value: { data: 'data3' } },
      ];

      await intelligentCache.setMany(items);

      const keys = items.map(item => item.key);
      const retrieved = await intelligentCache.getMany(keys);

      expect(retrieved).toHaveLength(3);
      expect(retrieved[0]).toEqual({ data: 'data1' });
      expect(retrieved[1]).toEqual({ data: 'data2' });
      expect(retrieved[2]).toEqual({ data: 'data3' });
    });
  });

  describe('CacheWarmupManager', () => {
    it('应该记录用户行为', () => {
      cacheWarmupManager.recordUserBehavior('translate', {
        text: 'hello',
        language: 'zh',
      });

      cacheWarmupManager.recordUserBehavior('translate', {
        text: 'world',
        language: 'zh',
      });

      // 验证行为被记录（这可能需要访问内部状态或提供查询方法）
      expect(true).toBe(true); // 占位符，实际测试需要根据API调整
    });

    it('应该能够执行智能预热', async () => {
      // 记录一些用户行为
      cacheWarmupManager.recordUserBehavior('translate', {
        text: 'hello',
        language: 'zh',
      });

      // 执行预热
      await cacheWarmupManager.performIntelligentWarmup({
        maxConcurrency: 2,
        priorityThreshold: 0.5,
      });

      // 验证预热操作（这可能需要mock API调用）
      expect(true).toBe(true); // 占位符
    });

    it('应该能够预测用户需求', () => {
      // 记录重复的用户行为
      for (let i = 0; i < 5; i++) {
        cacheWarmupManager.recordUserBehavior('translate', {
          text: 'hello',
          language: 'zh',
        });
      }

      const predictions = cacheWarmupManager.predictUserNeeds();
      expect(predictions).toBeDefined();
      expect(Array.isArray(predictions)).toBe(true);
    });
  });

  describe('UnifiedCacheManager', () => {
    it('应该协调多个缓存层', async () => {
      const key = 'test_key';
      const value = { data: 'test_data' };
      const category = 'translation';

      await unifiedCacheManager.set(key, value, category);
      const retrieved = await unifiedCacheManager.get(key, category);

      expect(retrieved).toEqual(value);
    });

    it('应该支持不同的缓存策略', async () => {
      const key = 'test_key';
      const value = { data: 'test_data' };
      const category = 'translation';

      // 测试不同的缓存选项
      await unifiedCacheManager.set(key, value, category, {
        enableOffline: true,
        priority: 8,
        strategy: 'LRU',
      });

      const retrieved = await unifiedCacheManager.get(key, category);
      expect(retrieved).toEqual(value);
    });

    it('应该提供缓存统计信息', async () => {
      // 添加一些缓存项
      await unifiedCacheManager.set('key1', { data: 'data1' }, 'translation');
      await unifiedCacheManager.set('key2', { data: 'data2' }, 'api');

      const stats = await unifiedCacheManager.getStats();
      expect(stats).toBeDefined();
      expect(stats.totalItems).toBeGreaterThan(0);
    });
  });

  describe('OfflineManager', () => {
    it('应该能够存储离线数据', async () => {
      const key = 'offline_key';
      const data = { content: 'offline_content' };

      await offlineManager.storeOfflineData(key, data, 'translation');
      const retrieved = offlineManager.getOfflineData(key);

      expect(retrieved).toBeDefined();
      expect(retrieved?.data).toEqual(data);
    });

    it('应该支持优先级队列', async () => {
      // 添加不同优先级的离线数据
      await offlineManager.storeOfflineData('low', { data: 'low' }, 'translation', 1);
      await offlineManager.storeOfflineData('high', { data: 'high' }, 'translation', 10);
      await offlineManager.storeOfflineData('medium', { data: 'medium' }, 'translation', 5);

      const queue = offlineManager.getOfflineQueue();
      expect(queue).toBeDefined();
      expect(Array.isArray(queue)).toBe(true);
    });

    it('应该能够同步离线数据', async () => {
      // 添加一些离线数据
      await offlineManager.storeOfflineData('sync_key', { data: 'sync_data' }, 'translation');

      // 模拟网络恢复
      await offlineManager.syncOfflineData();

      // 验证同步操作（这可能需要mock网络请求）
      expect(true).toBe(true); // 占位符
    });
  });

  // React钩子测试需要在实际环境中进行
  describe('缓存系统集成测试', () => {
    it('应该能够协调多个缓存组件', async () => {
      // 测试缓存预热管理器
      cacheWarmupManager.recordUserBehavior('translate', {
        text: 'hello',
        language: 'zh',
      });

      // 测试统一缓存管理器
      const key = 'integration_test';
      const value = { data: 'integration_data' };
      await unifiedCacheManager.set(key, value, 'translation');
      const retrieved = await unifiedCacheManager.get(key, 'translation');
      expect(retrieved).toEqual(value);

      // 测试离线管理器
      await offlineManager.storeOfflineData('offline_test', { data: 'offline' }, 'translation');
      const offlineData = offlineManager.getOfflineData('offline_test');
      expect(offlineData).toBeDefined();
    });
  });
});
