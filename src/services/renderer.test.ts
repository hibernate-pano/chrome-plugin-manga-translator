import { describe, expect, it } from 'vitest';
import { OverlayRenderer } from './renderer';
import type { TextArea } from '@/providers/base';

describe('OverlayRenderer adaptive layout', () => {
  it('shrinks overlay box to fit shorter translated text', () => {
    document.body.innerHTML = `
      <div id="root">
        <img id="manga-image" src="/page.jpg" style="width: 720px; height: 1000px;" />
      </div>
    `;

    const img = document.getElementById('manga-image') as HTMLImageElement;
    Object.defineProperty(img, 'offsetWidth', { configurable: true, value: 720 });
    Object.defineProperty(img, 'offsetHeight', { configurable: true, value: 1000 });

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

    const overlay = document.querySelector('.manga-translator-overlay') as HTMLElement;
    expect(parseFloat(overlay.style.width)).toBeLessThan(360);
    expect(parseFloat(overlay.style.height)).toBeLessThan(200);
    expect(overlay.style.whiteSpace).toBe('pre-wrap');
  });
});
