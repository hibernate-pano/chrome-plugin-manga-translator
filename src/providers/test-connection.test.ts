/**
 * The Settings "test connection" button used to call `validateConfig`, which
 * for OpenAI-compatible providers only checks that the key exists and is long
 * enough. A wrong base URL, a revoked key, or a nonexistent model all reported
 * "配置有效" — actively misleading, because it sends the user hunting for the
 * fault elsewhere. `testConnection` probes the endpoint instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAIProvider } from './openai';

const VALID_KEY = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';

function mockFetchResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function providerWith(overrides: Record<string, string>) {
  const provider = new OpenAIProvider();
  await provider.initialize({
    apiKey: VALID_KEY,
    baseUrl: 'https://api.example.com/v1',
    model: 'some-model',
    ...overrides,
  });
  return provider;
}

describe('OpenAI-compatible connection test', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports success when the models endpoint answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockFetchResponse(200, { data: [] }))
    );
    const result = await (await providerWith({})).testConnection?.();
    expect(result?.valid).toBe(true);
  });

  it('reports an auth failure instead of claiming the config is valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockFetchResponse(401, { error: 'bad key' }))
    );
    const result = await (await providerWith({})).testConnection?.();
    expect(result?.valid).toBe(false);
    expect(result?.message).toContain('401');
  });

  it('reports a wrong base URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockFetchResponse(404))
    );
    const result = await (
      await providerWith({ baseUrl: 'https://api.example.com/wrong' })
    ).testConnection?.();
    expect(result?.valid).toBe(false);
    expect(result?.message).toContain('404');
  });

  it('reports an unreachable host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      })
    );
    const result = await (await providerWith({})).testConnection?.();
    expect(result?.valid).toBe(false);
    expect(result?.message).toContain('无法连接');
  });

  it('does not hit the network when the key is missing', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await (
      await providerWith({ apiKey: '' })
    ).testConnection?.();
    expect(result?.valid).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the key as a bearer token', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      mockFetchResponse(200, { data: [] })
    );
    vi.stubGlobal('fetch', spy);
    await (await providerWith({})).testConnection?.();
    const init = spy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Authorization']).toBe(`Bearer ${VALID_KEY}`);
  });
});

describe('validateConfig stays local', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers without touching the network (content-script preflight path)', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await (await providerWith({})).validateConfig();
    expect(result.valid).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
