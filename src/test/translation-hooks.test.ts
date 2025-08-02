import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useTranslateText,
  useBatchTranslation,
  useTranslationHistory,
  useTranslationCache,
  usePrefetchTranslation
} from '../hooks/useTranslation';
import { APIManager } from '../utils/api-manager';
import { performanceMetricsCollector } from '../utils/performance-metrics';

// Mock Chrome API
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
};

// @ts-ignore
global.chrome = mockChrome;

// Mock API Manager
vi.mock('../utils/api-manager', () => ({
  APIManager: {
    getInstance: vi.fn(() => ({
      translateText: vi.fn(),
      isConfigured: vi.fn(() => true),
      getCurrentProvider: vi.fn(() => 'openai'),
    })),
  },
}));

// Mock performance metrics
vi.mock('../utils/performance-metrics', () => ({
  performanceMetricsCollector: {
    recordMetric: vi.fn(),
    recordAPIMetric: vi.fn(),
    recordTranslationMetric: vi.fn(),
  },
}));

// Mock cache managers
vi.mock('../utils/cache-warmup', () => ({
  cacheWarmupManager: {
    recordUserBehavior: vi.fn(),
  },
}));

vi.mock('../utils/unified-cache-manager', () => ({
  unifiedCacheManager: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../utils/offline-manager', () => ({
  offlineManager: {
    getOfflineData: vi.fn(),
  },
}));

