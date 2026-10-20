import { describe, expect, it, beforeEach } from 'vitest';
import { ReadingAnchors } from './reading-anchors';

function makeImage(
  width = 200,
  height = 100,
  left = 0,
  top = 0
): HTMLImageElement {
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

  it('syncIndices rewrites the badge numbers after a reindex', () => {
    // The reading panel renumbers its entries by DOM position once a batch
    // finishes. The badges on the images have to follow, otherwise badge "3"
    // jumps to a different entry than the one it used to point at.
    const first = makeImage();
    const second = makeImage();
    const anchors = new ReadingAnchors();
    anchors.upsert(first, 1);
    anchors.upsert(second, 2);

    const indices = new Map<HTMLImageElement, number>([
      [second, 1],
      [first, 2],
    ]);
    anchors.syncIndices(indices);

    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    const badges = Array.from(shadow.querySelectorAll<HTMLElement>('.badge'));
    const byImage = new Map(
      badges.map(badge => [badge.dataset['index'], badge.textContent])
    );
    expect(byImage.get('1')).toBe('1');
    expect(byImage.get('2')).toBe('2');
    // The badge that now carries index 1 must be the second image's badge.
    const secondBadge = badges.find(b => b.textContent === '1');
    expect(secondBadge?.dataset['index']).toBe('1');
    expect(byImage.size).toBe(2);
    anchors.destroy();
  });

  it('syncIndices leaves badges alone for images it does not know', () => {
    const img = makeImage();
    const anchors = new ReadingAnchors();
    anchors.upsert(img, 4);
    anchors.syncIndices(new Map<HTMLImageElement, number>());
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    expect(shadow.querySelector('.badge')?.textContent).toBe('4');
    anchors.destroy();
  });

  it('destroy drops the badge DOM', () => {
    const anchors = new ReadingAnchors();
    anchors.upsert(makeImage(), 1);
    anchors.destroy();
    expect(
      document.querySelector('[data-manga-translator-reading-anchors]')
    ).toBeNull();
  });

  it('puts the badge on the left, away from the reading panel', () => {
    // The reading panel is docked on the right and covers that corner of
    // the image, so a badge there was hidden behind the panel and could not
    // be clicked at all.
    const anchors = new ReadingAnchors();
    const img = makeImage(200, 100, 40, 60);
    anchors.upsert(img, 1);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    const badge = shadow.querySelector('.badge') as HTMLElement;

    expect(parseFloat(badge.style.left)).toBe(40 + 12);
    anchors.destroy();
  });

  it('keeps the badge visible while a tall image is being read', () => {
    // A manga page is usually taller than the screen, so a badge pinned to
    // the image's top corner scrolled out of view immediately.
    const anchors = new ReadingAnchors();
    const img = makeImage(200, 4000, 0, -1500);
    anchors.upsert(img, 1);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    const badge = shadow.querySelector('.badge') as HTMLElement;

    expect(badge.style.display).toBe('flex');
    expect(parseFloat(badge.style.top)).toBe(12);
    anchors.destroy();
  });

  it('hides the badge once the image has been scrolled past', () => {
    const anchors = new ReadingAnchors();
    const img = makeImage(200, 100, 0, -500);
    anchors.upsert(img, 1);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    const badge = shadow.querySelector('.badge') as HTMLElement;

    expect(badge.style.display).toBe('none');
    anchors.destroy();
  });

  it('drops the badge when the translation is removed from the image', () => {
    const anchors = new ReadingAnchors();
    const img = makeImage();
    anchors.upsert(img, 1);
    anchors.remove(img);
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    expect(shadow.querySelectorAll('.badge').length).toBe(0);
    anchors.destroy();
  });
});
