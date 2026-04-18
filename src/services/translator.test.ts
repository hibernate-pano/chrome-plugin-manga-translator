import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as imageProcessor from './image-processor';
import * as textDetector from './text-detector';
import { createTranslatorFromConfig, resetTranslator } from './translator';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import { useAppConfigStore } from '@/stores/config-v2';
import type { TextArea } from '@/providers/base';

const MOCK_API_KEY = 'sk-test-mock-api-key-12345678901234567890';

function createMockImage(
  width = 800,
  height = 600,
  src = 'https://example.com/manga.jpg'
): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(img, 'naturalHeight', {
    value: height,
    configurable: true,
  });
  Object.defineProperty(img, 'width', { value: width, configurable: true });
  Object.defineProperty(img, 'height', { value: height, configurable: true });
  Object.defineProperty(img, 'offsetWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(img, 'offsetHeight', {
    value: height,
    configurable: true,
  });
  img.src = src;
  return img;
}

function mockOpenAIResponse(textAreas: TextArea[]) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [
          {
            message: {
              content: JSON.stringify({ textAreas }),
            },
          },
        ],
      }),
  };
}

describe('TranslatorService text detection flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetTranslator();
    useAppConfigStore.getState().resetToDefaults();
    useTranslationCacheStore.getState().clear();

    useAppConfigStore.getState().setProvider('openai');
    useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
    HTMLCanvasElement.prototype.toDataURL = vi
      .fn()
      .mockReturnValue('data:image/jpeg;base64,full-image-base64');
  });

  it('maps cropped-region coordinates back to the original image', async () => {
    const img = createMockImage();
    const fetchMock = vi.fn().mockResolvedValue(
      mockOpenAIResponse([
        {
          x: 0.35,
          y: 0.53125,
          width: 0.3,
          height: 0.25,
          originalText: 'テスト',
          translatedText: '测试',
        },
      ])
    );
    globalThis.fetch = fetchMock as typeof fetch;

    vi.spyOn(textDetector, 'detectTextRegions').mockResolvedValue({
      regions: [
        { x: 100, y: 50, width: 200, height: 100, text: 'a', confidence: 0.9 },
        { x: 400, y: 200, width: 100, height: 200, text: 'b', confidence: 0.9 },
      ],
      imageWidth: 800,
      imageHeight: 600,
      processingTime: 5,
    });
    vi.spyOn(textDetector, 'mergeOverlappingRegions').mockImplementation(
      regions => regions
    );
    vi.spyOn(imageProcessor, 'cropRegions').mockResolvedValue([
      'crop-1-base64',
      'crop-2-base64',
    ]);
    vi.spyOn(imageProcessor, 'combineCroppedRegions').mockReturnValue(
      'combined-crop-base64'
    );

    const translator = createTranslatorFromConfig();
    const result = await translator.translateImage(img);

    expect(result.success).toBe(true);
    expect(result.textAreas).toHaveLength(1);
    expect(result.textAreas[0]).toMatchObject({
      x: 420,
      y: 250,
      width: 60,
      height: 80,
      translatedText: '测试',
    });

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')
    ) as {
      messages?: Array<{
        content?: Array<{
          type?: string;
          image_url?: { url?: string };
        }>;
      }>;
    };
    const imageUrl = request.messages?.[0]?.content?.find(
      part => part.type === 'image_url'
    )?.image_url?.url;
    expect(imageUrl).toContain('combined-crop-base64');
  });

  it('falls back to the full image when text detection fails', async () => {
    const img = createMockImage();
    const fetchMock = vi.fn().mockResolvedValue(
      mockOpenAIResponse([
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
          originalText: 'fallback',
          translatedText: '回退成功',
        },
      ])
    );
    globalThis.fetch = fetchMock as typeof fetch;

    vi.spyOn(textDetector, 'detectTextRegions').mockRejectedValue(
      new Error('worker init failed')
    );
    const cropSpy = vi.spyOn(imageProcessor, 'cropRegions');
    const combineSpy = vi.spyOn(imageProcessor, 'combineCroppedRegions');

    const translator = createTranslatorFromConfig();
    const result = await translator.translateImage(img);

    expect(result.success).toBe(true);
    expect(result.textAreas[0]?.translatedText).toBe('回退成功');
    expect(cropSpy).not.toHaveBeenCalled();
    expect(combineSpy).not.toHaveBeenCalled();

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')
    ) as {
      messages?: Array<{
        content?: Array<{
          type?: string;
          image_url?: { url?: string };
        }>;
      }>;
    };
    const imageUrl = request.messages?.[0]?.content?.find(
      part => part.type === 'image_url'
    )?.image_url?.url;
    expect(imageUrl).toContain('full-image-base64');
  });
});
