/**
 * Ollama Provider Tests
 *
 * Focused on v1.1.1 health-check edge cases: 403 origin rejection
 * (OLLAMA_ORIGINS not whitelisting the extension) and the generic
 * CORS-rejected fetch that lands in the catch block.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from './ollama';

const baseConfig = {
  apiKey: '',
  baseUrl: 'http://localhost:11434',
  model: 'llava',
};

describe('OllamaProvider.checkHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns healthy when Ollama returns 200', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    const result = await provider.checkHealth();

    expect(result.healthy).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('returns origin-not-allowed message when Ollama returns 403', async () => {
    // v1.1.1: a 403 from Ollama almost always means the browser extension
    // origin isn't in OLLAMA_ORIGINS. The message must contain "ollama"
    // and "forbidden" so error-handler maps to OLLAMA_ORIGIN_NOT_ALLOWED.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Forbidden', { status: 403 })
    );

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    const result = await provider.checkHealth();

    expect(result.healthy).toBe(false);
    expect(result.message.toLowerCase()).toContain('forbidden');
    expect(result.message.toLowerCase()).toContain('ollama');
  });

  it('returns origin-not-allowed message when fetch is CORS-rejected (Failed to fetch)', async () => {
    // When Ollama blocks the browser extension origin, the browser
    // throws "TypeError: Failed to fetch" before reading any response.
    // The message must trigger OLLAMA_ORIGIN_NOT_ALLOWED mapping.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch')
    );

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    const result = await provider.checkHealth();

    expect(result.healthy).toBe(false);
    expect(result.message).toMatch(/ollama/i);
  });

  it('returns timeout message on AbortError', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    const result = await provider.checkHealth();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain('超时');
  });
});

function makeTagsResponse(models: string[]): Response {
  return new Response(
    JSON.stringify({
      models: models.map(name => ({
        name,
        modified_at: '2026-01-01T00:00:00Z',
        size: 1,
      })),
    }),
    { status: 200 }
  );
}

describe('OllamaProvider.analyzeAndTranslate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeGenerateResponse(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  it('strips a data URL prefix before sending the image', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(makeTagsResponse(['llava']))
      .mockResolvedValueOnce(
        makeGenerateResponse({
          response: JSON.stringify({ textAreas: [] }),
          done: true,
        })
      );

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);
    await provider.analyzeAndTranslate('data:image/png;base64,QUJD', 'zh-CN');

    const generateCall = fetchSpy.mock.calls[2] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(generateCall[1].body) as { images?: string[] };
    expect(body.images?.[0]).toBe('QUJD');
  });

  it('throws the model-missing message on 404', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(makeTagsResponse(['llava']))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);
    await expect(provider.analyzeAndTranslate('QUJD', 'zh-CN')).rejects.toThrow(
      'ollama pull llava'
    );
  });

  it('throws the origin message on 403', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(makeTagsResponse(['llava']))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);
    await expect(provider.analyzeAndTranslate('QUJD', 'zh-CN')).rejects.toThrow(
      'OLLAMA_ORIGINS'
    );
  });

  it('surfaces the error field from a 200 response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(makeTagsResponse(['llava']))
      .mockResolvedValueOnce(
        makeGenerateResponse({ response: '', error: 'model overloaded' })
      );

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);
    await expect(provider.analyzeAndTranslate('QUJD', 'zh-CN')).rejects.toThrow(
      'Ollama error: model overloaded'
    );
  });

  it('rejects an empty 200 response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(makeTagsResponse(['llava']))
      .mockResolvedValueOnce(
        makeGenerateResponse({ response: '', done: true })
      );

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);
    await expect(provider.analyzeAndTranslate('QUJD', 'zh-CN')).rejects.toThrow(
      'empty response'
    );
  });
});

describe('OllamaProvider.model checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checkModel accepts the exact model and :latest suffixes', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeTagsResponse(['llava', 'bakllava', 'moondream'])
      )
      .mockResolvedValueOnce(makeTagsResponse(['llava:latest']));

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    await expect(provider.checkModel()).resolves.toMatchObject({
      available: true,
    });
    await expect(provider.checkModel()).resolves.toMatchObject({
      available: true,
    });
  });

  it('checkModel suggests vision models when the model is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeTagsResponse(['mistral', 'llava-llama3:13b'])
    );

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    const result = await provider.checkModel();
    expect(result.available).toBe(false);
    expect(result.message).toContain('ollama pull llava');
    expect(result.message).toContain('llava-llama3:13b');
  });

  it('checkModel reports a fetch failure as an unavailable model', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch')
    );

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);
    await expect(provider.checkModel()).resolves.toMatchObject({
      available: false,
    });
  });

  it('validateConfig fails on unhealthy service and passes end-to-end when ready', async () => {
    vi.spyOn(globalThis, 'fetch')
      // Health check fails first.
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      // Then health + model checks succeed.
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(makeTagsResponse(['llava']));

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    const unhealthy = await provider.validateConfig();
    expect(unhealthy.valid).toBe(false);

    const healthy = await provider.validateConfig();
    expect(healthy.valid).toBe(true);
  });

  it('getAvailableVisionModels filters to vision-capable names only', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeTagsResponse(['mistral', 'moondream']))
      .mockRejectedValueOnce(new Error('boom'));

    const provider = new OllamaProvider();
    await provider.initialize(baseConfig);

    await expect(provider.getAvailableVisionModels()).resolves.toEqual([
      'moondream',
    ]);
    await expect(provider.getAvailableVisionModels()).resolves.toEqual([]);
  });
});
