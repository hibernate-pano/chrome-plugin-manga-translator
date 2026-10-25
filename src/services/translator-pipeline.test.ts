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

import {
  TranslatorService,
  computeTiles,
  normalizeBaseUrl,
} from './translator';
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

  it('carries the priority class to every request of the image', async () => {
    // 队列按这个标记排序，所以它必须一路传到 worker 发出的那一条请求上
    // ——中间任何一段丢掉它，排序就还是"谁先到"。
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
    const translator = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport: { translateImage },
    });

    await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/long-strip.jpg',
      } as HTMLImageElement,
      false,
      undefined,
      { priorityClass: 'manual-retry' }
    );

    expect(translateImage).toHaveBeenCalled();
    for (const call of translateImage.mock.calls) {
      expect(call[0].priorityClass).toBe('manual-retry');
    }
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

  it('reports the failure and its reason when only some tiles failed', async () => {
    // The dangerous middle case: some tiles throw and the rest answer
    // "nothing here". Counting that as a complete run returned success with
    // zero areas, which skipped the full-image fallback, left three quarters
    // of the chapter untranslated, and marked the image processed so it was
    // never retried — a silent data loss disguised as a fix for double
    // billing.
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
        // The first two tiles answer "nothing here"; every other tile fails.
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

    const result = await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/partial-strip.jpg',
      } as HTMLImageElement,
      false
    );

    /*
     * 这条断言改过。
     *
     * 以前它断言"整图必须被发出去"（有一条 full-image 的请求）。那时候它
     * 成立的原因很偶然：模型回答"这里没有文字"时，那一片会被再问一次，而
     * 第二次问会失败——于是**每一片**都变成失败，整条走进"全部失败"分支，
     * 整图兜底才被允许。那是"每一片都失败"的兜底，不是"部分失败"的策略。
     *
     * 现在不再为一个"这里没有文字"的答案多问一次（那只是多花一次钱换回
     * 同一句话），于是真正失败的只有那几片。这条漫画因此走"部分失败"分支：
     * 报错、留在未处理状态、让读者按张重试——而**不**再付一次整图的钱。
     * 整图那条路会把 800x4000 压成 205x1024 送出去，读者拿到的是一张
     * 看不清字的图。
     *
     * 真正要守住的是两条：不能报成"翻译成功但什么都没有"，以及不能多花
     * 一次整图的钱。
     */
    expect(result.success).toBe(false);
    expect(result.textAreas).toHaveLength(0);
    // The reader is told how many tiles failed and why — a count alone
    // ("2/4 个切片翻译失败") leaves them with nothing to act on.
    expect(result.error).toMatch(/\d+\/4 个切片翻译失败/);
    expect(result.error).toContain('provider 500');

    const fullImagePayloads = translateImage.mock.calls
      .map(
        call =>
          (call[0] as unknown as { imageBase64?: string } | undefined)
            ?.imageBase64
      )
      .filter(b64 => b64 === 'full-image');
    expect(fullImagePayloads).toHaveLength(0);
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

  it('a tile that honestly has no text is asked once, not twice', async () => {
    // "这里没有文字"是一个**答案**。以前它会被再问一次 —— 多花一次钱，
    // 换回同一句"这里没有文字"。一条十二片的条漫里要是有一半是纯画面，
    // 那一半的钱就白花了两遍。
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
        src: 'https://example.com/art-only-strip.jpg',
      } as HTMLImageElement,
      false
    );

    const tiles = computeTiles(800, 4000);
    expect(result.success).toBe(true);
    // 一次请求，一片。
    expect(translateImage).toHaveBeenCalledTimes(tiles.length);
  });

  it('a tile that found boxes but no translation is still asked again', async () => {
    // 这一条是上面那条的另一半：模型找到了框却没给译文，这是可疑的，
    // 再问一次有可能拿到译文。两件事不能混为一谈。
    mockProcessImage();

    const translateImage = vi.fn(async () => ({
      success: true,
      textAreas: [
        {
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.1,
          originalText: '原文',
          translatedText: '  ',
        },
      ],
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

    await translator.translateImage(
      {
        naturalWidth: 800,
        naturalHeight: 4000,
        src: 'https://example.com/empty-translation.jpg',
      } as HTMLImageElement,
      false
    );

    const tiles = computeTiles(800, 4000);
    // 每片问两次：第一次没译文，第二次再问一次。
    expect(translateImage).toHaveBeenCalledTimes(tiles.length * 2);
  });

  it('the reader cancelling stops the tile loop', async () => {
    // 一条长条漫会被切成十几片。读者点取消之后，剩下的片不该再一张张发
    // 出去 —— 那是十几笔已经付出去的钱，换来一段读者根本没要的译文。
    //
    // 以前切片这一层读的是一个**从来没被赋值过**的字段，所以那个信号一直
    // 是 undefined：取消之后长条漫照跑照计费。
    mockProcessImage();

    const previousLimit = useContentConfigStore.getState().parallelLimit;
    useContentConfigStore.setState({ parallelLimit: 1 });

    try {
      const controller = new AbortController();
      const translateImage = vi.fn(
        async (
          _request: Parameters<TranslationTransport['translateImage']>[0]
        ) => {
          // 读者在第一片发出去之后按了取消。
          controller.abort();
          return { success: true, textAreas: [], cached: false };
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
          src: 'https://example.com/cancelled.jpg',
        } as HTMLImageElement,
        false,
        undefined,
        { signal: controller.signal }
      );

      const tiles = computeTiles(800, 4000);
      expect(tiles.length).toBeGreaterThan(1);
      // 只有第一片发出去了。
      expect(translateImage).toHaveBeenCalledTimes(1);
      // 取消之后也不该去走整图那条路。
      expect(fullImagePayloads(translateImage)).toHaveLength(0);
    } finally {
      useContentConfigStore.setState({ parallelLimit: previousLimit });
    }
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
    // The strip is not a comic page, so the request has to say so: the
    // provider picks a prompt from it, and the full-image prompt tells the
    // model to merge a bubble's lines into one item — on a stack of
    // unrelated crops that merges two different bubbles.
    expect(translateImage).toHaveBeenCalledWith(
      expect.objectContaining({ isHybridRegions: true })
    );
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

  it('keeps two bubbles inside one region as two boxes', async () => {
    // OCR merges overlapping regions, so one region can hold two bubbles —
    // and the model answers with two boxes for it. The old code joined their
    // texts and drew ONE overlay covering the whole region: the two
    // translations were crammed into a single box that also covered the
    // space between the bubbles.
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
        { x: 100, y: 200, width: 200, height: 100, text: 'a', confidence: 0.9 },
      ],
      imageWidth: 600,
      imageHeight: 900,
      processingTime: 1,
    });

    cropRegionsMock.mockResolvedValue(['crop0']);

    // One crop, 200×100, stacked at the top of a 200×100 strip.
    combineCroppedRegionsMock.mockResolvedValue({
      base64: 'combined',
      width: 200,
      height: 100,
      segments: [
        { index: 0, sourceIndex: 0, top: 0, height: 100, left: 0, width: 200 },
      ],
    });

    // Two boxes inside the crop: the upper half and the lower half.
    const translateImage = vi.fn(async () => ({
      success: true,
      cached: false,
      textAreas: [
        {
          x: 0.1,
          y: 0.1,
          width: 0.8,
          height: 0.35,
          originalText: 'upper',
          translatedText: 'UPPER',
        },
        {
          x: 0.1,
          y: 0.55,
          width: 0.8,
          height: 0.35,
          originalText: 'lower',
          translatedText: 'LOWER',
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
    expect(result.textAreas).toHaveLength(2);

    const [upper, lower] = result.textAreas;
    expect(upper?.translatedText).toBe('UPPER');
    expect(lower?.translatedText).toBe('LOWER');

    // The boxes are the model's own boxes, mapped back onto the region: the
    // region starts at x = 100, y = 200 and is 200×100 in the original
    // image, so the upper box starts a tenth of the region down and the
    // lower one just past its halfway point.
    expect(upper?.x).toBeCloseTo((100 + 0.1 * 200) / 600, 5);
    expect(upper?.y).toBeCloseTo((200 + 0.1 * 100) / 900, 5);
    expect(upper?.width).toBeCloseTo((0.8 * 200) / 600, 5);
    expect(upper?.height).toBeCloseTo((0.35 * 100) / 900, 5);

    expect(lower?.y).toBeCloseTo((200 + 0.55 * 100) / 900, 5);
    expect(lower?.y).toBeGreaterThan(upper?.y ?? 0);

    // Neither box is the whole region: that was the old, wrong behaviour.
    expect(upper?.height).toBeLessThan((200 + 100) / 900);
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

  it('keeps the numeric status, not just the text', async () => {
    // 状态码以数字的形式一路走回来，是为了让"分类器"还有东西可读：文本
    // 里的 `[HTTP nnn]` 标记只有出现在消息**开头**才认得，而 worker 拼出
    // 的句子中间那个标记谁也读不到。
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
      error: 'Invalid API key',
      errorStatus: 401,
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
        src: 'https://example.com/2.jpg',
      } as HTMLImageElement,
      false
    );

    expect(result.success).toBe(false);
    expect(result.errorStatus).toBe(401);
  });
});

// ================================================================
// A strip that honestly has no text is still an answer
//
// The tiled pipeline asks the model about every slice of a long webtoon.
// A slice that is pure artwork comes back with nothing — that is the model
// answering correctly, not a failure.
//
// The cache only took strips that produced text, so a text-free strip was
// never remembered: every visit to that page paid for every slice again,
// and every slice that came back empty was asked twice (the quality gate
// re-asks a slice with no text). The full-image path keeps its "no text is
// not cached" rule on purpose — one request is cheap, and a page the model
// mis-read stays retryable. A strip is N requests.
// ================================================================
describe('a strip with no text is cached like any other answer', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    useTranslationCacheStore.getState().clear();
  });

  function makeStripTranslator(
    translateImage: ReturnType<typeof vi.fn>
  ): TranslatorService {
    return new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as unknown as TranslationTransport,
    });
  }

  const strip = {
    naturalWidth: 800,
    naturalHeight: 4000,
    src: 'https://example.com/art-strip.jpg',
  } as HTMLImageElement;

  it('does not ask the provider about the same strip twice', async () => {
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
    const translator = makeStripTranslator(translateImage);

    const first = await translator.translateImage(strip, false);
    expect(first.success).toBe(true);
    expect(first.textAreas).toHaveLength(0);
    const callsAfterTheFirstRun = translateImage.mock.calls.length;
    expect(callsAfterTheFirstRun).toBeGreaterThan(0);

    // The same page, the same strip, the same day: the answer is already
    // known. Asking again is money for the same words.
    const second = await translator.translateImage(strip, false);

    expect(translateImage).toHaveBeenCalledTimes(callsAfterTheFirstRun);
    expect(second.success).toBe(true);
    expect(second.textAreas).toHaveLength(0);
    expect(second.cached).toBe(true);
  });
});

