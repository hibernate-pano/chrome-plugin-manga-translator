import { describe, expect, it } from 'vitest';

import { estimateMonthlyCost, type PriceEntry } from './usage-cost';
import type {
  DailyUsageSummary,
  ProviderTokenUsage,
  TranslationUsageRecord,
} from './usage-store';
import type { ProviderType } from '@/providers/base';

/**
 * A record of one call, made in the month under test.
 *
 * `now` is pinned to the middle of the month so a test never depends on the
 * day it runs: a record dated in the current month is what the estimate
 * counts, and "current" has to mean the same thing on the 1st and on the 31st.
 */
const NOW = new Date(2026, 4, 15, 12, 0, 0); // 2026-05-15, local time
const THIS_MONTH = '2026-05';

function record(
  options: {
    date?: string;
    provider?: ProviderType;
    prompt?: number;
    completion?: number;
    cached?: boolean;
    id?: string;
  } = {}
): TranslationUsageRecord {
  const {
    date = `${THIS_MONTH}-10`,
    provider = 'openai-compatible',
    prompt = 0,
    completion = 0,
    cached = false,
    id = `rec-${date}-${provider}-${prompt}-${completion}-${cached ? 1 : 0}`,
  } = options;
  return {
    id,
    timestamp: Date.parse(`${date}T12:00:00.000Z`),
    date,
    provider,
    usage: {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
    },
    cached,
  };
}

/**
 * A synthetic accumulator record, which is what the store actually keeps.
 *
 * The monthly total reads the accumulator rather than the detail list, so
 * the estimate has to be tested against one too — and against the case where
 * both cover the same calls.
 */
function accumulator(
  byDay: Record<string, DailyUsageSummary>,
  options: { id?: string; month?: string } = {}
): TranslationUsageRecord {
  const month = options.month ?? THIS_MONTH;
  return {
    id: options.id ?? `acc-test-${month}`,
    timestamp: Date.parse(`${month}-15T12:00:00.000Z`),
    date: month,
    provider: 'openai-compatible',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cached: false,
    accumulator: { byDay, clearedAt: 0 },
  };
}

/**
 * One day of an accumulator, with the per-provider split the store records.
 */
function daySummary(
  date: string,
  tokensByProvider: Partial<Record<ProviderType, ProviderTokenUsage>>,
  options: {
    tokens?: number;
    cached?: boolean;
    translationCount?: number;
    cachedCount?: number;
  } = {}
): DailyUsageSummary {
  const entries = Object.values(tokensByProvider);
  const prompt = entries.reduce((sum, item) => sum + item.prompt, 0);
  const completion = entries.reduce((sum, item) => sum + item.completion, 0);
  return {
    date,
    totalTokens: options.tokens ?? prompt + completion,
    promptTokens: prompt,
    completionTokens: completion,
    translationCount: options.translationCount ?? 1,
    cachedCount: options.cachedCount ?? (options.cached ? 1 : 0),
    providers: {},
    tokensByProvider,
  };
}

function price(
  inputPerMillion: number,
  outputPerMillion: number,
  unit = '元'
): PriceEntry {
  return { inputPerMillion, outputPerMillion, unit };
}

