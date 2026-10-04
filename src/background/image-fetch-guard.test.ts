/**
 * The background worker proxies cross-origin image bytes for the content
 * script. That makes it a fetcher driven by page content, so these tests pin
 * both halves of the defence: the address policy, and the refusal to act as
 * an open proxy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_IMAGE_BYTES,
  bytesToBase64,
  fetchImageBytes,
  isSafeImageUrl,
} from './image-fetch-guard';

function mockFetch(
  handler: (
    url: string,
    init?: RequestInit
  ) => {
    status?: number;
    headers?: Record<string, string>;
    body?: ArrayBuffer | null;
  }
) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => result.headers?.[name.toLowerCase()] ?? null,
      },
      arrayBuffer: async () => result.body ?? new ArrayBuffer(0),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('isSafeImageUrl', () => {
  it('accepts ordinary https image URLs', () => {
    expect(isSafeImageUrl('https://cdn.example.com/a/1.jpg')).toBe(true);
    expect(isSafeImageUrl('http://example.com/cover.png')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isSafeImageUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isSafeImageUrl('chrome-extension://abc/x.png')).toBe(false);
    expect(isSafeImageUrl('ftp://example.com/a.jpg')).toBe(false);
  });

  it('rejects loopback and localhost', () => {
    expect(isSafeImageUrl('http://127.0.0.1:8080/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://127.1.2.3/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://localhost/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://app.localhost/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://[::1]/x.jpg')).toBe(false);
  });

  it('rejects RFC1918 and other private IPv4 ranges', () => {
    expect(isSafeImageUrl('http://10.0.0.5/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://172.16.4.4/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://172.31.255.1/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://192.168.1.1/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://100.64.0.1/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://169.254.169.254/latest/meta-data')).toBe(
      false
    );
    expect(isSafeImageUrl('http://0.0.0.0/x.jpg')).toBe(false);
  });

  it('rejects private IPv6 ranges and IPv4-mapped forms', () => {
    expect(isSafeImageUrl('http://[fd00::1]/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://[fe80::1]/x.jpg')).toBe(false);
    expect(isSafeImageUrl('http://[::ffff:127.0.0.1]/x.jpg')).toBe(false);
  });

  it('rejects the cloud metadata host by name', () => {
    expect(
      isSafeImageUrl('http://metadata.google.internal/computeMetadata/v1/')
    ).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isSafeImageUrl('not a url')).toBe(false);
    expect(isSafeImageUrl('')).toBe(false);
  });
});

describe('bytesToBase64', () => {
  it('matches the reference encoding for all byte lengths mod 3', () => {
    // Buffer is Node's reference implementation; this pins our table encoder
    // against it for the 1/2/3 remainder cases and a longer body.
    for (const sample of [
      [0],
      [0, 0],
      [0, 0, 0],
      [1, 2, 3, 4],
      [255, 254, 253, 252, 251],
      [137, 80, 78, 71, 13, 10, 26, 10],
    ]) {
      const bytes = new Uint8Array(sample);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('handles a multi-chunk payload', () => {
    const bytes = new Uint8Array(20000);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i % 256;
    }
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('encodes empty input as an empty string', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });
});

describe('fetchImageBytes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses a blocked URL without touching the network', async () => {
    const spy = mockFetch(() => ({}));
    const result = await fetchImageBytes('http://127.0.0.1:9000/secret');
    expect(result.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not forward credentials', async () => {
    const spy = mockFetch(() => ({
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3]).buffer,
    }));
    await fetchImageBytes('https://cdn.example.com/a.png');
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.credentials).toBe('omit');
  });

  it('returns base64 for an image response', async () => {
    mockFetch(() => ({
      headers: { 'content-type': 'image/webp' },
      body: new Uint8Array([1, 2, 3, 4]).buffer,
    }));
    const result = await fetchImageBytes('https://cdn.example.com/a.webp');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mimeType).toBe('image/webp');
      // [1,2,3,4] -> "AQIDBA=="
      expect(result.base64).toBe('AQIDBA==');
    }
  });

  it('rejects a non-image content type', async () => {
    mockFetch(() => ({
      headers: { 'content-type': 'text/html' },
      body: new ArrayBuffer(8),
    }));
    const result = await fetchImageBytes('https://example.com/page');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not an image');
    }
  });

  it('rejects an oversized declared content-length', async () => {
    mockFetch(() => ({
      headers: {
        'content-type': 'image/png',
        'content-length': String(MAX_IMAGE_BYTES + 1),
      },
      body: new ArrayBuffer(8),
    }));
    const result = await fetchImageBytes('https://cdn.example.com/big.png');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('too large');
    }
  });

  it('rejects an oversized body even without content-length', async () => {
    mockFetch(() => ({
      headers: { 'content-type': 'image/png' },
      body: new ArrayBuffer(MAX_IMAGE_BYTES + 1),
    }));
    const result = await fetchImageBytes('https://cdn.example.com/big.png');
    expect(result.success).toBe(false);
  });

  it('reports a non-ok status', async () => {
    mockFetch(() => ({ status: 404 }));
    const result = await fetchImageBytes('https://cdn.example.com/missing.png');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('404');
    }
  });
});
