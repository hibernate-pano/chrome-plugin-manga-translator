import { describe, expect, it } from 'vitest';
import { shouldPreserveTallMangaPage } from './image-processor';

describe('shouldPreserveTallMangaPage', () => {
  it('preserves tall narrow manga pages', () => {
    expect(shouldPreserveTallMangaPage(720, 5000)).toBe(true);
  });

  it('does not preserve regular landscape images', () => {
    expect(shouldPreserveTallMangaPage(1600, 900)).toBe(false);
  });

  it('does not preserve tall pages when width is too large', () => {
    expect(shouldPreserveTallMangaPage(1800, 5000)).toBe(false);
  });
});
