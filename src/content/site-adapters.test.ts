import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectSiteCandidateImages,
  getRealImageSource,
  matchSiteAdapter,
  prepareImageForTranslation,
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

  // ---------------------------------------------------------------------------
  // collectSiteCandidateImages
  // ---------------------------------------------------------------------------

  it('returns empty array when adapter is null', () => {
    expect(collectSiteCandidateImages(null)).toEqual([]);
  });

  it('returns empty array when bootstrap data is missing', () => {
    const adapter = getAdapter();
    // chapterData is not installed — getChapterBootstrap returns null
    expect(collectSiteCandidateImages(adapter)).toEqual([]);
  });

  it('collects candidate images with valid adapter and bootstrap', () => {
    installChapterData();
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'>
          <div class='reading-page'><img id='page-1' class='reading-image' /></div>
          <div class='reading-page'><img id='page-2' class='reading-image' /></div>
        </div>
      </div>
    `;

    const adapter = getAdapter();
    const images = collectSiteCandidateImages(adapter);

    expect(images).toHaveLength(2);
    expect(images.map(img => img.id)).toEqual(['page-1', 'page-2']);
  });

  // ---------------------------------------------------------------------------
  // getRealImageSource
  // ---------------------------------------------------------------------------

  it('returns src when no adapter is provided', () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/image.jpg';

    expect(getRealImageSource(img)).toBe('https://example.com/image.jpg');
  });

  it('returns src when adapter has no bootstrap data', () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/image.jpg';
    const adapter = getAdapter();
    // chapterData not installed, bootstrap will be null
    expect(getRealImageSource(img, adapter)).toBe(
      'https://example.com/image.jpg'
    );
  });

  it('returns canonical URL when adapter resolves image', () => {
    installChapterData();
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'>
          <div class='reading-page'><img id='page-1' class='reading-image' /></div>
          <div class='reading-page'><img id='page-2' class='reading-image' /></div>
        </div>
      </div>
    `;

    const adapter = getAdapter();
    const img = document.getElementById('page-2') as HTMLImageElement;

    expect(getRealImageSource(img, adapter)).toBe(
      'https://manread.xyz/1268/53087/mr_002.jpg'
    );
  });

  it('falls back to src when image is not in recognised container', () => {
    installChapterData();
    // Image is NOT in the DOM, so resolveCanonicalImage returns null
    const img = document.createElement('img');
    img.src = 'https://example.com/fallback.jpg';
    const adapter = getAdapter();

    expect(getRealImageSource(img, adapter)).toBe(
      'https://example.com/fallback.jpg'
    );
  });

  // ---------------------------------------------------------------------------
  // prepareImageForTranslation (null adapter → waitForImageLoad)
  // ---------------------------------------------------------------------------

  it('resolves when image load event fires (no adapter)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/image.jpg';

    const promise = prepareImageForTranslation(img);

    // The async function has run up to the first await inside
    // waitForImageLoad, which set up load/error listeners.
    // Dispatch load to trigger resolution.
    img.dispatchEvent(new Event('load'));

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects when image raises error event (no adapter)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/image.jpg';

    const promise = prepareImageForTranslation(img);

    img.dispatchEvent(new Event('error'));

    await expect(promise).rejects.toThrow('章节图片加载失败');
  });

  it('rejects after timeout when image never loads (no adapter)', async () => {
    const img = document.createElement('img');
    img.src = 'https://example.com/image.jpg';

    let timeoutCallback: (() => void) | null = null;

    // Intercept window.setTimeout so we can manually fire the timeout
    // without waiting 10 real seconds. fake-timers are unreliable in jsdom.
    const setTimeoutSpy = vi
      .spyOn(window, 'setTimeout')
      .mockImplementation(((
        cb: (...args: unknown[]) => void
      ): ReturnType<typeof window.setTimeout> => {
        timeoutCallback = cb as () => void;
        return 1 as unknown as ReturnType<typeof window.setTimeout>;
      }) as typeof window.setTimeout);

    const clearTimeoutSpy = vi
      .spyOn(window, 'clearTimeout')
      .mockImplementation(() => {
        // no-op: we intentionally want the timeout to fire
      });

    try {
      const promise = prepareImageForTranslation(img);

      // Fire the timeout — this calls reject() inside waitForImageLoad.
      // The callback was assigned by the setTimeout mock above.
      if (timeoutCallback === null) {
        throw new Error('timeout callback was not captured by the mock');
      }
      (timeoutCallback as () => void)();

      await expect(promise).rejects.toThrow('章节图片加载超时');
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  // ---------------------------------------------------------------------------
  // prepareImageForTranslation (with adapter)
  // ---------------------------------------------------------------------------

  it('throws when bootstrap is missing with adapter', async () => {
    const img = document.createElement('img');
    const adapter = getAdapter();
    if (!adapter) throw new Error('expected adapter');

    // chapterData is not installed
    await expect(prepareImageForTranslation(img, adapter)).rejects.toThrow(
      '未检测到章节数据'
    );
  });

  it('throws when canonical URL cannot be resolved with adapter', async () => {
    installChapterData();
    // Image is NOT attached to the DOM, so resolveCanonicalImage returns null
    const img = document.createElement('img');
    const adapter = getAdapter();
    if (!adapter) throw new Error('expected adapter');

    await expect(prepareImageForTranslation(img, adapter)).rejects.toThrow(
      '未找到章节图片地址'
    );
  });

  it('prepares image for translation via adapter', async () => {
    installChapterData();
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'>
          <div class='reading-page'><img id='page-1' class='reading-image' /></div>
        </div>
      </div>
    `;

    const adapter = getAdapter();
    if (!adapter) throw new Error('expected adapter');

    const img = document.getElementById('page-1') as HTMLImageElement;

    const promise = prepareImageForTranslation(img, adapter);

    // prepareImage sets src then calls waitForImageLoad.
    // Dispatch load so waitForImageLoad resolves.
    img.dispatchEvent(new Event('load'));

    await expect(promise).resolves.toBeUndefined();

    // Verify that prepareImage set up the element correctly
    expect(img.crossOrigin).toBe('anonymous');
    expect(img.src).toBe('https://manread.xyz/1268/53087/mr_001.jpg');
    expect(img.loading).toBe('eager');
    expect(img.decoding).toBe('async');
  });

  // ---------------------------------------------------------------------------
  // waitForRenderablePages — remaining branches
  // ---------------------------------------------------------------------------

  it('returns existing pages immediately when already in DOM', async () => {
    installChapterData();
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'>
          <div class='reading-page'><img id='page-1' class='reading-image' /></div>
        </div>
      </div>
    `;

    const adapter = getAdapter();
    if (!adapter) throw new Error('expected adapter');

    // Pages are already present — should resolve synchronously (no observer)
    const pages = await waitForRenderablePages(adapter, 100);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.image.id).toBe('page-1');
    expect(pages[0]?.canonicalUrl).toBe(
      'https://manread.xyz/1268/53087/mr_001.jpg'
    );
  });

  it('rejects when pages do not appear within timeout', async () => {
    installChapterData();
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'></div>
      </div>
    `;

    const adapter = getAdapter();
    if (!adapter) throw new Error('expected adapter');

    // No images are ever added — the timeout should fire
    await expect(
      waitForRenderablePages(adapter, 50)
    ).rejects.toThrow('章节图片未在预期时间内出现');
  });

  it('observer skips mutations when bootstrap becomes unavailable', async () => {
    installChapterData();
    document.body.innerHTML = `
      <div id='reader'>
        <div id='imagesList'></div>
      </div>
    `;

    const adapter = getAdapter();
    if (!adapter) throw new Error('expected adapter');

    const pagesPromise = waitForRenderablePages(adapter, 500);

    // Remove chapter data — the observer will fire but bootstrap is null
    // (lines 304-305: early return, promise stays pending)
    delete (window as Window & { chapterData?: unknown }).chapterData;

    window.setTimeout(() => {
      const container = document.querySelector('#imagesList');
      if (container) {
        container.innerHTML =
          '<div class="reading-page"><img id="ignored" class="reading-image" /></div>';
      }
    }, 0);

    // Restore chapter data and trigger another mutation so the observer
    // can resolve with a valid bootstrap
    window.setTimeout(() => {
      installChapterData();
      const container = document.querySelector('#imagesList');
      if (container) {
        const div = document.createElement('div');
        div.className = 'reading-page';
        const img = document.createElement('img');
        img.id = 'page-final';
        img.className = 'reading-image';
        div.appendChild(img);
        container.appendChild(div);
      }
    }, 20);

    const pages = await pagesPromise;

    // Both images are now in the container; listRenderablePages maps them
    // to the two bootstrap pages
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages.some(p => p.image.id === 'page-final')).toBe(true);
  });
});
