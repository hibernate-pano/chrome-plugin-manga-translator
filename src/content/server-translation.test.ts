import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG_STORAGE_KEY } from '@/shared/app-config';
import { mockStorage } from '@/test/setup';
import { requestServerTranslation } from './server-translation';

function createBinaryResponse(
  bytes: number[],
  mimeType: string
): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': mimeType }),
    arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from(bytes).buffer),
  } as unknown as Response;
}

describe('requestServerTranslation', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockReset();

    mockStorage[APP_CONFIG_STORAGE_KEY] = {
      state: {
        enabled: false,
        server: {
          baseUrl: 'http://127.0.0.1:8000',
          authToken: 'secret',
          timeoutMs: 30000,
        },
        targetLanguage: 'zh-CN',
        translationStylePreset: 'natural-zh',
      },
      version: 0,
    };
  });

  it('retries with page-fetched image bytes when background image fetch gets 403', async () => {
    vi.mocked(chrome.runtime.sendMessage)
      .mockResolvedValueOnce({
        success: false,
        textAreas: [],
        pipeline: 'full-image-fallback',
        cached: false,
        error: '发生未知错误：无法获取图片 (403)',
      })
      .mockResolvedValueOnce({
        success: true,
        textAreas: [
          {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.15,
            originalText: 'Hello',
            translatedText: '你好',
          },
        ],
        pipeline: 'ocr-first',
        cached: false,
      });
    vi.mocked(fetch).mockResolvedValueOnce(
      createBinaryResponse([1, 2, 3], 'image/webp')
    );

    const response = await requestServerTranslation(
      'https://manread.xyz/12428/130293/mr_001.jpg',
      'https://manhwaread.com/manhwa/close-as-neighbors-uncensored/chapter-01/'
    );

    expect(response.success).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'TRANSLATE_VIA_SERVER',
      imageUrl: 'https://manread.xyz/12428/130293/mr_001.jpg',
      sourcePageUrl:
        'https://manhwaread.com/manhwa/close-as-neighbors-uncensored/chapter-01/',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
      forceRefresh: false,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'TRANSLATE_IMAGE_BYTES_VIA_SERVER',
        imageUrl: 'https://manread.xyz/12428/130293/mr_001.jpg',
        sourcePageUrl:
          'https://manhwaread.com/manhwa/close-as-neighbors-uncensored/chapter-01/',
        mimeType: 'image/webp',
        targetLanguage: 'zh-CN',
        translationStylePreset: 'natural-zh',
        forceRefresh: false,
      })
    );
  });

  it('does not retry through the page for non-image-fetch errors', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: false,
      textAreas: [],
      pipeline: 'full-image-fallback',
      cached: false,
      error: '服务端返回 500',
    });

    const response = await requestServerTranslation(
      'https://manread.xyz/12428/130293/mr_001.jpg',
      'https://manhwaread.com/manhwa/close-as-neighbors-uncensored/chapter-01/'
    );

    expect(response.success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });
});
