import { describe, expect, it } from 'vitest';

import { estimateProviderCost, getProviderStrategy } from './provider-strategy';

describe('provider strategy', () => {
  it('returns the expected local cost label for ollama', () => {
    expect(getProviderStrategy('ollama').costLabel).toBe('本地');
  });

  it('estimates a positive cost for openai-compatible', () => {
    expect(estimateProviderCost('openai-compatible', 1200, 5)).toBeGreaterThan(0);
  });
});