describe('a page with no text is cached like any other answer', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    detectTextRegionsMock.mockReset();
    useTranslationCacheStore.getState().clear();
  });

  const page = {
    naturalWidth: 800,
    naturalHeight: 600,
    src: 'https://example.com/blank-page.jpg',
  } as HTMLImageElement;

  it('does not ask the provider about the same page twice', async () => {
    // The listing promises "same image, no repeat request". A page the model
    // and the OCR both read as empty used to break that promise: the answer
    // was never remembered, so every visit billed another request.
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'blank-page-hash',
    });
    // No OCR region either: the fallback finds nothing and steps aside.
    detectTextRegionsMock.mockResolvedValue({ regions: [] });

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
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as unknown as TranslationTransport,
    });

    const first = await translator.translateImage(page, false);
    expect(first.success).toBe(true);
    expect(first.textAreas).toHaveLength(0);
    const callsAfterTheFirstRun = translateImage.mock.calls.length;
    expect(callsAfterTheFirstRun).toBeGreaterThan(0);

    const second = await translator.translateImage(page, false);

    expect(translateImage).toHaveBeenCalledTimes(callsAfterTheFirstRun);
    expect(second.success).toBe(true);
    expect(second.textAreas).toHaveLength(0);
    expect(second.cached).toBe(true);
  });

  it('still re-asks when the model found boxes but translated nothing', async () => {
    // The other kind of "empty" is a fake success: the model pointed at
    // speech bubbles and left every one of them blank. That deserves a
    // second try, so it must not be remembered.
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'fake-success-hash',
    });
    detectTextRegionsMock.mockResolvedValue({ regions: [] });

    const translateImage = vi.fn(async () => ({
      success: true,
      textAreas: [
        {
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.1,
          originalText: '原文',
          translatedText: '   ',
        },
      ],
      cached: false,
    }));
    const translator = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as unknown as TranslationTransport,
    });

    await translator.translateImage(page, false);
    const callsAfterTheFirstRun = translateImage.mock.calls.length;

    await translator.translateImage(page, false);

    expect(translateImage.mock.calls.length).toBeGreaterThan(
      callsAfterTheFirstRun
    );
  });
});

