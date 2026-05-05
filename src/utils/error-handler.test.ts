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
});
