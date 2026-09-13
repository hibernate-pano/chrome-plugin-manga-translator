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
});
