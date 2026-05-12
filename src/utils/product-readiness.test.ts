import { describe, expect, it } from 'vitest';

import type { ProvidersConfig } from '@/stores/config-v2';

import { getConfigurationNextStep, isProviderConfigured } from './product-readiness';

const providers: ProvidersConfig = {
  'openai-compatible': {
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    model: 'llava',
  },
};

describe('product readiness', () => {
  it('treats openai-compatible as configured when api key exists', () => {
    expect(isProviderConfigured('openai-compatible', providers)).toBe(true);
  });

  it('treats ollama as configured when base url exists', () => {
    expect(isProviderConfigured('ollama', providers)).toBe(true);
  });

  it('returns the new direct guidance copy', () => {
    expect(
      getConfigurationNextStep('openai-compatible', providers)
    ).toContain('OpenAI-compatible');
  });
});
