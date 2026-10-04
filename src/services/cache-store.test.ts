/**
 * Cache behaviour against the real `LRUCache` and the real store.
 *
 * The file this replaces (404 lines) defined its own `MockLRUCache` and its
 * own `createMockCacheStore`, then asserted on those. It exercised none of
 * `src/stores/cache-v2.ts` or `src/utils/lru-cache.ts`, so a regression in
 * either would have been invisible.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationResult } from '@/stores/cache-v2';

const storage: Record<string, unknown> = {};

function installChromeMock(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in storage) {
              out[key] = storage[key];
            }
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storage[key];
          }
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { id: 'cache-store-test' },
  };
}

function settle(ms = 60): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadCacheStore() {
  vi.resetModules();
  const mod = await import('@/stores/cache-v2');
  await settle();
  return mod;
}

const SAMPLE_RESULT: TranslationResult = {
  success: true,
  textAreas: [
    {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      originalText: 'Hello',
      translatedText: '你好',
    },
  ],
};

describe('translation cache store', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) {
      delete storage[key];
    }
    installChromeMock();
  });

  it('returns a stored result and flags it as cached', async () => {
    const { useTranslationCacheStore } = await loadCacheStore();
    useTranslationCacheStore
      .getState()
      .set('key-1', SAMPLE_RESULT, 'openai-compatible');
    const cached = useTranslationCacheStore.getState().get('key-1');
    expect(cached).not.toBeNull();
    expect(cached?.cached).toBe(true);
    expect(cached?.success).toBe(true);
    expect(cached?.textAreas[0]?.translatedText).toBe('你好');
  });

  it('reports a miss for an unknown key', async () => {
    const { useTranslationCacheStore } = await loadCacheStore();
    expect(useTranslationCacheStore.getState().get('nope')).toBeNull();
    expect(useTranslationCacheStore.getState().has('nope')).toBe(false);
  });

  it('overwrites an existing entry rather than duplicating it', async () => {
    const { useTranslationCacheStore } = await loadCacheStore();
    const store = useTranslationCacheStore.getState();
    store.set('key-1', SAMPLE_RESULT, 'openai-compatible');
    const updated: TranslationResult = {
      success: true,
      textAreas: [
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
          originalText: 'Hello',
          translatedText: '更新',
        },
      ],
    };
    store.set('key-1', updated, 'openai-compatible');
    const state = useTranslationCacheStore.getState();
    expect(state.entries()).toHaveLength(1);
    expect(state.get('key-1')?.textAreas[0]?.translatedText).toBe('更新');
  });

  it('removes a single entry and clears everything', async () => {
    const { useTranslationCacheStore } = await loadCacheStore();
    const store = useTranslationCacheStore.getState();
    store.set('a', SAMPLE_RESULT, 'openai-compatible');
    store.set('b', SAMPLE_RESULT, 'openai-compatible');
    expect(useTranslationCacheStore.getState().entries()).toHaveLength(2);
    useTranslationCacheStore.getState().remove('a');
    expect(useTranslationCacheStore.getState().has('a')).toBe(false);
    expect(useTranslationCacheStore.getState().has('b')).toBe(true);
    useTranslationCacheStore.getState().clear();
    expect(useTranslationCacheStore.getState().entries()).toHaveLength(0);
  });

  it('evicts the least recently used entry past the limit', async () => {
    const { useTranslationCacheStore } = await loadCacheStore();
    const store = useTranslationCacheStore.getState();
    store.setMaxEntries(3);
    store.set('a', SAMPLE_RESULT, 'openai-compatible');
    store.set('b', SAMPLE_RESULT, 'openai-compatible');
    store.set('c', SAMPLE_RESULT, 'openai-compatible');
    // Touch 'a' so 'b' becomes the least recently used.
    useTranslationCacheStore.getState().get('a');
    useTranslationCacheStore
      .getState()
      .set('d', SAMPLE_RESULT, 'openai-compatible');
    const state = useTranslationCacheStore.getState();
    expect(state.entries()).toHaveLength(3);
    expect(state.has('b')).toBe(false);
    expect(state.has('a')).toBe(true);
    expect(state.has('c')).toBe(true);
    expect(state.has('d')).toBe(true);
  });

  it('reports statistics that reflect the stored entries', async () => {
    const { useTranslationCacheStore } = await loadCacheStore();
    const store = useTranslationCacheStore.getState();
    store.setMaxEntries(10);
    store.set('a', SAMPLE_RESULT, 'openai-compatible');
    const stats = useTranslationCacheStore.getState().getStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.maxEntries).toBe(10);
    expect(stats.oldestEntry).not.toBeNull();
    expect(stats.newestEntry).not.toBeNull();
  });

  it('stores the result marked as not-cached for later reads', async () => {
    const { useTranslationCacheStore } = await loadCacheStore();
    useTranslationCacheStore
      .getState()
      .set('key-1', { ...SAMPLE_RESULT, cached: false }, 'openai-compatible');
    const entries = useTranslationCacheStore.getState().entries();
    expect(entries[0]?.[1].result.cached).toBe(false);
  });
});
