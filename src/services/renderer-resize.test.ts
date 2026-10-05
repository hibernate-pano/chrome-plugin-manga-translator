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

import { getRenderer, OverlayRenderer } from './renderer';
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

/**
 * Captures the callback handed to `requestAnimationFrame` through an object
 * slot, and counts the calls. A plain `let` gets narrowed to `null` by flow
 * analysis, because the assignment happens inside a callback TypeScript cannot
 * see running.
 */
function installFrameCapture(): {
  calls: () => number;
  take: () => FrameRequestCallback | null;
} {
  const holder = { callback: null as FrameRequestCallback | null, count: 0 };
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    holder.count += 1;
    holder.callback = callback;
    return holder.count;
  });
  return {
    calls: () => holder.count,
    take: () => holder.callback,
  };
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

  it('repositions on a window resize without waiting for the observer', async () => {
    const img = createImage('resize-2', 400, 600);
    renderer.render(img, [AREA]);
    const overlay = document.querySelector<HTMLElement>(OVERLAY_SELECTOR);
    const beforeLeft = overlay?.style.left;
    setImageSize(img, 900, 600);
    window.dispatchEvent(new Event('resize'));
    // The handler coalesces into the next frame, so the pass is queued rather
    // than run inline. Awaiting the frame still proves the window listener is
    // a working fallback when the observer never fires.
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => resolve());
    });
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

  it('collapses a burst of window resize events into one re-layout', () => {
    // Each resize re-ran collision resolution and per-character text
    // measurement, so drag-resizing a 60-image chapter was a measurement storm
    // per event. The handler must queue at most one pass per frame.
    const img = createImage('resize-6', 400, 600);
    renderer.render(img, [AREA]);

    const frames = installFrameCapture();
    const repositionAll = vi.spyOn(renderer, 'repositionAll');

    setImageSize(img, 900, 600);
    for (let i = 0; i < 20; i += 1) {
      window.dispatchEvent(new Event('resize'));
    }
    expect(frames.calls()).toBe(1);
    expect(repositionAll).not.toHaveBeenCalled();

    frames.take()?.(0);
    expect(repositionAll).toHaveBeenCalledTimes(1);

    // A later resize queues a fresh pass.
    setImageSize(img, 1200, 600);
    window.dispatchEvent(new Event('resize'));
    frames.take()?.(0);
    expect(repositionAll).toHaveBeenCalledTimes(2);
  });

  it('re-lays out an overlay when the image grows after placement', () => {
    // The case the "keep overlays aligned" commit claims to fix: a lazy-loaded
    // image is placed at its placeholder size, then the real dimensions arrive
    // afterwards. Without the observer the text stays where the placeholder was.
    const img = createImage('resize-7', 200, 300);
    renderer.render(img, [AREA]);
    const overlay = document.querySelector<HTMLElement>(OVERLAY_SELECTOR);
    const placedLeft = overlay?.style.left;
    const placedWidth = overlay?.style.width;
    expect(placedLeft).toBeTruthy();

    // The image finishes loading at double the size and the observer fires.
    setImageSize(img, 400, 600);
    Object.defineProperty(img, 'naturalWidth', {
      value: 400,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(img, 'naturalHeight', {
      value: 600,
      configurable: true,
      writable: true,
    });
    FakeResizeObserver.instances[0]?.emit();

    // Box sizing is adaptive (text fitting can shrink it), so the invariant is
    // that the geometry followed the image, not a specific formula.
    expect(overlay?.style.left).not.toBe(placedLeft);
    expect(overlay?.style.width).not.toBe(placedWidth);
  });

  it('dispose cancels a re-layout queued for the next frame', () => {
    const img = createImage('resize-8', 400, 600);
    renderer.render(img, [AREA]);

    const frames = installFrameCapture();
    const cancel = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    const repositionAll = vi.spyOn(renderer, 'repositionAll');

    window.dispatchEvent(new Event('resize'));
    expect(frames.calls()).toBe(1);

    const queued = frames.take();
    renderer.dispose();
    expect(cancel).toHaveBeenCalledTimes(1);

    // A stale callback firing after teardown must not touch a dead renderer.
    queued?.(0);
    expect(repositionAll).not.toHaveBeenCalled();

    // The cached singleton must not be handed back disposed: content.ts calls
    // getRenderer() again on the next init, and a disposed instance has no
    // observer and no resize listener, so overlays would silently stop
    // following the art after a bfcache restore.
    const shared = getRenderer();
    shared.dispose();
    expect(getRenderer()).not.toBe(shared);
  });
});
