import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataMigration, initializeDataMigration } from '@/utils/data-migration';
import { useConfigStore } from '@/stores/config';
import { useTranslationStore } from '@/stores/translation';
import { useCacheStore } from '@/stores/cache';

// Mock Chrome APIs
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
};

// 设置全局 chrome 对象
Object.defineProperty(globalThis, 'chrome', {
  value: mockChrome,
  writable: true,
});

describe('Data Migration', () => {
  let migration: DataMigration;

  beforeEach(() => {
    migration = DataMigration.getInstance();

    // 重置所有stores
    useConfigStore.getState().resetToDefaults();
    useTranslationStore.setState({
      enabled: false,
      mode: 'manual',
      targetLanguage: 'zh-CN',
      processing: false,
      currentImage: null,
      translatedImages: new Map(),
      history: [],
    });
    useCacheStore.getState().clearAllCache();

    // 重置mock
    vi.clearAllMocks();
  });

  describe('needsMigration', () => {
    it('应该检测到需要迁移的v0.1数据', async () => {
      // 模拟v0.1格式的数据
      mockChrome.storage.sync.get.mockResolvedValue({
        providerType: 'openai',
        providerConfig: {
          openai: {
            apiKey: 'test-key',
            baseUrl: 'https://api.openai.com/v1',
          },
        },
      });

      mockChrome.storage.local.get.mockResolvedValue({
        'manga-translator-migration-status': {
          version: '0.0.0',
          completed: false,
        },
      });

      const needsMigration = await migration.needsMigration();
      expect(needsMigration).toBe(true);
    });

    it('应该识别已完成迁移的数据', async () => {
      mockChrome.storage.sync.get.mockResolvedValue({});
      mockChrome.storage.local.get.mockResolvedValue({
        'manga-translator-migration-status': {
          version: '0.2.0',
          completed: true,
        },
      });

      const needsMigration = await migration.needsMigration();
      expect(needsMigration).toBe(false);
    });
  });

  describe('migrate', () => {
    it('应该成功迁移配置数据', async () => {
      // 模拟v0.1配置数据
      const v01ConfigData = {
        providerType: 'deepseek',
        providerConfig: {
          deepseek: {
            apiKey: 'test-deepseek-key',
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-vl',
          },
        },
        styleLevel: 75,
        fontFamily: 'Arial',
        advancedSettings: {
          debugMode: true,
          maxCacheSize: 100,
        },
      };

      // 设置mock返回值
      mockChrome.storage.sync.get.mockResolvedValue(v01ConfigData);
      mockChrome.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys)) {
          if (keys.includes('manga-translator-migration-status')) {
            return Promise.resolve({});
          }
        }
        return Promise.resolve({});
      });

      // 执行迁移
      await migration.migrate();

      // 验证配置是否正确迁移
      const configState = useConfigStore.getState();
      expect(configState.providerType).toBe('deepseek');
      expect(configState.styleLevel).toBe(75);
      expect(configState.fontFamily).toBe('Arial');
      expect(configState.advancedSettings.debugMode).toBe(true);
      expect(configState.advancedSettings.maxCacheSize).toBe(100);

      // 验证API配置是否正确规范化
      const deepseekConfig = configState.providerConfig.deepseek;
      expect(deepseekConfig.apiKey).toBe('test-deepseek-key');
      expect(deepseekConfig.apiBaseUrl).toBe('https://api.deepseek.com/v1');
      expect(deepseekConfig.visionModel).toBe('deepseek-vl');
    });

    it('应该成功迁移翻译数据', async () => {
      // 模拟v0.1翻译数据
      const v01TranslationData = {
        translationState: {
          enabled: true,
          mode: 'auto',
          targetLanguage: 'en',
        },
        translationHistory: [
          {
            imageUrl: 'test-image.jpg',
            originalText: 'テスト',
            translatedText: 'Test',
            targetLanguage: 'en',
          },
        ],
        translatedImages: {
          'hash123': {
            imageUrl: 'test-image.jpg',
            originalText: 'テスト',
            translatedText: 'Test',
            targetLanguage: 'en',
          },
        },
      };

      mockChrome.storage.sync.get.mockResolvedValue({});
      mockChrome.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys)) {
          if (keys.includes('manga-translator-migration-status')) {
            return Promise.resolve({});
          }
          if (keys.includes('translationState')) {
            return Promise.resolve(v01TranslationData);
          }
          if (keys.includes('translationCache')) {
            return Promise.resolve({});
          }
        }
        return Promise.resolve({});
      });

      await migration.migrate();

      // 验证翻译状态
      const translationState = useTranslationStore.getState();
      expect(translationState.enabled).toBe(true);
      expect(translationState.mode).toBe('auto');
      expect(translationState.targetLanguage).toBe('en');

      // 验证历史记录
      expect(translationState.history).toHaveLength(1);
      expect(translationState.history[0].originalText).toBe('テスト');
      expect(translationState.history[0].translatedText).toBe('Test');

      // 验证翻译图像映射
      const translatedImage = translationState.getTranslatedImage('hash123');
      expect(translatedImage).toBeDefined();
      expect(translatedImage?.originalText).toBe('テスト');
    });

    it('应该成功迁移缓存数据', async () => {
      // 模拟v0.1缓存数据
      const v01CacheData = {
        translationCache: {
          'cache-key-1': {
            data: { text: '翻译结果1' },
            timestamp: Date.now() - 1000,
            expiresAt: Date.now() + 60000, // 1分钟后过期
          },
        },
        imageCache: {
          'image-key-1': {
            data: { url: 'image-data' },
            timestamp: Date.now() - 2000,
          },
        },
        ocrCache: {
          'ocr-key-1': {
            data: { text: 'OCR结果' },
            timestamp: Date.now() - 3000,
            expiresAt: Date.now() - 1000, // 已过期
          },
        },
      };

      // 设置mock返回值，确保每次调用都返回正确的数据
      mockChrome.storage.sync.get.mockResolvedValue({});
      mockChrome.storage.local.get.mockImplementation((keys) => {
        if (Array.isArray(keys)) {
          if (keys.includes('manga-translator-migration-status')) {
            return Promise.resolve({});
          }
          if (keys.includes('translationState')) {
            return Promise.resolve({});
          }
          if (keys.includes('translationCache')) {
            return Promise.resolve(v01CacheData);
          }
        }
        return Promise.resolve({});
      });

      await migration.migrate();

      // 验证缓存迁移
      const cacheState = useCacheStore.getState();

      // 有效缓存应该被迁移
      expect(cacheState.getTranslationCache('cache-key-1')).toEqual({ text: '翻译结果1' });
      expect(cacheState.getImageCache('image-key-1')).toEqual({ url: 'image-data' });

      // 过期缓存不应该被迁移
      expect(cacheState.getOCRCache('ocr-key-1')).toBeNull();
    });
  });

  describe('initializeDataMigration', () => {
    it('应该在需要时执行迁移', async () => {
      mockChrome.storage.sync.get.mockResolvedValue({
        providerType: 'openai',
      });
      mockChrome.storage.local.get.mockResolvedValue({});

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

      await initializeDataMigration();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('检测到需要数据迁移')
      );

      consoleSpy.mockRestore();
    });

    it('应该跳过不需要的迁移', async () => {
      mockChrome.storage.sync.get.mockResolvedValue({});
      mockChrome.storage.local.get.mockResolvedValue({
        'manga-translator-migration-status': {
          version: '0.2.0',
          completed: true,
        },
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

      await initializeDataMigration();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('数据已是最新版本')
      );

      consoleSpy.mockRestore();
    });
  });
});
