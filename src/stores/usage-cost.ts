/**
 * Monthly Cost Estimate
 *
 * Turns this month's tokens into money, using the rates the user entered.
 *
 * ## Why there is no price table
 *
 * The extension used to carry a table of per-token rates and produced dollar
 * figures from it. Those numbers were wrong for almost every endpoint the
 * product actually talks to: the rates differ per provider, per model and
 * per plan, and a table shipped in the bundle is a guess presented to the
 * user as a bill. So there is no table here — only the rates the user typed
 * from their provider's pricing page, and the estimate says out loud that
 * it is an estimate.
 *
 * ## What is left out, and why
 *
 * - Local providers (Ollama, LM Studio) run on the user's own machine. They
 *   cost nothing, so they are not priced and not listed as unpriced — and
 *   their tokens are not counted as covered, because "covered" means "this
 *   number took part in the estimate".
 * - A cloud provider the user has not priced cannot be estimated at all.
 *   Its tokens stay out of the total and the provider is listed, so the UI
 *   can ask for the rates instead of quietly reporting a smaller number.
 * - Tokens from before the per-provider attribution existed cannot be
 *   placed. They are counted as unattributed and left out of the total
 *   rather than spread over the providers that happen to have a price.
 *
 * ## Where this module may be imported
 *
 * Only the settings page. The usage store is bundled into the content
 * script — the script that runs on every page the user opens — so anything
 * imported from here would be paid for on every page load. The store must
 * not import this module back.
 */

import {
  collectUsage,
  formatLocalMonth,
  type PriceEntry,
  type ProviderTokenUsage,
  type TranslationUsageRecord,
} from './usage-store';
import type { ProviderType } from '@/providers/base';
import { isLocalProvider } from '@/shared/local-providers';

export type { PriceEntry };

/**
 * The order the providers are walked in.
 *
 * Object key order is insertion order, which depends on the order the calls
 * happened to be counted in. A fixed order makes the estimate — and the
 * list of unpriced providers — the same number on every machine.
 */
const PROVIDER_ORDER: ProviderType[] = [
  'openai-compatible',
  'ollama',
  'lm-studio',
];

/**
 * What this month's calls cost, as far as the user's own rates allow.
 */
export interface CostEstimate {
  /**
   * The estimated cost of the month, or `null` when it cannot be estimated.
   *
   * `null` means "there is nothing here to price" — no cloud call the user
   * has a rate for. It is deliberately not `0`: a month that cost nothing
   * and a month nobody priced are different facts, and only one of them is
   * a bill.
   */
  total: number | null;
  /** The unit the total is in, as the user typed it. Empty for none. */
  unit: string;
  /** The tokens that took part in the estimate. */
  coveredTokens: number;
  /**
   * The tokens that could not be placed with a provider.
   *
   * These are the calls made before the per-provider attribution existed.
   * They are left out of the total: guessing which provider they belong to
   * would put a number on the user's bill that nobody can defend.
   */
  unattributedTokens: number;
  /** The cost per provider that took part in the estimate. */
  byProvider: Partial<Record<ProviderType, number>>;
  /**
   * The cloud providers that were called this month and have no rate.
   *
   * The UI asks for these rates rather than reporting a total that is
   * smaller than the real one.
   */
  unpricedProviders: ProviderType[];
}

/**
 * A rate that can be used to price a call.
 *
 * A price of zero is a real price — a free tier, or a provider that does
 * not charge — and it is not the same as no price at all. A rate that is not
 * a number, or is negative, is no price: it cannot be used, so the provider
 * counts as unpriced.
 */
function usablePrice(entry: PriceEntry | undefined): PriceEntry | null {
  if (!entry) {
    return null;
  }
  const { inputPerMillion, outputPerMillion } = entry;
  if (
    !Number.isFinite(inputPerMillion) ||
    !Number.isFinite(outputPerMillion) ||
    inputPerMillion < 0 ||
    outputPerMillion < 0
  ) {
    return null;
  }
  return entry;
}

/**
 * The cost of one provider's tokens at one provider's rates.
 */
