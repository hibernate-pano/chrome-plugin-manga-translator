import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateTextWidth,
  fitTextToBox,
  OverlayRenderer,
  type TextMeasurer,
} from './renderer';
import type { OverlayStyle } from './renderer';
import type { TextArea } from '@/providers/base';

/**
 * Measure the way the production code does when there is no canvas: a
 * full-width character is one em, an ASCII character about half an em.
 *
 * The canvas in the test environment is a stub that reports the same width
 * for every string, so the layout has to be measured against something
 * realistic — otherwise the tests only prove that the layout follows the
 * stub.
 */
const measureByEstimate: TextMeasurer = (text, fontSize) =>
  estimateTextWidth(text, fontSize);

/**
 * Every renderer this file creates is disposed here, whether the test that
 * created it passed or failed.
 *
 * The Alt-key listener behind the "hold Alt to see the original"
 * gesture is shared between renderers, and the count behind it is a count of
 * live renderers. A renderer that is never disposed holds that count up, and
 * every later test then sees a renderer that cannot release the listener —
 * so one failing assertion used to turn into three unrelated failures
 * further down the file.
 */
const liveRenderers = new Set<OverlayRenderer>();

function createRenderer(
  ...args: ConstructorParameters<typeof OverlayRenderer>
): OverlayRenderer {
  const renderer = new OverlayRenderer(...args);
  liveRenderers.add(renderer);
  return renderer;
}

afterEach(() => {
  for (const renderer of liveRenderers) {
    renderer.dispose();
  }
  liveRenderers.clear();
});

