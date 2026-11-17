import { vi, describe, expect, it, beforeEach } from 'vitest';
import {
  detectTextRegions,
  mergeOverlappingRegions,
  type TextRegion,
} from './text-detector';
import { createWorker } from 'tesseract.js';

vi.mock('tesseract.js', () => {
  const hello = {
    bbox: { x0: 100, y0: 200, x1: 200, y1: 300 },
    text: 'Hello',
    confidence: 90,
  };
  const world = {
    bbox: { x0: 110, y0: 210, x1: 210, y1: 310 },
    text: 'World',
    confidence: 80,
  };
  const lowConf = {
    bbox: { x0: 400, y0: 500, x1: 500, y1: 600 },
    text: 'LowConf',
    confidence: 10,
  };

  const mockWorker = {
    setParameters: vi.fn().mockResolvedValue(null),
    // tesseract.js 7's real shape: word boxes live under
    // `blocks[].paragraphs[].lines[].words`, and there is no top-level
    // `words`. Mimicking that here is the point of the mock — the previous
    // one had the v5 shape and hid the fact that the reader was broken.
    recognize: vi.fn().mockResolvedValue({
      data: {
        text: 'Hello World\nLowConf',
        confidence: 85,
        blocks: [
          { paragraphs: [{ lines: [{ words: [hello, world] }] }] },
          { paragraphs: [{ lines: [{ words: [lowConf] }] }] },
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

  /**
   * Queue one recognition result.
   *
   * The real `Page` type is enormous and mostly irrelevant here: these tests
   * are about how the detector reads the fields it needs, so the payload is
   * intentionally partial.
   */
  async function queueRecognition(
    data: Record<string, unknown>
  ): Promise<void> {
    const worker = await createWorker();
    vi.mocked(worker.recognize).mockResolvedValueOnce({
      data,
    } as unknown as Awaited<ReturnType<typeof worker.recognize>>);
  }

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

  it('falls back to the dimensions the caller supplies', async () => {
    // tesseract.js 7 no longer reports imageWidth/imageHeight, so the caller
    // passes the post-processing size it already knows.
    const result = await detectTextRegions('mocked_image_base64', {
      imageWidth: 640,
      imageHeight: 960,
    });

    expect(result.imageWidth).toBe(640);
    expect(result.imageHeight).toBe(960);
  });

  it('fails loudly when tesseract returns no word boxes at all', async () => {
    // Neither `words` nor `blocks` means the installed tesseract.js does not
    // match what this code reads. Reporting "no text" here would cache an
    // empty page, which is the failure this whole shape check exists for.
    await queueRecognition({ text: '' });

    await expect(detectTextRegions('mocked_image_base64')).rejects.toThrow(
      /OCR 输出形状不匹配/
    );
  });

  it('fails loudly when tesseract reports text but no word boxes', async () => {
    await queueRecognition({ text: 'こんにちは', blocks: [] });

    await expect(detectTextRegions('mocked_image_base64')).rejects.toThrow(
      /有文本，但读不出任何词框/
    );
  });

  it('still reads the legacy flat words shape', async () => {
    await queueRecognition({
      confidence: 90,
      words: [
        {
          bbox: { x0: 0, y0: 0, x1: 100, y1: 50 },
          text: 'Legacy',
          confidence: 90,
        },
      ],
    });

    const result = await detectTextRegions('mocked_image_base64');
    expect(result.regions.map(region => region.text)).toEqual(['Legacy']);
  });

  it('treats an empty result with no text as a genuine empty page', async () => {
    await queueRecognition({ text: '', blocks: [] });

    const result = await detectTextRegions('mocked_image_base64');
    expect(result.regions).toEqual([]);
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
