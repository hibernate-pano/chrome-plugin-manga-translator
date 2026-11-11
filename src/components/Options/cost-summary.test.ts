import { describe, expect, it } from 'vitest';

import { describeCost } from './cost-summary';
import type { CostEstimate } from '@/stores/usage-cost';
import type { ProviderType } from '@/providers/base';

/**
 * The cost card's four answers.
 *
 * Three of them are not a number, and that is what these tests protect: the
 * only failure mode that matters here is the card showing a figure when it
 * has no business showing one, because a small-looking bill is the mistake
 * the reader cannot detect.
 */

const nameOf = (type: ProviderType) =>
  ({
    'openai-compatible': 'OpenAI 兼容',
    ollama: 'Ollama',
    'lm-studio': 'LM Studio',
  })[type] ?? type;

function estimate(overrides: Partial<CostEstimate>): CostEstimate {
  return {
    total: null,
    unit: '',
    coveredTokens: 0,
    unattributedTokens: 0,
    byProvider: {},
    unpricedProviders: [],
    ...overrides,
  };
}

describe('describeCost', () => {
  it('shows the amount and the unit when a rate priced the month', () => {
    const summary = describeCost(
      estimate({ total: 0.48, unit: '元', coveredTokens: 150000 }),
      nameOf
    );

    expect(summary.label).toBe('0.48 元');
    expect(summary.note).toBe('按你填的单价估算，不是服务商的账单。');
    expect(summary.needsPrice).toBe(false);
  });

  it('shows the amount without a unit when the user left it blank', () => {
    const summary = describeCost(
      estimate({ total: 12, unit: '', coveredTokens: 1000 }),
      nameOf
    );

    expect(summary.label).toBe('12.00');
  });

  it('never presents a total that leaves an unpriced provider out', () => {
    const summary = describeCost(
      estimate({
        total: 0.48,
        unit: '元',
        coveredTokens: 150000,
        unpricedProviders: ['ollama'],
      }),
      nameOf
    );

    expect(summary.label).toBe('0.48 元');
    expect(summary.note).toContain('Ollama 还没有填单价，没有算进来');
    expect(summary.note).toContain('不是服务商的账单');
  });

  it('names unattributed usage alongside the number it did not reach', () => {
    const summary = describeCost(
      estimate({
        total: 1,
        unit: '元',
        coveredTokens: 1000,
        unattributedTokens: 5000,
      }),
      nameOf
    );

    expect(summary.note).toContain('旧版本的用量无法归属到服务商');
  });

  it('says 未设置单价 instead of a number when nothing is priced', () => {
    const summary = describeCost(
      estimate({ unpricedProviders: ['openai-compatible'] }),
      nameOf
    );

    expect(summary.label).toBe('未设置单价');
    expect(summary.note).toContain('本月调用过 OpenAI 兼容');
    expect(summary.needsPrice).toBe(true);
  });

  it('lists every unpriced provider rather than only the first', () => {
    const summary = describeCost(
      estimate({ unpricedProviders: ['openai-compatible', 'ollama'] }),
      nameOf
    );

    expect(summary.note).toContain('OpenAI 兼容、Ollama');
  });

  it('says 无法估算 when the only usage cannot be attributed', () => {
    const summary = describeCost(
      estimate({ unattributedTokens: 5000 }),
      nameOf
    );

    expect(summary.label).toBe('无法估算');
    expect(summary.note).toContain('无法归属到服务商');
    // There is no rate to enter: the missing thing is the attribution.
    expect(summary.needsPrice).toBe(false);
  });

  it('shows 0 only when the month really had no cloud calls', () => {
    const summary = describeCost(estimate({}), nameOf);

    expect(summary.label).toBe('0');
    expect(summary.note).toBe('本月没有需要估算的云端调用。');
    expect(summary.needsPrice).toBe(false);
  });

  it('treats a zero total as a real total, not as "no price"', () => {
    // A free tier prices the month at 0 — that is a number the user did
    // give, and it must not be reported as unpriced.
    const summary = describeCost(
      estimate({ total: 0, unit: '元', coveredTokens: 2000 }),
      nameOf
    );

    expect(summary.label).toBe('0.00 元');
    expect(summary.needsPrice).toBe(false);
  });
});