describe('OverlayRenderer adaptive layout', () => {
  describe('fitTextToBox', () => {
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
      expect(
        fitTextToBox('OK', 400, 200, baseStyle, 'horizontal', measureByEstimate)
          .fontSize
      ).toBe(22);
    });

    it('shrinks to the min font size for dense CJK text in a small box', () => {
      const text = '这是一个非常长的中文句子需要缩小字号才能放得下';
      const fit = fitTextToBox(
        text,
        60,
        30,
        baseStyle,
        'horizontal',
        measureByEstimate
      );
      expect(fit.fontSize).toBe(10);
      // The text does not fit even at the smallest size, and the overlay has
      // to admit it rather than quietly dropping the rest of the sentence.
      expect(fit.clipped).toBe(true);
    });

    it('uses the biggest font that fits instead of the smallest', () => {
      // The old layout asked how big the font could be for the whole text
      // to fit on ONE line. For anything longer than a line that answer
      // collapses onto the minimum size, so every bubble was drawn at 10px
      // however much room it actually had.
      const text = '这是一个很长的中文句子需要缩小字号才能放得下';
      const fit = fitTextToBox(
        text,
        400,
        200,
        baseStyle,
        'horizontal',
        measureByEstimate
      );
      expect(fit.fontSize).toBeGreaterThan(baseStyle.minFontSize);
      expect(fit.clipped).toBe(false);
    });

    it('treats CJK characters as twice the width of ASCII', () => {
      // The weighting is what decides how many characters fit on a line.
      const cjk = fitTextToBox(
        '中中中中中中中中中中中中',
        120,
        400,
        baseStyle,
        'horizontal',
        measureByEstimate
      );
      const ascii = fitTextToBox(
        'abcdefghijkl',
        120,
        400,
        baseStyle,
        'horizontal',
        measureByEstimate
      );
      expect(cjk.lines.length).toBeGreaterThan(ascii.lines.length);
    });

    it('clamps to bounds instead of producing zero or huge sizes', () => {
      const tiny = fitTextToBox(
        'a',
        1,
        1,
        baseStyle,
        'horizontal',
        measureByEstimate
      );
      expect(tiny.fontSize).toBeGreaterThanOrEqual(baseStyle.minFontSize);
      const huge = fitTextToBox(
        'a',
        2000,
        1000,
        baseStyle,
        'horizontal',
        measureByEstimate
      );
      expect(huge.fontSize).toBeLessThanOrEqual(baseStyle.maxFontSize);
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

    const renderer = createRenderer({}, { measure: measureByEstimate });
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
    // The box is sized to the original it covers, plus the padding
    // around it — so it no longer shrinks to the two characters of the
    // translation, because then the original would stay visible
    // next to it. The original is 0.5 of a 720px image, so the
    // box is a little wider than 360px.
    expect(parseFloat(overlay.style.width)).toBeGreaterThanOrEqual(360);
    expect(parseFloat(overlay.style.width)).toBeLessThan(720);
    expect(parseFloat(overlay.style.height)).toBeGreaterThanOrEqual(200);
    expect(overlay.style.whiteSpace).toBe('pre-wrap');
    renderer.dispose();
  });

  it('covers the original even when the translation is shorter', () => {
    // The overlay used to be sized to the translation alone. A translation
    // shorter than the original left the rest of the bubble
    // uncovered, so the reader saw the original beside the
    // translation — and where the two did overlap, the original
    // ghosted through the panel's 6% transparency.
    //
    // The store listing promises the bubble is covered. This is the test that
    // keeps that promise honest.
    document.body.innerHTML = `
      <div id="root">
        <img id="manga-image" src="/page.jpg" style="width: 1000px; height: 620px;" />
      </div>
    `;
    const img = document.getElementById('manga-image') as HTMLImageElement;
    Object.defineProperty(img, 'offsetWidth', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(img, 'offsetHeight', {
      configurable: true,
      value: 620,
    });

    const renderer = createRenderer({}, { measure: measureByEstimate });
    // The original occupies 355px of a 1000px image; the
    // translation is two characters wide.
    renderer.render(
      img,
      [
        {
          x: 0.108,
          y: 0.141,
          width: 0.355,
          height: 0.138,
          originalText: 'また明日ね！\n今日はいい修行だった。',
          translatedText: '明天再见！',
        },
      ],
      true
    );

    const overlay = document.querySelector(
      '.manga-translator-overlay'
    ) as HTMLElement;
    const width = parseFloat(overlay.style.width);
    const height = parseFloat(overlay.style.height);

    // Wide enough to cover the original box it stands in for.
    expect(width).toBeGreaterThanOrEqual(355);
    expect(height).toBeGreaterThanOrEqual(0.138 * 620);
    // And still inside the image.
    expect(parseFloat(overlay.style.left) + width).toBeLessThanOrEqual(1000);
    expect(parseFloat(overlay.style.top) + height).toBeLessThanOrEqual(620);
    renderer.dispose();
  });

  it('leaves the bubble alone when the translation is empty', () => {
    // An empty translation is not a translation. Covering the speech bubble
    // with an empty box hides the artwork and the original text for nothing.
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

    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(
      img,
      [
        {
          x: 0.1,
          y: 0.1,
          width: 0.5,
          height: 0.2,
          originalText: 'おはよう',
          translatedText: '   ',
        },
      ],
      true
    );

    expect(document.querySelector('.manga-translator-overlay')).toBeNull();
    renderer.dispose();
  });

  it('says so when the text did not fit the bubble', () => {
    // A silently truncated translation reads like a complete one.
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

    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(
      img,
      [
        {
          x: 0.1,
          y: 0.1,
          width: 0.02,
          height: 0.02,
          originalText: 'おはよう',
          translatedText:
            '这是一段非常非常长的翻译文字它永远放不进这个狭小的气泡里',
        },
      ],
      true
    );

    const overlay = document.querySelector(
      '.manga-translator-overlay'
    ) as HTMLElement;
    expect(overlay.classList.contains('manga-translator-overlay-clipped')).toBe(
      true
    );
    renderer.dispose();
  });

  it('re-lays out the translations already on the page when the style changes', () => {
    // The font size is part of the layout, so a change to it has to reach
    // the translations the user is already looking at. Without this the
    // setting only applied to the images translated afterwards, and the
    // user concluded the setting was broken.
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

    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(
      img,
      [
        {
          x: 0.1,
          y: 0.1,
          width: 0.5,
          height: 0.2,
          originalText: 'おはよう',
          translatedText: '早上好，今天天气不错呢',
        },
      ],
      true
    );

    const overlay = document.querySelector(
      '.manga-translator-overlay'
    ) as HTMLElement;
    const before = parseFloat(overlay.style.fontSize);

    renderer.updateStyle({ minFontSize: 10, maxFontSize: 12 });

    expect(parseFloat(overlay.style.fontSize)).toBeLessThan(before);
    renderer.dispose();
  });
});

describe('OverlayRenderer original-text layer', () => {
  const textAreas: TextArea[] = [
    {
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.2,
      originalText: 'おはよう',
      translatedText: '早上好',
    },
  ];

  function mountImage(): HTMLImageElement {
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
    return img;
  }

  it('keeps both the translation and the original in the overlay', () => {
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    const overlay = document.querySelector(
      '.manga-translator-overlay'
    ) as HTMLElement;
    const translated = overlay.querySelector(
      '.manga-translator-text-translated'
    ) as HTMLElement;
    const original = overlay.querySelector(
      '.manga-translator-text-original'
    ) as HTMLElement;

    expect(translated.textContent).toBe('早上好');
    // The source was already captured by the model — it was just parked in a
    // data attribute nobody could read.
    expect(original.textContent).toBe('おはよう');
    renderer.dispose();
  });

  it('reveals the original while Alt is held and restores the translation after', () => {
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(false);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Alt', altKey: true })
    );
    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(false);

    renderer.dispose();
  });

  it('drops the class when the window loses focus mid-gesture', () => {
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Alt', altKey: true })
    );
    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(true);

    // Alt-tabbing away while holding Alt would otherwise leave the page
    // stuck showing the source text.
    window.dispatchEvent(new Event('blur'));
    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(false);

    renderer.dispose();
  });

  it('cleans the class up when the renderer is disposed', () => {
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Alt', altKey: true })
    );
    renderer.dispose();

    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(false);
  });

  it('survives being disposed twice', () => {
    // The Alt-key listener is shared, and the count behind it is a count of
    // live renderers. A second `dispose()` used to release the shared
    // listener a second time, which took the count below the number of
    // renderers still alive — and the next renderer to be disposed left the
    // `show-original` class stuck on `<body>`, so the page
    // showed the original text with no way to get the translation back.
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Alt', altKey: true })
    );
    renderer.dispose();
    renderer.dispose();

    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(false);

    // A renderer created afterwards still gets the gesture back.
    const next = createRenderer({}, { measure: measureByEstimate });
    next.render(img, textAreas, true);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Alt', altKey: true })
    );
    expect(
      document.body.classList.contains('manga-translator-show-original')
    ).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    next.dispose();
  });
});