describe('estimateMonthlyCost', () => {
  it('prices input and output tokens at their own rates', () => {
    // 1,000,000 input at 3 / million is 3; 500,000 output at 15 / million
    // is 7.5. A single blended rate would give one of them the wrong price.
    const estimate = estimateMonthlyCost(
      [record({ prompt: 1_000_000, completion: 500_000 })],
      { 'openai-compatible': price(3, 15) },
      NOW
    );

    expect(estimate.total).toBe(10.5);
    expect(estimate.coveredTokens).toBe(1_500_000);
    expect(estimate.unpricedProviders).toEqual([]);
  });

  it('returns null when no called cloud provider has a rate', () => {
    const estimate = estimateMonthlyCost(
      [record({ prompt: 1000, completion: 500 })],
      {},
      NOW
    );

    // Not 0: nothing was priced, so there is no estimate to show.
    expect(estimate.total).toBeNull();
    expect(estimate.coveredTokens).toBe(0);
    expect(estimate.unpricedProviders).toEqual(['openai-compatible']);
  });

  it('treats local providers as free, and leaves their tokens out of covered', () => {
    const estimate = estimateMonthlyCost(
      [
        record({ provider: 'ollama', prompt: 5000, completion: 5000 }),
        record({ provider: 'lm-studio', prompt: 2000, completion: 1000 }),
      ],
      {},
      NOW
    );

    // Local calls cost nothing, so they are not "unpriced" — but they did
    // not take part in an estimate either, so they are not covered.
    expect(estimate.total).toBeNull();
    expect(estimate.coveredTokens).toBe(0);
    expect(estimate.unpricedProviders).toEqual([]);
    expect(estimate.byProvider).toEqual({});
  });

  it('counts local tokens alongside a priced cloud call without pricing them', () => {
    const estimate = estimateMonthlyCost(
      [
        record({ prompt: 1_000_000, completion: 0 }),
        record({ provider: 'ollama', prompt: 9_000_000, completion: 0 }),
      ],
      { 'openai-compatible': price(3, 15) },
      NOW
    );

    expect(estimate.total).toBe(3);
    expect(estimate.coveredTokens).toBe(1_000_000);
    expect(estimate.byProvider).toEqual({ 'openai-compatible': 3 });
  });

  it('leaves unattributable tokens out of the total', () => {
    // A day written before the per-provider split existed: it has tokens but
    // no provider to put them on. Spreading them over the priced provider
    // would invent a bill.
    const old = daySummary('2026-05-09', {}, { tokens: 4_000_000 });
    const estimate = estimateMonthlyCost(
      [accumulator({ '2026-05-09': old })],
      { 'openai-compatible': price(1000, 1000) },
      NOW
    );

    expect(estimate.unattributedTokens).toBe(4_000_000);
    expect(estimate.coveredTokens).toBe(0);
    expect(estimate.total).toBeNull();
  });

  it('only counts the local month under test', () => {
    const estimate = estimateMonthlyCost(
      [
        record({ date: '2026-04-30', prompt: 1_000_000 }),
        record({ date: '2026-05-01', prompt: 2_000_000 }),
        record({ date: '2026-06-01', prompt: 4_000_000 }),
      ],
      { 'openai-compatible': price(1, 1) },
      NOW
    );

    expect(estimate.coveredTokens).toBe(2_000_000);
    expect(estimate.total).toBe(2);
  });

  it('gives the same answer from the accumulator and from the details', () => {
    const detail = record({ prompt: 1_000_000, completion: 200_000 });
    const prices = { 'openai-compatible': price(3, 15) } as const;

    const fromDetails = estimateMonthlyCost([detail], { ...prices }, NOW);

    // The same call, but counted by an accumulator and with the detail still
    // present. Counting both would double the bill.
    const fromAccumulator = estimateMonthlyCost(
      [
        accumulator({
          '2026-05-10': daySummary('2026-05-10', {
            'openai-compatible': { prompt: 1_000_000, completion: 200_000 },
          }),
        }),
        detail,
      ],
      { ...prices },
      NOW
    );

    expect(fromAccumulator.total).toBe(fromDetails.total);
    expect(fromAccumulator.coveredTokens).toBe(fromDetails.coveredTokens);
  });

  it('adds up the accumulators of two writers without double counting', () => {
    // Two contexts each counted their own calls; the day is the sum of both.
    const estimate = estimateMonthlyCost(
      [
        accumulator(
          {
            '2026-05-10': daySummary('2026-05-10', {
              'openai-compatible': { prompt: 500_000, completion: 0 },
            }),
          },
          { id: 'acc-worker-2026-05' }
        ),
        accumulator(
          {
            '2026-05-10': daySummary('2026-05-10', {
              'openai-compatible': { prompt: 500_000, completion: 0 },
            }),
          },
          { id: 'acc-page-2026-05' }
        ),
      ],
      { 'openai-compatible': price(2, 2) },
      NOW
    );

    expect(estimate.coveredTokens).toBe(1_000_000);
    expect(estimate.total).toBe(2);
  });

  it('treats a rate of zero as a real price, not as a missing one', () => {
    const estimate = estimateMonthlyCost(
      [record({ prompt: 1_000_000, completion: 1_000_000 })],
      { 'openai-compatible': price(0, 0) },
      NOW
    );

    // A free tier is priced at zero; a missing rate is no estimate at all.
    expect(estimate.total).toBe(0);
    expect(estimate.coveredTokens).toBe(2_000_000);
    expect(estimate.unpricedProviders).toEqual([]);
  });

  it('ignores cached calls, which spent no tokens', () => {
    const estimate = estimateMonthlyCost(
      [
        record({ prompt: 0, completion: 0, cached: true }),
        record({ prompt: 1_000_000, cached: false }),
      ],
      { 'openai-compatible': price(1, 0) },
      NOW
    );

    expect(estimate.coveredTokens).toBe(1_000_000);
    expect(estimate.total).toBe(1);
  });

  it('reports a priced provider and an unpriced one separately', () => {
    // The cloud provider has a rate and a local one does not need one; the
    // estimate is the cloud part, and nothing is left unpriced.
    const estimate = estimateMonthlyCost(
      [
        record({ prompt: 1_000_000 }),
        record({ provider: 'ollama', prompt: 1_000_000 }),
      ],
      { 'openai-compatible': price(5, 5) },
      NOW
    );

    expect(estimate.total).toBe(5);
    expect(estimate.unpricedProviders).toEqual([]);
    expect(estimate.unattributedTokens).toBe(0);
  });

  it('uses the unit the user typed, and an empty one when they typed none', () => {
    const withUnit = estimateMonthlyCost(
      [record({ prompt: 1_000_000 })],
      { 'openai-compatible': price(1, 1, '$') },
      NOW
    );
    expect(withUnit.unit).toBe('$');

    const withoutUnit = estimateMonthlyCost(
      [record({ prompt: 1_000_000 })],
      { 'openai-compatible': price(1, 1, '') },
      NOW
    );
    expect(withoutUnit.unit).toBe('');
  });

  it('treats a negative rate as no rate at all', () => {
    const estimate = estimateMonthlyCost(
      [record({ prompt: 1_000_000 })],
      { 'openai-compatible': price(-1, 1) },
      NOW
    );

    // A negative price would make the estimate go down as usage grows; it
    // cannot be a real rate, so it is not used.
    expect(estimate.total).toBeNull();
    expect(estimate.unpricedProviders).toEqual(['openai-compatible']);
  });
});
