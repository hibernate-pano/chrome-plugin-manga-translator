/**
 * Base Provider Tests
 *
 * Tests for the base provider utilities including:
 * - Response parsing (Property 5: API 响应解析)
 * - Prompt generation
 */

import { describe, it, expect } from 'vitest';
import {
  parseVisionResponse,
  getMangaTranslationPrompt,
  createApiError,
  createApiErrorWithStatus,
} from './base';
import { parseTranslationError } from '@/utils/error-handler';

describe('parseVisionResponse', () => {
  it('should parse valid JSON response', () => {
    const response = JSON.stringify({
      textAreas: [
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
          originalText: '原文',
          translatedText: '翻译',
        },
      ],
    });

    const result = parseVisionResponse(response);

    expect(result.textAreas).toHaveLength(1);
    expect(result.textAreas[0]).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      originalText: '原文',
      translatedText: '翻译',
    });
  });

  it('should parse JSON wrapped in markdown code block', () => {
    const response = `\`\`\`json
{
  "textAreas": [
    {
      "x": 0.5,
      "y": 0.5,
      "width": 0.2,
      "height": 0.1,
      "originalText": "Hello",
      "translatedText": "你好"
    }
  ]
}
\`\`\``;

    const result = parseVisionResponse(response);

    expect(result.textAreas).toHaveLength(1);
    expect(result.textAreas[0]?.translatedText).toBe('你好');
  });

  it('should return empty array for response with no text areas', () => {
    const response = JSON.stringify({ textAreas: [] });
    const result = parseVisionResponse(response);

    expect(result.textAreas).toHaveLength(0);
  });

  it('should clamp coordinates to 0-1 range', () => {
    const response = JSON.stringify({
      textAreas: [
        {
          x: -0.1,
          y: 0.4,
          width: 2.0,
          height: 0.5,
          originalText: 'test',
          translatedText: '测试',
        },
      ],
    });

    const result = parseVisionResponse(response);
    const firstArea = result.textAreas[0];

    expect(firstArea?.x).toBe(0);
    expect(firstArea?.y).toBe(0.4);
    // 宽度被夹到 1，而 x=0，所以它仍然落在图里。
    expect(firstArea?.width).toBe(1);
    expect(firstArea?.height).toBe(0.5);
  });

  it('refuses an answer that has no textAreas field at all', () => {
    /*
     * 「这一页没有文字」在提示词里写的是 `{"textAreas":[]}`。字段整个不见
     * 了，只可能是模型没照格式来（大小写写错、换了字段名）。
     *
     * 以前这种回答被读成"一个文字区都没有"，然后作为"这一页确实没有文字"
     * 缓存下来：用户付了钱，看到一页没翻的漫画，而且永远不会再问第二次。
     * 抛错才是诚实的说法 —— 这一轮算失败，可以重试。
     */
    const response = JSON.stringify({
      textareas: [
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
          originalText: 'test',
          translatedText: '测试',
        },
      ],
    });

    expect(() => parseVisionResponse(response)).toThrow(/textAreas/);
  });

  it('does not draw a translation that came back without a box', () => {
    /*
     * 模型忘了给坐标时，那句译文以前会被画成左上角一列单字 —— 盖在画面
     * 上，而真正的气泡还留着原文。这种"画出来了"的假成功比"没画"更糟。
     */
    const response = JSON.stringify({
      textAreas: [
        { originalText: 'こんにちは', translatedText: '你好' },
        {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.1,
          originalText: 'test',
          translatedText: '测试',
        },
      ],
    });

    const result = parseVisionResponse(response);

    expect(result.textAreas).toHaveLength(1);
    expect(result.textAreas[0]?.translatedText).toBe('测试');
    // 放不下的那一个要记账：页面上少了一个气泡，用户得知道。
    expect(result.unplacedCount).toBe(1);
  });

  it('pulls a box that runs past the edge back into the picture', () => {
    // x=0.9、width=0.5 的框有四成在图外。以前渲染器会把面板往左挪，
    // 译文于是画在模型没有指的地方；缩小框至少让它留在模型说的位置。
    const response = JSON.stringify({
      textAreas: [
        {
          x: 0.9,
          y: 0.2,
          width: 0.5,
          height: 0.1,
          originalText: 'test',
          translatedText: '测试',
        },
      ],
    });

    const result = parseVisionResponse(response);

    expect(result.textAreas[0]?.x).toBe(0.9);
    expect(result.textAreas[0]?.width).toBeCloseTo(0.1);
  });

  it('should filter out invalid text areas', () => {
    const response = JSON.stringify({
      textAreas: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.1, translatedText: '有效' },
        {
          x: 'invalid',
          y: 0.2,
          width: 0.3,
          height: 0.1,
          translatedText: '无效',
        },
        { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, // missing translatedText
      ],
    });

    const result = parseVisionResponse(response);

    expect(result.textAreas).toHaveLength(1);
    expect(result.textAreas[0]?.translatedText).toBe('有效');
  });

  it('should throw error for completely invalid JSON', () => {
    expect(() => parseVisionResponse('not json at all')).toThrow();
  });

  it('should handle response with extra text around JSON', () => {
    const response = `Here is the translation result:
{
  "textAreas": [
    {
      "x": 0.1,
      "y": 0.2,
      "width": 0.3,
      "height": 0.1,
      "originalText": "test",
      "translatedText": "测试"
    }
  ]
}
Hope this helps!`;

    const result = parseVisionResponse(response);

    expect(result.textAreas).toHaveLength(1);
  });

  it('drops an area the model gave no box for, wherever it came from', () => {
    const response = JSON.stringify({
      textAreas: [
        {
          index: 1,
          originalText: 'Hello',
          translatedText: '你好',
        },
      ],
    });

    const result = parseVisionResponse(response);

    // 没有框就没有地方画。留着它，译文会以最小字号落在左上角，盖在画面上，
    // 而真正的气泡还留着原文 —— 一次"画出来了"的假成功。
    //
    // 编号救不了它：拼图条是一张真图，位置本来就有（提示词要的就是坐标），
    // 编号是模型自己编的，认它反而会把译文画到别的块上去。丢掉，并且记进
    // "没翻出来"的数字里，用户看得见。
    expect(result.textAreas).toHaveLength(0);
    expect(result.unplacedCount).toBe(1);
  });
});

