/**
 * OpenAI-Compatible Provider Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { httpRequest } from '@/utils/http-client';

vi.mock('@/utils/http-client', () => ({
  httpRequest: vi.fn(),
}));

const base64Image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider();
    vi.mocked(httpRequest).mockReset();
  });

  it('should initialize with default config', async () => {
    await provider.initialize({ apiKey: 'sk-test-key-12345678901234567890' });

    expect(provider.name).toBe('OpenAI-Compatible');
    expect(provider.type).toBe('openai-compatible');
  });

  describe('validateConfig', () => {
    it('should return valid when apiKey is long enough', async () => {
      await provider.initialize({
        apiKey: 'sk-test-key-12345678901234567890',
      });

      const result = await provider.validateConfig();

      expect(result.valid).toBe(true);
    });

    it('should return invalid when apiKey is missing', async () => {
      await provider.initialize({});

      const result = await provider.validateConfig();

      expect(result.valid).toBe(false);
      expect(result.message).toContain('API 密钥');
    });

    it('should return invalid when apiKey is too short', async () => {
      await provider.initialize({ apiKey: 'short' });

      const result = await provider.validateConfig();

      expect(result.valid).toBe(false);
      expect(result.message).toContain('密钥格式无效');
    });
  });

  describe('analyzeAndTranslate', () => {
    it('should call httpRequest with Authorization header when apiKey is set', async () => {
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
        apiKey: 'sk-test-key-12345678901234567890',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      });

      const response = await provider.analyzeAndTranslate(base64Image, 'zh-CN');

      expect(httpRequest).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer sk-test-key-12345678901234567890',
          },
          body: expect.objectContaining({
            model: 'gpt-4o',
            messages: expect.any(Array),
          }),
        })
      );

      expect(response.textAreas).toHaveLength(1);
      expect(response.textAreas[0]?.translatedText).toBe('translated');
    });

    it('should throw error when apiKey is missing (requires auth)', async () => {
      await provider.initialize({});

      await expect(
        provider.analyzeAndTranslate(base64Image, 'zh-CN')
      ).rejects.toThrow('API 密钥');
    });

    it('should throw error when apiKey is too short', async () => {
      await provider.initialize({ apiKey: 'short' });

      await expect(
        provider.analyzeAndTranslate(base64Image, 'zh-CN')
      ).rejects.toThrow('密钥格式无效');
    });

    it('should throw error when httpRequest is not ok', async () => {
      vi.mocked(httpRequest).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        error: 'Invalid API key',
      });

      await provider.initialize({
        apiKey: 'sk-test-key-12345678901234567890',
      });

      await expect(
        provider.analyzeAndTranslate(base64Image, 'zh-CN')
      ).rejects.toThrow('OpenAI-Compatible');
    });

    it('should throw error when response has no data', async () => {
      vi.mocked(httpRequest).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: undefined,
      });

      await provider.initialize({
        apiKey: 'sk-test-key-12345678901234567890',
      });

      await expect(
        provider.analyzeAndTranslate(base64Image, 'zh-CN')
      ).rejects.toThrow('no data');
    });

    it('should throw error when API returns error object', async () => {
      vi.mocked(httpRequest).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: {
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit',
            code: '429',
          },
        },
      });

      await provider.initialize({
        apiKey: 'sk-test-key-12345678901234567890',
      });

      await expect(
        provider.analyzeAndTranslate(base64Image, 'zh-CN')
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('should throw error when response has empty content', async () => {
      vi.mocked(httpRequest).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        data: {
          choices: [{ message: { content: '' } }],
        },
      });

      await provider.initialize({
        apiKey: 'sk-test-key-12345678901234567890',
      });

      await expect(
        provider.analyzeAndTranslate(base64Image, 'zh-CN')
      ).rejects.toThrow('empty response');
    });
  });
});
