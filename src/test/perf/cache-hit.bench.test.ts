/**
 * P4 perf baseline: cache hit path
 *
 * Verifies the "zero-delay" claim: cached translations should bypass
 * the LLM transport entirely. The hot path is just LRU hash lookup.
 *
 * We test the cache store directly rather than going through image
 * processing (which requires real image bytes and JSDOM canvas quirks).
 * End-to-end cold-vs-hot is covered by existing translator.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import { useUsageStore } from '@/stores/usage-store';

describe('P4 perf: cache hit path', () => {
  beforeEach(() => {
    useTranslationCacheStore.getState().clear();
    useUsageStore.getState().clearAll();
  });

  it('hot path: LRU lookup is sub-millisecond for 100 entries', () => {
    const cache = useTranslationCacheStore.getState();
    // Pre-fill 100 entries
    for (let i = 0; i < 100; i++) {
      cache.set(`hash-${i}`, { success: true, textAreas: [] }, 'openai-compatible');
    }

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const result = cache.get(`hash-${i}`);
      expect(result?.cached).toBe(true);
    }
    const elapsed = performance.now() - start;
    // 100 lookups in well under 50ms
    expect(elapsed).toBeLessThan(50);
  });

  it('hot path: get() returns cached: true flag', () => {
    const cache = useTranslationCacheStore.getState();
    cache.set('hash-1', { success: true, textAreas: [] }, 'openai-compatible');
    const result = cache.get('hash-1');
    expect(result).not.toBeNull();
    expect(result?.cached).toBe(true);
  });

  it('hot path: get() returns null for unknown key', () => {
    const cache = useTranslationCacheStore.getState();
    expect(cache.get('never-seen')).toBeNull();
  });

  it('cold path stats: 0 cached, 1 uncached = 0% hit rate', () => {
    useUsageStore.getState().clearAll();
    useUsageStore.getState().addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      cached: false,
    });
    const summary = useUsageStore.getState().getSummary();
    expect(summary.cacheHitRate).toBe(0);
  });

  it('cache hit rate: 3 cached + 2 uncached = 60%', () => {
    useUsageStore.getState().clearAll();
    for (let i = 0; i < 3; i++) {
      useUsageStore.getState().addRecord({
        provider: 'openai-compatible',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cached: true,
      });
    }
    for (let i = 0; i < 2; i++) {
      useUsageStore.getState().addRecord({
        provider: 'openai-compatible',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        cached: false,
      });
    }
    const summary = useUsageStore.getState().getSummary();
    expect(summary.cacheHitRate).toBeCloseTo(0.6, 1);
  });
});
