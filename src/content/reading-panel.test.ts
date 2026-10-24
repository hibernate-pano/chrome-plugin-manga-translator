import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ReadingPanel, scrollBehavior } from './reading-panel';
import type { TextArea } from '@/providers/base';
import {
  WHITE_PAGE,
  cssBlock,
  cssDeclaration,
  surfaceColor,
  textContrast,
} from '@/test/contrast';
import type { Rgb } from '@/test/contrast';

function makeImage(width = 200, height = 100): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(img, 'naturalWidth', { value: width });
  Object.defineProperty(img, 'naturalHeight', { value: height });
  document.body.appendChild(img);
  return img;
}

function makeAreas(texts: string[]): TextArea[] {
  return texts.map((text, i) => ({
    originalText: `原文 ${i + 1}`,
    translatedText: text,
    x: 0,
    y: i * 10,
    width: 100,
    height: 10,
  }));
}

describe('ReadingPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom doesn't implement scrollIntoView; stub it so focusEntryByIndex
    // doesn't throw when we exercise the entry-scroll path.
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = function () {
        /* noop */
      };
    }
  });

  it('renders empty state initially', () => {
    const panel = new ReadingPanel();
    expect(panel.getEntryCount()).toBe(0);
    panel.destroy();
  });

  it('upsert adds a numbered entry', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好世界']));
    expect(panel.getEntryCount()).toBe(1);

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entry = shadow.querySelector('.entry');
    expect(entry).toBeTruthy();
    expect(entry?.getAttribute('data-index')).toBe('1');
    panel.destroy();
  });

  it('reindex numbers entries by their position in the document', () => {
    // The images are appended to the body in this order: first, second,
    // third. The panel receives them in the opposite order, which is what a
    // concurrent, viewport-first translation does.
    const first = makeImage();
    const second = makeImage();
    const third = makeImage();

    const panel = new ReadingPanel();
    panel.upsert(third, makeAreas(['C']));
    panel.upsert(first, makeAreas(['A']));
    panel.upsert(second, makeAreas(['B']));

    panel.reindex();

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entries = Array.from(shadow.querySelectorAll('.entry'));
    expect(entries.map(e => e.getAttribute('data-index'))).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(
      entries.map(e => e.querySelector('.entry-preview')?.textContent)
    ).toEqual(['A', 'B', 'C']);
    panel.destroy();
  });

  it('reindex reorders the list items, not just their numbers', () => {
    const first = makeImage();
    const second = makeImage();

    const panel = new ReadingPanel();
    panel.upsert(second, makeAreas(['B']));
    panel.upsert(first, makeAreas(['A']));
    panel.reindex();

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const previews = Array.from(shadow.querySelectorAll('.entry-preview')).map(
      e => e.textContent
    );
    expect(previews).toEqual(['A', 'B']);
    panel.destroy();
  });

  it('getIndexByImage reports the DOM-order index of each image', () => {
    const first = makeImage();
    const second = makeImage();

    const panel = new ReadingPanel();
    panel.upsert(second, makeAreas(['B']));
    panel.upsert(first, makeAreas(['A']));
    panel.reindex();

    const indices = panel.getIndexByImage();
    expect(indices.get(first)).toBe(1);
    expect(indices.get(second)).toBe(2);
    panel.destroy();
  });

  it('focusEntryByIndex follows the renumbered entries', () => {
    // After a reindex, "index 1" must be the first image in the document,
    // not the one that happened to be translated first.
    const first = makeImage();
    const second = makeImage();

    const panel = new ReadingPanel();
    panel.upsert(second, makeAreas(['B']));
    panel.upsert(first, makeAreas(['A']));
    panel.reindex();

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entry = shadow.querySelector<HTMLElement>('.entry[data-index="1"]');
    expect(entry).toBeTruthy();
    expect(entry?.querySelector('.entry-preview')?.textContent).toBe('A');

    panel.focusEntryByIndex(1);
    expect(entry?.classList.contains('flash')).toBe(true);
    panel.destroy();
  });

  it('upsert is idempotent for the same image', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['A']));
    panel.upsert(img, makeAreas(['B']));
    expect(panel.getEntryCount()).toBe(1);
    panel.destroy();
  });

  it('reset clears all entries', () => {
    const panel = new ReadingPanel();
    panel.upsert(makeImage(), makeAreas(['1']));
    panel.upsert(makeImage(), makeAreas(['2']));
    expect(panel.getEntryCount()).toBe(2);
    panel.reset();
    expect(panel.getEntryCount()).toBe(0);
    panel.destroy();
  });

  it('shows the first translation as preview', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好', '世界']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const preview = shadow.querySelector('.entry-preview');
    expect(preview?.textContent).toBe('你好');
    panel.destroy();
  });

  it('renders the body without repeating the previewed line', () => {
    // The head shows the first bubble as a teaser. The body used to print
    // the whole list again, so the first sentence appeared twice — once in
    // the title row and once as the first line of the body.
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['第一句', '第二句']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const items = Array.from(shadow.querySelectorAll('.entry-body li')).map(
      li => li.textContent
    );
    expect(items).toEqual(['第二句']);
    panel.destroy();
  });

  /**
   * The panel is the surface meant for *reading*. The source text travels
   * with the translation, so a bilingual reader can read both — but the
   * panel used to drop it, leaving the Alt-hold on the image as the only
   * way to see the original.
   */
  it('offers the original text for each bubble', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好', '世界']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;

    const details = shadow.querySelector('details.entry-original');
    expect(details).not.toBeNull();
    // Collapsed by default: the translation is what the reader came for.
    expect(details?.hasAttribute('open')).toBe(false);

    const originals = Array.from(
      shadow.querySelectorAll('.entry-original-list li')
    ).map(li => li.textContent);
    expect(originals).toEqual(['原文 1', '原文 2']);
    panel.destroy();
  });

  it('omits the original section when there is no source text', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, [
      {
        originalText: '',
        translatedText: '只有译文',
        x: 0,
        y: 0,
        width: 100,
        height: 10,
      },
    ]);
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    expect(shadow.querySelector('details.entry-original')).toBeNull();
    panel.destroy();
  });

  it('keeps the part of a long first bubble that the teaser cannot show', () => {
    // The teaser is one line. Anything past it has to land somewhere, or
    // the panel silently drops part of a translation.
    const long = '从前有座山山里有座庙庙里有个老和尚老和尚在讲故事';
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas([long, '第二句']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const preview = shadow.querySelector('.entry-preview')?.textContent ?? '';
    const items = Array.from(shadow.querySelectorAll('.entry-body li')).map(
      li => li.textContent
    );
    expect(preview.length).toBeLessThan(long.length);
    expect(items[0]).toBe(long.slice(preview.length));
    expect(items[1]).toBe('第二句');
    // Nothing is lost: the teaser and the body together spell the bubble.
    expect(preview + (items[0] ?? '')).toBe(long);
    panel.destroy();
  });

  it('toggle collapsed hides the list', () => {
    const panel = new ReadingPanel();
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const btn = shadow.getElementById('collapse-btn') as HTMLButtonElement;
    btn.click();
    const root = shadow.getElementById('root') as HTMLElement;
    expect(root.classList.contains('collapsed')).toBe(true);
    panel.destroy();
  });

  it('focusEntryByIndex adds the flash class to the matching entry', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好世界']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entry = shadow.querySelector<HTMLElement>('.entry');
    // jsdom doesn't implement scrollIntoView, but we can verify the visible
    // side effect (flash class) which only fires after a successful lookup.
    panel.focusEntryByIndex(1);
    expect(entry?.classList.contains('flash')).toBe(true);
    panel.destroy();
  });

  it('focusEntryByIndex is a no-op for unknown index', () => {
    const panel = new ReadingPanel();
    expect(() => panel.focusEntryByIndex(99)).not.toThrow();
    panel.destroy();
  });

  it('drops the entry when the translation is removed from the image', () => {
    // The panel is another view of the same translations. When the user
    // removes a translation from the image, the panel has to let it go —
    // otherwise it keeps listing a translation that is no longer there.
    const panel = new ReadingPanel();
    const first = makeImage();
    const second = makeImage();
    panel.upsert(first, makeAreas(['第一张']));
    panel.upsert(second, makeAreas(['第二张']));
    expect(panel.getEntryCount()).toBe(2);

    panel.remove(first);

    expect(panel.getEntryCount()).toBe(1);
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const previews = Array.from(shadow.querySelectorAll('.entry-preview')).map(
      node => node.textContent
    );
    expect(previews.some(text => text?.includes('第一张'))).toBe(false);
    // The remaining entry is renumbered, so "第 2 张" does not point at
    // nothing.
    const numbers = Array.from(shadow.querySelectorAll('.entry-num')).map(
      node => node.textContent
    );
    expect(numbers).toEqual(['1']);
    panel.destroy();
  });

  it('asks the host to take the panel off the page', () => {
    // The panel used to have exactly one way out — a keyboard shortcut
    // nobody was told about — so a reader whose panel covered the manga
    // had nothing to click.
    const panel = new ReadingPanel();
    const host = document.querySelector(
      '[data-manga-translator-reading-panel]'
    ) as HTMLElement;
    const seen: string[] = [];
    host.addEventListener('reading-panel-hide', () => seen.push('hidden'));

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    (shadow.getElementById('hide-btn') as HTMLButtonElement).click();

    expect(seen).toEqual(['hidden']);
    panel.destroy();
  });

  it('expands itself when an entry is focused while collapsed', () => {
    // A collapsed panel hides the list, so focusing an entry inside it
    // scrolled nothing and flashed nothing: the click looked like it did
    // nothing at all.
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好世界']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    (shadow.getElementById('collapse-btn') as HTMLButtonElement).click();
    expect(panel.isCollapsed()).toBe(true);

    panel.focusEntryByIndex(1);

    expect(panel.isCollapsed()).toBe(false);
    panel.destroy();
  });

  it('does not leave a stranded full stop at the start of the body', () => {
    // The teaser is cut at a fixed length, and the character right after the
    // cut is sometimes a full stop. Showing that on a line of its own makes
    // the panel look broken.
    const head = '一二三四五六七八九十一二三四五六七八九十';
    const text = `${head}。后面还有更多内容`;
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas([text]));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const preview = shadow.querySelector('.entry-preview')?.textContent ?? '';
    const items = Array.from(shadow.querySelectorAll('.entry-body li')).map(
      li => li.textContent
    );

    expect(preview).toBe(`${head}。`);
    expect(items[0]).toBe('后面还有更多内容');
    panel.destroy();
  });
});

