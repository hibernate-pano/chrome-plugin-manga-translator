import { describe, expect, it } from 'vitest';

import {
  parseTranslationError,
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
    const result = parseTranslationError(new Error('章节图片未在预期时间内出现'));

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
