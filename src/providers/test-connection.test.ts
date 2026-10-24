/**
 * The Settings "test connection" button used to call `validateConfig`, which
 * for OpenAI-compatible providers only checks that the key exists and is long
 * enough. A wrong base URL, a revoked key, or a nonexistent model all reported
 * "配置有效" — actively misleading, because it sends the user hunting for the
 * fault elsewhere. `testConnection` probes the endpoint instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';

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

  it('reports a wrong base URL when neither route exists', async () => {
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

  it('falls back to a chat probe when /models is absent', async () => {
    // Some gateways expose chat completions but not /models. Reporting a
    // problem there would send the user chasing a working endpoint.
    const spy = vi.fn(async (url: string) =>
      String(url).endsWith('/models')
        ? mockFetchResponse(404)
        : mockFetchResponse(200, { choices: [] })
    );
    vi.stubGlobal('fetch', spy);
    const result = await (await providerWith({})).testConnection?.();
    expect(result?.valid).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1]?.[0])).toContain('/chat/completions');
  });

  it('surfaces a bad model name from the chat probe', async () => {
    const spy = vi.fn(async (url: string) =>
      String(url).endsWith('/models')
        ? mockFetchResponse(404)
        : mockFetchResponse(400, { error: { message: 'model not found' } })
    );
    vi.stubGlobal('fetch', spy);
    const result = await (
      await providerWith({ model: 'no-such-model' })
    ).testConnection?.();
    expect(result?.valid).toBe(false);
    expect(result?.message).toContain('model not found');
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

  it('counts the billed probe the button sends', async () => {
    // 「测试配置」在网关不提供 /models 时会真的发一次 chat completion，
    // 而服务商要为它计费。用户的账上多了一次，扩展的计数就得跟上 ——
    // 否则他正好在盯着那个数字的时候发现它对不上。
    useUsageStore.getState().clearAll();
    const spy = vi.fn(async (url: string) =>
      String(url).endsWith('/models')
        ? mockFetchResponse(404)
        : mockFetchResponse(200, { choices: [] })
    );
    vi.stubGlobal('fetch', spy);

    await (await providerWith({})).testConnection?.();

    expect(
      summarizeUsageForMonth(useUsageStore.getState().records).billableCalls
    ).toBe(1);
  });

  it('does not spend a request when the health poll forbids a billed probe', async () => {
    // The settings page polls the provider every fifteen minutes to draw a
    // status dot. For a gateway without /models, that poll used to fall
    // back to a real chat completion — a request the provider bills, run
    // every fifteen minutes, to keep a dot green. The poll asks for the
    // cheap answer; only the 「测试配置」 button pays for the full one.
    const spy = vi.fn(async (url: string) =>
      String(url).endsWith('/models')
        ? mockFetchResponse(404)
        : mockFetchResponse(200, { choices: [] })
    );
    vi.stubGlobal('fetch', spy);

    const result = await (
      await providerWith({})
    ).testConnection?.({ allowBillableProbe: false });

    expect(result?.valid).toBe(true);
    expect(result?.message).toContain('未做会计费的完整测试');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('/models');
  });

  it('does not count a model listing that timed out as a billable call', async () => {
    /*
     * `/models` is a listing: it asks the gateway which models it has and
     * never runs one. A timeout there is a request the provider did not
     * run a model for, so there is nothing to bill.
     */
    useUsageStore.getState().clearAll();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockFetchResponse(408))
    );

    const result = await (await providerWith({})).testConnection?.();

    expect(result?.valid).toBe(false);
    expect(
      summarizeUsageForMonth(useUsageStore.getState().records).billableCalls
    ).toBe(0);
  });

  it('does not bill the health poll when the listing times out', async () => {
    /*
     * The poll runs every fifteen minutes. If a timed-out listing counted as
     * a call, a gateway that was slow would add a billable request to the
     * user's account every fifteen minutes, forever, to keep a dot green.
     */
    useUsageStore.getState().clearAll();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => mockFetchResponse(408))
    );

    await (
      await providerWith({})
    ).testConnection?.({
      allowBillableProbe: false,
    });

    expect(
      summarizeUsageForMonth(useUsageStore.getState().records).billableCalls
    ).toBe(0);
  });

  it('counts a chat probe that timed out, because the model may have run', async () => {
    /*
     * The other way round: a chat completion that timed out may well have
     * been run by the provider. The user paid for it whether or not we ever
     * saw the answer, so the bill has to count it.
     */
    useUsageStore.getState().clearAll();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/models')
          ? mockFetchResponse(404)
          : mockFetchResponse(408)
      )
    );

    await (await providerWith({})).testConnection?.();

    expect(
      summarizeUsageForMonth(useUsageStore.getState().records).billableCalls
    ).toBe(1);
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