describe('OverlayRenderer persisted style', () => {
  const STORAGE_KEY = 'manga-translator-config-v2';

  function persistStyle(overlayStyle: Record<string, unknown>): Promise<void> {
    return chrome.storage.local.set({
      [STORAGE_KEY]: { state: { overlayStyle } },
    });
  }

  it('adopts the style the user configured, without waiting for a storage event', async () => {
    // A freshly opened page never sees the `chrome.storage.onChanged` event
    // that carried the setting, so the style used to be lost on every page
    // the user opened after changing it.
    await persistStyle({
      backgroundColor: 'rgba(10, 20, 30, 0.8)',
      textColor: '#ffee00',
      minFontSize: 12,
      maxFontSize: 30,
      verticalText: true,
    });

    const renderer = createRenderer({}, { measure: measureByEstimate });
    await vi.waitFor(() => {
      expect(renderer.getStyle().textColor).toBe('#ffee00');
    });

    expect(renderer.getStyle().backgroundColor).toBe('rgba(10, 20, 30, 0.8)');
    expect(renderer.getStyle().minFontSize).toBe(12);
    expect(renderer.getStyle().maxFontSize).toBe(30);
    expect(renderer.getStyle().verticalText).toBe(true);

    renderer.dispose();
  });

  it('keeps the default style when nothing was configured', async () => {
    const renderer = createRenderer({}, { measure: measureByEstimate });
    await vi.waitFor(() => {
      expect(renderer.getStyle().textColor).toBe('#111111');
    });
    renderer.dispose();
  });

  it('lets an explicit style win over a late persisted one', async () => {
    await persistStyle({
      backgroundColor: 'rgba(10, 20, 30, 0.8)',
      textColor: '#ffee00',
      minFontSize: 12,
      maxFontSize: 30,
      verticalText: false,
    });

    const renderer = createRenderer({}, { measure: measureByEstimate });
    // A storage event arrives with a newer value while the persisted one is
    // still in flight. The newer value has to survive.
    renderer.updateStyleFromConfig({
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      textColor: '#00ff00',
      minFontSize: 10,
      maxFontSize: 20,
      verticalText: false,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(renderer.getStyle().textColor).toBe('#00ff00');
    renderer.dispose();
  });
});

describe('OverlayRenderer vertical text', () => {
  // A vertical column of text: tall and narrow, the shape a vertical
  // Japanese text box actually has.
  const textAreas: TextArea[] = [
    {
      x: 0.1,
      y: 0.1,
      width: 0.12,
      height: 0.5,
      originalText: 'おはようございます',
      translatedText: '早上好，今天天气不错呢',
    },
  ];

  function mountImage(): HTMLImageElement {
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
    return img;
  }

  function renderWith(vertical: boolean): HTMLElement {
    const img = mountImage();
    const renderer = createRenderer(
      { verticalText: vertical },
      { measure: measureByEstimate }
    );
    renderer.render(img, textAreas, true);
    const overlay = document.querySelector(
      '.manga-translator-overlay'
    ) as HTMLElement;
    renderer.dispose();
    return overlay;
  }

  it('writes the overlay vertically when the setting is on', () => {
    const overlay = renderWith(true);

    expect(overlay.style.writingMode).toBe('vertical-rl');
    expect(
      overlay.classList.contains('manga-translator-overlay-vertical')
    ).toBe(true);
  });

  it('keeps horizontal writing when the setting is off', () => {
    const overlay = renderWith(false);

    expect(overlay.style.writingMode).toBe('horizontal-tb');
    expect(
      overlay.classList.contains('manga-translator-overlay-vertical')
    ).toBe(false);
  });

  it('stacks the text as columns instead of rows', () => {
    const horizontal = renderWith(false);
    const vertical = renderWith(true);

    // The same text, laid out along the other axis: the vertical box is
    // taller and narrower than the horizontal one.
    expect(parseFloat(vertical.style.height)).toBeGreaterThan(
      parseFloat(horizontal.style.height)
    );
    expect(parseFloat(vertical.style.width)).toBeLessThan(
      parseFloat(horizontal.style.width)
    );
  });

  it('keeps the overlay inside the image', () => {
    const vertical = renderWith(true);
    const width = parseFloat(vertical.style.width);
    const height = parseFloat(vertical.style.height);
    const left = parseFloat(vertical.style.left);
    const top = parseFloat(vertical.style.top);

    expect(left + width).toBeLessThanOrEqual(720);
    expect(top + height).toBeLessThanOrEqual(1000);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});
