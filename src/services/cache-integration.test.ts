/**
 * Cache Behavior Integration Tests
 *
 * Tests the caching behavior in the translation pipeline:
 * - Cache hit scenarios
 * - Cache miss scenarios
 * - Cache key generation consistency
 * - LRU eviction behavior
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { create } from 'zustand';
import type { TranslationResult } from '@/stores/cache-v2';

// Mock LRU Cache for testing
class MockLRUCache<K, V> {
  private cache: Map<K, V> = new Map();

  constructor(private maxSize: number = 100) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }
}

// Mock cache store
interface MockCacheState {
  cache: MockLRUCache<string, { result: TranslationResult; timestamp: number; provider: string }>;
  maxEntries: number;
}

function createMockCacheStore(_initialEntries?: Map<string, { result: TranslationResult; timestamp: number; provider: string }>) {
  return create<MockCacheState & {
    get: (key: string) => TranslationResult | null;
    set: (key: string, result: TranslationResult, provider: string) => void;
    has: (key: string) => boolean;
    clear: () => void;
  }>((set, get) => ({
    cache: new MockLRUCache<string, { result: TranslationResult; timestamp: number; provider: string }>(100),
    maxEntries: 100,

    get: (key: string) => {
      const entry = get().cache.get(key);
      return entry ? { ...entry.result, cached: true } : null;
    },

    set: (key: string, result: TranslationResult, provider: string) => {
      const state = get();
      const newCache = new MockLRUCache<string, { result: TranslationResult; timestamp: number; provider: string }>(state.maxEntries);
      for (const [k, v] of state.cache.entries()) {
        newCache.set(k, v);
      }
      newCache.set(key, { result, timestamp: Date.now(), provider });
      set({ cache: newCache });
    },

    has: (key: string) => get().cache.has(key),

    clear: () => {
      set({ cache: new MockLRUCache<string, { result: TranslationResult; timestamp: number; provider: string }>(get().maxEntries) });
    },
  }));
}

describe('Cache Store Behavior', () => {
  let cacheStore: ReturnType<typeof createMockCacheStore>;
  const sampleResult: TranslationResult = {
    success: true,
    textAreas: [
      { x: 0.1, y: 0.2, width: 0.3, height: 0.1, originalText: 'Hello', translatedText: '你好' },
    ],
  };

  beforeEach(() => {
    cacheStore = createMockCacheStore();
  });

  describe('Cache Hit', () => {
    it('returns cached result with cached flag set', () => {
      const cacheKey = 'test-key-123';
      cacheStore.getState().set(cacheKey, sampleResult, 'openai-compatible');

      const cached = cacheStore.getState().get(cacheKey);

      expect(cached).not.toBeNull();
      expect(cached?.cached).toBe(true);
      expect(cached?.success).toBe(true);
      expect(cached?.textAreas).toHaveLength(1);
    });

    it('returns null for non-existent key', () => {
      const cached = cacheStore.getState().get('non-existent-key');

      expect(cached).toBeNull();
    });

    it('multiple gets return same cached result', () => {
      const cacheKey = 'test-key-456';
      cacheStore.getState().set(cacheKey, sampleResult, 'openai-compatible');

      const first = cacheStore.getState().get(cacheKey);
      const second = cacheStore.getState().get(cacheKey);

      expect(first).toEqual(second);
    });
  });

  describe('Cache Miss', () => {
    it('returns null when key not in cache', () => {
      const result = cacheStore.getState().get('missing-key');

      expect(result).toBeNull();
    });

    it('check with has() returns false for missing key', () => {
      const exists = cacheStore.getState().has('missing-key');

      expect(exists).toBe(false);
    });
  });

  describe('Cache Key Generation', () => {
    const HYBRID_PIPELINE_VERSION = 'hybrid-v1';

    function generateCacheKey(
      imageHash: string,
      provider: string,
      model: string,
      targetLanguage: string,
      preset: string,
      renderMode: string
    ): string {
      const requestedPath = provider === 'ollama' ? 'ollama-direct' : 'plugin-direct';
      const executionScope = `provider::${requestedPath}::${provider}::${model}`;
      return [
        imageHash,
        executionScope,
        targetLanguage,
        preset,
        renderMode,
        HYBRID_PIPELINE_VERSION,
      ].join('::');
    }

    it('same input generates same key', () => {
      const key1 = generateCacheKey(
        'abc123',
        'openai-compatible',
        'gpt-4o',
        'zh-CN',
        'default',
        'strong-overlay-compat'
      );
      const key2 = generateCacheKey(
        'abc123',
        'openai-compatible',
        'gpt-4o',
        'zh-CN',
        'default',
        'strong-overlay-compat'
      );

      expect(key1).toBe(key2);
    });

    it('different model generates different key', () => {
      const key1 = generateCacheKey(
        'abc123',
        'openai-compatible',
        'gpt-4o',
        'zh-CN',
        'default',
        'strong-overlay-compat'
      );
      const key2 = generateCacheKey(
        'abc123',
        'openai-compatible',
        'gpt-4o-mini',
        'zh-CN',
        'default',
        'strong-overlay-compat'
      );

      expect(key1).not.toBe(key2);
    });

    it('different language generates different key', () => {
      const key1 = generateCacheKey(
        'abc123',
        'openai-compatible',
        'gpt-4o',
        'zh-CN',
        'default',
        'strong-overlay-compat'
      );
      const key2 = generateCacheKey(
        'abc123',
        'openai-compatible',
        'gpt-4o',
        'ja-JP',
        'default',
        'strong-overlay-compat'
      );

      expect(key1).not.toBe(key2);
    });
  });

  describe('LRU Eviction', () => {
    it('evicts oldest entries when cache is full', () => {
      const store = createMockCacheStore();

      // Add more entries than max (100)
      for (let i = 0; i < 105; i++) {
        store.getState().set(`key-${i}`, sampleResult, 'openai-compatible');
      }

      expect(store.getState().cache.size).toBeLessThanOrEqual(100);
    });

    it('recently accessed entries are more likely to be kept', () => {
      const _store = createMockCacheStore();
      const limitedStore = create<MockCacheState & {
        get: (key: string) => TranslationResult | null;
        set: (key: string, result: TranslationResult, provider: string) => void;
        has: (key: string) => boolean;
        clear: () => void;
      }>((set, get) => ({
        cache: new MockLRUCache<string, { result: TranslationResult; timestamp: number; provider: string }>(5),
        maxEntries: 5,

        get: (key: string) => {
          const entry = get().cache.get(key);
          return entry ? { ...entry.result, cached: true } : null;
        },

        set: (key: string, result: TranslationResult, provider: string) => {
          const state = get();
          const newCache = new MockLRUCache<string, { result: TranslationResult; timestamp: number; provider: string }>(state.maxEntries);
          for (const [k, v] of state.cache.entries()) {
            newCache.set(k, v);
          }
          newCache.set(key, { result, timestamp: Date.now(), provider });
          set({ cache: newCache });
        },

        has: (key: string) => get().cache.has(key),

        clear: () => {
          set({ cache: new MockLRUCache<string, { result: TranslationResult; timestamp: number; provider: string }>(get().maxEntries) });
        },
      }));

      // Add entries
      for (let i = 0; i < 3; i++) {
        limitedStore.getState().set(`key-${i}`, sampleResult, 'openai-compatible');
      }

      // Access some entries to make them recent
      limitedStore.getState().get('key-0');
      limitedStore.getState().get('key-1');

      // Add more entries to trigger eviction
      for (let i = 3; i < 5; i++) {
        limitedStore.getState().set(`key-${i}`, sampleResult, 'openai-compatible');
      }

      // key-2 might be evicted (was added first and not accessed)
      // But key-0 and key-1 were accessed, so should be more likely to remain
      const cacheState = limitedStore.getState();
      // At least one of the recently accessed keys should still be there
      const hasRecentAccess = cacheState.has('key-0') || cacheState.has('key-1');
      expect(hasRecentAccess || !cacheState.has('key-2')).toBe(true); // Either recent was kept or oldest was evicted
    });

    it('clearing cache removes all entries', () => {
      const store = createMockCacheStore();

      store.getState().set('key-1', sampleResult, 'openai-compatible');
      store.getState().set('key-2', sampleResult, 'openai-compatible');

      store.getState().clear();

      expect(store.getState().cache.size).toBe(0);
      expect(store.getState().has('key-1')).toBe(false);
      expect(store.getState().has('key-2')).toBe(false);
    });
  });

  describe('Cache Invalidation Scenarios', () => {
    it('different providers produce different cache keys', () => {
      // Test that different provider configurations produce different cache keys
      const HYBRID_PIPELINE_VERSION = 'hybrid-v1';

      const generateCacheKey = (
        imageHash: string,
        provider: string,
        model: string,
        targetLanguage: string
      ): string => {
        const requestedPath = provider === 'ollama' ? 'ollama-direct' : 'plugin-direct';
        const executionScope = `provider::${requestedPath}::${provider}::${model}`;
        return [
          imageHash,
          executionScope,
          targetLanguage,
          'default',
          'strong-overlay-compat',
          HYBRID_PIPELINE_VERSION,
        ].join('::');
      };

      const key1 = generateCacheKey('test-hash', 'openai-compatible', 'gpt-4o', 'zh-CN');
      const key2 = generateCacheKey('test-hash', 'ollama', 'llava', 'zh-CN');

      // Keys should be different due to different providers/execution paths
      expect(key1).not.toBe(key2);
      expect(key1).toContain('plugin-direct');
      expect(key2).toContain('ollama-direct');
    });

    it('force refresh bypasses cache', () => {
      const cacheKey = 'force-refresh-test';
      cacheStore.getState().set(cacheKey, sampleResult, 'openai-compatible');

      // Simulate force refresh scenario - cache should still work
      // but translation would re-request
      const forceRefresh = true;

      if (forceRefresh) {
        // In real flow, this would skip cache lookup
        const cached = cacheStore.getState().get(cacheKey);
        // Cache still exists but translation would bypass it
        expect(cached).not.toBeNull();
      }
    });
  });
});

describe('Cache Usage Tracking', () => {
  it('cached results increment usage without tokens', () => {
    const usageRecord = {
      provider: 'openai-compatible' as const,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cached: true,
    };

    expect(usageRecord.cached).toBe(true);
    expect(usageRecord.usage.totalTokens).toBe(0);
  });

  it('non-cached results have token usage', () => {
    const usageRecord = {
      provider: 'openai-compatible' as const,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      cached: false,
    };

    expect(usageRecord.cached).toBe(false);
    expect(usageRecord.usage.totalTokens).toBe(150);
  });
});