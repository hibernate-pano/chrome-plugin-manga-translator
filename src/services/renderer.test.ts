import { describe, expect, it } from 'vitest';
import { calculateFontSize, OverlayRenderer } from './renderer';
import type { OverlayStyle } from './renderer';
import type { TextArea } from '@/providers/base';

describe('OverlayRenderer adaptive layout', () => {
  describe('calculateFontSize', () => {
    const baseStyle: OverlayStyle = {
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      textColor: '#ffffff',
      fontFamily: 'sans-serif',
      borderRadius: 4,
      verticalText: false,
      padding: 4,
      minFontSize: 10,
      maxFontSize: 22,
    };

    it('returns the max font size for a short text in a large box', () => {
      expect(calculateFontSize(400, 200, 'OK', baseStyle)).toBe(22);
    });

    it('shrinks to the min font size for dense CJK text in a small box', () => {
      const text = '这是一个非常长的中文句子需要缩小字号才能放得下';
      expect(calculateFontSize(60, 30, text, baseStyle)).toBe(10);
    });

    it('treats CJK characters as twice the width of ASCII', () => {
      const asciiSize = calculateFontSize(120, 400, 'abcdefghijkl', baseStyle);
      const cjkSize = calculateFontSize(
        120,
        400,
        '中中中中中中中中中中中中',
        baseStyle
      );
      expect(cjkSize).toBeLessThan(asciiSize);
    });

    it('clamps to bounds instead of producing zero or huge sizes', () => {
      const tiny = calculateFontSize(1, 1, 'a', baseStyle);
      expect(tiny).toBeGreaterThanOrEqual(baseStyle.minFontSize);
      const huge = calculateFontSize(2000, 1000, 'a', baseStyle);
      expect(huge).toBeLessThanOrEqual(baseStyle.maxFontSize);
    });
  });

  it('shrinks overlay box to fit shorter translated text', () => {
    document.body.innerHTML = `
      <div id="root">
        <img id="manga-image" src="/page.jpg" style="width: 720px; height: 1000px;" />
      </div>
    `;

    const img = document.getElementById('manga-image') as HTMLImageElement;
    Object.defineProperty(img, 'offsetWidth', {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(img, 'offsetHeight', {
      configurable: true,
      value: 1000,
    });

    const renderer = new OverlayRenderer();
    const textAreas: TextArea[] = [
      {
        x: 0.1,
        y: 0.1,
        width: 0.5,
        height: 0.2,
        originalText: 'LONG ORIGINAL BUBBLE',
        translatedText: '你好',
      },
    ];

    renderer.render(img, textAreas, true);

    const overlay = document.querySelector(
      '.manga-translator-overlay'
    ) as HTMLElement;
    expect(parseFloat(overlay.style.width)).toBeLessThan(360);
    expect(parseFloat(overlay.style.height)).toBeLessThan(200);
    expect(overlay.style.whiteSpace).toBe('pre-wrap');
  });
});
