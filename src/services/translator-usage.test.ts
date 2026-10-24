/**
 * 账归谁记。
 *
 * 用量面板上的数字是用户拿来对账的，所以「一次请求记一笔」这件事必须由
 * 唯一知道「真的问了一次服务商」的那一层来记：
 *
 *   - provider：在「2xx 但答案读不懂」的时候记一笔。那一层之后错误就被拍
 *     扁成一句话了，上面再也拿不到 usage，只能由它记。
 *   - worker（`provider-direct-client.ts`）：成功、以及「超时放弃」（408）
 *     记一笔。worker 的队列会把两个相同的 pageKey 合并成一个 job，两个调
 *     用方拿到同一份结果，而服务商只被问了一次 —— 只有它知道问了几次。
 *   - translator（内容脚本这一层）：只记缓存命中。那不是一次请求，是一次
 *     没有发生的请求。
 *
 * 记账曾经放在 translator 里，于是 worker 合并的两个调用方各记一笔：一次
 * 请求在用户的账单上出现两次，把用户没花的钱算成花了。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processImageMock } = vi.hoisted(() => ({
  processImageMock: vi.fn(),
}));

vi.mock('./image-processor', async importOriginal => {
  const actual = await importOriginal<typeof import('./image-processor')>();
  return { ...actual, processImage: processImageMock };
});

vi.mock('@/utils/http-client', () => ({
  httpRequest: vi.fn(),
}));

import { TranslatorService } from './translator';
import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';
import { httpRequest } from '@/utils/http-client';
import { OpenAIProvider } from '@/providers/openai';
import {
  isAbandonedRequest,
  recordBilledRequest,
} from '@/providers/usage-recording';
import type { TranslationTransport } from './translation-transport';

const image = {
  naturalWidth: 800,
  naturalHeight: 600,
  src: 'https://example.com/page.jpg',
} as HTMLImageElement;

function makeTranslator(
  translateImage: TranslationTransport['translateImage']
): TranslatorService {
  return new TranslatorService({
    provider: 'openai-compatible',
    apiKey: 'sk-test',
    baseUrl: 'https://example.com/v1',
    model: 'gpt-4o',
    targetLanguage: 'zh-CN',
    cacheEnabled: false,
    translationStylePreset: 'natural-zh',
    transport: { translateImage } as TranslationTransport,
  });
}

describe('TranslatorService usage accounting', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    useUsageStore.getState().clearAll();
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'usage-hash',
    });
  });

  it('does not record a billable request — the worker does', async () => {
    const translator = makeTranslator(async () => ({
      success: true,
      textAreas: [
        {
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.1,
          originalText: '原文',
          translatedText: '译文',
        },
      ],
      cached: false,
      usage: { promptTokens: 1200, completionTokens: 340, totalTokens: 1540 },
    }));

    await translator.translateImage(image);

    // 这一层不能记账：它不知道这一次是不是真的问了服务商。worker 的队列
    // 会把两个相同的 pageKey 合并成一个 job，两个调用方拿到同一份结果 ——
    // 在这一层记，一次请求就会在用户的账单上出现两次。
    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.billableCalls).toBe(0);
    expect(summary.tokens).toBe(0);
    expect(useUsageStore.getState().records).toHaveLength(0);
  });

  it('does not count a call that never happened', async () => {
    const translator = makeTranslator(async () => {
      throw new Error('network down');
    });

    await translator.translateImage(image).catch(() => undefined);

    expect(useUsageStore.getState().records).toHaveLength(0);
  });

  it('reports a cache hit to the worker instead of writing it itself', async () => {
    // 缓存命中是这一层唯一该记的东西：它不是一次请求，是一次没有发生的
    // 请求。计费的那一笔不归它。
    const translateImage = vi.fn(async () => ({
      success: true,
      textAreas: [
        {
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.1,
          originalText: '原文',
          translatedText: '译文',
        },
      ],
      cached: false,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));

    const cached = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });

    await cached.translateImage(image);
    // A second translator with the same endpoint and image hits the cache.
    const second = new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o',
      targetLanguage: 'zh-CN',
      cacheEnabled: true,
      translationStylePreset: 'natural-zh',
      transport: { translateImage } as TranslationTransport,
    });
    await second.translateImage(image);

    // 服务商只被问了一次；第二次是缓存命中。
    expect(translateImage).toHaveBeenCalledTimes(1);

    // 页面自己不记账了：它把"这是一次缓存命中"告诉 worker，由 worker 写进
    // 这个月的合计。页面写一份、worker 再写一份，两个数谁也加不出总数，
    // 而且每个上下文都会攒下自己的一份，列表就永远长下去。
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RECORD_CACHE_HIT',
        provider: 'openai-compatible',
      })
    );

    // 页面这一侧不留任何记录：命中没有发过请求，不该算成一次计费调用。
    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.translations).toBe(0);
    expect(summary.billableCalls).toBe(0);
    expect(summary.cacheHitRate).toBe(0);
  });
});

/**
 * 一次请求，只记一次。
 *
 * 这里跑的是真的 provider，只是把 worker 换成一层假的外壳：真的调
 * provider，真的把错误拍扁成一句话传回来，记账的动作照着 worker 那一层
 * 做（成功记一笔、408 记一笔、服务商拒收的不记）。
 *
 * 拍扁这一步是整个问题的一半 —— 拍扁之后，上层再也分不出「服务商拒收」
 * 和「服务商还在算我们就走了」，只能从消息里的 `[HTTP nnn]` 标记把它读
 * 回来。以前账就是记在这一层往上的，所以一次请求被记成两次。
 */
