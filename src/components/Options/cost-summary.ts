/**
 * What the cost card says.
 *
 * The card has four answers, and three of them are not a number. That is
 * the point: a panel that always showed a figure would be wrong whenever
 * the estimate cannot be made — and wrong in the direction the reader cares
 * about, which is a bill that looks smaller than it is.
 *
 * This lives outside the settings component so the wording can be tested.
 * The name of a provider is passed in rather than looked up here: the
 * component owns the display names, and this module owns the sentences.
 */

import type { ProviderType } from '@/providers/base';
import type { CostEstimate } from '@/stores/usage-cost';

/** The three lines the card renders. */
export interface CostSummary {
  /** The big number, or what stands in for it. */
  label: string;
  /** The sentence under it, which says what the number is and is not. */
  note: string;
  /** Whether the user still has a rate to enter before a number can exist. */
  needsPrice: boolean;
}

/**
 * Turn an estimate into the card's label and note.
 *
 * @param estimate What the month cost, as far as the rates allow.
 * @param nameOf How the settings page names a provider to the user.
 */
export function describeCost(
  estimate: CostEstimate,
  nameOf: (type: ProviderType) => string
): CostSummary {
  const unpricedNames = estimate.unpricedProviders.map(nameOf).join('、');

  if (estimate.total !== null) {
    const amount = estimate.total.toFixed(2);
    /*
     * A total that leaves part of the month out is not the whole bill, so
     * the note names what was left out instead of letting the number look
     * complete.
     */
    const gaps: string[] = [];
    if (estimate.unpricedProviders.length > 0) {
      gaps.push(`${unpricedNames} 还没有填单价`);
    }
    if (estimate.unattributedTokens > 0) {
      gaps.push('旧版本的用量无法归属到服务商');
    }
    const note =
      gaps.length > 0
        ? `按你填的单价估算，不是服务商的账单。${gaps.join('，')}，没有算进来。`
        : '按你填的单价估算，不是服务商的账单。';
    return {
      label: estimate.unit ? `${amount} ${estimate.unit}` : amount,
      note,
      needsPrice: false,
    };
  }

  if (estimate.unpricedProviders.length > 0) {
    return {
      label: '未设置单价',
      note: `本月调用过 ${unpricedNames}，但还没有填单价，所以算不出费用。`,
      needsPrice: true,
    };
  }

  if (estimate.unattributedTokens > 0) {
    return {
      label: '无法估算',
      note: '本月有一部分用量来自旧版本，无法归属到服务商，没有计入估算。',
      needsPrice: false,
    };
  }

  return {
    label: '0',
    note: '本月没有需要估算的云端调用。',
    needsPrice: false,
  };
}
