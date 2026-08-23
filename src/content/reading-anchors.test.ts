import { describe, expect, it, beforeEach } from 'vitest';
import { ReadingAnchors } from './reading-anchors';

function makeImage(width = 200, height = 100, left = 0, top = 0): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(img);
  return img;
}

describe('ReadingAnchors', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('upsert adds a badge for the image', () => {
    const anchors = new ReadingAnchors();
    const img = makeImage();
    anchors.upsert(img, 1);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    expect(shadow.querySelectorAll('.badge').length).toBe(1);
    anchors.destroy();
  });

  it('badge shows the index', () => {
    const anchors = new ReadingAnchors();
    anchors.upsert(makeImage(), 7);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    const badge = shadow.querySelector('.badge');
    expect(badge?.textContent).toBe('7');
    anchors.destroy();
  });

  it('upsert on same image updates index', () => {
    const anchors = new ReadingAnchors();
    const img = makeImage();
    anchors.upsert(img, 1);
    anchors.upsert(img, 5);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    expect(shadow.querySelectorAll('.badge').length).toBe(1);
    expect(shadow.querySelector('.badge')?.textContent).toBe('5');
    anchors.destroy();
  });

  it('clicking badge dispatches reading-anchor-click', () => {
    const anchors = new ReadingAnchors();
    let receivedIndex = 0;
    (anchors as unknown as { host: HTMLElement }).host.addEventListener(
      'reading-anchor-click',
      ((e: Event) => {
        receivedIndex = (e as CustomEvent<{ index: number }>).detail.index;
      }) as EventListener
    );
    anchors.upsert(makeImage(), 4);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    const badge = shadow.querySelector('.badge') as HTMLElement;
    badge.click();
    expect(receivedIndex).toBe(4);
    anchors.destroy();
  });

  it('reset clears all badges', () => {
    const anchors = new ReadingAnchors();
    anchors.upsert(makeImage(), 1);
    anchors.upsert(makeImage(), 2);
    anchors.reset();
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    expect(shadow.querySelectorAll('.badge').length).toBe(0);
    anchors.destroy();
  });

  it('repositionAll does not throw with detached images', () => {
    const anchors = new ReadingAnchors();
    anchors.upsert(makeImage(), 1);
    expect(() => anchors.repositionAll()).not.toThrow();
    anchors.destroy();
  });
});