// The 原文 disclosure sits inside the entry, and the entry scrolls its image
// into view when clicked. Expanding the original text therefore scrolled the
// manga away from the panel the reader was reading — the one control that
// only reveals text was the one control that moved the page.
describe('展开原文不会把漫画滚走', () => {
  let panel: ReadingPanel;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView =
      scrollIntoView as unknown as HTMLElement['scrollIntoView'];
    panel = new ReadingPanel();
  });

  afterEach(() => {
    panel.destroy();
  });

  it('点击原文不会滚动到图片', () => {
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好']));

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const summary = shadow.querySelector(
      '.entry-original-summary'
    ) as HTMLElement;
    expect(summary).toBeTruthy();

    summary.click();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('原文仍然会展开', () => {
    // Stopping the bubble-up must not break the disclosure itself.
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好']));

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const details = shadow.querySelector(
      'details.entry-original'
    ) as HTMLElement;
    const summary = shadow.querySelector(
      '.entry-original-summary'
    ) as HTMLElement;
    expect(details.hasAttribute('open')).toBe(false);

    summary.click();

    expect(details.hasAttribute('open')).toBe(true);
  });

  it('点击 entry 本身仍然会滚动到图片', () => {
    // The guard is on the summary only — the entry's own click still
    // navigates, or the panel would stop being a navigation surface.
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好']));

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entry = shadow.querySelector('.entry') as HTMLElement;

    entry.click();

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('用键盘展开原文也不会滚动', () => {
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好']));

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const summary = shadow.querySelector(
      '.entry-original-summary'
    ) as HTMLElement;

    summary.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('ReadingPanel interactions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = function () {};
    }
  });

  it('keyboard Enter focuses the image and flashes both sides', () => {
    vi.useFakeTimers();
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好']));

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entry = shadow.querySelector('.entry') as HTMLElement;
    entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(img.style.outline).toContain('22d3ee');
    expect(entry.classList.contains('flash')).toBe(true);

    vi.advanceTimersByTime(1300);
    expect(entry.classList.contains('flash')).toBe(false);
    vi.useRealTimers();
    panel.destroy();
  });

  it('focusEntryByIndex is a no-op for unknown indices', () => {
    const panel = new ReadingPanel();
    expect(() => panel.focusEntryByIndex(99)).not.toThrow();
    panel.destroy();
  });

  it('focusEntryByIndex uses the configured highlight duration', () => {
    // The flash used to be removed after a hardcoded 1200ms while the image
    // highlight used the configured duration. A panel configured for 300ms
    // kept the entry flashing long after the image highlight was gone.
    vi.useFakeTimers();
    const panel = new ReadingPanel({ highlightDurationMs: 300 });
    const img = makeImage();
    panel.upsert(img, makeAreas(['你好']));

    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entry = shadow.querySelector('.entry') as HTMLElement;

    panel.focusEntryByIndex(1);
    expect(entry.classList.contains('flash')).toBe(true);

    vi.advanceTimersByTime(300);
    expect(entry.classList.contains('flash')).toBe(false);

    vi.useRealTimers();
    panel.destroy();
  });

  it('expand returns from collapsed state with labels updated', () => {
    const panel = new ReadingPanel();
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const btn = shadow.getElementById('collapse-btn') as HTMLButtonElement;
    btn.click();
    expect(btn.textContent).toBe('+');
    btn.click();
    expect(btn.textContent).toBe('−');
    panel.destroy();
  });

  it('renders a placeholder preview when no area has text', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['   ']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const preview = shadow.querySelector('.entry-preview');
    expect(preview?.textContent).toContain('无文字气泡');
    panel.destroy();
  });
});

// The panel is an overlay on someone else's page. Every pixel it does not
// use is a pixel it takes away from the page, and a click it swallows is a
// click the reader cannot make.
describe('reading panel footprint', () => {
  it('does not swallow clicks on the page when collapsed', () => {
    const panel = new ReadingPanel({ initiallyCollapsed: true });
    try {
      const host = document.querySelector(
        '[data-manga-translator-reading-panel]'
      ) as HTMLElement;
      // The host is a shrink-to-fit wrapper; only the panel's own pixels
      // capture clicks. A host that captured them would sit over the page
      // as an invisible 320px rectangle.
      expect(host.style.pointerEvents).toBe('none');
      expect(host.style.width).toBe('');
    } finally {
      panel.destroy();
    }
  });

  it('shrinks to its header when collapsed', () => {
    const panel = new ReadingPanel({ initiallyCollapsed: true });
    try {
      const root = (panel as unknown as { root: HTMLElement }).root;
      expect(root.classList.contains('collapsed')).toBe(true);
      // The collapsed panel is a header bar, not a full-width panel.
      expect(root.style.width).toBe('');
    } finally {
      panel.destroy();
    }
  });

  it('hides the placeholder once there are translations', () => {
    const panel = new ReadingPanel();
    try {
      const img = document.createElement('img');
      document.body.appendChild(img);
      panel.upsert(img, [
        {
          x: 0.1,
          y: 0.1,
          width: 0.4,
          height: 0.1,
          originalText: 'original',
          translatedText: '译文',
        },
      ]);

      const empty = (
        panel as unknown as { shadow: ShadowRoot }
      ).shadow.getElementById('empty');
      // The placeholder says "translations will appear here". Once they
      // have, that sentence is stale and contradicts the list below it.
      expect(empty?.hidden).toBe(true);
    } finally {
      panel.destroy();
    }
  });

  it('shows the placeholder again when the entries are cleared', () => {
    const panel = new ReadingPanel();
    try {
      const img = document.createElement('img');
      document.body.appendChild(img);
      panel.upsert(img, [
        {
          x: 0.1,
          y: 0.1,
          width: 0.4,
          height: 0.1,
          originalText: 'original',
          translatedText: '译文',
        },
      ]);
      panel.reset();

      const empty = (
        panel as unknown as { shadow: ShadowRoot }
      ).shadow.getElementById('empty');
      expect(empty?.hidden).toBe(false);
    } finally {
      panel.destroy();
    }
  });
});

describe('reading panel visibility', () => {
  it('can be hidden entirely and shown again', () => {
    const panel = new ReadingPanel();
    try {
      const host = document.querySelector(
        '[data-manga-translator-reading-panel]'
      ) as HTMLElement;

      expect(panel.isVisible()).toBe(true);
      panel.setVisible(false);
      expect(panel.isVisible()).toBe(false);
      expect(host.style.display).toBe('none');

      panel.setVisible(true);
      expect(panel.isVisible()).toBe(true);
      expect(host.style.display).toBe('');
    } finally {
      panel.destroy();
    }
  });

  it('keeps the collapsed state separate from the visible state', () => {
    const panel = new ReadingPanel();
    try {
      // Hiding the panel must not un-collapse it, or the panel comes back
      // in a different shape than the user left it.
      panel.setCollapsed(true);
      panel.setVisible(false);
      panel.setVisible(true);
      expect(panel.isCollapsed()).toBe(true);
    } finally {
      panel.destroy();
    }
  });
});

describe('阅读顺序在插入的那一刻就成立', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('numbers an entry by its place in the chapter, not by arrival', () => {
    const panel = new ReadingPanel();
    try {
      // Three images in the document, in this order.
      const first = makeImage();
      const second = makeImage();
      const third = makeImage();

      // The middle one finishes first. That is what a concurrent,
      // viewport-first run does all the time.
      expect(panel.upsert(second, makeAreas(['第二张']))).toBe(1);
      // The first one arrives next: it belongs in front, so it takes
      // number 1 and pushes the other one down.
      expect(panel.upsert(first, makeAreas(['第一张']))).toBe(1);
      expect(panel.upsert(third, makeAreas(['第三张']))).toBe(3);

      const indices = panel.getIndexByImage();
      expect(indices.get(first)).toBe(1);
      expect(indices.get(second)).toBe(2);
      expect(indices.get(third)).toBe(3);
    } finally {
      panel.destroy();
    }
  });

  it('keeps the list in reading order while the batch is still running', () => {
    const panel = new ReadingPanel();
    try {
      const first = makeImage();
      const second = makeImage();

      panel.upsert(second, makeAreas(['第二张']));
      panel.upsert(first, makeAreas(['第一张']));

      const entries = panel.getEntriesInOrder();
      expect(
        entries.map(entry => entry.textAreas[0]?.translatedText ?? '')
      ).toEqual(['第一张', '第二张']);
    } finally {
      panel.destroy();
    }
  });

  it('renumbers the entries after one is removed', () => {
    const panel = new ReadingPanel();
    try {
      const first = makeImage();
      const second = makeImage();
      const third = makeImage();

      panel.upsert(first, makeAreas(['第一张']));
      panel.upsert(second, makeAreas(['第二张']));
      panel.upsert(third, makeAreas(['第三张']));

      panel.remove(second);

      const indices = panel.getIndexByImage();
      expect(indices.get(first)).toBe(1);
      expect(indices.get(third)).toBe(2);
    } finally {
      panel.destroy();
    }
  });
});

