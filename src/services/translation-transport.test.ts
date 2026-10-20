import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chromeMock } from '@/test/setup';

import {
  ChromeRuntimeTranslationTransport,
  generateJobId,
} from './translation-transport';

describe('generateJobId', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  });

  it('uses crypto.randomUUID when it is available', () => {
    const id = generateJobId();
    expect(id).toBeTruthy();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('falls back to getRandomValues when randomUUID is missing (insecure context)', () => {
    // `crypto.randomUUID` is a [SecureContext] API. A content script on a
    // plain http:// page inherits the page's insecure context, where the
    // method does not exist — calling it threw a TypeError that was
    // swallowed into a bare {success:false}, so the whole extension looked
    // broken on every non-HTTPS manga site.
    const getRandomValues = vi.fn((array: Uint8Array) => {
      for (let i = 0; i < array.length; i += 1) {
        array[i] = i;
      }
      return array;
    });

    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues },
      configurable: true,
      writable: true,
    });

    const id = generateJobId();

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);
    // Still a well-formed v4 UUID.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('falls back to a timestamp+random id when no crypto API is available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const id = generateJobId();

    expect(id).toBeTruthy();
    expect(id).toContain('-');
  });

  it('never throws, whatever crypto looks like', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        randomUUID: () => {
          throw new Error('nope');
        },
        getRandomValues: () => {
          throw new Error('nope');
        },
      },
      configurable: true,
      writable: true,
    });

    expect(() => generateJobId()).not.toThrow();
    expect(generateJobId()).toBeTruthy();
  });
});

describe('ChromeRuntimeTranslationTransport', () => {
  let transport: ChromeRuntimeTranslationTransport;

  beforeEach(() => {
    transport = new ChromeRuntimeTranslationTransport();
    vi.mocked(chromeMock.runtime.sendMessage).mockReset();
  });

  it('sends a job request that carries no provider configuration', async () => {
    // The request used to carry `provider`, `apiKey`, `baseUrl` and
    // `model`, and the worker used them as-is. A content script could then
    // name an endpoint of its own choosing and have the user's real key
    // sent there. The worker resolves the provider from its own
    // configuration now, so the request must not even name one.
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
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'JOB_TRANSLATE_IMAGE',
        targetLanguage: 'zh-CN',
      })
    );

    const sent = vi.mocked(chromeMock.runtime.sendMessage).mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(sent).toBeDefined();
    for (const field of ['apiKey', 'baseUrl', 'model', 'provider']) {
      expect(sent).not.toHaveProperty(field);
    }
  });

  it('sends the same message for a local provider as for a cloud one', async () => {
    // The execution path is the worker's business now: it derives it from
    // the provider the user configured, so the transport has nothing to say
    // about it.
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
      translationStylePreset: 'natural-zh',
    });

    const sent = vi.mocked(chromeMock.runtime.sendMessage).mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(sent).not.toHaveProperty('requestedPath');
    expect(sent).not.toHaveProperty('provider');
  });

  it('throws a clear error when background does not respond', async () => {
    vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue(undefined);

    await expect(
      transport.translateImage({
        imageBase64: 'base64-data',
        mimeType: 'image/png',
        targetLanguage: 'zh-CN',
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
      translationStylePreset: 'natural-zh',
    });

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ pageKey: 'inline-image' })
    );
  });

  it('still sends a job on an insecure context (no crypto.randomUUID)', async () => {
    // The content script on an http:// page has no crypto.randomUUID. The
    // transport used to throw a TypeError there, which the translator
    // swallowed into {success:false} — every image on the site "failed"
    // with no visible reason.
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: originalCrypto.getRandomValues },
      configurable: true,
      writable: true,
    });

    try {
      vi.mocked(chromeMock.runtime.sendMessage).mockResolvedValue({
        success: true,
        job: {
          jobId: 'job-7',
          pageKey: 'page-7',
          priorityClass: 'visible-now',
          requestedPath: 'plugin-direct',
          actualCapabilityUsed: 'plugin-direct',
          scope: 'page',
          state: 'succeeded',
        },
        textAreas: [],
      });

      const result = await transport.translateImage({
        imageBase64: 'base64-data',
        mimeType: 'image/png',
        imageUrl: 'https://example.com/page-7.png',
        targetLanguage: 'zh-CN',
        translationStylePreset: 'natural-zh',
      });

      expect(result.success).toBe(true);
      const sent = vi.mocked(chromeMock.runtime.sendMessage).mock.calls[0]?.[0];
      expect(sent).toBeDefined();
      const jobId = (sent as { jobId?: string }).jobId;
      expect(typeof jobId).toBe('string');
      expect((jobId ?? '').length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    }
  });
});
