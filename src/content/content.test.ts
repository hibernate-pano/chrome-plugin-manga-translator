import { describe, expect, it } from 'vitest';

import { clampPageTranslationConcurrency } from './page-translation-utils';

describe('content page translation settings', () => {
  it('clamps concurrency into stable range 2-3', () => {
    expect(clampPageTranslationConcurrency(1)).toBe(2);
    expect(clampPageTranslationConcurrency(2)).toBe(2);
    expect(clampPageTranslationConcurrency(3)).toBe(3);
    expect(clampPageTranslationConcurrency(9)).toBe(3);
  });

  it('falls back to default for invalid values', () => {
    expect(clampPageTranslationConcurrency(Number.NaN)).toBe(3);
    expect(clampPageTranslationConcurrency(Number.POSITIVE_INFINITY)).toBe(3);
  });
});
