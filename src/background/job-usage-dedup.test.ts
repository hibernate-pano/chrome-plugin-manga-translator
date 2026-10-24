/**
 * 一次请求，只记一次。
 *
 * worker 的队列会把两个相同的 pageKey 合并成一个 job：两个调用方拿到同一份
 * 结果，而服务商只被问了一次。两个标签页打开同一页漫画、观察器和用户按钮
 * 同时要同一张图，都会走到这一步。
 *
 * 账必须跟着那一次请求走。以前记账在调用方那边（内容脚本里的翻译器），
 * 于是两个调用方各记一笔 —— 一次请求在用户的账单上出现两次，把用户没花
 * 的钱算成花了。现在账记在 worker 这一层：它才是唯一知道"真的问了一次"
 * 的地方。
 *
 * 这个测试用的是真的队列、真的直连客户端、真的用量存储，只有网络那一层
 * （`@/providers`）是假的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyzeAndTranslateMock = vi.fn();

vi.mock('@/providers', () => ({
  createProvider: vi.fn(async () => ({
    analyzeAndTranslate: analyzeAndTranslateMock,
  })),
  providerRequiresApiKey: () => true,
}));

import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';
import { BackgroundJobQueue, createJobStatus } from './job-queue';
import { translateImageViaProviderDirect } from './provider-direct-client';

describe('worker 合并的两个调用方，只记一次账', () => {
  beforeEach(() => {
    analyzeAndTranslateMock.mockReset();
    useUsageStore.getState().clearAll();
  });

  function job(pageKey: string, jobId: string) {
    return createJobStatus({
      jobId,
      pageKey,
      priorityClass: 'visible-now',
      requestedPath: 'plugin-direct',
      scope: 'page',
    });
  }

  function run() {
    return translateImageViaProviderDirect({
      provider: 'openai-compatible',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      imageBase64: 'base64-data',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    });
  }

  it('asks the provider once and records it once', async () => {
    analyzeAndTranslateMock.mockResolvedValue({
      textAreas: [],
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const queue = new BackgroundJobQueue(2, 0);
    const pageKey = 'page-1::t0';

    // Two callers ask for the same image at the same time — two tabs of the
    // same chapter, or the observer and the reader's own button.
    const [first, second] = await Promise.all([
      queue.enqueue({ job: job(pageKey, 'job-1'), run }),
      queue.enqueue({ job: job(pageKey, 'job-2'), run }),
    ]);

    // 两个调用方拿到同一份结果……
    expect(first).toEqual(second);
    // ……而服务商只被问了一次。
    expect(analyzeAndTranslateMock).toHaveBeenCalledTimes(1);

    // 账也只有一笔：面板上那个数字是用户拿来对账的。
    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.billableCalls).toBe(1);
    expect(summary.tokens).toBe(120);
  });

  it('records two jobs that are really two requests', async () => {
    // 反过来：两个不同的图就是两次请求，也就该是两笔账。
    analyzeAndTranslateMock.mockResolvedValue({
      textAreas: [],
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const queue = new BackgroundJobQueue(2, 0);

    await Promise.all([
      queue.enqueue({ job: job('page-1::t0', 'job-1'), run }),
      queue.enqueue({ job: job('page-1::t1', 'job-2'), run }),
    ]);

    expect(analyzeAndTranslateMock).toHaveBeenCalledTimes(2);
    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.billableCalls).toBe(2);
  });
});
