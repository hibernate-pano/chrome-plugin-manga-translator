import { vi, describe, expect, it, beforeEach } from 'vitest';
import {
  detectTextRegions,
  mergeOverlappingRegions,
  type TextRegion,
} from './text-detector';
import { createWorker } from 'tesseract.js';

vi.mock('tesseract.js', () => {
  const mockWorker = {
    setParameters: vi.fn().mockResolvedValue(null),
    recognize: vi.fn().mockResolvedValue({
      data: {
        confidence: 85,
        imageWidth: 800,
        imageHeight: 1200,
        words: [
          {
            bbox: { x0: 100, y0: 200, x1: 200, y1: 300 },
            text: 'Hello',
            confidence: 90,
          },
          {
            bbox: { x0: 110, y0: 210, x1: 210, y1: 310 },
            text: 'World',
            confidence: 80,
          },
          {
            bbox: { x0: 400, y0: 500, x1: 500, y1: 600 },
            text: 'LowConf',
            confidence: 10,
          },
        ],
      },
    }),
    terminate: vi.fn().mockResolvedValue(null),
  };

  return {
    createWorker: vi.fn().mockResolvedValue(mockWorker),
  };
});

describe('text-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects regions and applies psm parameter and confidence threshold filter', async () => {
    const result = await detectTextRegions('mocked_image_base64', {
      psm: '12',
      minConfidence: 0.25,
      expandMargin: 0.1,
    });

    // Verify worker creation
    expect(createWorker).toHaveBeenCalled();

    // Verify parameters setting (like psm)
    const mockWorker = await createWorker();
    expect(mockWorker.setParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: '12',
    });

    // LowConf has confidence 0.10, which is below minConfidence 0.25, so it should be filtered out
    // Only 'Hello' and 'World' are returned
    expect(result.regions).toHaveLength(2);
    expect(result.regions[0]?.text).toBe('Hello');
    expect(result.regions[1]?.text).toBe('World');

    // Verify margin expansion calculation for 'Hello':
    // Original: x0: 100, y0: 200, x1: 200, y1: 300 => width = 100, height = 100
    // Margin: 100 * 0.1 = 10
    // Expected x = max(0, 100 - 10) = 90
    // Expected y = max(0, 200 - 10) = 190
    // Expected width = 100 + 10 * 2 = 120
    // Expected height = 100 + 10 * 2 = 120
    expect(result.regions[0]?.x).toBe(90);
    expect(result.regions[0]?.y).toBe(190);
    expect(result.regions[0]?.width).toBe(120);
    expect(result.regions[0]?.height).toBe(120);
  });

  describe('mergeOverlappingRegions', () => {
    it('merges overlapping regions into a combined bounding box', () => {
      const regions = [
        { x: 10, y: 10, width: 20, height: 20, text: 'Hello', confidence: 0.9 },
        { x: 15, y: 15, width: 20, height: 20, text: 'World', confidence: 0.8 },
        {
          x: 100,
          y: 100,
          width: 30,
          height: 30,
          text: 'Unrelated',
          confidence: 0.9,
        },
      ];

      const merged = mergeOverlappingRegions(regions, 0.1);

      // Hello and World overlap. Unrelated does not.
      expect(merged).toHaveLength(2);

      // The first merged region should enclose both Hello and World:
      // minX = 10, minY = 10
      // maxX = max(10+20, 15+20) = 35
      // maxY = max(10+20, 15+20) = 35
      // width = 35 - 10 = 25
      // height = 35 - 10 = 25
      const mergedRegion = merged.find(r => r.text.includes('Hello'));
      expect(mergedRegion).toBeDefined();
      expect(mergedRegion?.x).toBe(10);
      expect(mergedRegion?.y).toBe(10);
      expect(mergedRegion?.width).toBe(25);
      expect(mergedRegion?.height).toBe(25);
      expect(mergedRegion?.text).toBe('Hello World');
    });
  });
});

describe('mergeOverlappingRegions', () => {
  const region = (
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    confidence = 0.9
  ): TextRegion => ({ x, y, width, height, text, confidence });

  it('returns the input untouched for empty or single-region lists', () => {
    expect(mergeOverlappingRegions([])).toEqual([]);
    const single = [region(0, 0, 10, 10, 'a')];
    expect(mergeOverlappingRegions(single)).toEqual(single);
  });

  it('merges regions whose overlap exceeds the threshold', () => {
    const merged = mergeOverlappingRegions(
      [
        region(0, 0, 100, 40, 'hello', 0.8),
        region(10, 0, 100, 40, 'world', 1.0),
      ],
      0.3
    );

    expect(merged).toHaveLength(1);
    const first = merged[0];
    expect(first?.text).toBe('hello world');
    expect(first?.x).toBe(0);
    expect(first?.width).toBe(110);
    expect(first?.confidence).toBe(0.9);
  });

  it('keeps regions that do not overlap', () => {
    const merged = mergeOverlappingRegions(
      [region(0, 0, 50, 50, 'a'), region(100, 100, 50, 50, 'b')],
      0.3
    );

    expect(merged).toHaveLength(2);
  });

  it('handles null-ish coordinate fields defensively', () => {
    const sparse = [
      {
        x: undefined,
        y: undefined,
        width: undefined,
        height: undefined,
        text: undefined,
        confidence: undefined,
      } as unknown as TextRegion,
      region(0, 0, 40, 40, 'b', 0.5),
    ];
    const merged = mergeOverlappingRegions(sparse, 0.3);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.x).toBe(0);
    expect(merged[0]?.confidence).toBe(0);
  });
});
