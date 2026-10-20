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
  function area(x: number, y: number, width: number, height: number): TextArea {
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

describe('computeTiles edge shapes', () => {
  it('merges a trailing sliver into the previous tile', () => {
    // Height chosen so the final slice is under 40% of a tile: the algorithm
    // extends the previous tile instead of emitting a sliver.
    const tiles = computeTiles(800, 2600);
    const last = tiles[tiles.length - 1];
    expect(last).toBeDefined();
    expect(last?.height).toBeGreaterThanOrEqual(1152 * 0.4);
    const prev = tiles[tiles.length - 2];
    expect(prev).toBeDefined();
    // Extended last tile must still overlap the previous tile's band.
    expect(last?.top ?? 0).toBeLessThan((prev?.top ?? 0) + (prev?.height ?? 0));
  });

  it('returns one tile when width makes the aspect ratio non-strip', () => {
    expect(computeTiles(3000, 3000)).toEqual([{ top: 0, height: 3000 }]);
  });
});

describe('filterOverlapDuplicates edge cases', () => {
  const area = (x: number, y: number, w: number, h: number): TextArea => ({
    x,
    y,
    width: w,
    height: h,
    originalText: 'o',
    translatedText: 't',
  });

  it('keeps areas whose horizontal centers differ beyond tolerance', () => {
    const areas = [area(0.1, 0.1, 0.1, 0.05), area(0.5, 0.12, 0.1, 0.05)];
    expect(filterOverlapDuplicates(areas)).toHaveLength(2);
  });

  it('drops later areas that vertically overlap a kept area', () => {
    const areas = [
      area(0.2, 0.1, 0.1, 0.08),
      area(0.24, 0.14, 0.1, 0.08),
      area(0.25, 0.13, 0.1, 0.08),
    ];
    expect(filterOverlapDuplicates(areas)).toHaveLength(1);
  });

  it('keeps areas that only touch within the vertical tolerance', () => {
    const areas = [area(0.2, 0.1, 0.1, 0.02), area(0.2, 0.135, 0.1, 0.02)];
    expect(filterOverlapDuplicates(areas)).toHaveLength(2);
  });
});

describe('filterOverlapDuplicates on a long strip', () => {
  // The old dedup compared the vertical overlap against a FIXED 0.03 of the
  // image height. On an 8000px strip that is 240px, while a speech bubble
  // is ~40px tall (0.005 of the image). Two detections of the same bubble
  // therefore never looked like a duplicate, and the same sentence was
  // rendered twice.
  const STRIP_HEIGHT = 8000;
  const TILE_HEIGHT = 1152;
  const TILE_OVERLAP = 96;

  /**
   * Simulate what one tile reports for a bubble that lives at
   * `bubbleTop..bubbleTop + bubbleHeight` in the ORIGINAL strip.
   *
   * The tile only sees the part of the bubble inside its own band, and the
   * result is mapped back to original coordinates — exactly what
   * `mapTextAreasToOriginalImage` does. The second tile of a seam
   * therefore reports the bubble a few pixels LOWER than the first, not
   * 96px lower: the overlap is the shift, and the bubble is clipped by it.
   */
  function detectInTile(
    bubbleTop: number,
    bubbleHeight: number,
    tileTop: number,
    x: number,
    width: number
  ): TextArea {
    const tileBottom = tileTop + TILE_HEIGHT;
    const visibleTop = Math.max(bubbleTop, tileTop);
    const visibleBottom = Math.min(bubbleTop + bubbleHeight, tileBottom);
    if (visibleBottom <= visibleTop) {
      throw new Error('bubble is not inside this tile');
    }

    // Position inside the tile, then back to original space.
    const relativeTop = visibleTop - tileTop;
    const relativeHeight = visibleBottom - visibleTop;

    return {
      x,
      y: (relativeTop + tileTop) / STRIP_HEIGHT,
      width,
      height: relativeHeight / STRIP_HEIGHT,
      originalText: 'o',
      translatedText: 't',
    };
  }

  it('dedupes a bubble detected in both tiles of a seam', () => {
    // Tile 0 covers 0..1152, tile 1 covers 1056..2208. A bubble at
    // 1040..1080 straddles the seam: tile 0 sees all 40px, tile 1 sees the
    // bottom 24px. Both detections map back to (nearly) the same place.
    const areas = [
      detectInTile(1040, 40, 0, 0.2, 0.3),
      detectInTile(1040, 40, TILE_HEIGHT - TILE_OVERLAP, 0.2, 0.3),
    ];

    expect(filterOverlapDuplicates(areas)).toHaveLength(1);
  });

  it('dedupes a seam bubble when the VLM localizes it imprecisely', () => {
    // The VLM is not pixel-exact: the two detections differ by a few
    // pixels. The old absolute tolerance (0.03 of 8000px = 240px) called
    // that "not a duplicate".
    const areas = [
      detectInTile(1040, 40, 0, 0.2, 0.3),
      detectInTile(1040, 40, TILE_HEIGHT - TILE_OVERLAP, 0.21, 0.29),
    ];

    expect(filterOverlapDuplicates(areas)).toHaveLength(1);
  });

  it('keeps two distinct bubbles that sit near the seam', () => {
    // Two separate bubbles that do not overlap at all must both survive.
    const areas = [
      detectInTile(980, 40, 0, 0.2, 0.3),
      detectInTile(1120, 40, 0, 0.2, 0.3),
    ];

    expect(filterOverlapDuplicates(areas)).toHaveLength(2);
  });

  it('keeps bubbles in different columns at the same height', () => {
    const areas = [
      detectInTile(1040, 40, 0, 0.05, 0.2),
      detectInTile(1040, 40, 0, 0.6, 0.2),
    ];

    expect(filterOverlapDuplicates(areas)).toHaveLength(2);
  });

  it('keeps every bubble of a strip that has no seam duplicates', () => {
    // Four bubbles inside one tile band, well clear of each other.
    const areas = [200, 400, 600, 800].map(top =>
      detectInTile(top, 40, 0, 0.2, 0.3)
    );

    expect(filterOverlapDuplicates(areas)).toHaveLength(4);
  });
});