// ================================================================
// A fallback that could not run is not the same answer as
// "this image has no text".
//
// The full-image path asks the model, gets nothing, and then asks
// Tesseract to look instead. When Tesseract itself fails — the language
// pack downloads from cdn.jsdelivr.net, which is not reachable
// everywhere — the old code swallowed the error and returned
// `success: true` with zero areas. That image counted as translated, the
// HUD said 译文已直接覆盖在原图上 over an untouched page, and the empty
// answer was written to the cache, so opening the page again never asked
// a second time. The reader paid and got nothing, permanently.
// ================================================================
describe('an OCR fallback that failed is a failed image, not an empty answer', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    detectTextRegionsMock.mockReset();
    useContentConfigStore.setState({ translationPipeline: 'full-image-vlm' });
    useTranslationCacheStore.getState().clear();
  });

  afterEach(() => {
    useContentConfigStore.setState({ translationPipeline: 'full-image-vlm' });
  });

  const page = {
    naturalWidth: 800,
    naturalHeight: 600,
    src: 'https://example.com/no-text.jpg',
  } as HTMLImageElement;

  function makeTranslator(transport: TranslationTransport): TranslatorService {
    return new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport,
    });
  }

  function mockProcessing(): void {
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'no-text-hash',
    });
  }

  it('reports the failure instead of a successful empty translation', async () => {
    mockProcessing();
    // The model saw nothing, and the fallback could not run.
    detectTextRegionsMock.mockRejectedValue(
      new Error('Failed to load language pack from cdn.jsdelivr.net')
    );

    const translateImage = vi.fn(async () => ({
      success: true,
      cached: false,
      textAreas: [],
    }));

    const result = await makeTranslator({
      translateImage,
    } as TranslationTransport).translateImage(page, false);

    expect(detectTextRegionsMock).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('does not cache that empty answer', async () => {
    mockProcessing();
    detectTextRegionsMock.mockRejectedValue(new Error('language pack failed'));

    const translateImage = vi.fn(async () => ({
      success: true,
      cached: false,
      textAreas: [],
    }));

    await makeTranslator({
      translateImage,
    } as TranslationTransport).translateImage(page, false);

    // No cached entry means the next visit asks again, which is the whole
    // point: the reader did not get an answer, so we must not pretend we
    // already have one.
    expect(useTranslationCacheStore.getState().cache.size).toBe(0);
  });

  it('still treats "OCR ran and found nothing" as an answer', async () => {
    mockProcessing();
    detectTextRegionsMock.mockResolvedValue({
      regions: [],
      imageWidth: 800,
      imageHeight: 600,
      processingTime: 1,
    });

    const translateImage = vi.fn(async () => ({
      success: true,
      cached: false,
      textAreas: [],
    }));

    const result = await makeTranslator({
      translateImage,
    } as TranslationTransport).translateImage(page, false);

    // Detection completed and reported no text. That is a real answer and
    // stays a success — the image simply has nothing to translate.
    expect(result.success).toBe(true);
    expect(result.textAreas).toHaveLength(0);
  });
});

