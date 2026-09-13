import { describe, expect, it } from 'vitest';

import { normalizeRuntimeAppConfig } from './app-config';

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
