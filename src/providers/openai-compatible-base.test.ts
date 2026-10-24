/**
 * OpenAI-Compatible Provider Base Tests
 *
 * Focus: the HTTP status of a failed response must survive all the way to
 * the error classifier. Before the fix, `createApiError` was called with the
 * response body only, so 401 / 422 / 429 were all flattened into the same
 * generic "翻译失败" and the three status-based mappings in error-handler
 * were unreachable for provider errors.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { httpRequest } from '@/utils/http-client';
import {
  parseTranslationError,
  TranslationErrorCode,
} from '@/utils/error-handler';
import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';

import { OpenAICompatibleProvider } from './openai-compatible-base';

vi.mock('@/utils/http-client', () => ({
  httpRequest: vi.fn(),
}));

const base64Image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

class TestProvider extends OpenAICompatibleProvider {
  readonly name = 'Test-Provider';
  readonly type = 'openai-compatible' as const;

  protected getDefaultModel(): string {
    return 'test-model';
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.example.com/v1';
  }

  protected requiresAuth(): boolean {
    return true;
  }
}

function mockFailure(status: number, error: string): void {
  vi.mocked(httpRequest).mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    error,
  });
}

describe('OpenAICompatibleProvider error status propagation', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
    vi.mocked(httpRequest).mockReset();
  });

  it('carries a 401 as an auth error', async () => {
    mockFailure(401, 'Invalid API key');

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });

    const error = await provider
      .analyzeAndTranslate(base64Image, 'zh-CN')
      .catch((caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { status?: number }).status).toBe(401);
    expect(parseTranslationError(error).code).toBe(
      TranslationErrorCode.AUTH_ERROR
    );
  });

  it('carries a 429 as a rate limit', async () => {
    mockFailure(429, 'Rate limit reached');

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });

    const error = await provider
      .analyzeAndTranslate(base64Image, 'zh-CN')
      .catch((caught: unknown) => caught as Error);

    expect((error as Error & { status?: number }).status).toBe(429);
    expect(parseTranslationError(error).code).toBe(
      TranslationErrorCode.RATE_LIMIT
    );
  });

  it('carries a 422 as a content-blocked error', async () => {
    // MiniMax and friends answer 422 unprocessable_entity when the image
    // trips their moderation. Retrying that is pointless, so the user has
    // to be told to switch provider.
    mockFailure(422, 'unprocessable_entity: image is sensitive');

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });

    const error = await provider
      .analyzeAndTranslate(base64Image, 'zh-CN')
      .catch((caught: unknown) => caught as Error);

    expect((error as Error & { status?: number }).status).toBe(422);
    const friendly = parseTranslationError(error);
    expect(friendly.code).toBe(TranslationErrorCode.CONTENT_BLOCKED);
    expect(friendly.retryable).toBe(false);
  });

  it('keeps the provider name in the message', async () => {
    mockFailure(401, 'Invalid API key');

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });

    const error = await provider
      .analyzeAndTranslate(base64Image, 'zh-CN')
      .catch((caught: unknown) => caught as Error);

    expect((error as Error).message).toContain('Test-Provider');
    expect((error as Error).message).toContain('Invalid API key');
  });

  it('uses the cloud timeout by default', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { choices: [{ message: { content: '{"textAreas":[]}' } }] },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    await provider.analyzeAndTranslate(base64Image, 'zh-CN');

    const options = vi.mocked(httpRequest).mock.calls[0]?.[1];
    // 30 s was below what a `detail: 'high'` request with a 4096-token
    // ceiling actually needs: the client gave up while the model was still
    // working, and the provider billed for the abandoned request anyway.
    expect(options?.timeout).toBe(90_000);
  });

  it('survives the background worker flattening the error to a string', async () => {
    // The real chain is: provider error → background `getErrorMessage()` →
    // `{success: false, error: "<message>"}` → content script. The status
    // only lives on the message after that hop, so this asserts the whole
    // chain rather than just the object.
    mockFailure(401, 'Invalid API key');

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });

    const error = await provider
      .analyzeAndTranslate(base64Image, 'zh-CN')
      .catch((caught: unknown) => caught as Error);

    const flattened = (error as Error).message;
    const friendly = parseTranslationError(flattened);

    expect(friendly.code).toBe(TranslationErrorCode.AUTH_ERROR);
    expect(friendly.message).toBe('API 密钥无效，请检查配置');
    expect(friendly.suggestion).toContain('API 密钥');
    // The internal marker must never reach the user.
    expect(friendly.message).not.toContain('[HTTP');
  });

  it('surfaces a 422 as content blocked through the flattened message', async () => {
    mockFailure(422, 'unprocessable_entity: image is sensitive');

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });

    const error = await provider
      .analyzeAndTranslate(base64Image, 'zh-CN')
      .catch((caught: unknown) => caught as Error);

    const friendly = parseTranslationError((error as Error).message);
    expect(friendly.code).toBe(TranslationErrorCode.CONTENT_BLOCKED);
    expect(friendly.retryable).toBe(false);
  });
});

/**
 * The token counts are the only number the extension has that says what a
 * request cost.
 *
 * The response was parsed and the usage was thrown away, so the usage store
 * never received a record and the popup's 「本月 N 次 API 调用」 said zero for
 * the rest of the user's life no matter how much they were billed. These
 * tests pin the capture at the only place it can be lost.
 */
