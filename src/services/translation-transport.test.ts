import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chromeMock } from '@/test/setup';

import { ChromeRuntimeTranslationTransport } from './translation-transport';

describe('ChromeRuntimeTranslationTransport', () => {
  let transport: ChromeRuntimeTranslationTransport;

  beforeEach(() => {
    transport = new ChromeRuntimeTranslationTransport();
    vi.mocked(chromeMock.runtime.sendMessage).mockReset();
  });

  it('发送统一的 JOB_TRANSLATE_IMAGE 协议并携带 accelerator path', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-1',
        pageKey: 'https://example.com/page-1.png',
        priorityClass: 'visible-now',
        requestedPath: 'accelerator',
        actualCapabilityUsed: 'accelerator',
        scope: 'page',
        state: 'succeeded',
      },
      textAreas: [],
      pipeline: 'ocr-first',
      cached: false,
    });

    await transport.translateImage({
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      imageUrl: 'https://example.com/page-1.png',
      pageUrl: 'https://manhwaread.com/chapter-1',
      targetLanguage: 'zh-CN',
      provider: 'openai',
      executionMode: 'server',
      server: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:8000',
        authToken: '',
        timeoutMs: 30000,
      },
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'JOB_TRANSLATE_IMAGE',
      jobId: expect.any(String),
      pageKey: 'https://example.com/page-1.png',
      scope: 'page',
      priorityClass: 'visible-now',
      requestedPath: 'accelerator',
      imageBase64: 'base64-data',
      mimeType: 'image/png',
      imageUrl: 'https://example.com/page-1.png',
      sourcePageUrl: 'https://manhwaread.com/chapter-1',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
      provider: 'openai',
      apiKey: undefined,
      baseUrl: undefined,
      model: undefined,
      forceRefresh: undefined,
    });
  });

  it('在插件直连路径下仍发送统一 job 协议并标明 plugin-direct', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
      success: true,
      job: {
        jobId: 'job-2',
        pageKey: 'image-hash',
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
      mimeType: 'image/jpeg',
      imageKey: 'image-hash',
      targetLanguage: 'zh-CN',
      provider: 'openai',
      apiKey: 'sk-test',
      executionMode: 'provider-direct',
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'JOB_TRANSLATE_IMAGE',
      jobId: expect.any(String),
      pageKey: 'image-hash',
      scope: 'page',
      priorityClass: 'visible-now',
      requestedPath: 'plugin-direct',
      imageBase64: 'base64-data',
      mimeType: 'image/jpeg',
      imageUrl: undefined,
      sourcePageUrl: undefined,
      targetLanguage: 'zh-CN',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: undefined,
      model: undefined,
      translationStylePreset: 'natural-zh',
      forceRefresh: undefined,
    });
  });
});
