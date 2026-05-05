const DEFAULT_PAGE_TRANSLATION_CONCURRENCY = 3;
const MIN_PAGE_TRANSLATION_CONCURRENCY = 2;
const MAX_PAGE_TRANSLATION_CONCURRENCY = 3;

export function clampPageTranslationConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PAGE_TRANSLATION_CONCURRENCY;
  }

  return Math.max(
    MIN_PAGE_TRANSLATION_CONCURRENCY,
    Math.min(MAX_PAGE_TRANSLATION_CONCURRENCY, Math.round(value))
  );
}

export function getDefaultPageTranslationConcurrency(): number {
  return DEFAULT_PAGE_TRANSLATION_CONCURRENCY;
}
