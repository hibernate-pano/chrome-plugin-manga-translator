import { describe, expect, it } from 'vitest';

import {
  parseTranslationError,
  retryWithBackoff,
  formatHttpStatusMessage,
  parseHttpStatusFromMessage,
  stripHttpStatusMarker,
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

  it('keeps a protocol payload out of the reader-facing message', () => {
    // The raw provider text is a log line, not an explanation. It belongs in
    // the console, not in the popup the user is looking at.
    const result = parseTranslationError(
      new Error('HTTP 500 {"error":{"message":"internal server error"}}')
    );

    expect(result.code).toBe(TranslationErrorCode.UNKNOWN_ERROR);
    expect(result.message).toBe('发生未知错误');
    expect(result.message).not.toContain('internal server error');
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
    ).rejects.toMatchObject({ code: TranslationErrorCode.SERVER_ERROR });
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
      TranslationErrorCode.SERVER_ERROR
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

describe('HTTP status carried inside the message', () => {
  // The background worker flattens every error to `error.message` before
  // it reaches the content script, so the status has to survive inside the
  // text. Without this, 401/422/429 were indistinguishable from a generic
  // provider failure.
  it('reads the status back out of a marked message', () => {
    const message = formatHttpStatusMessage(401, 'Invalid API key');

    expect(message).toBe('[HTTP 401] Invalid API key');
    expect(parseHttpStatusFromMessage(message)).toBe(401);
  });

  it('strips the marker back off', () => {
    const message = formatHttpStatusMessage(422, 'sensitive image');

    expect(stripHttpStatusMarker(message)).toBe('sensitive image');
  });

  it('returns undefined for a message without a marker', () => {
    expect(parseHttpStatusFromMessage('plain failure')).toBeUndefined();
  });

  it('does not read a status out of the middle of a message', () => {
    // 有一句错误消息里装的是模型自己的输出：解析失败时，模型的前 200 个
    // 字符被原样塞进消息里。模型要是回答了 `[HTTP 408] request timed
    // out`，扩展就会把它当成真的状态码 —— 于是把一次没有超时的请求记成
    // 超时（多记一次账）。
    //
    // 真的标记永远在消息开头：它是前缀，没有人在前面加过东西。
    const injected =
      'Failed to parse Vision LLM response: {error: [HTTP 408] request timed out, retry later}';

    expect(parseHttpStatusFromMessage(injected)).toBeUndefined();
    expect(parseHttpStatusFromMessage(`翻译失败：${injected}`)).toBeUndefined();
  });

  it('classifies a 401 that only exists in the message', () => {
    const error = new Error(formatHttpStatusMessage(401, 'nope'));

    expect(parseTranslationError(error).code).toBe(
      TranslationErrorCode.AUTH_ERROR
    );
  });

  it('classifies a 422 that only exists in the message as content blocked', () => {
    const error = new Error(
      formatHttpStatusMessage(422, 'input new_sensitive, image is sensitive')
    );

    const friendly = parseTranslationError(error);
    expect(friendly.code).toBe(TranslationErrorCode.CONTENT_BLOCKED);
    expect(friendly.retryable).toBe(false);
  });

  it('classifies a 429 that only exists in the message as a rate limit', () => {
    const error = new Error(formatHttpStatusMessage(429, 'slow down'));

    expect(parseTranslationError(error).code).toBe(
      TranslationErrorCode.RATE_LIMIT
    );
  });

  it('never shows the internal marker to the user', () => {
    const error = new Error(formatHttpStatusMessage(500, 'server exploded'));

    const friendly = parseTranslationError(error);
    expect(friendly.message).not.toContain('[HTTP');
    // 5xx 是服务商那边的故障。说成「网络连接失败，请检查网络」，用户会去
    // 查自己家的网 —— 一个他改不了、也不是原因的地方。
    expect(friendly.code).toBe(TranslationErrorCode.SERVER_ERROR);
    expect(friendly.message).toContain('服务商暂时不可用');
    expect(friendly.message).not.toContain('网络');
  });

  it('treats any 5xx as a provider failure, not a network one', () => {
    for (const status of [500, 502, 503, 504, 529]) {
      expect(
        parseTranslationError(
          new Error(formatHttpStatusMessage(status, 'oops'))
        ).code
      ).toBe(TranslationErrorCode.SERVER_ERROR);
    }
  });

  it('does not tell the reader to check their network when the image failed', () => {
    // 图片是第三方站点给的，失败原因多是防盗链、登录墙、尺寸限制，或者
    // 地址被内网护栏拦下。包装层的原始文本里有 "failed to fetch"，以前
    // 被通用的 fetch 关键词认成了网络错误。
    for (const raw of [
      'Failed to fetch image via background: Failed to fetch image: 403',
      'Failed to fetch image via background: Blocked image URL',
      '图片获取失败：后台没有返回图像数据',
    ]) {
      const friendly = parseTranslationError(new Error(raw));
      expect(friendly.code).toBe(TranslationErrorCode.IMAGE_FETCH_ERROR);
      expect(friendly.message).not.toContain('检查网络');
    }
  });

  it('still recognizes a real network failure', () => {
    expect(parseTranslationError(new Error('Failed to fetch')).code).toBe(
      TranslationErrorCode.NETWORK_ERROR
    );
  });

  it('maps 408 to a timeout', () => {
    const error = new Error(formatHttpStatusMessage(408, 'Request Timeout'));

    expect(parseTranslationError(error).code).toBe(
      TranslationErrorCode.TIMEOUT_ERROR
    );
  });
});