describe('getMangaTranslationPrompt', () => {
  it('should include target language in prompt', () => {
    const prompt = getMangaTranslationPrompt('简体中文');

    expect(prompt).toContain('简体中文');
    expect(prompt).toContain('textAreas');
    expect(prompt).toContain('JSON');
  });

  it('should include coordinate instructions', () => {
    const prompt = getMangaTranslationPrompt('zh-CN');

    expect(prompt).toContain('0-1');
    expect(prompt).toContain('ratio');
  });

  it('describes the strip as a stack of separate blocks', () => {
    const prompt = getMangaTranslationPrompt('zh-CN', 'faithful', true);
    // The strip is a stack of unrelated crops, and the prompt has to say so:
    // the full-image prompt tells the model to merge a bubble's lines into
    // one item, and on a strip that merges two different bubbles.
    expect(prompt).toContain('SEPARATE cropped blocks');
    expect(prompt).toContain('horizontal rule');
    expect(prompt).toContain('NEVER merge text from two different blocks');
    // Coordinates are still relative to the whole strip, so the boxes can be
    // mapped back onto the crop they came from.
    expect(prompt).toContain('THIS WHOLE IMAGE');
    expect(prompt).toContain('0.0-1.0');
  });
});

describe('providerRequiresApiKey', () => {
  it('returns true for openai-compatible (cloud provider)', async () => {
    const { providerRequiresApiKey } = await import('./base');
    expect(providerRequiresApiKey('openai-compatible')).toBe(true);
  });

  it('returns false for ollama (local server, no key needed)', async () => {
    const { providerRequiresApiKey } = await import('./base');
    expect(providerRequiresApiKey('ollama')).toBe(false);
  });

  it('returns false for lm-studio (local server, no key needed)', async () => {
    const { providerRequiresApiKey } = await import('./base');
    expect(providerRequiresApiKey('lm-studio')).toBe(false);
  });
});

