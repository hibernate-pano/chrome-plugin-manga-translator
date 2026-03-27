import { describe, expect, it } from 'vitest';
import {
  estimateProviderCost,
  getProviderStrategy,
} from './provider-strategy';

describe('getProviderStrategy', () => {
  it('returns the expected recommendation for siliconflow', () => {
    expect(getProviderStrategy('siliconflow').suggestedModel).toBe(
      'Qwen/Qwen2.5-VL-32B-Instruct'
    );
  });

  it('marks ollama as local cost', () => {
    expect(getProviderStrategy('ollama').costLabel).toBe('本地');
  });
});

describe('estimateProviderCost', () => {
  it('estimates non-zero cost for cloud providers', () => {
    expect(estimateProviderCost('openai', 1200, 20)).toBeGreaterThan(0);
  });

  it('estimates zero cost for ollama', () => {
    expect(estimateProviderCost('ollama', 1200, 20)).toBe(0);
  });
});
