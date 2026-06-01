import { vi, describe, expect, it, beforeEach } from 'vitest';
import { detectTextRegions, mergeOverlappingRegions } from './text-detector';
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
          }
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
        { x: 100, y: 100, width: 30, height: 30, text: 'Unrelated', confidence: 0.9 },
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