/**
 * 找到了、也给了译文，却没有地方可以画。
 *
 * 模型给了一个框，但没给全（或者根本没给），于是这条译文没有位置。
 * 页面上的气泡比模型找到的少 —— 差的这几个还留着原文，而这一轮被记成
 * 成功。读者只看到「翻译完成」，只当自己看漏了。
 *
 * 这个数字以前没人告诉读者：解析层数出了"画不上去的条目"，worker 把它
 * 带回来了，翻译器把它算进"没翻出来"，页面把它说给读者。
 */
describe('a translation the model could not place', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    detectTextRegionsMock.mockReset();
    useTranslationCacheStore.getState().clear();
    useContentConfigStore.setState({ translationPipeline: 'full-image-vlm' });
  });

  afterEach(() => {
    useContentConfigStore.setState({ translationPipeline: 'full-image-vlm' });
  });

  const page = {
    naturalWidth: 800,
    naturalHeight: 600,
    src: 'https://example.com/page.jpg',
  } as HTMLImageElement;

  it('is counted as not translated, and the page says so', async () => {
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'unplaced-hash',
    });

    const translateImage = vi.fn(async () => ({
      success: true,
      cached: false,
      textAreas: [
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
          originalText: 'こんにちは',
          translatedText: '你好',
        },
      ],
      // The model found two more bubbles and gave no box for either.
      unplacedCount: 2,
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

    const result = await translator.translateImage(page, false);

    expect(result.success).toBe(true);
    // 画上去的一句不算少，画不上去的两句要算进去。
    expect(result.missingCount).toBe(2);
  });
});
