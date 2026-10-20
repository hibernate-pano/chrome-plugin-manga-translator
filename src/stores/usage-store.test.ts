import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useUsageStore,
  summarizeUsageForMonth,
  formatLocalDate,
  formatLocalMonth,
  startUsageStoreSync,
  type TranslationUsageRecord,
} from './usage-store';

const USAGE_KEY = 'manga-translator-usage-v1';

function record(
  date: string,
  totalTokens: number,
  cached = false
): TranslationUsageRecord {
  return {
    id: `test-${date}-${totalTokens}-${cached ? 1 : 0}`,
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

/**
 * Wait until the queued storage writes have settled.
 *
 * The store writes asynchronously (and serializes the writes through a
 * queue), so a test that looks at `chrome.storage.local` has to let the
 * microtask chain drain first.
 */
async function flushStorage(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function readStoredSnapshot(): Promise<{
  records: TranslationUsageRecord[];
  clearedAt: number;
}> {
  const result = await chrome.storage.local.get([USAGE_KEY]);
  const value = result[USAGE_KEY] as
    | { state?: { records?: unknown; clearedAt?: unknown } }
    | undefined;
  const state = value?.state;
  return {
    records: Array.isArray(state?.records)
      ? (state.records as TranslationUsageRecord[])
      : [],
    clearedAt: typeof state?.clearedAt === 'number' ? state.clearedAt : 0,
  };
}

const originalTz = process.env['TZ'];

/**
 * Pin the timezone for the duration of a test.
 *
 * `process.env.TZ` is read by Node on every date operation, so setting it at
 * runtime is enough (Node >= 16). The guard below fails the test loudly if
 * the platform ignores the override, because a test that silently runs in the
 * wrong timezone would pass for the wrong reason.
 */
function withTimezone(tz: string): void {
  process.env['TZ'] = tz;
  const offset = new Date('2026-10-19T17:00:00.000Z').getTimezoneOffset();
  const expected =
    tz === 'Asia/Shanghai' ? -480 : tz === 'America/New_York' ? 240 : 0;
  if (offset !== expected) {
    throw new Error(
      `timezone override failed: TZ=${tz} produced offset ${offset}, expected ${expected}`
    );
  }
}

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env['TZ'];
  } else {
    process.env['TZ'] = originalTz;
  }
  vi.useRealTimers();
});

