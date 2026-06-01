import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/providers', () => ({
  createProvider: vi.fn(),
}));

import { createProvider } from '@/providers';

import { translateImageViaProviderDirect } from './provider-direct-client';

describe('provider-direct-client', () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockReset();
  });

  it('creates the openai-compatible provider with direct settings', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({ textAreas: [] }),
    } as never);

    await translateImageViaProviderDirect({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      targetLanguage: 'zh-CN',
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      translationStylePreset: 'natural-zh',
    });

    expect(createProvider).toHaveBeenCalledWith('openai-compatible', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
  });

  it('creates the lm-studio provider with direct settings', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({ textAreas: [] }),
    } as never);

    await translateImageViaProviderDirect({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      targetLanguage: 'zh-CN',
      provider: 'lm-studio',
      baseUrl: 'http://localhost:1234/v1',
      model: 'qwen',
      translationStylePreset: 'natural-zh',
    });

    expect(createProvider).toHaveBeenCalledWith('lm-studio', {
      apiKey: undefined,
      baseUrl: 'http://localhost:1234/v1',
      model: 'qwen',
    });
  });

  it('returns pipeline: "full-image-fallback" and success on happy path (t10 regression guard)', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({
        textAreas: [
          {
            x: 0,
            y: 0,
            width: 100,
            height: 50,
            translatedText: '你好',
            originalText: 'hello',
          },
        ],
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      }),
    } as never);

    const result = await translateImageViaProviderDirect({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      targetLanguage: 'zh-CN',
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      translationStylePreset: 'natural-zh',
    });

    expect(result.success).toBe(true);
    expect(result.pipeline).toBe('full-image-fallback');
    expect(result.cached).toBe(false);
    expect(result.textAreas).toHaveLength(1);
    expect(result.textAreas?.[0]?.translatedText).toBe('你好');
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it('rejects unknown provider types without calling createProvider', async () => {
    const result = await translateImageViaProviderDirect({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      targetLanguage: 'zh-CN',
      provider: 'unknown-provider' as never,
      translationStylePreset: 'natural-zh',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Provider');
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('rejects invalid translation style preset', async () => {
    const result = await translateImageViaProviderDirect({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      targetLanguage: 'zh-CN',
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      translationStylePreset: 'invalid-style' as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('翻译风格');
    expect(createProvider).not.toHaveBeenCalled();
  });
});
