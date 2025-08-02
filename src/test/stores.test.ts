import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTranslationStore } from '@/stores/translation';
import { useConfigStore } from '@/stores/config';
import { useCacheStore } from '@/stores/cache';

// Mock Chrome APIs
const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
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

describe('Translation Store', () => {
  beforeEach(() => {
    // 重置store状态
    useTranslationStore.setState({
      enabled: false,
      mode: 'manual',
      targetLanguage: 'zh-CN',
      processing: false,
      currentImage: null,
      translatedImages: new Map(),
      history: [],
    });
  });

  it('应该能够设置基本状态', () => {
    const store = useTranslationStore.getState();
    
    store.setEnabled(true);
    expect(useTranslationStore.getState().enabled).toBe(true);
    
    store.setMode('auto');
    expect(useTranslationStore.getState().mode).toBe('auto');
    
    store.setTargetLanguage('en');
    expect(useTranslationStore.getState().targetLanguage).toBe('en');
    
    store.setProcessing(true);
    expect(useTranslationStore.getState().processing).toBe(true);
  });

  it('应该能够管理翻译历史', () => {
    const store = useTranslationStore.getState();
    
    const historyItem = {
      imageUrl: 'test-image.jpg',
      originalText: '原文',
      translatedText: '翻译文本',
      targetLanguage: 'zh-CN',
    };
    
    store.addToHistory(historyItem);
    
    const history = useTranslationStore.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject(historyItem);
    expect(history[0].id).toBeDefined();
    expect(history[0].timestamp).toBeDefined();
  });

  it('应该能够管理翻译图像映射', () => {
    const store = useTranslationStore.getState();
    
    const translationItem = {
      id: 'test-id',
      imageUrl: 'test-image.jpg',
      originalText: '原文',
      translatedText: '翻译文本',
      targetLanguage: 'zh-CN',
      timestamp: Date.now(),
    };
    
    store.addTranslatedImage('test-hash', translationItem);
    
    const retrieved = store.getTranslatedImage('test-hash');
    expect(retrieved).toEqual(translationItem);
    
    store.removeTranslatedImage('test-hash');
    expect(store.getTranslatedImage('test-hash')).toBeUndefined();
  });
});

describe('Config Store', () => {
  beforeEach(() => {
    // 重置store到默认状态
    useConfigStore.getState().resetToDefaults();
  });

  it('应该能够设置API提供者', () => {
    const store = useConfigStore.getState();
    
    store.setProviderType('deepseek');
    expect(useConfigStore.getState().providerType).toBe('deepseek');
  });

  it('应该能够更新提供者配置', () => {
    const store = useConfigStore.getState();
    
    store.updateProviderConfig('openai', {
      apiKey: 'test-key',
      temperature: 0.5,
    });
    
    const config = useConfigStore.getState().providerConfig.openai;
    expect(config.apiKey).toBe('test-key');
    expect(config.temperature).toBe(0.5);
  });

  it('应该能够获取活跃提供者配置', () => {
    const store = useConfigStore.getState();
    
    store.setProviderType('openai');
    store.setProviderApiKey('openai', 'test-api-key');
    
    const activeConfig = store.getActiveProviderConfig();
    expect(activeConfig.apiKey).toBe('test-api-key');
  });

  it('应该能够更新高级设置', () => {
    const store = useConfigStore.getState();
    
    store.updateAdvancedSettings({
      debugMode: true,
      maxCacheSize: 100,
    });
    
    const settings = useConfigStore.getState().advancedSettings;
    expect(settings.debugMode).toBe(true);
    expect(settings.maxCacheSize).toBe(100);
  });
});

describe('Cache Store', () => {
  beforeEach(() => {
    // 清空缓存
    useCacheStore.getState().clearAllCache();
  });

  it('应该能够设置和获取翻译缓存', () => {
    const store = useCacheStore.getState();
    const testData = { text: '测试翻译' };
    
    store.setTranslationCache('test-key', testData);
    const retrieved = store.getTranslationCache('test-key');
    
    expect(retrieved).toEqual(testData);
  });

  it('应该能够处理缓存过期', () => {
    const store = useCacheStore.getState();
    const testData = { text: '测试翻译' };
    
    // 设置1毫秒TTL的缓存
    store.setTranslationCache('test-key', testData, 1);
    
    // 等待过期
    setTimeout(() => {
      const retrieved = store.getTranslationCache('test-key');
      expect(retrieved).toBeNull();
    }, 10);
  });

  it('应该能够获取缓存统计', () => {
    const store = useCacheStore.getState();
    
    store.setTranslationCache('key1', { data: 'test1' });
    store.setImageCache('key2', { data: 'test2' });
    store.setOCRCache('key3', { data: 'test3' });
    
    const stats = store.getCacheStats();
    expect(stats.translationCount).toBe(1);
    expect(stats.imageCount).toBe(1);
    expect(stats.ocrCount).toBe(1);
    expect(stats.totalSize).toBe(3);
  });

  it('应该能够清理过期缓存', () => {
    const store = useCacheStore.getState();
    
    // 设置一个正常缓存和一个过期缓存
    store.setTranslationCache('normal-key', { data: 'normal' });
    store.setTranslationCache('expired-key', { data: 'expired' }, 1);
    
    // 等待过期后清理
    setTimeout(() => {
      store.cleanExpiredCache();
      
      expect(store.getTranslationCache('normal-key')).toBeTruthy();
      expect(store.getTranslationCache('expired-key')).toBeNull();
    }, 10);
  });
});