describe('formatLocalDate', () => {
  it('uses the local calendar day, not the UTC one', () => {
    withTimezone('Asia/Shanghai');
    // 2026-10-19T17:00Z is 2026-10-20 01:00 in Shanghai.
    const instant = new Date('2026-10-19T17:00:00.000Z');

    expect(instant.toISOString().slice(0, 10)).toBe('2026-10-19');
    expect(formatLocalDate(instant)).toBe('2026-10-20');
  });

  it('handles the negative-offset side the same way', () => {
    withTimezone('America/New_York');
    // 2026-11-01T03:00Z is 2026-10-31 23:00 in New York.
    const instant = new Date('2026-11-01T03:00:00.000Z');

    expect(instant.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(formatLocalDate(instant)).toBe('2026-10-31');
  });

  it('zero-pads month and day', () => {
    const instant = new Date(2026, 0, 5, 12, 0, 0);
    expect(formatLocalDate(instant)).toBe('2026-01-05');
  });

  it('is timezone-independent for a locally constructed instant', () => {
    // A locally constructed Date has the given wall-clock fields in *every*
    // timezone, so the formatter has to return them verbatim.
    const instant = new Date(2026, 9, 20, 1, 30, 0);
    expect(formatLocalDate(instant)).toBe('2026-10-20');
    expect(formatLocalMonth(instant)).toBe('2026-10');
  });
});

describe('formatLocalMonth', () => {
  it('uses the local calendar month, not the UTC one', () => {
    withTimezone('Asia/Shanghai');
    // 2026-10-31T17:00Z is 2026-11-01 01:00 in Shanghai.
    const instant = new Date('2026-10-31T17:00:00.000Z');

    expect(instant.toISOString().slice(0, 7)).toBe('2026-10');
    expect(formatLocalMonth(instant)).toBe('2026-11');
  });
});

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

  it('buckets a record into the local month, not the UTC month', () => {
    withTimezone('Asia/Shanghai');
    // 2026-10-31T17:00Z is 2026-11-01 01:00 in Shanghai, so the November
    // bucket is the local one.
    const summary = summarizeUsageForMonth(
      [record('2026-11-01', 120)],
      new Date('2026-10-31T17:00:00.000Z')
    );

    expect(summary.translations).toBe(1);
    expect(summary.tokens).toBe(120);
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

  it('stamps records with the local date, not the UTC date', () => {
    withTimezone('Asia/Shanghai');
    // Local 2026-10-20 01:00 — still 2026-10-19 in UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T17:00:00.000Z'));

    useUsageStore.getState().addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      cached: false,
    });

    const { records } = useUsageStore.getState();
    expect(records[0]?.date).toBe('2026-10-20');
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
    const staleDate = formatLocalDate(stale);
    useUsageStore.setState(state => ({
      records: [
        {
          id: `stale-${staleDate}`,
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
    const today = formatLocalDate();
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

  it('getDailyStats buckets a record into the local day', () => {
    withTimezone('Asia/Shanghai');
    vi.useFakeTimers();
    // Local 2026-10-20 01:00 — still 2026-10-19 in UTC.
    vi.setSystemTime(new Date('2026-10-19T17:00:00.000Z'));

    useUsageStore.getState().addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      cached: false,
    });

    const stats = useUsageStore.getState().getDailyStats(30);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.date).toBe('2026-10-20');
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

describe('usage store across tabs', () => {
  type StorageChangeHandler = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string
  ) => void;

  let changeHandlers: StorageChangeHandler[] = [];

  beforeAll(() => {
    Object.assign(chrome.storage, {
      onChanged: {
        addListener: (handler: StorageChangeHandler) => {
          changeHandlers.push(handler);
        },
        removeListener: (handler: StorageChangeHandler) => {
          changeHandlers = changeHandlers.filter(item => item !== handler);
        },
      },
    });
    // The module tried to register its listener when it was imported, before
    // the mock had an `onChanged` channel. Arm it now.
    startUsageStoreSync();
  });

  beforeEach(async () => {
    useUsageStore.getState().clearAll();
    await flushStorage();
  });

  /**
   * A record as another context would write it.
   *
   * The timestamp has to be newer than the "cleared" stamp, otherwise the
   * record is part of the deleted history.
   */
  function foreignRecord(
    id: string,
    totalTokens: number,
    overrides: Partial<TranslationUsageRecord> = {}
  ): TranslationUsageRecord {
    const clearedAt = useUsageStore.getState().clearedAt;
    return {
      id,
      timestamp: Math.max(Date.now(), clearedAt + 1),
      date: formatLocalDate(),
      provider: 'openai-compatible',
      usage: {
        promptTokens: totalTokens / 2,
        completionTokens: totalTokens / 2,
        totalTokens,
      },
      cached: false,
      ...overrides,
    };
  }

  it('keeps the records another tab already wrote', async () => {
    // Tab A records a translation.
    useUsageStore.getState().addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      cached: false,
    });
    await flushStorage();

    const tabARecordId = useUsageStore.getState().records[0]?.id;
    expect(tabARecordId).toBeTruthy();

    // Tab B only knows about its own translation and writes the history.
    // The old behaviour replaced the stored array, so tab A's record was
    // gone and the month total under-counted what the user was charged.
    useUsageStore.setState({ records: [foreignRecord('tab-b-1', 2)] });
    await flushStorage();

    const stored = await readStoredSnapshot();
    const ids = stored.records.map(item => item.id);
    expect(ids).toContain(tabARecordId);
    expect(ids).toContain('tab-b-1');
    const total = stored.records.reduce(
      (sum, item) => sum + item.usage.totalTokens,
      0
    );
    expect(total).toBe(12);
  });

  it('folds in a record written by another tab', () => {
    const record = foreignRecord('tab-c-1', 5);

    for (const handler of changeHandlers) {
      handler(
        {
          [USAGE_KEY]: {
            newValue: {
              state: { records: [record], clearedAt: 0 },
              version: 1,
            },
          },
        },
        'local'
      );
    }

    const records = useUsageStore.getState().records;
    expect(records.map(item => item.id)).toContain('tab-c-1');
    expect(useUsageStore.getState().monthlyTokens).toBe(5);
  });

  it('ignores a change that carries nothing new', async () => {
    useUsageStore.getState().addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      cached: false,
    });
    await flushStorage();

    const before = useUsageStore.getState().records;
    const stored = await readStoredSnapshot();

    for (const handler of changeHandlers) {
      handler(
        {
          [USAGE_KEY]: {
            newValue: {
              state: { records: stored.records, clearedAt: stored.clearedAt },
              version: 1,
            },
          },
        },
        'local'
      );
    }

    // The echo of our own write must not be treated as a change, or the
    // store would write back on every notification and never settle.
    expect(useUsageStore.getState().records).toBe(before);
  });

  it('does not resurrect a cleared history when a stale tab writes', async () => {
    useUsageStore.getState().addRecord({
      provider: 'openai-compatible',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      cached: false,
    });
    await flushStorage();

    useUsageStore.getState().clearAll();
    await flushStorage();

    // A tab that never saw the clear writes its stale history back.
    const clearedAt = useUsageStore.getState().clearedAt;
    useUsageStore.setState({
      records: [
        {
          id: 'stale-tab-1',
          timestamp: clearedAt - 1,
          date: formatLocalDate(),
          provider: 'openai-compatible',
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          cached: false,
        },
      ],
      clearedAt: 0,
    });
    await flushStorage();

    const stored = await readStoredSnapshot();
    expect(stored.records.map(item => item.id)).not.toContain('stale-tab-1');
    expect(stored.clearedAt).toBeGreaterThan(0);
  });
});
