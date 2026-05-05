import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchImageBytesFromPage,
  shouldRetryWithPageImageFetch,
} from './image-fetch';

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

describe('image-fetch', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it('marks 403 image fetch errors as eligible for page fallback', () => {
    expect(
      shouldRetryWithPageImageFetch('发生未知错误：无法获取图片 (403)')
    ).toBe(true);
    expect(shouldRetryWithPageImageFetch('服务端返回 500')).toBe(false);
  });

  it('fetches cross-origin image bytes without credentials to avoid wildcard CORS rejection', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createBinaryResponse([1, 2, 3], 'image/jpeg')
    );

    const result = await fetchImageBytesFromPage(
      'https://manread.xyz/12428/130293/mr_001.jpg',
      'https://manhwaread.com/manhwa/close-as-neighbors-uncensored/chapter-01/'
    );

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.imageBase64).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(
      'https://manread.xyz/12428/130293/mr_001.jpg',
      expect.objectContaining({
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
        referrer:
          'https://manhwaread.com/manhwa/close-as-neighbors-uncensored/chapter-01/',
        referrerPolicy: 'strict-origin-when-cross-origin',
      })
    );
  });
});
