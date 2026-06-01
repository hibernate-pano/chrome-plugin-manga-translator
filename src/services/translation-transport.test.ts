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

  it('routes lm-studio to ollama-direct to align with runtime-contracts (t14 regression guard)', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-lm',
        pageKey: 'page-lm',
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
      mimeType: 'image/png',
      imageUrl: 'https://example.com/page-lm.png',
      targetLanguage: 'zh-CN',
      provider: 'lm-studio',
      baseUrl: 'http://localhost:1234/v1',
      model: 'qwen-vl',
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedPath: 'ollama-direct',
        provider: 'lm-studio',
      })
    );
  });

  it('respects an explicitly-supplied requestedPath instead of inferring from provider', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-3',
        pageKey: 'page-3',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        actualCapabilityUsed: 'plugin-direct',
        scope: 'page',
        state: 'succeeded',
      },
      textAreas: [],
    });

    await transport.translateImage({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      imageUrl: 'https://example.com/page-3.png',
      targetLanguage: 'zh-CN',
      provider: 'ollama', // would normally resolve to ollama-direct
      requestedPath: 'plugin-direct', // explicit override
      baseUrl: 'http://localhost:11434',
      model: 'llava',
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedPath: 'plugin-direct',
        provider: 'ollama',
      })
    );
  });

  it('throws a clear error when background does not respond', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue(undefined);

    await expect(
      transport.translateImage({
        imageBase64: 'base64-data',
        mimeType: 'image/png',
        targetLanguage: 'zh-CN',
        provider: 'openai-compatible',
        apiKey: 'sk-test',
        translationStylePreset: 'natural-zh',
      })
    ).rejects.toThrow(/Background script 无响应/);
  });

  it('flattens a job response (job.diagnostics → diagnostics) for downstream consumers', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-4',
        pageKey: 'page-4',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        actualCapabilityUsed: 'plugin-direct',
        scope: 'page',
        state: 'succeeded',
        diagnostics: {
          detectedRegions: 5,
          fallbackRegions: 0,
          ocrMs: 120,
          translateMs: 800,
          totalMs: 1000,
        },
      },
      textAreas: [
        { x: 0, y: 0, width: 100, height: 50, translatedText: '你好' },
      ],
      pipeline: 'full-image-fallback',
      cached: false,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const result = await transport.translateImage({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      imageUrl: 'https://example.com/page-4.png',
      targetLanguage: 'zh-CN',
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      translationStylePreset: 'natural-zh',
    });

    expect(result.success).toBe(true);
    expect(result.diagnostics).toEqual({
      detectedRegions: 5,
      fallbackRegions: 0,
      ocrMs: 120,
      translateMs: 800,
      totalMs: 1000,
    });
    expect(result.textAreas).toHaveLength(1);
    expect(result.pipeline).toBe('full-image-fallback');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('derives a pageKey from imageUrl when pageKey is not supplied', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-5',
        pageKey: 'https://example.com/foo.png',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        actualCapabilityUsed: 'plugin-direct',
        scope: 'page',
        state: 'succeeded',
      },
      textAreas: [],
    });

    await transport.translateImage({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      imageUrl: 'https://example.com/foo.png',
      targetLanguage: 'zh-CN',
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageKey: 'https://example.com/foo.png',
      })
    );
  });

  it('falls back to "inline-image" when no imageKey / imageUrl / pageKey is given', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-6',
        pageKey: 'inline-image',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        actualCapabilityUsed: 'plugin-direct',
        scope: 'page',
        state: 'succeeded',
      },
      textAreas: [],
    });

    await transport.translateImage({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      targetLanguage: 'zh-CN',
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ pageKey: 'inline-image' })
    );
  });
});