function priceTokens(tokens: ProviderTokenUsage, price: PriceEntry): number {
  return (
    (tokens.prompt / 1e6) * price.inputPerMillion +
    (tokens.completion / 1e6) * price.outputPerMillion
  );
}

/**
 * Add a day's per-provider tokens to the month's, and report how many of
 * the day's tokens could not be placed.
 *
 * A day written before the attribution existed has tokens but no provider
 * to put them on: they are counted as unattributed, never spread over the
 * providers that do have one.
 */
function addDayTokens(
  target: Partial<Record<ProviderType, ProviderTokenUsage>>,
  tokensByProvider: Partial<Record<ProviderType, ProviderTokenUsage>>,
  dayTokens: number
): number {
  let attributed = 0;
  for (const [provider, tokens] of Object.entries(tokensByProvider)) {
    const key = provider as ProviderType;
    const existing = target[key] ?? { prompt: 0, completion: 0 };
    target[key] = {
      prompt: existing.prompt + (tokens?.prompt ?? 0),
      completion: existing.completion + (tokens?.completion ?? 0),
    };
    attributed += (tokens?.prompt ?? 0) + (tokens?.completion ?? 0);
  }
  return Math.max(0, dayTokens - attributed);
}

/**
 * What this month's calls cost, at the rates the user entered.
 *
 * Only the current month is counted, and the month is the local one: a
 * reader in UTC+8 does not lose the first eight hours of the month.
 */
export function estimateMonthlyCost(
  records: TranslationUsageRecord[],
  prices: Partial<Record<ProviderType, PriceEntry>>,
  now: Date = new Date()
): CostEstimate {
  const monthPrefix = formatLocalMonth(now);
  // The same counting the monthly summary uses: the accumulators carry the
  // calls, the detail records no accumulator covers are counted directly,
  // and neither is counted twice.
  const { days, looseRecords } = collectUsage(records);

  const tokensByProvider: Partial<Record<ProviderType, ProviderTokenUsage>> =
    {};
  let unattributedTokens = 0;

  for (const [day, summary] of days) {
    if (!day.startsWith(monthPrefix)) {
      continue;
    }
    unattributedTokens += addDayTokens(
      tokensByProvider,
      summary.tokensByProvider ?? {},
      // `totalTokens` is the figure the usage panel shows, so it is the one
      // the estimate has to account for: an old day may carry a total
      // without the prompt/completion split, and measuring it by the split
      // would quietly drop tokens the user can see on screen.
      summary.totalTokens
    );
  }

  for (const record of looseRecords) {
    if (!record.date.startsWith(monthPrefix) || record.cached) {
      continue;
    }
    // A detail record names its provider, so these tokens can be placed.
    const existing = tokensByProvider[record.provider] ?? {
      prompt: 0,
      completion: 0,
    };
    tokensByProvider[record.provider] = {
      prompt: existing.prompt + record.usage.promptTokens,
      completion: existing.completion + record.usage.completionTokens,
    };
  }

  const byProvider: Partial<Record<ProviderType, number>> = {};
  const unpricedProviders: ProviderType[] = [];
  let coveredTokens = 0;
  let total = 0;
  let unit = '';

  for (const provider of PROVIDER_ORDER) {
    const tokens = tokensByProvider[provider];
    if (!tokens) {
      continue;
    }
    const tokenCount = tokens.prompt + tokens.completion;
    if (tokenCount === 0) {
      continue;
    }
    if (isLocalProvider(provider)) {
      // It runs on the user's own machine: no bill, nothing to price.
      continue;
    }
    const price = usablePrice(prices[provider]);
    if (!price) {
      unpricedProviders.push(provider);
      continue;
    }
    coveredTokens += tokenCount;
    const cost = priceTokens(tokens, price);
    byProvider[provider] = cost;
    total += cost;
    if (!unit) {
      unit = price.unit;
    }
  }

  return {
    // No priced cloud call means there is nothing to estimate — which is
    // not the same as a month that cost nothing.
    total: coveredTokens > 0 ? total : null,
    unit,
    coveredTokens,
    unattributedTokens,
    byProvider,
    unpricedProviders,
  };
}
