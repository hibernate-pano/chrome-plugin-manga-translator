import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateTextWidth,
  fitTextToBox,
  OverlayRenderer,
  planVerticalText,
  resolveOverlayCollisions,
  wrapTextLikeBrowser,
  type TextMeasurer,
  type VerticalColumn,
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

/**
 * The controls that sit on every translated image.
 *
 * They used to be reachable with the mouse only: the strip was `opacity: 0`
 * until the pointer hovered the image, so a keyboard user tabbed onto an
 * invisible button (the opacity-0 ancestor hides the focus ring too) and a
 * touch user had no way to reach them at all — the only way to remove one
 * translation was to clear the whole page.
 */
describe('OverlayRenderer image controls', () => {
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

  function controls(): HTMLElement {
    const found = document.querySelector('.manga-translator-controls');
    if (!found) {
      throw new Error('找不到控制条');
    }
    return found as HTMLElement;
  }

  it('gives every button a name a screen reader can read', () => {
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    const buttons = Array.from(
      controls().querySelectorAll('button')
    ) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const name = button.getAttribute('aria-label');
      expect(name, `按钮 ${button.textContent} 没有可读的名字`).toBeTruthy();
      expect(name?.trim().length ?? 0).toBeGreaterThan(1);
    }
  });

  it('shows the pin glyph for the state it is in', () => {
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    const pin = controls().querySelector('button') as HTMLButtonElement;
    // Rendered pinned (the click-to-translate path auto-pins), so the glyph
    // has to be the pin, not the eye.
    expect(pin.textContent).toBe('📌');
    expect(pin.getAttribute('aria-label')).toContain('取消固定');

    pin.click();
    expect(pin.textContent).toBe('👁');
    expect(pin.getAttribute('aria-label')).toContain('固定');
  });

  it('reveals the controls for the keyboard and for touch', () => {
    const img = mountImage();
    const renderer = createRenderer({}, { measure: measureByEstimate });
    renderer.render(img, textAreas, true);

    const styles = Array.from(document.querySelectorAll('style'))
      .map(style => style.textContent ?? '')
      .join('\n');

    // A keyboard user has to be able to see the control they tabbed onto.
    expect(styles).toContain(':focus-within');
    // A touch device has no hover at all.
    expect(styles).toContain('@media (pointer: coarse)');
    // The overlay animates inside somebody else's page; the user who asked
    // their system for less motion still got it here.
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

/**
 * 折行：页面交给浏览器，导出得自己算一遍。
 *
 * 这两个函数是导出的 PNG 和屏幕之间那层"看起来一样"的地基。页面用
 * `white-space: pre-wrap; word-break: break-word`（横排）和
 * `writing-mode: vertical-rl`（竖排），浏览器不会把一个拉丁词从中间劈开，
 * 也不会让句号跑到行首。导出到画布上没有浏览器可用，就得按同一套规则
 * 重新算一次。
 */
describe('browser-like line breaking', () => {
  const style: OverlayStyle = {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    textColor: '#ffffff',
    fontFamily: 'sans-serif',
    borderRadius: 6,
    padding: 7,
    minFontSize: 10,
    maxFontSize: 22,
    verticalText: false,
  };

  // 一个字 10px 宽。
  const measure: TextMeasurer = (text, fontSize) =>
    Array.from(text).length * fontSize;

  describe('wrapTextLikeBrowser', () => {
    it('keeps a latin word in one piece', () => {
      const lines = wrapTextLikeBrowser(
        'the quick brown fox jumps',
        100,
        10,
        style,
        measure
      );

      // 每行 10 个字符宽。"the quick" 正好 9 个字符，"quick brown" 是 11 个，
      // 装不下 100px，所以断在词与词之间，而不是把 "quick" 劈成两半。
      expect(lines).toEqual(['the quick', 'brown fox', 'jumps']);
    });

    it('breaks between chinese characters', () => {
      const lines = wrapTextLikeBrowser(
        '你好世界今天天气',
        40,
        10,
        style,
        measure
      );

      // 四个字一行（每个字 10px）。
      expect(lines).toEqual(['你好世界', '今天天气']);
    });

    it('never starts a line with a closing punctuation mark', () => {
      const lines = wrapTextLikeBrowser(
        '他说。好久不见。',
        40,
        10,
        style,
        measure
      );

      for (const line of lines) {
        expect(line.startsWith('。')).toBe(false);
        expect(line.startsWith('，')).toBe(false);
      }
    });

    it('keeps the blank line of a paragraph break', () => {
      const lines = wrapTextLikeBrowser(
        '第一段\n\n第二段',
        400,
        10,
        style,
        measure
      );

      expect(lines).toEqual(['第一段', '', '第二段']);
    });

    it('splits a word that is wider than the whole line', () => {
      // `word-break: break-word` 的做法：这个词自己就比一行还宽，只能拆。
      const lines = wrapTextLikeBrowser('unbelievable', 40, 10, style, measure);

      expect(lines).toEqual(['unbe', 'liev', 'able']);
    });
  });

  describe('planVerticalText', () => {
    /** 一列列的文字。 */
    function columnTexts(columns: VerticalColumn[]): string[] {
      return columns.map(column =>
        column.blocks.map(block => block.text).join('')
      );
    }

    it('keeps a latin word in one column', () => {
      const columns = planVerticalText(
        'the quick brown fox',
        60,
        10,
        style,
        measure
      );

      // 每一列能放 60px；一个拉丁词斜着排，占的是它横着排出来的宽度
      // （"the" 30px，"quick" 50px），所以断在词与词之间。
      expect(columnTexts(columns)).toEqual(['the', 'quick', 'brown', 'fox']);
    });

    it('breaks between chinese characters', () => {
      const columns = planVerticalText(
        '你好世界今天天气',
        30,
        10,
        style,
        measure
      );

      // 一列 30px = 三个字高。
      expect(columnTexts(columns)).toEqual(['你好世', '界今天', '天气']);
    });

    it('says which runs stand upright and which are rotated', () => {
      const columns = planVerticalText('你好 ok', 100, 10, style, measure);

      // 中日韩字直立着写，拉丁文整个转 90° —— 浏览器在竖排里就是这么排的，
      // 导出必须做同一件事，否则同一个词在两处长得不一样。
      const blocks = columns[0]?.blocks ?? [];
      expect(blocks.map(block => [block.text, block.upright])).toEqual([
        ['你', true],
        ['好', true],
        [' ', true],
        ['ok', false],
      ]);
    });

    it('gives a latin run the width it would have on one line', () => {
      const columns = planVerticalText('ok', 100, 10, style, measure);

      // "ok" 横着排 20px，斜着排也占 20px。画的时候必须按这个数往下走，
      // 否则一个词会被撑成好几个字高，把列顶出气泡。
      expect(columns[0]?.blocks[0]?.advance).toBe(20);
    });
  });
});

/**
 * 气泡避让。
 *
 * 页面上两个挨得很近的气泡会互相盖住读者要读的字，所以要推开。导出的
 * PNG 必须做同一件事 —— 屏幕上分开的两个气泡，在画布上叠在一起，就是
 * "保存我看到的译文"这句话不成立。
 */
describe('resolveOverlayCollisions', () => {
  it('pushes two bubbles that sit on the same spot apart', () => {
    const rects = [
      { left: 100, top: 100, width: 120, height: 40 },
      { left: 100, top: 100, width: 120, height: 40 },
    ];

    const resolved = resolveOverlayCollisions(rects, 800, 600);

    // 中心一模一样的时候，两个气泡不能朝同一个方向让 —— 那样挪完它们
    // 还叠在一起，避让等于没做。
    const a = resolved[0];
    const b = resolved[1];
    if (!a || !b) {
      throw new Error('expected two bubbles');
    }
    const overlap =
      a.left < b.left + b.width &&
      a.left + a.width > b.left &&
      a.top < b.top + b.height &&
      a.top + a.height > b.top;
    expect(overlap).toBe(false);
  });

  it('keeps the bubbles inside the image', () => {
    const resolved = resolveOverlayCollisions(
      [
        { left: 660, top: 540, width: 120, height: 40 },
        { left: 660, top: 540, width: 120, height: 40 },
      ],
      800,
      600
    );

    for (const rect of resolved) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.left + rect.width).toBeLessThanOrEqual(800);
      expect(rect.top + rect.height).toBeLessThanOrEqual(600);
    }
  });

  it('leaves bubbles that are already apart where they are', () => {
    const rects = [
      { left: 10, top: 10, width: 100, height: 30 },
      { left: 200, top: 300, width: 100, height: 30 },
    ];

    expect(resolveOverlayCollisions(rects, 800, 600)).toEqual(rects);
  });
});
