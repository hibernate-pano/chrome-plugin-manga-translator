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
});
