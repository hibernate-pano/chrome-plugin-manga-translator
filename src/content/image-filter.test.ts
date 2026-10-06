import { describe, expect, it } from 'vitest';

import { isTranslatableImage } from './image-filter';
import type { SiteAdapter } from './site-adapters';

function createImage(
  overrides: Partial<HTMLImageElement> = {}
): HTMLImageElement {
  const image = {
    naturalWidth: 800,
    naturalHeight: 1200,
    width: 800,
    height: 1200,
    complete: true,
    className: '',
    id: '',
    classList: {
      contains: (name: string) =>
        name === 'manga-translator-processed' &&
        typeof (image as { className?: unknown }).className === 'string' &&
        (image as { className: string }).className.includes(name),
    },
    currentSrc: 'https://cdn.example.com/page-1.webp',
    closest: (_selector: string) => null,
    getAttribute: (_name: string) => null,
    src: 'https://cdn.example.com/page-1.webp',
  } as unknown as HTMLImageElement;
  return Object.assign(image, overrides);
}

describe('isTranslatableImage', () => {
  it('accepts a complete, large comic page image', () => {
    const image = createImage();
    expect(isTranslatableImage(image)).toBe(true);
  });

  it('rejects images below the minimum size', () => {
    expect(isTranslatableImage(createImage({ naturalWidth: 100 }))).toBe(false);
    expect(isTranslatableImage(createImage({ naturalHeight: 100 }))).toBe(
      false
    );
  });

  it('rejects images without a resolvable source', () => {
    const adapter = {
      id: 'manhwaread',
      matchesChapter: () => true,
      getChapterBootstrap: () => ({}) as unknown,
      resolveCanonicalImage: () => null,
      listRenderablePages: () => [],
      prepareImage: async () => undefined,
    } as unknown as SiteAdapter;
    expect(
      isTranslatableImage(createImage({ currentSrc: '', src: '' }), {
        siteAdapter: adapter,
      })
    ).toBe(false);
  });

  it('rejects incomplete images unless allowed', () => {
    expect(isTranslatableImage(createImage({ complete: false }))).toBe(false);
    expect(
      isTranslatableImage(createImage({ complete: false }), {
        allowIncomplete: true,
      })
    ).toBe(true);
  });

  it('rejects images inside structural chrome like headers', () => {
    const inHeader = createImage();
    (inHeader.closest as unknown as (s: string) => Element | null) = () =>
      ({}) as Element;
    expect(isTranslatableImage(inHeader)).toBe(false);
  });

  it('rejects UI-shaped images by class or id keywords', () => {
    expect(isTranslatableImage(createImage({ className: 'site-logo' }))).toBe(
      false
    );
    expect(isTranslatableImage(createImage({ id: 'user-avatar' }))).toBe(false);
    expect(isTranslatableImage(createImage({ className: 'top-banner' }))).toBe(
      false
    );
  });

  it('rejects small near-square icons', () => {
    expect(
      isTranslatableImage(
        createImage({
          naturalWidth: 300,
          naturalHeight: 300,
          width: 300,
          height: 300,
        })
      )
    ).toBe(false);
  });

  it('rejects already-processed images and wrapped images', () => {
    expect(
      isTranslatableImage(
        createImage({
          className: 'manga-translator-processed',
        })
      )
    ).toBe(false);
    const wrapped = createImage();
    (wrapped.closest as unknown as (s: string) => Element | null) = (
      selector: string
    ) => (selector === '.manga-translator-wrapper' ? ({} as Element) : null);
    expect(isTranslatableImage(wrapped)).toBe(false);
  });

  it('honours a custom allowImage predicate', () => {
    const image = createImage();
    expect(isTranslatableImage(image, { allowImage: () => false })).toBe(false);
    expect(isTranslatableImage(image, { allowImage: () => true })).toBe(true);
  });
});
