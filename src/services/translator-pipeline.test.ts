import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processImageMock } = vi.hoisted(() => ({
  processImageMock: vi.fn(),
}));

vi.mock('./image-processor', async importOriginal => {
  const actual = await importOriginal<typeof import('./image-processor')>();
  return {
    ...actual,
    processImage: processImageMock,
  };
});

import { TranslatorService } from './translator';
import type { TranslationTransport } from './translation-transport';

describe('TranslatorService pipeline selection', () => {
  beforeEach(() => {
    processImageMock.mockReset();
  });

  it('always tiles long images and sends cropped regions', async () => {
    processImageMock.mockImplementation(async (_image, options) => {
      const crop = options?.cropRegion;
      return {
        base64: crop ? `tile-${crop.top}` : 'full-image',
        mimeType: 'image/jpeg',
        originalWidth: 800,
        originalHeight: 4000,
        width: crop ? 800 : 800,
        height: crop ? crop.height : 4000,
        wasCompressed: false,
        hash: crop ? `hash-${crop.top}` : 'hash-full',
        cropY: crop?.top ?? 0,
        cropHeight: crop?.height ?? 4000,
      };
    });

    const translateImage = vi.fn(
      async (
        _request: Parameters<TranslationTransport['translateImage']>[0]
      ) => ({
        success: true,
        textAreas: [
          {
            x: 0.1,
            y: 0.1,
            width: 0.2,
            height: 0.1,
            originalText: '原文',
            translatedText: '译文',
          },
        ],
        cached: false,
      })
    );
    const transport: TranslationTransport = { translateImage };
    const translator = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport,
    });

    const result = await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/long-strip.jpg',
      } as HTMLImageElement,
      false
    );

    const tileCalls = processImageMock.mock.calls.filter(
      ([, options]) => options?.cropRegion
    );
    expect(result.success).toBe(true);
    expect(tileCalls.length).toBeGreaterThan(1);
    expect(translateImage).toHaveBeenCalledTimes(tileCalls.length);
    expect(translateImage.mock.calls[0]?.[0].imageKey).toContain('::t0');
  });

  it('does not pay for a full-image request when tiles honestly find no text', async () => {
    // A pure-art stretch of a webtoon is a valid answer, not a pipeline
    // failure. Treating it as a failure fell through to the full-image path
    // and billed a second request to learn the same thing.
    processImageMock.mockImplementation(async (_image, options) => {
      const crop = options?.cropRegion;
      return {
        base64: crop ? `tile-${crop.top}` : 'full-image',
        mimeType: 'image/jpeg',
        originalWidth: 800,
        originalHeight: 4000,
        width: 800,
        height: crop ? crop.height : 4000,
        wasCompressed: false,
        hash: crop ? `hash-${crop.top}` : 'hash-full',
        cropY: crop?.top ?? 0,
        cropHeight: crop?.height ?? 4000,
      };
    });

    const translateImage = vi.fn(async () => ({
      success: true,
      textAreas: [],
      cached: false,
    }));
    const translator = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });

    const result = await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/art-only.jpg',
      } as HTMLImageElement,
      false
    );

    const fullImageCalls = processImageMock.mock.calls.filter(
      ([, options]) => !options?.cropRegion
    );
    expect(result.success).toBe(true);
    expect(result.textAreas).toHaveLength(0);
    // One call for the initial pass of the whole image, then only tile crops.
    expect(fullImageCalls).toHaveLength(1);
  });

  it('degrades when only some tiles answered and none produced text', async () => {
    // The dangerous middle case: 3 tiles throw and 1 answers "nothing here".
    // Counting that single reply as a complete run returned success with zero
    // areas, which skipped the full-image fallback, left three quarters of the
    // chapter untranslated, and marked the image processed so it was never
    // retried — a silent data loss disguised as a fix for double billing.
    processImageMock.mockImplementation(async (_image, options) => {
      const crop = options?.cropRegion;
      return {
        base64: crop ? `tile-${crop.top}` : 'full-image',
        mimeType: 'image/jpeg',
        originalWidth: 800,
        originalHeight: 4000,
        width: 800,
        height: crop ? crop.height : 4000,
        wasCompressed: false,
        hash: crop ? `hash-${crop.top}` : 'hash-full',
        cropY: crop?.top ?? 0,
        cropHeight: crop?.height ?? 4000,
      };
    });

    let tileCalls = 0;
    const translateImage = vi.fn(
      async (
        _request: Parameters<TranslationTransport['translateImage']>[0]
      ) => {
        tileCalls += 1;
        // Tile 0 answers empty; every other tile fails.
        if (tileCalls <= 2) {
          return { success: true, textAreas: [], cached: false };
        }
        throw new Error('provider 500');
      }
    );
    const translator = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });

    await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/partial-strip.jpg',
      } as HTMLImageElement,
      false
    );

    // The full-image bytes must be attempted rather than reporting a clean
    // empty page.
    const fullImagePayloads = translateImage.mock.calls
      .map(
        call =>
          (call[0] as unknown as { imageBase64?: string } | undefined)
            ?.imageBase64
      )
      .filter(b64 => b64 === 'full-image');
    expect(fullImagePayloads.length).toBeGreaterThan(0);
  });

  it('still falls back to the full-image path when every tile request fails', async () => {
    // Real transport failures must keep the degradation path, otherwise a CORS
    // block on the original image leaves the strip untranslated forever.
    processImageMock.mockImplementation(async (_image, options) => {
      const crop = options?.cropRegion;
      return {
        base64: crop ? `tile-${crop.top}` : 'full-image',
        mimeType: 'image/jpeg',
        originalWidth: 800,
        originalHeight: 4000,
        width: 800,
        height: crop ? crop.height : 4000,
        wasCompressed: false,
        hash: crop ? `hash-${crop.top}` : 'hash-full',
        cropY: crop?.top ?? 0,
        cropHeight: crop?.height ?? 4000,
      };
    });

    let callCount = 0;
    const translateImage = vi.fn(
      async (
        _request: Parameters<TranslationTransport['translateImage']>[0]
      ) => {
        callCount += 1;
        if (callCount <= 20) {
          throw new Error('CORS blocked');
        }
        return {
          success: true,
          textAreas: [
            {
              x: 0.1,
              y: 0.1,
              width: 0.2,
              height: 0.1,
              originalText: '原文',
              translatedText: '译文',
            },
          ],
          cached: false,
        };
      }
    );
    const translator = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });

    await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/blocked.jpg',
      } as HTMLImageElement,
      false
    );

    const fullImagePayloads = translateImage.mock.calls
      .map(
        call =>
          (call[0] as unknown as { imageBase64?: string } | undefined)
            ?.imageBase64
      )
      .filter(b64 => b64 === 'full-image');
    // The fallback reuses the whole-image bytes processed once up front, so
    // the evidence is a transport call carrying them, not a second processImage.
    expect(fullImagePayloads.length).toBeGreaterThan(0);
  });
});

