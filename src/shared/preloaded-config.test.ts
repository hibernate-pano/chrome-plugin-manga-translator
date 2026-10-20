import { describe, expect, it } from 'vitest';

import { ENV_CONFIG } from './env-config';
import { ENV_CREDENTIALS } from './env-credentials';
import {
  PRELOADED_LM_STUDIO_CONFIG,
  PRELOADED_OLLAMA_CONFIG,
  PRELOADED_OPENAI_COMPATIBLE_CONFIG,
  normalizeRuntimeAppConfig,
} from './preloaded-config';

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

describe('预置的 provider 设置', () => {
  it('把构建时的 key 交给云端 provider，本地 provider 不带 key', () => {
    // The cloud provider is the only one that ships a credential. Ollama and
    // LM Studio are local daemons and never had one.
    expect(PRELOADED_OPENAI_COMPATIBLE_CONFIG.apiKey).toBe(
      ENV_CREDENTIALS.minimax.apiKey
    );
    expect(PRELOADED_OLLAMA_CONFIG.apiKey).toBe('');
    expect(PRELOADED_LM_STUDIO_CONFIG.apiKey).toBe('');
  });

  it('用的是构建时注入的端点，而不是硬编码的占位符', () => {
    expect(PRELOADED_OPENAI_COMPATIBLE_CONFIG.baseUrl).toBe(
      ENV_CONFIG.minimax.baseUrl
    );
    expect(PRELOADED_OPENAI_COMPATIBLE_CONFIG.model).toBe(
      ENV_CONFIG.minimax.model
    );
  });

  it('全新安装（存储为空）时，worker 仍然拿得到构建时的 key', () => {
    // The whole point of preloading: a personal build works with no setup.
    // If this regresses, a fresh install silently starts failing with an
    // "empty API key" error and nothing in the UI says why.
    const normalized = normalizeRuntimeAppConfig({});
    expect(normalized.openaiCompatible.apiKey).toBe(
      ENV_CREDENTIALS.minimax.apiKey
    );
    expect(normalized.openaiCompatible.baseUrl).toBe(
      ENV_CONFIG.minimax.baseUrl
    );
  });

  it('用户在设置里填的 key 覆盖构建时的 key', () => {
    const normalized = normalizeRuntimeAppConfig({
      openaiCompatible: { apiKey: 'typed-by-hand' },
    });
    expect(normalized.openaiCompatible.apiKey).toBe('typed-by-hand');
  });
});
