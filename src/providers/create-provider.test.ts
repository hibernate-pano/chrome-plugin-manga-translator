import { describe, expect, it } from 'vitest';

import { createProvider } from './index';

describe('createProvider', () => {
  const config = {
    apiKey: 'sk-test',
    baseUrl: 'https://example.com/v1',
    model: 'test-model',
  };

  it('creates an openai-compatible provider and initializes it', async () => {
    const provider = await createProvider('openai-compatible', config);
    expect(provider).toBeDefined();
  });

  it('creates ollama and lm-studio providers', async () => {
    const ollama = await createProvider('ollama', config);
    const lmStudio = await createProvider('lm-studio', config);
    expect(ollama).toBeDefined();
    expect(lmStudio).toBeDefined();
  });

  it('rejects an unknown provider type', async () => {
    await expect(createProvider('nope' as never, config)).rejects.toThrow(
      'Unknown provider type: nope'
    );
  });
});
