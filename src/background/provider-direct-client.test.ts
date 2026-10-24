import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/providers', () => ({
  createProvider: vi.fn(),
}));

import { createProvider } from '@/providers';
import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';
import { createApiErrorWithStatus } from '@/providers/base';

import { translateImageViaProviderDirect } from './provider-direct-client';

describe('provider-direct-client', () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockReset();
  });

  it('creates the openai-compatible provider with the worker-side settings', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({ textAreas: [] }),
    } as never);

    await translateImageViaProviderDirect({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      imageBase64: 'base64-data',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    });

    expect(createProvider).toHaveBeenCalledWith('openai-compatible', {
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    });
  });

  it('creates the lm-studio provider with direct settings', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({ textAreas: [] }),
    } as never);

    await translateImageViaProviderDirect({
      provider: 'lm-studio',
      apiKey: '',
      baseUrl: 'http://localhost:1234/v1',
      model: 'qwen',
      imageBase64: 'base64-data',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    });

    expect(createProvider).toHaveBeenCalledWith('lm-studio', {
      apiKey: '',
      baseUrl: 'http://localhost:1234/v1',
      model: 'qwen',
    });
  });

  it('returns pipeline: "full-image-fallback" and success on happy path (t10 regression guard)', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({
        textAreas: [
          {
            x: 0,
            y: 0,
            width: 100,
            height: 50,
            translatedText: '你好',
            originalText: 'hello',
          },
        ],
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      }),
    } as never);

    const result = await translateImageViaProviderDirect({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      imageBase64: 'base64-data',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    });

    expect(result.success).toBe(true);
    expect(result.pipeline).toBe('full-image-fallback');
    expect(result.cached).toBe(false);
    expect(result.textAreas).toHaveLength(1);
    expect(result.textAreas?.[0]?.translatedText).toBe('你好');
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it('rejects unknown provider types without calling createProvider', async () => {
    const result = await translateImageViaProviderDirect({
      provider: 'unknown-provider' as never,
      apiKey: '',
      baseUrl: '',
      model: '',
      imageBase64: 'base64-data',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Provider');
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('rejects invalid translation style preset', async () => {
    const result = await translateImageViaProviderDirect({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: '',
      model: '',
      imageBase64: 'base64-data',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'invalid-style' as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('翻译风格');
    expect(createProvider).not.toHaveBeenCalled();
  });
});

/**
 * 记账跟着"真的问了一次服务商"走。
 *
 * 这一层是唯一知道这件事的地方：worker 的队列会把两个相同的 pageKey 合并
 * 成一个 job，两个调用方拿到同一份结果，而服务商只被问了一次。账在这里记
 * 一次，两边就都对了 —— 在调用方那边记，一次请求会变成两次，用户没花的
 * 钱被算成花了。
 */
describe('worker 的用量记账', () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockReset();
    useUsageStore.getState().clearAll();
  });

  function job() {
    return {
      provider: 'openai-compatible' as const,
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      imageBase64: 'base64-data',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh' as const,
    };
  }

  function billableCalls(): number {
    return summarizeUsageForMonth(useUsageStore.getState().records)
      .billableCalls;
  }

  it('records the tokens the provider reported', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({
        textAreas: [],
        usage: {
          promptTokens: 1200,
          completionTokens: 340,
          totalTokens: 1540,
        },
      }),
    } as never);

    await translateImageViaProviderDirect(job());

    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.billableCalls).toBe(1);
    expect(summary.tokens).toBe(1540);
  });

  it('records the call even when the provider reports no usage', async () => {
    // 扩展知道自己问了。服务商没有报 token，不等于这次请求不花钱 ——
    // 面板上那个数字是用户拿来对账的。
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({ textAreas: [] }),
    } as never);

    await translateImageViaProviderDirect(job());

    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.billableCalls).toBe(1);
    expect(summary.tokens).toBe(0);
  });

  it('does not record a request the provider refused', async () => {
    // 401：模型没有跑，没有计费。记下来就是凭空给用户算钱。
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi
        .fn()
        .mockRejectedValue(
          createApiErrorWithStatus('Invalid API key', 'OpenAI', 401)
        ),
    } as never);

    await translateImageViaProviderDirect(job());

    expect(billableCalls()).toBe(0);
  });

  it('records an abandoned request once', async () => {
    // 408：请求已经送到，模型已经在算，客户端不想等了。钱已经花了。
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi
        .fn()
        .mockRejectedValue(
          createApiErrorWithStatus('Request timed out', 'OpenAI', 408)
        ),
    } as never);

    await translateImageViaProviderDirect(job());

    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.billableCalls).toBe(1);
    expect(summary.tokens).toBe(0);
  });

  it('does not add a second record when the answer cannot be read', async () => {
    // "2xx 但答案读不懂"是 provider 自己记的：那一层之后错误就被拍扁了，
    // usage 再也拿不到。这里不能再记一笔 —— 一次请求记两次，是把用户没
    // 花的钱算成花了。
    vi.mocked(createProvider).mockResolvedValue({
      analyzeAndTranslate: vi
        .fn()
        .mockRejectedValue(new Error('OpenAI API returned no data')),
    } as never);

    await translateImageViaProviderDirect(job());

    expect(billableCalls()).toBe(0);
  });
});
