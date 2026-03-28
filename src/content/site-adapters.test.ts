import { beforeEach, describe, expect, it } from 'vitest';

import {
  matchSiteAdapter,
  waitForRenderablePages,
} from './site-adapters';

const CHAPTER_PAGES_BASE64 =
  'W3sic3JjIjoiNTMwODcvbXJfMDAxLmpwZyIsInciOjEwODAsImgiOjUwMDB9LHsic3JjIjoiNTMwODcvbXJfMDAyLmpwZyIsInciOjEwODAsImgiOjUwMDB9XQ==';

function getAdapter() {
  const adapter = matchSiteAdapter(
    'https://manhwaread.com/manhwa/outro/chapter-1/'
  );

  expect(adapter).not.toBeNull();

  return adapter;
}

function createChapterWindow() {
  return {
    chapterData: {
      base: 'https://manread.xyz/1268',
      data: CHAPTER_PAGES_BASE64,
    },
    location: {
      href: 'https://manhwaread.com/manhwa/outro/chapter-1/',
    },
  } as unknown as Window & typeof globalThis;
}

function installChapterData() {
  Object.defineProperty(window, 'chapterData', {
    configurable: true,
    value: {
      base: 'https://manread.xyz/1268',
      data: CHAPTER_PAGES_BASE64,
    },
    writable: true,
  });
}

describe('site-adapters', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as Window & { chapterData?: unknown }).chapterData;
  });

  it('matches only ManhwaRead chapter pages', () => {
    expect(
      matchSiteAdapter(
        'https://manhwaread.com/manhwa/outro/chapter-1/'
      )?.id
    ).toBe('manhwaread');
    expect(
      matchSiteAdapter('https://manhwaread.com/manhwa/outro/')
    ).toBeNull();
    expect(matchSiteAdapter('https://example.com')).toBeNull();
  });

  it('parses canonical chapter image URLs from chapterData', () => {
    const adapter = getAdapter();
    const bootstrap = adapter?.getChapterBootstrap(createChapterWindow());

    expect(bootstrap).not.toBeNull();
    expect(bootstrap?.pages.map(page => page.src)).toEqual([
      'https://manread.xyz/1268/53087/mr_001.jpg',
      'https://manread.xyz/1268/53087/mr_002.jpg',
    ]);
  });

  it('lists only chapter images inside #reader #imagesList', () => {
    document.body.innerHTML = `
      <div id='reader'>
        <div id='readingNavTop'><img id='nav-top' /></div>
        <div id='imagesList'>
          <div class='reading-page'><img id='page-1' class='reading-image' /></div>
          <div class='reading-page'><img id='page-2' class='reading-image' /></div>
        </div>
      </div>
      <div class='manga-item__img-inner'>
        <img id='cover' />
      </div>
    `;

    const adapter = getAdapter();
    const bootstrap = adapter?.getChapterBootstrap(createChapterWindow());

    expect(bootstrap).not.toBeNull();

    if (!adapter || !bootstrap) {
      throw new Error('expected adapter bootstrap');
    }

    const pages = adapter.listRenderablePages(document, bootstrap);

    expect(pages?.map(page => page.image.id)).toEqual(['page-1', 'page-2']);
    expect(pages?.map(page => page.canonicalUrl)).toEqual([
      'https://manread.xyz/1268/53087/mr_001.jpg',
      'https://manread.xyz/1268/53087/mr_002.jpg',
    ]);
  });

  it('resolves the canonical URL for a hydrated chapter image', () => {
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'>
          <div class='reading-page'><img id='page-1' class='reading-image' /></div>
          <div class='reading-page'><img id='page-2' class='reading-image' /></div>
        </div>
      </div>
    `;

    const adapter = getAdapter();
    const bootstrap = adapter?.getChapterBootstrap(createChapterWindow());
    const pageImage = document.getElementById('page-2') as HTMLImageElement;

    expect(bootstrap).not.toBeNull();
    if (!adapter || !bootstrap) {
      throw new Error('expected adapter bootstrap');
    }

    expect(adapter.resolveCanonicalImage(pageImage, bootstrap)).toBe(
      'https://manread.xyz/1268/53087/mr_002.jpg'
    );
  });

  it('waits for chapter images to appear after DOM hydration', async () => {
    installChapterData();
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'></div>
      </div>
    `;

    const adapter = getAdapter();

    if (!adapter) {
      throw new Error('expected adapter');
    }

    const pagesPromise = waitForRenderablePages(adapter, 1000);

    window.setTimeout(() => {
      const container = document.querySelector('#imagesList');

      if (!container) {
        return;
      }

      container.innerHTML = `
        <div class='reading-page'><img id='page-1' class='reading-image' /></div>
        <div class='reading-page'><img id='page-2' class='reading-image' /></div>
      `;
    }, 0);

    const pages = await pagesPromise;

    expect(pages.map(page => page.image.id)).toEqual(['page-1', 'page-2']);
  });

  it('returns null when chapter bootstrap data is missing', () => {
    const adapter = getAdapter();
    const bootstrap = adapter?.getChapterBootstrap(
      {
        location: {
          href: 'https://manhwaread.com/manhwa/outro/chapter-1/',
        },
      } as unknown as Window & typeof globalThis
    );

    expect(bootstrap).toBeNull();
  });
});
