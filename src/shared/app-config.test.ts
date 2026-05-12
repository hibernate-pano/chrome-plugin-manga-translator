import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OLLAMA_CONFIG,
  normalizeRuntimeAppConfig,
} from './app-config';

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
    expect(normalized.openaiCompatible).toEqual({
      apiKey: 'sf-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-VL-32B-Instruct',
    });
  });

  it('keeps explicit openai-compatible settings when already migrated', () => {
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

    expect(normalized.openaiCompatible).toEqual({
      apiKey: 'new-key',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'custom-vlm',
    });
  });

  it('normalizes ollama and strips legacy api keys', () => {
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
    expect(normalized.ollama).toEqual({
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'minicpm-v',
    });
    expect(normalized.ollama.apiKey).toBe(DEFAULT_OLLAMA_CONFIG.apiKey);
  });
});
