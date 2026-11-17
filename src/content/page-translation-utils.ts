const DEFAULT_PAGE_TRANSLATION_CONCURRENCY = 3;
/**
 * The range the settings page offers.
 *
 * It used to be 2–3, while the settings page offered 1, 3 and 5: a user who
 * picked 「1 张 · 最稳」 silently got two parallel requests, and one who
 * picked 5 got three. The choice on screen has to be the choice in force.
 */
const MIN_PAGE_TRANSLATION_CONCURRENCY = 1;
const MAX_PAGE_TRANSLATION_CONCURRENCY = 5;

export function clampPageTranslationConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PAGE_TRANSLATION_CONCURRENCY;
  }

  return Math.max(
    MIN_PAGE_TRANSLATION_CONCURRENCY,
    Math.min(MAX_PAGE_TRANSLATION_CONCURRENCY, Math.round(value))
  );
}
