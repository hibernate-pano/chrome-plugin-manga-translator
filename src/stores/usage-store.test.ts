import { describe, expect, it } from 'vitest';

import {
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