// The panel floats over somebody else's comic page. The grey it used to
// print its placeholder and its "no text found" note in measured 3.22:1
// against the panel surface — under the 4.5:1 that small text owes.
describe('阅读面板的对比度预算', () => {
  function stylesheet(panel: ReadingPanel): string {
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    return shadow.querySelector('style')?.textContent ?? '';
  }

  /** The colour the panel paints, once it is composited over the page. */
  function panelSurface(panel: ReadingPanel): Rgb {
    const background = cssDeclaration(
      cssBlock(stylesheet(panel), '#root'),
      'background'
    );
    return surfaceColor(background, WHITE_PAGE);
  }

  function contrastOf(panel: ReadingPanel, selector: string): number {
    const color = cssDeclaration(
      cssBlock(stylesheet(panel), selector),
      'color'
    );
    return textContrast(color, panelSurface(panel));
  }

  it('空状态提示在面板底色上至少 4.5:1', () => {
    const panel = new ReadingPanel();
    try {
      expect(contrastOf(panel, '#empty')).toBeGreaterThanOrEqual(4.5);
    } finally {
      panel.destroy();
    }
  });

  it('“未识别出文字”提示在面板底色上至少 4.5:1', () => {
    const panel = new ReadingPanel();
    try {
      expect(contrastOf(panel, '.entry-empty')).toBeGreaterThanOrEqual(4.5);
    } finally {
      panel.destroy();
    }
  });
});

