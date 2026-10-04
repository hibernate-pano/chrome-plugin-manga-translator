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
