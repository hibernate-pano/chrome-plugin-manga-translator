import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { processImageMock, cropRegionsMock, combineCroppedRegionsMock } =
  vi.hoisted(() => ({
    processImageMock: vi.fn(),
    cropRegionsMock: vi.fn(),
    combineCroppedRegionsMock: vi.fn(),
  }));

const { detectTextRegionsMock } = vi.hoisted(() => ({
  detectTextRegionsMock: vi.fn(),
}));

vi.mock('./image-processor', async importOriginal => {
  const actual = await importOriginal<typeof import('./image-processor')>();
  return {
    ...actual,
    processImage: processImageMock,
    cropRegions: cropRegionsMock,
    combineCroppedRegions: combineCroppedRegionsMock,
  };
});

vi.mock('./text-detector', async importOriginal => {
  const actual = await importOriginal<typeof import('./text-detector')>();
  return {
    ...actual,
    detectTextRegions: detectTextRegionsMock,
  };
});

import { TranslatorService, normalizeBaseUrl } from './translator';
import { useContentConfigStore } from '@/stores/content-config';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import {
  formatHttpStatusMessage,
  parseTranslationError,
} from '@/utils/error-handler';
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

describe('TranslatorService tiled failure policy', () => {
  beforeEach(() => {
    processImageMock.mockReset();
  });

  function mockProcessImage(): void {
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
  }

  function fullImagePayloads(
    translateImage: ReturnType<typeof vi.fn>
  ): string[] {
    return translateImage.mock.calls
      .map(
        call =>
          (call[0] as unknown as { imageBase64?: string } | undefined)
            ?.imageBase64
      )
      .filter((b64): b64 is string => b64 === 'full-image');
  }

  it('retries the failed tiles instead of paying for the full image', async () => {
    // 12 tiles answered, the 12th had a network blip. The old policy fell
    // back to the full-image path: a 13th request, and the full image of an
    // 800x8000 strip is downscaled to 1024px (102px wide) before it is sent,
    // so the user paid twice for an unreadable thumbnail.
    mockProcessImage();

    let callCount = 0;
    const translateImage = vi.fn(
      async (
        _request: Parameters<TranslationTransport['translateImage']>[0]
      ) => {
        callCount += 1;
        // The very first tile attempt fails once, then everything succeeds.
        if (callCount === 1) {
          throw new Error('network blip');
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

    const result = await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/blip.jpg',
      } as HTMLImageElement,
      false
    );

    expect(result.success).toBe(true);
    // The failed tile was retried, so the strip is complete...
    expect(result.textAreas.length).toBeGreaterThan(0);
    // ...and the full image was never sent.
    expect(fullImagePayloads(translateImage)).toHaveLength(0);
  });

  it('does not fall back to the full image when a tile keeps failing', async () => {
    // The tile fails on the first attempt AND on the retry. Falling back
    // to the full image here would bill a 13th request for a 102px-wide
    // thumbnail of the strip.
    mockProcessImage();

    const translateImage = vi.fn(
      async (
        _request: Parameters<TranslationTransport['translateImage']>[0]
      ) => {
        const request = _request as unknown as {
          imageBase64?: string;
          imageKey?: string;
        };
        if (request.imageBase64 === 'full-image') {
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
        // Only the first tile keeps failing, so the strip is partial but
        // not empty.
        if (request.imageKey?.includes('::t0')) {
          throw new Error('network blip');
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
        src: 'https://example.com/partial.jpg',
      } as HTMLImageElement,
      false
    );

    expect(fullImagePayloads(translateImage)).toHaveLength(0);
  });

  it('still falls back to the full image when every tile fails', async () => {
    // The full-image path is the last resort, and it must stay: it is the
    // only path that can translate a strip whose tiles could not be
    // produced at all.
    mockProcessImage();

    const translateImage = vi.fn(
      async (
        _request: Parameters<TranslationTransport['translateImage']>[0]
      ) => {
        const request = _request as unknown as { imageBase64?: string };
        if (request.imageBase64 === 'full-image') {
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
        throw new Error('CORS blocked');
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
        src: 'https://example.com/all-fail.jpg',
      } as HTMLImageElement,
      false
    );

    expect(fullImagePayloads(translateImage).length).toBeGreaterThan(0);
  });

  it('does not pay for the full image when the model honestly finds no text', async () => {
    // "No text here" is a valid answer, not a failure. Treating it as one
    // billed a second request to learn the same thing.
    mockProcessImage();

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

    expect(result.success).toBe(true);
    expect(fullImagePayloads(translateImage)).toHaveLength(0);
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

describe('normalizeBaseUrl', () => {
  it('treats trailing slashes and host case as cosmetic differences', () => {
    expect(normalizeBaseUrl('https://API.Example.com/v1/')).toBe(
      normalizeBaseUrl('https://api.example.com/v1')
    );
  });

  it('keeps genuinely different endpoints apart', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1')).not.toBe(
      normalizeBaseUrl('https://api.example.com/v2')
    );
    expect(normalizeBaseUrl('https://api.example.com/v1')).not.toBe(
      normalizeBaseUrl('https://gateway.example.com/v1')
    );
  });

  it('returns a stable marker for a missing base URL', () => {
    expect(normalizeBaseUrl(undefined)).toBe('default');
    expect(normalizeBaseUrl('')).toBe('default');
    expect(normalizeBaseUrl('   ')).toBe('default');
  });
});

describe('TranslatorService cache key', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    useTranslationCacheStore.getState().clear();
  });

  function makeTranslator(baseUrl: string): TranslatorService {
    return new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl,
      model: 'gpt-4o',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: {
        translateImage: async () => ({
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
        }),
      } as TranslationTransport,
    });
  }

  it('does not serve a cached translation from a different base URL', async () => {
    // `gpt-4o` is not a unique model name: a gateway, a reseller and
    // OpenAI itself can all answer to it. Serving the old endpoint's
    // translation after the user switched base URLs is wrong.
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'same-image-hash',
    });

    const image = {
      naturalWidth: 800,
      naturalHeight: 600,
      src: 'https://example.com/1.jpg',
    } as HTMLImageElement;

    const first = makeTranslator('https://gateway.example.com/v1');
    await first.translateImage(image);

    // Second translator: same model, same image, different endpoint.
    const translateImage = vi.fn(async () => ({
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
    }));
    const second = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://direct.example.com/v1',
      model: 'gpt-4o',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });

    await second.translateImage(image);

    // A cache hit would have produced zero transport calls.
    expect(translateImage).toHaveBeenCalled();
  });

  it('hits the cache for the same base URL', async () => {
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'same-image-hash',
    });

    const image = {
      naturalWidth: 800,
      naturalHeight: 600,
      src: 'https://example.com/2.jpg',
    } as HTMLImageElement;

    const first = makeTranslator('https://gateway.example.com/v1');
    await first.translateImage(image);

    const translateImage = vi.fn(async () => ({
      success: true,
      textAreas: [],
      cached: false,
    }));
    const second = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      // Same endpoint, cosmetic difference only.
      baseUrl: 'https://gateway.example.com/v1/',
      model: 'gpt-4o',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });

    await second.translateImage(image);

    expect(translateImage).not.toHaveBeenCalled();
  });
});