describe('TranslatorService coordinate mapping', () => {
  beforeEach(() => {
    processImageMock.mockReset();
  });

  it('maps tile-relative areas back into original-image coordinates', async () => {
    // 4000-tall strip splits into ~4 tiles; tile 1 starts at some top T.
    // A provider response is always tile-relative, so the merged output must
    // place the area at y = T + relY * scale.
    processImageMock.mockImplementation(async (_image, options) => {
      const crop = options?.cropRegion;
      return {
        base64: crop ? `tile-${crop.top}` : 'full-image',
        mimeType: 'image/jpeg',
        originalWidth: 800,
        originalHeight: 4000,
        width: 800,
        height: crop ? crop.height : 4000,
        wasCompressed: false,
        hash: crop ? `hash-${crop.top}` : 'hash-full',
        cropY: crop?.top ?? 0,
        cropHeight: crop?.height ?? 4000,
      };
    });

    const translateImage = vi.fn(
      async (
        request: Parameters<TranslationTransport['translateImage']>[0]
      ) => {
        // Each tile: one area in the middle of the tile, tile-relative.
        const tileTop = Number(
          /tile-(\d+)/.exec(request.imageBase64 ?? '')?.[1] ?? 0
        );
        const yRel = tileTop / 4000;
        return {
          success: true,
          cached: false,
          textAreas: [
            {
              x: 0.5,
              y: yRel + 0.2,
              width: 0.2,
              height: 0.05,
              originalText: '原文',
              translatedText: `译${Math.round(yRel * 100)}`,
            },
          ],
        };
      }
    );
    const translator = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });

    const result = await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/strip.jpg',
      } as HTMLImageElement,
      false
    );

    expect(result.success).toBe(true);
    const ys = result.textAreas.map(a => a.y);
    // Areas must be spread across the strip, not stacked at the top.
    expect(Math.max(...ys)).toBeGreaterThan(0.5);
    // Coordinates stay normalized.
    for (const area of result.textAreas) {
      expect(area.y).toBeGreaterThanOrEqual(0);
      expect(area.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('TranslatorService batch runner', () => {
  beforeEach(() => {
    processImageMock.mockReset();
  });

  function makeTranslator(): TranslatorService {
    return new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport: {
        translateImage: async () => ({
          success: true,
          textAreas: [],
          cached: false,
        }),
      } as TranslationTransport,
    });
  }

  it('translateImages reports progress and collects results in order', async () => {
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'hash',
    });

    const translator = makeTranslator();
    const images = [1, 2, 3].map(
      i =>
        ({
          naturalWidth: 800,
          naturalHeight: 600,
          src: `https://example.com/${i}.jpg`,
        }) as HTMLImageElement
    );

    const progress: number[] = [];
    const results = await translator.translateImages(images, p =>
      progress.push(p.current)
    );

    expect(results).toHaveLength(3);
    expect(progress).toEqual([1, 2, 3]);
  });

  it('cancel stops the batch loop early', async () => {
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'hash',
    });

    const translator = makeTranslator();
    const images = [1, 2, 3, 4].map(
      i =>
        ({
          naturalWidth: 800,
          naturalHeight: 600,
          src: `https://example.com/${i}.jpg`,
        }) as HTMLImageElement
    );

    const originalTranslate = translator.translateImage.bind(translator);
    let calls = 0;
    vi.spyOn(translator, 'translateImage').mockImplementation(
      async (img, force) => {
        calls += 1;
        const result = await originalTranslate(
          img as HTMLImageElement,
          force ?? false
        );
        if (calls >= 1) {
          translator.cancel();
        }
        return result;
      }
    );

    const results = await translator.translateImages(images);
    expect(results.length).toBeLessThan(images.length);
  });

  it('validateConfig and updateConfig guard configuration', async () => {
    const translator = makeTranslator();
    await expect(translator.validateConfig()).resolves.toMatchObject({
      valid: true,
    });

    translator.updateConfig({ apiKey: '' });
    await expect(translator.validateConfig()).resolves.toMatchObject({
      valid: false,
    });
    expect(translator.getConfig().apiKey).toBe('');
  });
});
