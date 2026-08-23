import { describe, expect, it } from 'vitest';
import { computeTiles, filterOverlapDuplicates } from './translator';
import type { TextArea } from '@/providers/base';

describe('computeTiles', () => {
  it('returns a single tile for short images (no tiling)', () => {
    const tiles = computeTiles(800, 1500);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toEqual({ top: 0, height: 1500 });
  });

  it('returns a single tile for non-strip aspect ratios', () => {
    const tiles = computeTiles(1200, 2500); // aspect 2.08 < 2.2
    expect(tiles).toHaveLength(1);
  });

  it('splits a long strip into overlapping tiles covering full height', () => {
    const tiles = computeTiles(800, 4000);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]?.top).toBe(0);
    const last = tiles[tiles.length - 1];
    const lastBottom = last ? last.top + last.height : 0;
    expect(lastBottom).toBeGreaterThanOrEqual(4000 - 1);
  });

  it('produces overlapping tiles (overlap > 0 between consecutive)', () => {
    const tiles = computeTiles(800, 6000);
    for (let i = 1; i < tiles.length; i++) {
      const prev = tiles[i - 1];
      const cur = tiles[i];
      if (prev && cur) {
        const overlap = prev.top + prev.height - cur.top;
        expect(overlap).toBeGreaterThan(0);
      }
    }
  });

  it('covers full image height without gaps', () => {
    const tiles = computeTiles(800, 10000);
    expect(tiles[0]?.top).toBe(0);
    for (let i = 1; i < tiles.length; i++) {
      const prev = tiles[i - 1];
      const cur = tiles[i];
      if (prev && cur) {
        // No gap: next tile top <= previous tile bottom
        expect(cur.top).toBeLessThanOrEqual(prev.top + prev.height);
      }
    }
    const last = tiles[tiles.length - 1];
    expect(last ? last.top + last.height : 0).toBeGreaterThanOrEqual(10000);
  });
});

describe('filterOverlapDuplicates', () => {
  function area(
    x: number,
    y: number,
    width: number,
    height: number
  ): TextArea {
    return {
      x,
      y,
      width,
      height,
      originalText: '',
      translatedText: 't',
    };
  }

  it('keeps non-overlapping areas', () => {
    const areas = [area(0.1, 0.1, 0.2, 0.1), area(0.1, 0.5, 0.2, 0.1)];
    expect(filterOverlapDuplicates(areas)).toHaveLength(2);
  });

  it('dedupes areas that straddle a tile seam', () => {
    // Two areas at the same x, heavily overlapping in y (same bubble detected
    // twice in the tile overlap) → keep only one.
    const areas = [area(0.2, 0.4, 0.3, 0.1), area(0.2, 0.44, 0.3, 0.1)];
    const result = filterOverlapDuplicates(areas);
    expect(result).toHaveLength(1);
  });

  it('keeps distinct bubbles that only slightly touch vertically', () => {
    const areas = [area(0.1, 0.1, 0.2, 0.02), area(0.1, 0.15, 0.2, 0.1)];
    expect(filterOverlapDuplicates(areas)).toHaveLength(2);
  });
});