describe('滚动方式', () => {
  /**
   * jsdom does not implement `matchMedia` at all, so the extension has to
   * work without it — and the test has to install it to ask the question.
   */
  function installMatchMedia(matches: boolean): () => void {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('reduce') ? matches : false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    return () => {
      if (original) {
        Object.defineProperty(window, 'matchMedia', original);
      } else {
        delete (window as unknown as { matchMedia?: unknown }).matchMedia;
      }
    };
  }

  it('默认是平滑滚动', () => {
    expect(scrollBehavior()).toBe('smooth');
  });

  it('系统开了"减少动态效果"就瞬移', () => {
    // The user asked the system to stop moving things: a smooth scroll
    // across a whole manga page is exactly what makes people motion sick.
    const restore = installMatchMedia(true);
    try {
      expect(scrollBehavior()).toBe('auto');
    } finally {
      restore();
    }
  });

  it('滚动到图片时用同一个判断', () => {
    const restore = installMatchMedia(true);
    const calls: Array<ScrollIntoViewOptions | boolean | undefined> = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (
      options?: boolean | ScrollIntoViewOptions
    ) {
      calls.push(options);
    };

    try {
      const panel = new ReadingPanel();
      const img = makeImage();
      panel.upsert(img, makeAreas(['你好']));
      panel.focusEntryByIndex(1);

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect((call as ScrollIntoViewOptions).behavior).toBe('auto');
      }
      panel.destroy();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
      restore();
    }
  });
});

