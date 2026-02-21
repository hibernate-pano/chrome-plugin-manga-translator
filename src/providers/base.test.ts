/**
 * Base Provider Tests
 * 
 * Tests for the base provider utilities including:
 * - Response parsing (Property 5: API 响应解析)
 * - Prompt generation
 */

import { describe, it, expect } from 'vitest';
import { parseVisionResponse, getMangaTranslationPrompt } from './base';

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
          y: 1.5,
          width: 2.0,
          height: -0.5,
          originalText: 'test',
          translatedText: '测试',
        },
      ],
    });

    const result = parseVisionResponse(response);
    const firstArea = result.textAreas[0];
    
    expect(firstArea?.x).toBe(0);
    expect(firstArea?.y).toBe(1);
    expect(firstArea?.width).toBe(1);
    expect(firstArea?.height).toBe(0);
  });

  it('should filter out invalid text areas', () => {
    const response = JSON.stringify({
      textAreas: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.1, translatedText: '有效' },
        { x: 'invalid', y: 0.2, width: 0.3, height: 0.1, translatedText: '无效' },
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
});
