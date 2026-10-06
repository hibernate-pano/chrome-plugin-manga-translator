import { describe, expect, it } from 'vitest';

import {
  parseTranslationError,
  retryWithBackoff,
  TranslationErrorHandler,
  TranslationErrorCode,
} from './error-handler';

describe('parseTranslationError', () => {
  it('keeps original message for unknown errors', () => {
    const result = parseTranslationError(
      new Error('章节数据结构已变更，未匹配到图片节点')
    );

    expect(result.code).toBe(TranslationErrorCode.UNKNOWN_ERROR);
    expect(result.message).toContain('发生未知错误：');
    expect(result.message).toContain('章节数据结构已变更');
  });

  it('maps chapter waiting timeout to timeout error', () => {
    const result = parseTranslationError(
      new Error('章节图片未在预期时间内出现')
    );

    expect(result.code).toBe(TranslationErrorCode.TIMEOUT_ERROR);
  });

  it('treats known Chinese model incompatibility as a first-class error', () => {
    const result = parseTranslationError(new Error('当前模型不支持翻译任务'));

    expect(result.code).toBe(TranslationErrorCode.MODEL_INCOMPATIBLE);
    expect(result.message).toBe('当前模型不支持翻译任务');
  });

  it('maps ollama extension origin rejection to a specific error', () => {
    const result = parseTranslationError(
      new Error(
        'Ollama rejected the extension origin. Set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.'
      )
    );

    expect(result.code).toBe(TranslationErrorCode.OLLAMA_ORIGIN_NOT_ALLOWED);
    expect(result.message).toBe('Ollama 未允许当前浏览器扩展访问');
  });

  it('maps MiniMax-style sensitive-image rejection to CONTENT_BLOCKED (not retryable)', () => {
    const result = parseTranslationError(
      new Error(
        'OpenAI-Compatible: {"type":"error","error":{"type":"unprocessable_entity_error","message":"input new_sensitive, messages[0]\'s content[1] image is sensitive, please check your input (1026)","http_code":"422"},"request_id":"06dcac921482a6069ec57e1dec9034d7"}'
      )
    );

    expect(result.code).toBe(TranslationErrorCode.CONTENT_BLOCKED);
    expect(result.retryable).toBe(false);
    expect(result.suggestion).toContain('Ollama');
  });
});

describe('TranslationErrorHandler retry semantics', () => {
  it('isRetryable reads the retryable flag of a FriendlyError', () => {
    const rateLimit = parseTranslationError(new Error('429 too many'));
    expect(rateLimit.code).toBe(TranslationErrorCode.RATE_LIMIT);
    expect(TranslationErrorHandler.isRetryable(rateLimit)).toBe(
      rateLimit.retryable
    );
    expect(TranslationErrorHandler.isRetryable(new Error('boom'))).toBe(
      parseTranslationError(new Error('boom')).retryable
    );
  });

  it('retryWithBackoff returns the first successful result', async () => {
    let calls = 0;
    const value = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 2) {
          throw Object.assign(new Error('temporary'), { status: 429 });
        }
        return 'ok';
      },
      3,
      1
    );
    expect(value).toBe('ok');
    expect(calls).toBe(2);
  });

  it('retryWithBackoff throws the FriendlyError once retries are exhausted', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw Object.assign(new Error('down'), { status: 503 });
        },
        2,
        1
      )
    ).rejects.toMatchObject({ code: TranslationErrorCode.NETWORK_ERROR });
    expect(calls).toBe(2);
  });

  it('retryWithBackoff does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw Object.assign(new Error('unauthorized'), { status: 401 });
        },
        3,
        1
      )
    ).rejects.toMatchObject({ code: TranslationErrorCode.AUTH_ERROR });
    expect(calls).toBe(1);
  });
});

describe('parseTranslationError keyword coverage', () => {
  const cases: Array<[string, TranslationErrorCode]> = [
    ['api key missing', TranslationErrorCode.CONFIG_MISSING],
    ['密钥未配置', TranslationErrorCode.CONFIG_MISSING],
    ['invalid sk- key format', TranslationErrorCode.INVALID_API_KEY_FORMAT],
    ['sk- key format invalid', TranslationErrorCode.INVALID_API_KEY_FORMAT],
    ['ECONNREFUSED 127.0.0.1', TranslationErrorCode.CONNECTION_REFUSED],
    ['unauthorized access', TranslationErrorCode.AUTH_ERROR],
    ['invalid key provided', TranslationErrorCode.AUTH_ERROR],
    ['network hiccup', TranslationErrorCode.NETWORK_ERROR],
    ['Failed to fetch', TranslationErrorCode.NETWORK_ERROR],
    [
      'connection refused by ollama host',
      TranslationErrorCode.CONNECTION_REFUSED,
    ],
    ['连接 localhost 失败', TranslationErrorCode.OLLAMA_NOT_RUNNING],
    ['model not found on server', TranslationErrorCode.MODEL_NOT_FOUND],
    ['model does not exist here', TranslationErrorCode.MODEL_NOT_FOUND],
    ['rate limited', TranslationErrorCode.RATE_LIMIT],
    ['too many requests', TranslationErrorCode.RATE_LIMIT],
    ['max_tokens limit', TranslationErrorCode.PARAM_ERROR],
    ['发生未知错误', TranslationErrorCode.UNKNOWN_ERROR],
  ];

  it.each(cases)('maps %s', (message, code) => {
    expect(parseTranslationError(new Error(message)).code).toBe(code);
  });

  it('returns the original FriendlyError untouched', () => {
    const friendly = parseTranslationError(new Error('rate limited'));
    expect(parseTranslationError(friendly)).toBe(friendly);
  });

  it('extracts status codes from nested response objects', () => {
    const error = Object.assign(new Error('server exploded'), {
      response: { status: 502 },
    });
    expect(parseTranslationError(error).code).toBe(
      TranslationErrorCode.NETWORK_ERROR
    );
    const authError = Object.assign(new Error('nope'), { statusCode: 401 });
    expect(parseTranslationError(authError).code).toBe(
      TranslationErrorCode.AUTH_ERROR
    );
    const forbidden = Object.assign(new Error('forbidden'), { status: 403 });
    expect(parseTranslationError(forbidden).code).toBe(
      TranslationErrorCode.AUTH_ERROR
    );
    const missing = Object.assign(new Error('missing model'), { status: 404 });
    expect(parseTranslationError(missing).code).toBe(
      TranslationErrorCode.MODEL_NOT_FOUND
    );
    const blocked = Object.assign(new Error('blocked'), { status: 422 });
    expect(parseTranslationError(blocked).code).toBe(
      TranslationErrorCode.CONTENT_BLOCKED
    );
  });

  it('stringifies non-error values instead of crashing', () => {
    expect(parseTranslationError(42).code).toBe(
      TranslationErrorCode.UNKNOWN_ERROR
    );
    expect(parseTranslationError(null).code).toBe(
      TranslationErrorCode.UNKNOWN_ERROR
    );
  });
});
