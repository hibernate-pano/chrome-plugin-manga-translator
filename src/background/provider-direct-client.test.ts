import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProvider } from '@/providers';

import { translateImageViaProviderDirect } from './provider-direct-client';

vi.mock('@/providers', () => ({
  createProvider: vi.fn(),
}));

describe('provider-direct-client', () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockReset();
  });

  it('调用 provider-direct 兼容链路并返回标准响应', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({
        textAreas: [
          {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.1,
            originalText: 'hello',
            translatedText: '你好',
          },
        ],
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      }),
    } as never);

    const response = await translateImageViaProviderDirect({
      imageBase64: 'base64-data',
      mimeType: 'image/jpeg',
      targetLanguage: 'zh-CN',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      translationStylePreset: 'natural-zh',
      executionMode: 'provider-direct',
    });

    expect(createProvider).toHaveBeenCalledWith('openai', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
    expect(response).toEqual({
      success: true,
      textAreas: [
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
          originalText: 'hello',
          translatedText: '你好',
        },
      ],
      pipeline: 'full-image-fallback',
      cached: false,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    });
  });

  it('对未知 provider 返回明确错误', async () => {
    const response = await translateImageViaProviderDirect({
      imageBase64: 'base64-data',
      mimeType: 'image/jpeg',
      targetLanguage: 'zh-CN',
      provider: 'bad-provider',
      translationStylePreset: 'natural-zh',
    } as never);

    expect(response).toEqual({
      success: false,
      error: '未知 Provider，无法执行兼容翻译',
    });
  });
});