// The translation is the thing the reader opened the panel for.
//
// It was set at 12px — the same size as the notes around it and smaller
// than the popup's body text — inside a 320px column. A translated line
// is prose, not a label, and prose at 12px in a narrow column breaks into
// unreadable stubs.
describe('译文字号不能比旁边的说明还小', () => {
  function stylesheet(panel: ReadingPanel): string {
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    return shadow.querySelector('style')?.textContent ?? '';
  }

  function fontSize(panel: ReadingPanel, selector: string): number {
    return Number.parseFloat(
      cssDeclaration(cssBlock(stylesheet(panel), selector), 'font-size')
    );
  }

  it('译文正文是 13px', () => {
    const panel = new ReadingPanel();
    try {
      expect(fontSize(panel, '.entry-body li')).toBe(13);
    } finally {
      panel.destroy();
    }
  });

  it('译文预览也是 13px', () => {
    const panel = new ReadingPanel();
    try {
      expect(fontSize(panel, '.entry-preview')).toBe(13);
    } finally {
      panel.destroy();
    }
  });

  it('译文比它周围的次要说明大', () => {
    const panel = new ReadingPanel();
    try {
      // "未识别出文字" and the original-text disclosure are notes; the
      // translation is the content.
      expect(fontSize(panel, '.entry-body li')).toBeGreaterThan(
        fontSize(panel, '.entry-empty')
      );
      expect(fontSize(panel, '.entry-body li')).toBeGreaterThan(
        fontSize(panel, '.entry-original-summary')
      );
    } finally {
      panel.destroy();
    }
  });

  it('序号徽章还是 11px——它是一个数字', () => {
    const panel = new ReadingPanel();
    try {
      expect(fontSize(panel, '.entry-num')).toBe(11);
    } finally {
      panel.destroy();
    }
  });
});