describe('P2 Korean + truncation guards', () => {
  it('includes Korean handling rules for webtoon source text', () => {
    const prompt = getMangaTranslationPrompt('zh-CN');
    expect(prompt).toContain('KOREAN');
    expect(prompt).toContain('반말');
    expect(prompt).toContain('-요');
  });

  it('includes anti-hallucination instruction (never invent text)', () => {
    const prompt = getMangaTranslationPrompt('zh-CN');
    expect(prompt).toContain('Do NOT invent text');
    expect(prompt).toContain('never hallucinate');
  });

  it('detects truncated JSON and throws a token-limit error', () => {
    // Unclosed JSON — model hit the token ceiling mid-output
    const truncated = '{"textAreas":[{"x":0.1,"y":0.2,';
    expect(() => parseVisionResponse(truncated)).toThrow(
      /token limit|cut off/i
    );
  });

  it('detects plain-text captioning and throws a format error', () => {
    const caption =
      'This image shows a young man walking in the rain at night. He looks sad.';
    expect(() => parseVisionResponse(caption)).toThrow(/plain text|format/i);
  });
});

describe('getTranslationStyleInstruction', () => {
  it('includes Korean honorific + webtoon slang handling in natural-zh', async () => {
    const { getTranslationStyleInstruction } =
      await import('@/utils/translation-style');
    const style = getTranslationStyleInstruction('natural-zh');
    expect(style).toContain('-요');
    expect(style).toContain('ㅋㅋ');
    expect(style).toContain('반말');
  });

  /**
   * The style instruction used to name Chinese in every preset, so a user
   * who picked English was told to write "polished natural Simplified
   * Chinese" in the same request that asked for English.
   */
  it('does not tell the model to write Chinese when English was asked for', async () => {
    const { getTranslationStyleInstruction } =
      await import('@/utils/translation-style');
    const style = getTranslationStyleInstruction('natural-zh', 'en');
    expect(style).toContain('English');
    expect(style).not.toContain('Simplified Chinese');
    expect(style).not.toContain('Traditional Chinese');
  });
});

describe('getMangaTranslationPrompt', () => {
  it('names the target language and never contradicts it', async () => {
    const { getMangaTranslationPrompt } = await import('@/providers/base');
    const prompt = getMangaTranslationPrompt('en', 'natural-zh');
    expect(prompt).toContain('translate to English');
    expect(prompt).not.toContain('Simplified Chinese');
  });

  it('still asks for Chinese when Chinese is the target', async () => {
    const { getMangaTranslationPrompt } = await import('@/providers/base');
    const prompt = getMangaTranslationPrompt('zh-CN', 'natural-zh');
    expect(prompt).toContain('Simplified Chinese');
  });
});

describe('createApiError (HTTP status propagation)', () => {
  it('carries the status on the error object', () => {
    const error = createApiError('Invalid API key', 'OpenAI-Compatible', 401);

    expect(error.status).toBe(401);
  });

  it('embeds the status in the message so it survives flattening to a string', () => {
    // The background worker turns every error into its message before it
    // reaches the content script, so a status that only lives on the object
    // is lost. The in-message marker is what keeps it.
    const error = createApiError('Invalid API key', 'OpenAI-Compatible', 401);

    expect(error.message).toContain('[HTTP 401]');
    expect(error.message).toContain('Invalid API key');
  });

  it('classifies 401 as an auth error', () => {
    const error = createApiError('Invalid API key', 'OpenAI-Compatible', 401);

    expect(parseTranslationError(error).code).toBe('AUTH_ERROR');
  });

  it('classifies 429 as a rate limit', () => {
    const error = createApiError('too many requests', 'OpenAI-Compatible', 429);

    expect(parseTranslationError(error).code).toBe('RATE_LIMIT');
  });

  it('classifies 422 as content blocked', () => {
    const error = createApiError(
      'unprocessable_entity',
      'OpenAI-Compatible',
      422
    );

    const friendly = parseTranslationError(error);
    expect(friendly.code).toBe('CONTENT_BLOCKED');
    expect(friendly.retryable).toBe(false);
  });

  it('leaves the message free of the marker for a status-less error', () => {
    const error = createApiError('boom', 'OpenAI-Compatible');

    expect(error.message).toBe('OpenAI-Compatible: boom');
    expect(error.status).toBeUndefined();
  });

  it('createApiErrorWithStatus behaves the same way', () => {
    const error = createApiErrorWithStatus('nope', 'OpenAI-Compatible', 401);

    expect(error.status).toBe(401);
    expect(parseTranslationError(error).code).toBe('AUTH_ERROR');
  });
});
