import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIManager } from '../api/api-manager';
import { ProviderFactory } from '../api/provider-factory';
import { useConfigStore } from '../stores/config';
import { useCacheStore } from '../stores/cache';

// Mock dependencies
vi.mock('../api/provider-factory');
vi.mock('../stores/config');
vi.mock('../stores/cache');
vi.mock('../utils/error-handler');

describe('API管理器测试', () => {
  let apiManager: APIManager;
  let mockProvider: any;
  let mockConfigStore: any;
  let mockCacheStore: any;

  beforeEach(() => {
    // 重置单例
    (APIManager as any).instance = null;
    apiManager = APIManager.getInstance();

    // Mock provider
    mockProvider = {
      name: 'TestProvider',
      supportedFeatures: {
        textDetection: true,
        textTranslation: true,
      },
      initialize: vi.fn().mockResolvedValue(true),
      terminate: vi.fn().mockResolvedValue(true),
      validateConfig: vi.fn().mockResolvedValue({ isValid: true, message: '配置有效' }),
      detectText: vi.fn().mockResolvedValue([{ text: '测试文本', bbox: [0, 0, 100, 50] }]),
      translateText: vi.fn().mockImplementation((text) => {
        if (Array.isArray(text)) {
          return Promise.resolve(text.map(t => `翻译: ${t}`));
        }
        return Promise.resolve(`翻译: ${text}`);
      }),
    };

    // Mock ProviderFactory
    vi.mocked(ProviderFactory.createProvider).mockReturnValue(mockProvider);

    // Mock config store
    mockConfigStore = {
      providerType: 'test',
      providerConfig: {
        test: { apiKey: 'test-key' },
      },
    };
    vi.mocked(useConfigStore.getState).mockReturnValue(mockConfigStore);

    // Mock cache store
    mockCacheStore = {
      getOCRCache: vi.fn().mockReturnValue(null),
      setOCRCache: vi.fn(),
      getTranslationCache: vi.fn().mockReturnValue(null),
      setTranslationCache: vi.fn(),
      settings: {
        defaultTTL: 24 * 60 * 60 * 1000, // 24小时
      },
    };
    vi.mocked(useCacheStore.getState).mockReturnValue(mockCacheStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('初始化', () => {
    it('应该正确初始化API管理器', async () => {
      await apiManager.initialize();

      expect(ProviderFactory.createProvider).toHaveBeenCalledWith(
        'test',
        { apiKey: 'test-key' }
      );
      expect(mockProvider.initialize).toHaveBeenCalled();
    });

    it('应该在未配置提供者时抛出错误', async () => {
      mockConfigStore.providerType = null;

      await expect(apiManager.initialize()).rejects.toThrow('未配置API提供者');
    });
  });

  describe('提供者切换', () => {
    it('应该正确切换API提供者', async () => {
      await apiManager.initialize();

      const newProvider = { ...mockProvider, name: 'NewProvider' };
      vi.mocked(ProviderFactory.createProvider).mockReturnValue(newProvider);

      await apiManager.switchProvider('newProvider', { apiKey: 'new-key' });

      expect(mockProvider.terminate).toHaveBeenCalled();
      expect(ProviderFactory.createProvider).toHaveBeenCalledWith(
        'newProvider',
        { apiKey: 'new-key' }
      );
      expect(newProvider.initialize).toHaveBeenCalled();
    });
  });

  describe('文字检测', () => {
    beforeEach(async () => {
      await apiManager.initialize();
    });

    it('应该正确检测文字', async () => {
      const imageData = 'base64-image-data';
      const result = await apiManager.detectText(imageData);

      expect(mockProvider.detectText).toHaveBeenCalledWith(imageData, {});
      expect(result).toEqual([{ text: '测试文本', bbox: [0, 0, 100, 50] }]);
      expect(mockCacheStore.setOCRCache).toHaveBeenCalled();
    });

    it('应该使用缓存的OCR结果', async () => {
      const cachedResult = { text: '缓存文本', bbox: [0, 0, 100, 50] };
      mockCacheStore.getOCRCache.mockReturnValue({
        data: cachedResult,
        timestamp: Date.now(),
      });

      const imageData = 'base64-image-data';
      const result = await apiManager.detectText(imageData);

      expect(mockProvider.detectText).not.toHaveBeenCalled();
      expect(result).toEqual(cachedResult);
    });

    it('应该在提供者未初始化时抛出错误', async () => {
      const uninitializedManager = APIManager.getInstance();
      (uninitializedManager as any).currentProvider = null;

      await expect(uninitializedManager.detectText('image-data')).rejects.toThrow(
        'API提供者未初始化'
      );
    });
  });

  describe('文本翻译', () => {
    beforeEach(async () => {
      await apiManager.initialize();
    });

    it('应该正确翻译单个文本', async () => {
      const text = '测试文本';
      const result = await apiManager.translateText(text, 'en');

      expect(mockProvider.translateText).toHaveBeenCalledWith(text, 'en', {});
      expect(result).toBe('翻译: 测试文本');
      expect(mockCacheStore.setTranslationCache).toHaveBeenCalled();
    });

    it('应该正确翻译文本数组', async () => {
      const texts = ['文本1', '文本2'];
      const result = await apiManager.translateText(texts, 'en');

      expect(mockProvider.translateText).toHaveBeenCalledWith(texts, 'en', {});
      expect(result).toEqual(['翻译: 文本1', '翻译: 文本2']);
    });

    it('应该使用缓存的翻译结果', async () => {
      mockCacheStore.getTranslationCache.mockReturnValue({
        data: '缓存翻译',
        timestamp: Date.now(),
      });

      const text = '测试文本';
      const result = await apiManager.translateText(text, 'en');

      expect(mockProvider.translateText).not.toHaveBeenCalled();
      expect(result).toBe('缓存翻译');
    });

    it('应该处理部分缓存的情况', async () => {
      const texts = ['文本1', '文本2', '文本3'];

      // 模拟第二个文本有缓存
      mockCacheStore.getTranslationCache
        .mockReturnValueOnce(null) // 文本1无缓存
        .mockReturnValueOnce({ data: '缓存翻译2', timestamp: Date.now() }) // 文本2有缓存
        .mockReturnValueOnce(null); // 文本3无缓存

      // 模拟API只翻译未缓存的文本
      mockProvider.translateText.mockResolvedValue(['翻译: 文本1', '翻译: 文本3']);

      const result = await apiManager.translateText(texts, 'en');

      expect(result).toEqual(['翻译: 文本1', '缓存翻译2', '翻译: 文本3']);
      expect(mockProvider.translateText).toHaveBeenCalledWith(['文本1', '文本3'], 'en', {});
    });
  });

  describe('配置验证', () => {
    beforeEach(async () => {
      await apiManager.initialize();
    });

    it('应该正确验证提供者配置', async () => {
      const result = await apiManager.validateCurrentProvider();

      expect(mockProvider.validateConfig).toHaveBeenCalled();
      expect(result).toEqual({ isValid: true, message: '配置有效' });
    });

    it('应该在提供者未初始化时返回错误', async () => {
      (apiManager as any).currentProvider = null;

      const result = await apiManager.validateCurrentProvider();

      expect(result).toEqual({ isValid: false, message: 'API提供者未初始化' });
    });
  });

  describe('提供者信息', () => {
    beforeEach(async () => {
      await apiManager.initialize();
    });

    it('应该正确获取当前提供者信息', () => {
      const info = apiManager.getCurrentProviderInfo();

      expect(info).toEqual({
        name: 'TestProvider',
        features: {
          textDetection: true,
          textTranslation: true,
        },
      });
    });

    it('应该在提供者未初始化时返回null', () => {
      (apiManager as any).currentProvider = null;

      const info = apiManager.getCurrentProviderInfo();

      expect(info).toBeNull();
    });
  });

  describe('资源清理', () => {
    beforeEach(async () => {
      await apiManager.initialize();
    });

    it('应该正确清理资源', async () => {
      await apiManager.cleanup();

      expect(mockProvider.terminate).toHaveBeenCalled();
    });
  });

  describe('请求去重', () => {
    beforeEach(async () => {
      await apiManager.initialize();
    });

    it('应该对相同的OCR请求进行去重', async () => {
      const imageData = 'same-image-data';

      // 模拟慢速API调用
      let resolveDetection: (value: any) => void;
      const detectionPromise = new Promise(resolve => {
        resolveDetection = resolve;
      });
      mockProvider.detectText.mockReturnValue(detectionPromise);

      // 同时发起两个相同的请求
      const promise1 = apiManager.detectText(imageData);
      const promise2 = apiManager.detectText(imageData);

      // 解决API调用
      resolveDetection([{ text: '测试', bbox: [0, 0, 100, 50] }]);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // 应该只调用一次API
      expect(mockProvider.detectText).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });
  });
});
