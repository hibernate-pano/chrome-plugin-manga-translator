/**
 * Overlay geometry is stored in absolute pixels, so it silently drifts out of
 * alignment whenever the host page resizes an image: a window resize, a
 * responsive breakpoint, a reader-mode width change, or a lazy-loaded image
 * that finally reports its real dimensions.
 *
 * `reading-anchors.ts` already repositioned on scroll/resize; the overlays
 * themselves did not, which is why the badges tracked the art while the text
 * did not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverlayRenderer } from './renderer';
import type { TextArea } from '@/providers/base';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();

  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }

  emit(): void {
    const entries = Array.from(this.observed).map(
      target =>
        ({
          target,
          contentRect: target.getBoundingClientRect(),
        }) as unknown as ResizeObserverEntry
    );
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

const OVERLAY_SELECTOR = '.manga-translator-overlay';

function setImageSize(
  img: HTMLImageElement,
  width: number,
  height: number
): void {
  Object.defineProperty(img, 'offsetWidth', {
    value: width,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(img, 'offsetHeight', {
    value: height,
    configurable: true,
    writable: true,
  });
  img.style.width = `${width}px`;
  img.style.height = `${height}px`;
}

function createImage(
  id: string,
  width: number,
  height: number
): HTMLImageElement {
  const img = document.createElement('img');
  img.id = id;
  img.src =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  setImageSize(img, width, height);
  Object.defineProperty(img, 'naturalWidth', {
    value: width,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(img, 'naturalHeight', {
    value: height,
    configurable: true,
    writable: true,
  });
  document.body.appendChild(img);
  return img;
}

const AREA: TextArea = {
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.1,
  originalText: 'こんにちは',
  translatedText: '你好',
};

describe('overlay repositioning on resize', () => {
  let renderer: OverlayRenderer;

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    document.body.innerHTML = '';
    renderer = new OverlayRenderer();
  });

  afterEach(() => {
    renderer.dispose();
    vi.unstubAllGlobals();
  });

  it('re-lays out overlays when the observed image resizes', () => {
    const img = createImage('resize-1', 400, 600);
    renderer.render(img, [AREA]);
    const overlay = document.querySelector<HTMLElement>(OVERLAY_SELECTOR);
    expect(overlay).not.toBeNull();
    const beforeLeft = overlay?.style.left;
    const beforeTop = overlay?.style.top;
    setImageSize(img, 800, 1200);
    FakeResizeObserver.instances[0]?.emit();
    const afterLeft = overlay?.style.left;
    const afterTop = overlay?.style.top;
    expect(afterLeft).not.toBe(beforeLeft);
    // Vertical offset tracks image height, so it must move too.
    expect(afterTop).not.toBe(beforeTop);
    // A wider box puts the same 0-1 area further right.
    expect(parseFloat(afterLeft ?? '0')).toBeGreaterThan(
      parseFloat(beforeLeft ?? '0')
    );
  });

  it('repositions on a window resize without waiting for the observer', () => {
    const img = createImage('resize-2', 400, 600);
    renderer.render(img, [AREA]);
    const overlay = document.querySelector<HTMLElement>(OVERLAY_SELECTOR);
    const beforeLeft = overlay?.style.left;
    setImageSize(img, 900, 600);
    window.dispatchEvent(new Event('resize'));
    expect(overlay?.style.left).not.toBe(beforeLeft);
  });

  it('stops observing an image once its overlays are removed', () => {
    const img = createImage('resize-3', 400, 600);
    renderer.render(img, [AREA]);
    const observer = FakeResizeObserver.instances[0];
    expect(observer?.observed.has(img)).toBe(true);
    renderer.remove(img);
    expect(observer?.observed.has(img)).toBe(false);
  });

  it('repositions every rendered image via repositionAll', () => {
    const first = createImage('resize-4a', 400, 600);
    const second = createImage('resize-4b', 400, 600);
    renderer.render(first, [AREA]);
    renderer.render(second, [AREA]);
    const before = Array.from(
      document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)
    ).map(overlay => overlay.style.left);
    setImageSize(first, 1000, 600);
    setImageSize(second, 1000, 600);
    renderer.repositionAll();
    const after = Array.from(
      document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)
    ).map(overlay => overlay.style.left);
    expect(after).not.toEqual(before);
  });

  it('dispose releases the observer and clears the overlays', () => {
    const img = createImage('resize-5', 400, 600);
    renderer.render(img, [AREA]);
    const observer = FakeResizeObserver.instances[0];
    renderer.dispose();
    expect(observer?.observed.size).toBe(0);
    expect(document.querySelectorAll(OVERLAY_SELECTOR)).toHaveLength(0);
  });
});
