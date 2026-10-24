import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpRequest } from './http-client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('httpRequest', () => {
  it('cancels its timeout timer when the request throws', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network down'))
    );

    const response = await httpRequest('https://example.com/v1/models', {
      timeout: 30_000,
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(0);
    // A live timer here is the abort of a request that is already over: it
    // keeps the service worker awake, and nothing ever clears it because the
    // success path is the only one that used to.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels its timeout timer when the response is an error status', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'bad key',
      })
    );

    const response = await httpRequest('https://example.com/v1/models', {
      timeout: 30_000,
    });

    expect(response.status).toBe(401);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a request that ran out of time as a timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      )
    );

    const pending = httpRequest('https://example.com/v1/chat', {
      timeout: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const response = await pending;

    expect(response.ok).toBe(false);
    expect(response.status).toBe(408);
    expect(vi.getTimerCount()).toBe(0);
  });
});
