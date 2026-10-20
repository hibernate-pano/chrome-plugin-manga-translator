import { describe, expect, it } from 'vitest';

import {
  evaluateBaseUrlSafety,
  hostMatchesAllowlist,
  isSupportedPageUrl,
  normalizeHostEntry,
} from './app-config';

describe('auto-translate allowlist host matching', () => {
  it('normalizes user input down to a host, keeping an explicit port', () => {
    expect(normalizeHostEntry('https://Manga.Example.com/reader/1')).toBe(
      'manga.example.com'
    );
    expect(normalizeHostEntry('  example.com  ')).toBe('example.com');
    expect(normalizeHostEntry('localhost:8080')).toBe('localhost:8080');
    expect(normalizeHostEntry('*.example.com')).toBe('*.example.com');
    expect(normalizeHostEntry('*.localhost')).toBe('*.localhost');
    expect(normalizeHostEntry('')).toBeNull();
    // A colon that is not a port means the entry is not a host:port pair.
    expect(normalizeHostEntry('example.com:not-a-port')).toBeNull();
  });

  it('refuses a wildcard that would match the whole internet', () => {
    // `*.com` is a typo away from authorising every .com site.
    expect(normalizeHostEntry('*.com')).toBeNull();
    expect(normalizeHostEntry('*.org')).toBeNull();
    expect(normalizeHostEntry('*.net')).toBeNull();
    // A real registrable domain still works.
    expect(normalizeHostEntry('*.co.uk')).toBe('*.co.uk');
  });

  it('matches exact hosts and subdomains but never look-alike suffixes', () => {
    expect(hostMatchesAllowlist('https://example.com/a', ['example.com'])).toBe(
      true
    );
    expect(
      hostMatchesAllowlist('https://notexample.com/a', ['example.com'])
    ).toBe(false);
    expect(
      hostMatchesAllowlist('https://cdn.example.com/a', ['*.example.com'])
    ).toBe(true);
    expect(
      hostMatchesAllowlist('https://example.com/a', ['*.example.com'])
    ).toBe(true);
    expect(hostMatchesAllowlist('https://evil.com/a', ['*.example.com'])).toBe(
      false
    );
    expect(hostMatchesAllowlist('ftp://example.com/a', ['example.com'])).toBe(
      false
    );
  });

  it('honours default ports and scopes port-bearing entries to that port', () => {
    // No port in the entry means any port, which is the usual intent.
    expect(
      hostMatchesAllowlist('https://example.com:8443/a', ['example.com'])
    ).toBe(true);

    // An entry that names a port must not cover the other services on the
    // host: auto-translating a router admin page would upload its images.
    expect(
      hostMatchesAllowlist('http://localhost:8080/a', ['localhost:8080'])
    ).toBe(true);
    expect(
      hostMatchesAllowlist('http://localhost:9999/a', ['localhost:8080'])
    ).toBe(false);
    expect(
      hostMatchesAllowlist('http://192.168.1.10:22/a', ['192.168.1.10:8080'])
    ).toBe(false);

    // An implicit port still matches an explicit entry for it.
    expect(
      hostMatchesAllowlist('http://localhost:80/a', ['localhost:80'])
    ).toBe(true);
    expect(
      hostMatchesAllowlist('https://example.com:443/a', ['example.com:443'])
    ).toBe(true);
  });
});

describe('evaluateBaseUrlSafety', () => {
  it('accepts https to any host', () => {
    expect(evaluateBaseUrlSafety('https://api.openai.com/v1')).toBe('secure');
    expect(evaluateBaseUrlSafety('https://example.com')).toBe('secure');
  });

  it('accepts plaintext http only on loopback', () => {
    // Ollama and LM Studio legitimately serve on http://localhost.
    expect(evaluateBaseUrlSafety('http://localhost:11434')).toBe('secure');
    expect(evaluateBaseUrlSafety('http://127.0.0.1:1234/v1')).toBe('secure');
    expect(evaluateBaseUrlSafety('http://[::1]:11434')).toBe('secure');
  });

  it('flags plaintext http to a remote host, which would leak the bearer token', () => {
    expect(evaluateBaseUrlSafety('http://api.example.com/v1')).toBe('insecure');
    expect(evaluateBaseUrlSafety('http://192.168.1.20:11434')).toBe('insecure');
    expect(evaluateBaseUrlSafety('http://例え.jp')).toBe('insecure');
  });

  it('treats a bare host as https and rejects nonsense schemes', () => {
    expect(evaluateBaseUrlSafety('api.example.com/v1')).toBe('secure');
    expect(evaluateBaseUrlSafety('ftp://files.example.com')).toBe('invalid');
    expect(evaluateBaseUrlSafety('javascript:alert(1)')).toBe('invalid');
  });

  it('treats an unset value as no problem to report', () => {
    expect(evaluateBaseUrlSafety('')).toBe('secure');
    expect(evaluateBaseUrlSafety('   ')).toBe('secure');
  });
});

describe('isSupportedPageUrl', () => {
  it('accepts ordinary web pages', () => {
    expect(isSupportedPageUrl('https://manga.example/chapter/1')).toBe(true);
    expect(isSupportedPageUrl('http://localhost:3000')).toBe(true);
  });

  it("rejects the browser's own pages", () => {
    expect(isSupportedPageUrl('chrome://extensions')).toBe(false);
    expect(isSupportedPageUrl('edge://settings')).toBe(false);
    expect(isSupportedPageUrl('about:blank')).toBe(false);
    expect(isSupportedPageUrl('chrome-extension://abc/options.html')).toBe(
      false
    );
    expect(isSupportedPageUrl('file:///tmp/page.html')).toBe(false);
  });

  it('rejects a missing address', () => {
    expect(isSupportedPageUrl(undefined)).toBe(false);
    expect(isSupportedPageUrl('')).toBe(false);
  });
});
