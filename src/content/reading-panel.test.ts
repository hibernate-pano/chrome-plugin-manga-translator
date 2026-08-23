import { describe, expect, it, beforeEach } from 'vitest';
import { ReadingPanel } from './reading-panel';
import type { TextArea } from '@/providers/base';

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

  it('renders the full body when there are 2+ areas', () => {
    const panel = new ReadingPanel();
    const img = makeImage();
    panel.upsert(img, makeAreas(['第一句', '第二句']));
    const shadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const items = shadow.querySelectorAll('.entry-body li');
    expect(items.length).toBe(2);
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
});