describe('一次请求只记一次（provider 与 worker 合起来）', () => {
  beforeEach(() => {
    processImageMock.mockReset();
    useUsageStore.getState().clearAll();
    vi.mocked(httpRequest).mockReset();
    processImageMock.mockResolvedValue({
      base64: 'img',
      mimeType: 'image/jpeg',
      originalWidth: 800,
      originalHeight: 600,
      width: 800,
      height: 600,
      wasCompressed: false,
      hash: 'billing-hash',
    });
  });

  /**
   * 模拟 worker：真的调 provider，然后把错误拍扁成一句话传回来。
   *
   * 记账的动作和真的 worker（`provider-direct-client.ts`）一样：成功记一
   * 笔（扩展知道自己问了），超时放弃记一笔（钱已经花了），服务商拒收的
   * 不记（模型没有跑）。
   */
  function workerLikeTransport(): TranslationTransport {
    const provider = new OpenAIProvider();
    void provider.initialize({
      // 云端服务商要求密钥至少 20 个字符，短密钥在发请求之前就被拦下了。
      apiKey: 'sk-test-key-1234567890',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o',
    });

    return {
      async translateImage(request) {
        try {
          const response = await provider.analyzeAndTranslate(
            request.imageBase64,
            request.targetLanguage
          );
          recordBilledRequest('openai-compatible', response.usage ?? null);
          return {
            success: true,
            textAreas: response.textAreas,
            usage: response.usage,
          };
        } catch (error) {
          if (isAbandonedRequest(error)) {
            recordBilledRequest('openai-compatible', null);
          }
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }

  function translatorWith(transport: TranslationTransport): TranslatorService {
    return new TranslatorService({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o',
      targetLanguage: 'zh-CN',
      cacheEnabled: false,
      translationStylePreset: 'natural-zh',
      transport,
    });
  }

  function records(): number {
    return summarizeUsageForMonth(useUsageStore.getState().records)
      .billableCalls;
  }

  it('服务商拒收的请求不记账', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      error: 'Invalid API key',
    });

    const translator = translatorWith(workerLikeTransport());
    await translator.translateImage(image).catch(() => undefined);

    // 模型根本没跑，没有钱可记。
    expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(1);
    expect(records()).toBe(0);
  });

  it('成功的一次请求记一次', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                textAreas: [
                  {
                    x: 0.1,
                    y: 0.1,
                    width: 0.2,
                    height: 0.1,
                    originalText: '原文',
                    translatedText: '译文',
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    });

    const translator = translatorWith(workerLikeTransport());
    await translator.translateImage(image);

    expect(records()).toBe(1);
    expect(
      summarizeUsageForMonth(useUsageStore.getState().records).tokens
    ).toBe(120);
  });

  it('2xx 但答案读不懂：记一次，不记两次', async () => {
    // provider 记一笔（它之后再没有人拿得到 usage），worker 看到的是一
    // 次失败而不是一次成功，不该再记。两次记账就是把一次请求算成两次。
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { choices: [{ message: { content: 'I cannot help with that.' } }] },
    });

    const translator = translatorWith(workerLikeTransport());
    await translator.translateImage(image).catch(() => undefined);

    expect(records()).toBe(1);
  });

  it('模型自己在回答里写了一个状态码：也不会多记一笔', async () => {
    // 解析失败时，模型的前 200 个字符被原样塞进错误消息。模型要是回答了
    // `[HTTP 408] request timed out`，一个从消息里读状态码的记账方就会
    // 认定"服务商还在算我们就走了"，于是再记一笔 —— 一次请求两条记录。
    //
    // 现在记账方看的是错误对象上的状态码，不是消息里的文字，所以模型写
    // 什么都不会多出一条账。
    //
    // 解析失败本身会重试一次（这是有意的：换一次机会，模型可能就听话了），
    // 所以两次请求就是两条记录，多出来的那一条才是 bug。
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {
        choices: [
          {
            message: {
              content: '{error: [HTTP 408] request timed out, retry later}',
            },
          },
        ],
      },
    });

    const translator = translatorWith(workerLikeTransport());
    await translator.translateImage(image).catch(() => undefined);

    expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(2);
    expect(records()).toBe(2);
  });

  it('超时放弃：两次请求记两次', async () => {
    // 408 的语义是「已经送出去了，服务商还在算，客户端不等了」。钱已经
    // 花了，所以要记；而重试又发了一次，所以是两次请求、两条记录。
    vi.mocked(httpRequest).mockResolvedValue({
      ok: false,
      status: 408,
      statusText: 'Request Timeout',
      error: 'Request timed out',
    });

    const translator = translatorWith(workerLikeTransport());
    await translator.translateImage(image).catch(() => undefined);

    expect(vi.mocked(httpRequest)).toHaveBeenCalledTimes(2);
    expect(records()).toBe(2);
  }, 15_000);
});
