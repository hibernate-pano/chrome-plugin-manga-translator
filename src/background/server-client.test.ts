import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG_STORAGE_KEY } from '@/shared/app-config';
import { mockStorage } from '@/test/setup';
import {
  fetchImageBytesResponse,
  testServerConnection,
  translateViaServer,
} from './server-client';

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

function createJsonResponse(
  body: unknown,
  status: number = 200
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('server-client', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
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

  it('fetches remote image bytes successfully', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createBinaryResponse([1, 2, 3], 'image/webp')
    );

    const response = await fetchImageBytesResponse(
      'https://manread.xyz/1268/53087/mr_001.jpg'
    );

    expect(response.success).toBe(true);
    expect(response.mimeType).toBe('image/webp');
    expect(response.imageBase64).toBeDefined();
  });

  it('maps server translation response into typed payload', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        createBinaryResponse([1, 2, 3], 'image/jpeg')
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          success: true,
          textAreas: [
            {
              x: 0.1,
              y: 0.2,
              width: 0.3,
              height: 0.1,
              originalText: 'Hello',
              translatedText: '你好',
            },
          ],
          pipeline: 'ocr-first',
          cached: true,
        })
      );

    const response = await translateViaServer({
      type: 'TRANSLATE_VIA_SERVER',
      imageUrl: 'https://manread.xyz/1268/53087/mr_001.jpg',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    });

    expect(response.success).toBe(true);
    expect(response.pipeline).toBe('ocr-first');
    expect(response.cached).toBe(true);
    expect(response.textAreas).toHaveLength(1);
  });

  it('surfaces auth or health errors from the server', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createJsonResponse({ detail: 'Unauthorized' }, 401)
    );

    const response = await testServerConnection();

    expect(response.success).toBe(false);
    expect(response.message).toBe('Unauthorized');
  });
});
