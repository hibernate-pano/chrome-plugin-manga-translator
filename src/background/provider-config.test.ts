import { describe, expect, it } from 'vitest';

import {
  isProviderUsable,
  resolveActiveProvider,
  type ActiveProviderConfig,
} from './provider-config';

describe('the active provider is read out of the configuration', () => {
  it('reads the provider the reader selected', () => {
    const active = resolveActiveProvider({
      provider: 'ollama',
      providers: {
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          model: 'llava',
        },
      },
    });

    expect(active.provider).toBe('ollama');
    expect(active.baseUrl).toBe('http://localhost:11434');
    expect(active.model).toBe('llava');
  });

  it('falls back to the openai-compatible provider for an unknown name', () => {
    // A provider name that is not one of the three is not a name the
    // extension can call, so it must not become the endpoint the key is
    // sent to.
    const active = resolveActiveProvider({
      provider: 'not-a-provider',
      providers: {
        'openai-compatible': {
          apiKey: 'sk-key',
          baseUrl: 'https://api.vendor.example/v1',
          model: 'vendor-model',
        },
      },
    });

    expect(active.provider).toBe('openai-compatible');
  });

  it('returns empty settings rather than throwing on a broken config', () => {
    const active = resolveActiveProvider({ provider: 'ollama' });

    expect(active.provider).toBe('ollama');
    expect(active.apiKey).toBe('');
    expect(active.baseUrl).toBe('');
  });
});

describe('a provider has to be set up before it can run a job', () => {
  const cloud: ActiveProviderConfig = {
    provider: 'openai-compatible',
    apiKey: 'sk-key',
    baseUrl: 'https://api.vendor.example/v1',
    model: 'vendor-model',
  };

  it('accepts a cloud provider with an endpoint and a key', () => {
    expect(isProviderUsable(cloud)).toBe(true);
  });

  it('rejects a cloud provider with no key', () => {
    // The job has to stop with a sentence that says what to do, rather
    // than fail with an authentication error that has nothing to do with
    // the image the reader asked about.
    expect(isProviderUsable({ ...cloud, apiKey: '' })).toBe(false);
  });

  it('rejects a provider with no endpoint', () => {
    expect(isProviderUsable({ ...cloud, baseUrl: '' })).toBe(false);
  });

  it('accepts a local provider with only an endpoint', () => {
    // Ollama and LM Studio run on the reader's own machine: no key, no
    // bill, nothing to fill in beyond the address.
    expect(
      isProviderUsable({
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llava',
      })
    ).toBe(true);
  });

  it('rejects a local provider with no endpoint', () => {
    expect(
      isProviderUsable({
        provider: 'lm-studio',
        apiKey: '',
        baseUrl: '',
        model: '',
      })
    ).toBe(false);
  });
});
