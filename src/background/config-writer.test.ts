/**
 * The worker writes the persisted configuration through one function.
 *
 * It matters because there are two writers for one key: zustand's `persist`
 * middleware and this one. Zustand rehydrates from `deserializedStorageValue
 * .state`, so anything that is not `{ state, version }` reads back as "nothing
 * stored" — the defaults get merged over the user's settings and written
 * straight back. The user loses their API key, endpoint, model and
 * auto-translate allowlist.
 *
 * These tests pin the shape, the version and the obfuscation.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  APP_CONFIG_STORAGE_KEY,
  APP_CONFIG_VERSION,
} from '@/shared/app-config';
import { deobfuscateAllApiKeys, obfuscateApiKey } from '@/utils/crypto';

import {
  buildConfigEnvelope,
  toConfigEnvelope,
  writeConfigEnvelope,
} from './config-writer';

interface StoredEnvelope {
  state: Record<string, unknown>;
  version: number;
}

function installChromeMock(): Record<string, unknown> {
  const localStore: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'config-writer-test' },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) {
            if (key in localStore) out[key] = localStore[key];
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(localStore, items);
        },
        remove: async () => undefined,
      },
      sync: {
        get: async () => ({}),
        remove: async () => undefined,
      },
    },
  };
  return localStore;
}

describe('config writer', () => {
  let localStore: Record<string, unknown>;

  beforeEach(() => {
    localStore = installChromeMock();
  });

  it('writes the envelope the store reads', async () => {
    await writeConfigEnvelope({
      enabled: true,
      targetLanguage: 'ko',
      parallelLimit: 5,
    });

    const stored = localStore[APP_CONFIG_STORAGE_KEY] as StoredEnvelope;
    expect(stored).toBeDefined();
    expect(stored.version).toBe(APP_CONFIG_VERSION);
    // The state lives under `state`. A flat object here is what zustand
    // cannot read.
    expect(stored.state['enabled']).toBe(true);
    expect(stored.state['targetLanguage']).toBe('ko');
    expect(stored.state['parallelLimit']).toBe(5);
  });

  it('obfuscates the API key on the way to disk', async () => {
    await writeConfigEnvelope({
      openaiCompatible: {
        apiKey: 'sk-plaintext-secret',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
      },
      providers: {
        'openai-compatible': {
          apiKey: 'sk-plaintext-secret',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-4o',
        },
      },
    });

    const raw = JSON.stringify(localStore[APP_CONFIG_STORAGE_KEY]);
    expect(raw).not.toContain('sk-plaintext-secret');

    const stored = localStore[APP_CONFIG_STORAGE_KEY] as StoredEnvelope;
    const provider = stored.state['openaiCompatible'] as Record<string, string>;
    const storedKey = provider['apiKey'] ?? '';
    expect(storedKey).not.toBe('sk-plaintext-secret');
    expect(storedKey.startsWith('obf:')).toBe(true);

    // …and it is still the user's key once read back.
    deobfuscateAllApiKeys(stored.state);
    const deobfuscated = stored.state['openaiCompatible'] as Record<
      string,
      string
    >;
    expect(deobfuscated['apiKey']).toBe('sk-plaintext-secret');
  });

  it('does not mutate the state it was handed', async () => {
    const state = {
      openaiCompatible: {
        apiKey: 'sk-plaintext-secret',
        baseUrl: '',
        model: '',
      },
    };

    await writeConfigEnvelope(state);

    expect(state.openaiCompatible.apiKey).toBe('sk-plaintext-secret');
  });

  it('stamps the current version on the envelope it builds', () => {
    const envelope = buildConfigEnvelope({ enabled: true });

    expect(envelope.version).toBe(APP_CONFIG_VERSION);
    expect(envelope.state['enabled']).toBe(true);
  });
});

describe('toConfigEnvelope', () => {
  it('keeps the version of an envelope it is handed', () => {
    const envelope = toConfigEnvelope({
      state: { enabled: true },
      version: 2,
    });

    expect(envelope?.version).toBe(2);
    expect(envelope?.state['enabled']).toBe(true);
  });

  it('wraps a flat configuration and dates it by its contents', () => {
    // `onboardingCompleted` arrived with v3, so a flat object that has it is
    // already in the modern shape — only the last migration step is left.
    const envelope = toConfigEnvelope({
      enabled: true,
      onboardingCompleted: true,
    });

    expect(envelope?.version).toBe(3);
    expect(envelope?.state['enabled']).toBe(true);
  });

  it('dates a flat configuration without the v3 marker as the oldest shape', () => {
    const envelope = toConfigEnvelope({ enabled: true });

    expect(envelope?.version).toBe(0);
  });

  it('obfuscates a key that is somehow still in plaintext', () => {
    const envelope = toConfigEnvelope({
      providers: {
        'openai-compatible': { apiKey: 'sk-plaintext-secret' },
      },
    });

    const raw = JSON.stringify(envelope);
    expect(raw).not.toContain('sk-plaintext-secret');

    if (!envelope) {
      throw new Error('扁平配置应当被包成信封');
    }
    deobfuscateAllApiKeys(envelope.state);
    const providers = envelope.state['providers'] as Record<
      string,
      { apiKey: string }
    >;
    expect(providers['openai-compatible']?.apiKey).toBe('sk-plaintext-secret');
  });

  it('leaves an already-obfuscated key alone', () => {
    const obfuscated = obfuscateApiKey('sk-plaintext-secret');
    const envelope = toConfigEnvelope({
      providers: { 'openai-compatible': { apiKey: obfuscated } },
    });

    if (!envelope) {
      throw new Error('扁平配置应当被包成信封');
    }
    const providers = envelope.state['providers'] as Record<
      string,
      { apiKey: string }
    >;
    expect(providers['openai-compatible']?.apiKey).toBe(obfuscated);
  });

  it('refuses a value that is not a configuration at all', () => {
    expect(toConfigEnvelope('nonsense')).toBeNull();
    expect(toConfigEnvelope(null)).toBeNull();
    expect(toConfigEnvelope(undefined)).toBeNull();
  });
});
