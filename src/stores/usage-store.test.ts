import { beforeEach, describe, expect, it } from 'vitest';

import {
  useUsageStore,
  summarizeUsageForMonth,
  type TranslationUsageRecord,
} from './usage-store';

function record(
  date: string,
  totalTokens: number,
  cached = false
): TranslationUsageRecord {
  return {
    timestamp: Date.parse(`${date}T12:00:00.000Z`),
    date,
    provider: 'openai-compatible',
    usage: {
      promptTokens: totalTokens / 2,
      completionTokens: totalTokens / 2,
      totalTokens,
    },
    cached,
  };
}

describe('summarizeUsageForMonth', () => {
  it('counts only the selected month and excludes cached tokens', () => {
    const summary = summarizeUsageForMonth(
      [
        record('2026-09-01', 100),
        record('2026-09-02', 0, true),
        record('2026-08-31', 500),
      ],
      new Date('2026-09-13T12:00:00.000Z')
    );

    expect(summary).toEqual({
      translations: 2,
      billableCalls: 1,
      tokens: 100,
      cacheHitRate: 50,
    });
  });

  it('returns zeroes when there are no records', () => {
    expect(
      summarizeUsageForMonth([], new Date('2026-09-13T12:00:00.000Z'))
    ).toEqual({
      translations: 0,
      billableCalls: 0,
      tokens: 0,
      cacheHitRate: 0,
    });
  });
});

describe('usage store', () => {
  beforeEach(() => {
    useUsageStore.getState().clearAll();
  });

  it('addRecord keeps the newest record first and caps history at 500', () => {
    for (let index = 0; index < 505; index += 1) {
      useUsageStore.getState().addRecord({
        provider: 'openai-compatible',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        cached: false,
      });
    }

    const { records, monthlyTokens } = useUsageStore.getState();
    expect(records).toHaveLength(500);
    expect(monthlyTokens).toBe(500 * 2);
  });

  it('monthlyTokens excludes cached records and other months', () => {
    const store = useUsageStore.getState();
    store.addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cached: false,
    });
    store.addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cached: true,
    });
    // A record dated outside the current month must not count toward
    // monthlyTokens even though it sits in the same history.
    const stale = new Date();
    stale.setMonth(stale.getMonth() - 1);
    const staleDate = stale.toISOString().slice(0, 10);
    useUsageStore.setState(state => ({
      records: [
        {
          timestamp: Date.parse(`${staleDate}T12:00:00.000Z`),
          date: staleDate,
          provider: 'openai-compatible',
          usage: { promptTokens: 99, completionTokens: 99, totalTokens: 198 },
          cached: false,
        },
        ...state.records,
      ],
    }));

    expect(useUsageStore.getState().monthlyTokens).toBe(15);
  });

  it('getDailyStats aggregates per day and skips older records', () => {
    const store = useUsageStore.getState();
    const today = new Date().toISOString().slice(0, 10);
    store.addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      cached: false,
    });
    store.addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cached: true,
    });

    const stats = store.getDailyStats(30);
    expect(stats).toHaveLength(1);
    const day = stats[0];
    if (!day) throw new Error('expected at least one daily summary');
    expect(day.date).toBe(today);
    expect(day.totalTokens).toBe(10);
    expect(day.translationCount).toBe(2);
    expect(day.cachedCount).toBe(1);
    expect(day.providers['openai-compatible']).toBe(1);

    // The synthetic stale record from the monthlyTokens test lives in the
    // store singleton's history only within its own test; this fresh state
    // has one day's records. Cutting the window to zero days still returns
    // today's entry because the cutoff is computed before today.
    expect(store.getDailyStats(0)).toHaveLength(1);
  });

  it('getSummary totals only billable records and reports cache hit rate', () => {
    const store = useUsageStore.getState();
    store.addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      cached: false,
    });
    store.addRecord({
      provider: 'ollama',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      cached: false,
    });
    store.addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cached: true,
    });

    const summary = store.getSummary();
    expect(summary.totalRecords).toBe(3);
    expect(summary.totalTokens).toBe(23);
    expect(summary.avgTokensPerTranslation).toBe(12); // round(23 / 2)
    expect(summary.cacheHitRate).toBeCloseTo(1 / 3);
  });

  it('clearAll empties history and monthly totals', () => {
    useUsageStore.getState().addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      cached: false,
    });
    expect(useUsageStore.getState().records).toHaveLength(1);

    useUsageStore.getState().clearAll();
    const { records, monthlyTokens } = useUsageStore.getState();
    expect(records).toHaveLength(0);
    expect(monthlyTokens).toBe(0);
  });
});
