/**
 * Tests for the API key obfuscation helper.
 *
 * Two things matter here:
 *   1. the round trip must be lossless — a user's key has to come back
 *      exactly as they typed it;
 *   2. the stored form must stay compatible with what earlier versions wrote,
 *      otherwise upgrading the extension silently breaks every key the user
 *      already saved.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  deobfuscateApiKey,
  deobfuscateAllApiKeys,
  obfuscateApiKey,
  obfuscateAllApiKeys,
  processAllApiKeys,
  registerSensitiveKey,
} from './crypto';

const SAMPLE_KEY = 'sk-abc123XYZ_-0123456789';

describe('obfuscateApiKey / deobfuscateApiKey', () => {
  it('round-trips a plain ASCII key', () => {
    const obfuscated = obfuscateApiKey(SAMPLE_KEY);

    expect(obfuscated).not.toBe(SAMPLE_KEY);
    expect(obfuscated.startsWith('obf:')).toBe(true);
    expect(deobfuscateApiKey(obfuscated)).toBe(SAMPLE_KEY);
  });

  it('round-trips non-ASCII keys', () => {
    const keys = [
      'sk-你好世界',
      'sk-😀-emoji',
      'clé-avec-accents',
      'sk-ключ',
      'sk-日本語のキー',
    ];

    for (const key of keys) {
      expect(deobfuscateApiKey(obfuscateApiKey(key))).toBe(key);
    }
  });

  it('round-trips keys that contain URL-significant characters', () => {
    // The old implementation ran the key through escape/unescape, which
    // turns "%" into "%25" and "%25" back into "%" — lossy for keys that
    // legitimately contain a percent sign.
    const key = 'sk-50%-off&more=1';

    expect(deobfuscateApiKey(obfuscateApiKey(key))).toBe(key);
  });

  it('returns an empty string for an empty key', () => {
    expect(obfuscateApiKey('')).toBe('');
    expect(deobfuscateApiKey('')).toBe('');
  });

  it('does not double-obfuscate an already obfuscated key', () => {
    const once = obfuscateApiKey(SAMPLE_KEY);

    expect(obfuscateApiKey(once)).toBe(once);
    expect(deobfuscateApiKey(once)).toBe(SAMPLE_KEY);
  });

  it('passes a non-obfuscated value through unchanged', () => {
    expect(deobfuscateApiKey('sk-plaintext')).toBe('sk-plaintext');
    expect(deobfuscateApiKey('some other value')).toBe('some other value');
  });

  it('produces a different stored form for the same key on every call', () => {
    // The XOR keystream is fixed, so the same key always yields the same
    // output. That is what keeps the storage readable for the user (and
    // what makes the scheme obfuscation rather than encryption).
    expect(obfuscateApiKey(SAMPLE_KEY)).toBe(obfuscateApiKey(SAMPLE_KEY));
  });

  it('does not contain the plaintext key', () => {
    const obfuscated = obfuscateApiKey(SAMPLE_KEY);

    expect(obfuscated).not.toContain(SAMPLE_KEY);
    expect(obfuscated).not.toContain('sk-abc');
  });

  it('keeps values written by the previous implementation readable', () => {
    // The bytes the old escape/unescape + XOR scheme produced for these
    // keys. If a future refactor changes the encoding, this test fails and
    // the user is told their saved keys would break.
    expect(deobfuscateApiKey('obf:1e0a4306034e')).toBe('sk-abc');
    expect(deobfuscateApiKey('obf:1e0a4306034e454052')).toBe('sk-abc123');
    expect(deobfuscateApiKey('obf:1e0a4383dc8d91d7dc8acbfa86e1e3')).toBe(
      'sk-你好世界'
    );
  });

  it('returns the input unchanged when the obfuscated value is malformed', () => {
    const malformed = ['obf:ZZZZ', 'obf:abc', 'obf:not-hex-at-all'];

    for (const value of malformed) {
      expect(deobfuscateApiKey(value)).toBe(value);
    }
  });

  it('decodes an empty obfuscated payload to an empty key', () => {
    // The encoder never writes "obf:" for an empty key (it writes ""), but a
    // hand-edited storage entry can contain it. Decoding it to "" is the
    // honest result: there is no key there.
    expect(deobfuscateApiKey('obf:')).toBe('');
  });

  it('returns the input unchanged when the bytes are not valid UTF-8', () => {
    // 0xff is not a valid UTF-8 lead byte. Decoding it leniently would
    // silently produce U+FFFD replacement characters — a "successful" but
    // completely wrong key.
    const invalid = 'obf:ff';

    expect(deobfuscateApiKey(invalid)).toBe(invalid);
  });

  it('keeps a key with a lone surrogate intact instead of corrupting it', () => {
    const key = 'sk-\uD800';

    // Encoding replaces the lone surrogate, so the value cannot be stored
    // losslessly; the helper must fall back to the plaintext rather than
    // write a key that would come back as something else.
    const stored = obfuscateApiKey(key);

    expect(deobfuscateApiKey(stored)).toBe(key);
  });
});

describe('processAllApiKeys', () => {
  it('obfuscates only the registered sensitive fields', () => {
    const config: Record<string, unknown> = {
      apiKey: SAMPLE_KEY,
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o',
    };

    processAllApiKeys(config, obfuscateApiKey);

    expect(config['apiKey']).toBe(obfuscateApiKey(SAMPLE_KEY));
    expect(config['baseUrl']).toBe('https://example.com/v1');
    expect(config['model']).toBe('gpt-4o');
  });

  it('walks nested provider objects', () => {
    const config: Record<string, unknown> = {
      providers: {
        'openai-compatible': { apiKey: SAMPLE_KEY, baseUrl: 'https://x.dev' },
      },
    };

    processAllApiKeys(config, obfuscateApiKey);

    const providers = config['providers'] as Record<string, unknown>;
    const openai = providers['openai-compatible'] as Record<string, unknown>;
    expect(openai['apiKey']).toBe(obfuscateApiKey(SAMPLE_KEY));
    expect(openai['baseUrl']).toBe('https://x.dev');
  });

  it('ignores non-object and array values', () => {
    const config: Record<string, unknown> = {
      list: [{ apiKey: SAMPLE_KEY }],
      nothing: null,
      text: 'hello',
    };

    expect(() => processAllApiKeys(config, obfuscateApiKey)).not.toThrow();
    // Arrays are not traversed, so the key inside the array is untouched.
    const list = config['list'] as Array<Record<string, unknown>>;
    expect(list[0]?.['apiKey']).toBe(SAMPLE_KEY);
  });

  it('covers newly registered sensitive fields', () => {
    registerSensitiveKey('accessToken');
    const config: Record<string, unknown> = {
      apiKey: SAMPLE_KEY,
      accessToken: 'token-value',
    };

    processAllApiKeys(config, obfuscateApiKey);

    expect(config['accessToken']).toBe(obfuscateApiKey('token-value'));
  });
});

describe('batch helpers', () => {
  it('obfuscates and deobfuscates a config in place', () => {
    const config: Record<string, unknown> = {
      openaiCompatible: { apiKey: SAMPLE_KEY, baseUrl: 'https://x.dev' },
      providers: {
        'openai-compatible': { apiKey: SAMPLE_KEY, baseUrl: 'https://x.dev' },
        ollama: { apiKey: '', baseUrl: 'http://localhost:11434' },
      },
    };

    obfuscateAllApiKeys(config);

    const openai = config['openaiCompatible'] as Record<string, unknown>;
    expect(openai['apiKey']).not.toBe(SAMPLE_KEY);

    deobfuscateAllApiKeys(config);

    const restored = config['openaiCompatible'] as Record<string, unknown>;
    expect(restored['apiKey']).toBe(SAMPLE_KEY);
    expect(restored['baseUrl']).toBe('https://x.dev');
  });

  it('leaves an empty key empty', () => {
    const config: Record<string, unknown> = { apiKey: '' };

    obfuscateAllApiKeys(config);

    expect(config['apiKey']).toBe('');
  });
});

describe('failure handling', () => {
  it('logs when a key cannot be obfuscated and keeps it usable', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const original = globalThis.TextEncoder;
    // Force the encoder to throw.
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      value: class {
        encode(): Uint8Array {
          throw new Error('boom');
        }
      },
    });

    try {
      const result = obfuscateApiKey(SAMPLE_KEY);

      expect(result).toBe(SAMPLE_KEY);
      expect(error).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'TextEncoder', {
        configurable: true,
        value: original,
      });
      error.mockRestore();
    }
  });
});