describe('OpenAICompatibleProvider token usage capture', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
    vi.mocked(httpRequest).mockReset();
  });

  function mockSuccess(data: unknown): void {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data,
    });
  }

  it('keeps the usage the service reported', async () => {
    mockSuccess({
      choices: [{ message: { content: '{"textAreas":[]}' } }],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 340,
        total_tokens: 1540,
      },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    const response = await provider.analyzeAndTranslate(base64Image, 'zh-CN');

    expect(response.usage).toEqual({
      promptTokens: 1200,
      completionTokens: 340,
      totalTokens: 1540,
    });
  });

  it('still returns the parsed text areas alongside the usage', async () => {
    mockSuccess({
      choices: [
        {
          message: {
            content: JSON.stringify({
              textAreas: [
                {
                  x: 0.1,
                  y: 0.2,
                  width: 0.3,
                  height: 0.1,
                  originalText: 'こんにちは',
                  translatedText: '你好',
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    const response = await provider.analyzeAndTranslate(base64Image, 'zh-CN');

    expect(response.textAreas).toHaveLength(1);
    expect(response.textAreas[0]?.translatedText).toBe('你好');
    expect(response.usage?.totalTokens).toBe(15);
  });

  it('adds up the parts when the service reports no total', async () => {
    mockSuccess({
      choices: [{ message: { content: '{"textAreas":[]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    const response = await provider.analyzeAndTranslate(base64Image, 'zh-CN');

    expect(response.usage?.totalTokens).toBe(120);
  });

  it('reports no usage when the service reports none', async () => {
    // Recording a zero would make a request that cost real money look like a
    // free one, so the absence of a number has to stay an absence.
    mockSuccess({
      choices: [{ message: { content: '{"textAreas":[]}' } }],
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    const response = await provider.analyzeAndTranslate(base64Image, 'zh-CN');

    expect(response.usage).toBeUndefined();
  });

  it('reports no usage when the numbers are not numbers', async () => {
    mockSuccess({
      choices: [{ message: { content: '{"textAreas":[]}' } }],
      usage: { prompt_tokens: 'many', completion_tokens: null },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    const response = await provider.analyzeAndTranslate(base64Image, 'zh-CN');

    expect(response.usage).toBeUndefined();
  });
});

/**
 * A 200 the model answered on is a request the service has already billed.
 *
 * The worker flattens errors to a string before the content script sees
 * them, so the caller cannot record these; the provider is the last place
 * that still knows the request was paid for.
 */
describe('OpenAICompatibleProvider billing on an unreadable answer', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
    vi.mocked(httpRequest).mockReset();
    useUsageStore.getState().clearAll();
  });

  function summary(): ReturnType<typeof summarizeUsageForMonth> {
    return summarizeUsageForMonth(useUsageStore.getState().records);
  }

  it('records a billed call when the answer cannot be parsed', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {
        choices: [{ message: { content: 'I cannot help with that.' } }],
        usage: { prompt_tokens: 900, completion_tokens: 100 },
      },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    await expect(
      provider.analyzeAndTranslate(base64Image, 'zh-CN')
    ).rejects.toThrow();

    expect(summary().billableCalls).toBe(1);
    expect(summary().tokens).toBe(1000);
  });

  it('records a billed call when the model returns no content', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {
        choices: [{ message: { content: '' } }],
        usage: { prompt_tokens: 500, completion_tokens: 0 },
      },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    await expect(
      provider.analyzeAndTranslate(base64Image, 'zh-CN')
    ).rejects.toThrow();

    expect(summary().billableCalls).toBe(1);
    expect(summary().tokens).toBe(500);
  });

  it('records the call with zero tokens when the service reports none', async () => {
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { choices: [{ message: { content: 'not json at all' } }] },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    await expect(
      provider.analyzeAndTranslate(base64Image, 'zh-CN')
    ).rejects.toThrow();

    // The count is what the user reads as their bill; the tokens stay at
    // zero rather than being invented.
    expect(summary().billableCalls).toBe(1);
    expect(summary().tokens).toBe(0);
  });

  it('records a billed call when the body cannot be read at all', async () => {
    // A gateway that answers 200 with an HTML error page leaves no body to
    // read. The model still ran and the service still billed for it, so
    // this 2xx must not be the one that escapes the count.
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    await expect(
      provider.analyzeAndTranslate(base64Image, 'zh-CN')
    ).rejects.toThrow();

    expect(summary().billableCalls).toBe(1);
    expect(summary().tokens).toBe(0);
  });

  it('does not record a 2xx that carries an error instead of an answer', async () => {
    // A 2xx with an `error` field is the service reporting a refusal under
    // a success status: the model did not run, so nothing was billed. It is
    // the one 2xx that is not a bill — and the rule now says so out loud,
    // so the next reader does not have to guess.
    vi.mocked(httpRequest).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { error: { message: 'insufficient balance' } },
    });

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    await expect(
      provider.analyzeAndTranslate(base64Image, 'zh-CN')
    ).rejects.toThrow();

    expect(summary().billableCalls).toBe(0);
  });

  it('does not record a request the provider rejected', async () => {
    mockFailure(401, 'Invalid API key');

    await provider.initialize({ apiKey: 'sk-'.padEnd(24, 'x') });
    await expect(
      provider.analyzeAndTranslate(base64Image, 'zh-CN')
    ).rejects.toThrow();

    // 401 was rejected before the model ran; nothing was billed.
    expect(summary().billableCalls).toBe(0);
  });
});
