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
    expect(options?.timeout).toBe(30_000);
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
