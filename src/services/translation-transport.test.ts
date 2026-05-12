import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chromeMock } from '@/test/setup';

import { ChromeRuntimeTranslationTransport } from './translation-transport';

describe('ChromeRuntimeTranslationTransport', () => {
  let transport: ChromeRuntimeTranslationTransport;

  beforeEach(() => {
    transport = new ChromeRuntimeTranslationTransport();
    vi.mocked(chromeMock.runtime.sendMessage).mockReset();
  });

  it('sends a direct job request for openai-compatible', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-1',
        pageKey: 'page-1',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        actualCapabilityUsed: 'plugin-direct',
        scope: 'page',
        state: 'succeeded',
      },
      textAreas: [],
      cached: false,
    });

    await transport.translateImage({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      imageUrl: 'https://example.com/page-1.png',
      pageUrl: 'https://example.com/chapter/1',
      targetLanguage: 'zh-CN',
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'JOB_TRANSLATE_IMAGE',
        requestedPath: 'plugin-direct',
        provider: 'openai-compatible',
      })
    );
  });

  it('defaults to ollama-direct for ollama requests', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-2',
        pageKey: 'page-2',
        priorityClass: 'visible-now',
        requestedPath: 'ollama-direct',
        actualCapabilityUsed: 'ollama-direct',
        scope: 'page',
        state: 'succeeded',
      },
      textAreas: [],
    });

    await transport.translateImage({
      imageBase64: 'base64-data',
      mimeType: 'image/jpeg',
      imageKey: 'page-2',
      targetLanguage: 'zh-CN',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llava',
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedPath: 'ollama-direct',
        provider: 'ollama',
      })
    );
  });
});
