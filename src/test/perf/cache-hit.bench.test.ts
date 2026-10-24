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
      cache.set(
        `hash-${i}`,
        { success: true, textAreas: [] },
        'openai-compatible'
      );
    }

    /*
     * 这个断言量的是缓存，还是量这台机器？
     *
     * 一轮 100 次查找跑出 80ms，单次 0.8ms —— 一个 Map 查找不可能这么慢，
     * 慢的是这个测试文件和另外 76 个测试文件一起抢 CPU。计时断言在负载
     * 下量的是机器，不是代码，于是它随机变红，而它变红的时候没有任何
     * 人改了缓存。
     *
     * 所以：先热身（第一次调用要编译），再取多轮里最快的一轮。噪声只会
     * 让一轮变慢，不会让它变快，最小值是负载下唯一稳定的量。断言也从
     * 计时区间里拿出去 —— expect() 的开销不是查找的开销。
     */
    const run = (): number => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        cache.get(`hash-${i}`);
      }
      return performance.now() - start;
    };

    run(); // 热身：把 JIT 和缓存的首次访问成本排除在外

    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i++) {
      best = Math.min(best, run());
    }

    // 100 次命中查找在 10ms 以内 —— 缓存命中这条路不是瓶颈。
    expect(best).toBeLessThan(10);

    // 命中本身还是要验的，只是别让它占用计时区间。
    for (let i = 0; i < 100; i++) {
      expect(cache.get(`hash-${i}`)?.cached).toBe(true);
    }
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