describe('翻译钩子测试', () => {
  let queryClient: QueryClient;
  let mockApiManager: any;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    mockApiManager = {
      translateText: vi.fn(),
      isConfigured: vi.fn(() => true),
      getCurrentProvider: vi.fn(() => 'openai'),
    };

    vi.mocked(APIManager.getInstance).mockReturnValue(mockApiManager);

    // 重置 mocks
    vi.clearAllMocks();
    mockChrome.storage.local.get.mockResolvedValue({});
    mockChrome.storage.local.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client= { queryClient } > { children } </QueryClientProvider>
  );

describe('useTranslateText', () => {
  it('应该成功翻译文本', async () => {
    const mockTranslationResult = ['翻译结果'];
    mockApiManager.translateText.mockResolvedValue(mockTranslationResult);

    const { result } = renderHook(
      () => useTranslateText({
        text: 'Hello',
        targetLang: 'zh',
        sourceLanguage: 'en',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({
      translatedText: '翻译结果',
      sourceLanguage: 'en',
    });

    expect(mockApiManager.translateText).toHaveBeenCalledWith(
      ['Hello'],
      'zh',
      {
        sourceLanguage: 'en',
        context: undefined,
      }
    );
  });

  it('应该记录性能指标', async () => {
    const mockTranslationResult = ['翻译结果'];
    mockApiManager.translateText.mockResolvedValue(mockTranslationResult);

    const { result } = renderHook(
      () => useTranslateText({
        text: 'Hello',
        targetLang: 'zh',
        sourceLanguage: 'en',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(performanceMetricsCollector.recordTranslationMetric).toHaveBeenCalled();
  });

  it('应该处理缓存命中', async () => {
    const cachedResult = {
      translatedText: '缓存的翻译结果',
      sourceLanguage: 'en',
    };

    // Mock cache hit
    const { unifiedCacheManager } = await import('../utils/unified-cache-manager');
    vi.mocked(unifiedCacheManager.get).mockResolvedValue(cachedResult);

    const { result } = renderHook(
      () => useTranslateText({
        text: 'Hello',
        targetLang: 'zh',
        sourceLanguage: 'en',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(cachedResult);
    expect(mockApiManager.translateText).not.toHaveBeenCalled();
  });

  it('应该处理API错误', async () => {
    mockApiManager.translateText.mockRejectedValue(new Error('API Error'));

    const { result } = renderHook(
      () => useTranslateText({
        text: 'Hello',
        targetLang: 'zh',
        sourceLanguage: 'en',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(performanceMetricsCollector.recordTranslationMetric).toHaveBeenCalledWith(
      'translation_error',
      expect.any(Number),
      expect.objectContaining({
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        textLength: 5,
        provider: 'api',
        cacheHit: false,
      })
    );
  });

  it('应该在禁用时不执行查询', () => {
    const { result } = renderHook(
      () => useTranslateText({
        text: 'Hello',
        targetLang: 'zh',
      }, false),
      { wrapper }
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockApiManager.translateText).not.toHaveBeenCalled();
  });

  it('应该在缺少必需参数时不执行查询', () => {
    const { result } = renderHook(
      () => useTranslateText({
        text: '',
        targetLang: 'zh',
      }),
      { wrapper }
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockApiManager.translateText).not.toHaveBeenCalled();
  });
});

describe('useBatchTranslation', () => {
  it('应该成功批量翻译', async () => {
    const mockTranslationResults = ['结果1', '结果2', '结果3'];
    mockApiManager.translateText.mockResolvedValue(mockTranslationResults);

    const { result } = renderHook(
      () => useBatchTranslation(),
      { wrapper }
    );

    const texts = ['Text 1', 'Text 2', 'Text 3'];
    const targetLang = 'zh';

    result.current.mutate({ texts, targetLang });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([
      { original: 'Text 1', translated: '结果1' },
      { original: 'Text 2', translated: '结果2' },
      { original: 'Text 3', translated: '结果3' },
    ]);

    expect(mockApiManager.translateText).toHaveBeenCalledWith(
      texts,
      targetLang,
      expect.any(Object)
    );
  });

  it('应该处理批量翻译错误', async () => {
    mockApiManager.translateText.mockRejectedValue(new Error('Batch Error'));

    const { result } = renderHook(
      () => useBatchTranslation(),
      { wrapper }
    );

    result.current.mutate({
      texts: ['Text 1', 'Text 2'],
      targetLang: 'zh',
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useTranslationHistory', () => {
  it('应该返回翻译历史', async () => {
    const mockHistory = [
      {
        id: '1',
        originalText: 'Hello',
        translatedText: '你好',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        timestamp: Date.now(),
      },
    ];

    mockChrome.storage.local.get.mockResolvedValue({
      translationHistory: mockHistory,
    });

    const { result } = renderHook(() => useTranslationHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockHistory);
  });

  it('应该处理空历史', async () => {
    mockChrome.storage.local.get.mockResolvedValue({});

    const { result } = renderHook(() => useTranslationHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });
});

describe('useTranslationCache', () => {
  it('应该返回缓存统计信息', async () => {
    const { result } = renderHook(() => useTranslationCache(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data).toHaveProperty('size');
    expect(result.current.data).toHaveProperty('hitRate');
  });

  it('应该能够清理缓存', async () => {
    const { result } = renderHook(() => useTranslationCache(), { wrapper });

    await waitFor(() => {
      expect(result.current.clearCache).toBeDefined();
    });

    result.current.clearCache.mutate();

    await waitFor(() => {
      expect(result.current.clearCache.isSuccess).toBe(true);
    });
  });
});

describe('usePrefetchTranslation', () => {
  it('应该能够预取翻译', async () => {
    const mockTranslationResult = ['预取结果'];
    mockApiManager.translateText.mockResolvedValue(mockTranslationResult);

    const { result } = renderHook(() => usePrefetchTranslation(), { wrapper });

    result.current({
      text: 'Prefetch text',
      targetLang: 'zh',
      sourceLanguage: 'en',
    });

    // 等待预取完成
    await waitFor(() => {
      expect(mockApiManager.translateText).toHaveBeenCalled();
    });

    expect(mockApiManager.translateText).toHaveBeenCalledWith(
      ['Prefetch text'],
      'zh',
      {
        sourceLanguage: 'en',
        context: undefined,
      }
    );
  });
});

describe('集成测试', () => {
  it('应该正确处理完整的翻译流程', async () => {
    const mockTranslationResult = ['完整流程测试'];
    mockApiManager.translateText.mockResolvedValue(mockTranslationResult);

    // 1. 执行翻译
    const { result: translateResult } = renderHook(
      () => useTranslateText({
        text: 'Integration test',
        targetLang: 'zh',
        sourceLanguage: 'en',
      }),
      { wrapper }
    );

    await waitFor(() => {
      expect(translateResult.current.isSuccess).toBe(true);
    });

    // 2. 检查历史记录
    const { result: historyResult } = renderHook(
      () => useTranslationHistory(),
      { wrapper }
    );

    await waitFor(() => {
      expect(historyResult.current.isSuccess).toBe(true);
    });

    // 3. 检查缓存状态
    const { result: cacheResult } = renderHook(
      () => useTranslationCache(),
      { wrapper }
    );

    await waitFor(() => {
      expect(cacheResult.current.data).toBeDefined();
    });

    // 验证所有组件都正常工作
    expect(translateResult.current.data?.translatedText).toBe('完整流程测试');
    expect(performanceMetricsCollector.recordTranslationMetric).toHaveBeenCalled();
  });
});
});
