/**
 * LM Studio Provider Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LMStudioProvider } from './lm-studio';
import { httpRequest } from '@/utils/http-client';

vi.mock('@/utils/http-client', () => ({
  httpRequest: vi.fn(),
}));

describe('LMStudioProvider', () => {
  let provider: LMStudioProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new LMStudioProvider();
    vi.mocked(httpRequest).mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should initialize with default config', async () => {
    await provider.initialize({});
    expect(provider.name).toBe('LM Studio');
    expect(provider.type).toBe('lm-studio');
  });

  describe('checkHealth', () => {
    it('should return healthy when server responds with 200 OK', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });
      const result = await provider.checkHealth();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:1234/v1/models', expect.any(Object));
      expect(result).toEqual({
        healthy: true,
        message: 'LM Studio 服务运行正常',
      });
    });

    it('should return unhealthy when server responds with error status', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });
      const result = await provider.checkHealth();

      expect(result).toEqual({
        healthy: false,
        message: 'LM Studio 服务响应异常: 500',
      });
    });

    it('should return unhealthy on network failure', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Failed to fetch'));

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });
      const result = await provider.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('无法连接到 LM Studio 服务');
    });

    it('should return unhealthy on timeout', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      vi.mocked(global.fetch).mockRejectedValue(abortError);

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });
      const result = await provider.checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('请检查服务是否启动及端口配置');
    });
  });

  describe('getAvailableModels', () => {
    it('should return list of model IDs from models endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-a' },
            { id: 'model-b' },
          ],
        }),
      } as Response);

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });
      const models = await provider.getAvailableModels();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:1234/v1/models');
      expect(models).toEqual(['model-a', 'model-b']);
    });

    it('should return empty array on failure', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });
      const models = await provider.getAvailableModels();

      expect(models).toEqual([]);
    });
  });

  describe('validateConfig', () => {
    it('should return valid configuration validation result when healthy', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response) // checkHealth
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'model-a' }],
          }),
        } as Response); // getAvailableModels

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1', model: 'model-a' });
      const result = await provider.validateConfig();

      expect(result.valid).toBe(true);
      expect(result.message).toContain('LM Studio 连接正常');
    });

    it('should return invalid result when checkHealth fails', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });
      const result = await provider.validateConfig();

      expect(result.valid).toBe(false);
      expect(result.message).toContain('LM Studio 服务响应异常');
    });
  });

  describe('analyzeAndTranslate', () => {
    const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    it('should call httpRequest with proper payload and parse response', async () => {
      vi.mocked(httpRequest).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  textAreas: [
                    {
                      x: 0.1,
                      y: 0.2,
                      width: 0.3,
                      height: 0.4,
                      originalText: 'original',
                      translatedText: 'translated',
                    },
                  ],
                }),
              },
            },
          ],
        },
      });

      await provider.initialize({
        baseUrl: 'http://localhost:1234/v1',
        model: 'my-model',
        apiKey: 'optional-key',
      });

      const response = await provider.analyzeAndTranslate(base64Image, 'zh-CN');

      expect(httpRequest).toHaveBeenCalledWith(
        'http://localhost:1234/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer optional-key',
          },
          body: expect.objectContaining({
            model: 'my-model',
            messages: expect.any(Array),
          }),
        })
      );

      expect(response.textAreas).toHaveLength(1);
      expect(response.textAreas[0]).toEqual({
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
        originalText: 'original',
        translatedText: 'translated',
      });
    });

    it('should throw error when httpRequest is not ok', async () => {
      vi.mocked(httpRequest).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        error: 'Model not loaded',
      });

      await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });

      await expect(
        provider.analyzeAndTranslate(base64Image, 'zh-CN')
      ).rejects.toThrow('LM Studio');
    });
  });
});
