import { describe, expect, it } from 'vitest';

import {
  evaluateBaseUrlSafety,
  hostMatchesAllowlist,
  normalizeHostEntry,
  normalizeRuntimeAppConfig,
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

describe('normalizeRuntimeAppConfig', () => {
  it('maps legacy selected cloud providers into openai-compatible settings', () => {
    const normalized = normalizeRuntimeAppConfig({
      provider: 'siliconflow',
      providers: {
        siliconflow: {
          apiKey: 'sf-key',
          baseUrl: 'https://api.siliconflow.cn/v1',
          model: 'Qwen/Qwen2.5-VL-32B-Instruct',
        },
      },
    });

    expect(normalized.provider).toBe('openai-compatible');
    expect(normalized.openaiCompatible.apiKey).toBe('sf-key');
    expect(normalized.openaiCompatible.baseUrl).toBe(
      'https://api.siliconflow.cn/v1'
    );
    expect(normalized.openaiCompatible.model).toBe(
      'Qwen/Qwen2.5-VL-32B-Instruct'
    );
  });

  it('keeps explicit openai-compatible settings and user-typed apiKey', () => {
    const normalized = normalizeRuntimeAppConfig({
      provider: 'openai-compatible',
      openaiCompatible: {
        apiKey: 'new-key',
        baseUrl: 'https://proxy.example.com/v1',
        model: 'custom-vlm',
      },
      providers: {
        openai: {
          apiKey: 'old-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        },
      },
    });

    expect(normalized.openaiCompatible.apiKey).toBe('new-key');
    expect(normalized.openaiCompatible.baseUrl).toBe(
      'https://proxy.example.com/v1'
    );
    expect(normalized.openaiCompatible.model).toBe('custom-vlm');
  });

  it('allows Ollama host and model overrides while stripping apiKey', () => {
    const normalized = normalizeRuntimeAppConfig({
      provider: 'ollama',
      providers: {
        ollama: {
          apiKey: 'should-not-survive',
          baseUrl: 'http://127.0.0.1:11434',
          model: 'minicpm-v',
        },
      },
    });

    expect(normalized.provider).toBe('ollama');
    expect(normalized.ollama.apiKey).toBe('');
    expect(normalized.ollama.baseUrl).toBe('http://127.0.0.1:11434');
    expect(normalized.ollama.model).toBe('minicpm-v');
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