describe('TranslatorService hybrid region mapping', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    cropRegionsMock.mockReset();
    combineCroppedRegionsMock.mockReset();
    detectTextRegionsMock.mockReset();
    useContentConfigStore.setState({ translationPipeline: 'hybrid-regions' });
  });

  afterEach(() => {
    useContentConfigStore.setState({ translationPipeline: 'full-image-vlm' });
  });

  it('maps a translation onto the region it actually came from', async () => {
    // Three regions, and the SECOND crop fails to load. `combineCroppedRegions`
    // then stacks only the first and the third crop, so the stacked index of
    // the third region is 1, not 2.
    //
    // The old code grouped the provider's answers by the STACKED index and
    // then looked them up with the ORIGINAL region index — so region 1
    // received region 2's translation and region 2 was left empty.
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 600,
      originalHeight: 900,
      width: 600,
      height: 900,
      wasCompressed: false,
      hash: 'hash',
    });

    detectTextRegionsMock.mockResolvedValue({
      regions: [
        { x: 0, y: 0, width: 200, height: 100, text: 'a', confidence: 0.9 },
        { x: 0, y: 200, width: 200, height: 100, text: 'b', confidence: 0.9 },
        { x: 0, y: 400, width: 200, height: 100, text: 'c', confidence: 0.9 },
      ],
      imageWidth: 600,
      imageHeight: 900,
      processingTime: 1,
    });

    cropRegionsMock.mockResolvedValue(['crop0', 'crop1', 'crop2']);

    // The middle crop (source index 1) failed to load: it is not in the
    // stack, and the third crop takes its place.
    combineCroppedRegionsMock.mockResolvedValue({
      base64: 'combined',
      width: 200,
      height: 220,
      segments: [
        { index: 0, sourceIndex: 0, top: 0, height: 100 },
        { index: 1, sourceIndex: 2, top: 120, height: 100 },
      ],
    });

    const translateImage = vi.fn(async () => ({
      success: true,
      cached: false,
      textAreas: [
        {
          x: 0,
          y: 0.1,
          width: 1,
          height: 0.4,
          originalText: 'first',
          translatedText: 'FIRST',
        },
        {
          x: 0,
          y: 0.6,
          width: 1,
          height: 0.4,
          originalText: 'third',
          translatedText: 'THIRD',
        },
      ],
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
        naturalWidth: 600,
        naturalHeight: 900,
        src: 'https://example.com/hybrid.jpg',
      } as HTMLImageElement,
      false
    );

    expect(result.success).toBe(true);
    const entries = result.readingResult?.entries ?? [];
    expect(entries).toHaveLength(2);

    // The first region keeps the FIRST translation.
    const first = entries.find(entry => entry.sourceRegion.y === 0);
    expect(first?.translatedText).toBe('FIRST');

    // The third region (source index 2) keeps the THIRD translation — not
    // the first one, which the stacked-index lookup handed to it.
    const third = entries.find(entry => entry.sourceRegion.y === 400);
    expect(third?.translatedText).toBe('THIRD');

    // The region whose crop failed has no translation at all.
    const missing = entries.find(entry => entry.sourceRegion.y === 200);
    expect(missing).toBeUndefined();
  });
});

describe('TranslatorService error status propagation', () => {
  beforeEach(() => {
    processImageMock.mockReset();
  });

  it('keeps the HTTP status classifiable after the transport boundary', async () => {
    // The transport returns `{success: false, error: "<message>"}` — the
    // error object itself never reaches the content script, so the status
    // has to survive inside the message.
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

    const translateImage = vi.fn(async () => ({
      success: false,
      error: formatHttpStatusMessage(401, 'Invalid API key'),
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
        naturalHeight: 600,
        src: 'https://example.com/1.jpg',
      } as HTMLImageElement,
      false
    );

    expect(result.success).toBe(false);
    const friendly = parseTranslationError(new Error(result.error ?? ''));
    expect(friendly.code).toBe('AUTH_ERROR');
    expect(friendly.message).toBe('API 密钥无效，请检查配置');
  });
});
