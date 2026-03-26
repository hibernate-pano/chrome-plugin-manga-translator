import { describe, expect, it } from 'vitest';
import {
  collectSiteCandidateImages,
  getRealImageSource,
  matchSiteAdapter,
  prepareImageForTranslation,
} from './site-adapters';

describe('site-adapters', () => {
  it('matches configured sites', () => {
    expect(matchSiteAdapter('https://mangadex.org/chapter/demo')?.id).toBe(
      'mangadex'
    );
    expect(
      matchSiteAdapter('https://comic-walker.com/detail/KC_005312_S')?.id
    ).toBe('comic-walker');
    expect(
      matchSiteAdapter('https://web-ace.jp/youngaceup/contents/100')
    ).toEqual(expect.objectContaining({ id: 'web-ace' }));
    expect(
      matchSiteAdapter(
        'https://manhwaread.com/manhwa/milf-hunter-in-another-world/chapter-109/'
      )?.id
    ).toBe('manhwaread');
  });

  it('returns null for unsupported sites', () => {
    expect(matchSiteAdapter('https://example.com')).toBeNull();
  });

  it('collects candidates from adapter selectors and excludes ignored nodes', () => {
    document.body.innerHTML = `
      <header><img id="header-image" src="/ui.jpg" /></header>
      <main>
        <div data-testid="reader-container">
          <img id="page-image" src="/page.jpg" />
        </div>
      </main>
    `;

    const adapter = matchSiteAdapter('https://mangadex.org/chapter/demo');
    const images = collectSiteCandidateImages(adapter);

    expect(images.map(image => image.id)).toEqual(['page-image']);
  });

  it('prefers real lazy-load source attributes', () => {
    const image = document.createElement('img');
    image.src = 'https://example.com/placeholder.jpg';
    image.setAttribute('data-src', 'https://cdn.example.com/page-1.jpg');

    expect(getRealImageSource(image)).toBe(
      'https://cdn.example.com/page-1.jpg'
    );
  });

  it('collects chapter images from manhwaread reader container', () => {
    document.body.innerHTML = `
      <div id="reader">
        <div id="imagesList">
          <div class="reading-page">
            <img id="page-1" class="reading-image" width="720" height="5000" />
          </div>
          <div class="reading-page">
            <img id="page-2" class="reading-image" width="720" height="5000" />
          </div>
        </div>
      </div>
      <div class="manga-item__img-inner">
        <img id="cover-image" src="/cover.jpg" />
      </div>
    `;

    const adapter = matchSiteAdapter(
      'https://manhwaread.com/manhwa/demo/chapter-1/'
    );
    const images = collectSiteCandidateImages(adapter);

    expect(images.map(image => image.id)).toEqual(['page-1', 'page-2']);
  });

  it('resolves manhwaread chapter image source from chapterData and reading-page metadata', () => {
    document.body.innerHTML = `
      <div class="reading-page" id="page-wrapper">
        <img id="page-image" class="reading-image" width="720" height="5000" />
      </div>
    `;

    const pageWrapper = document.getElementById('page-wrapper') as HTMLElement & {
      img?: { src?: string };
    };
    pageWrapper.img = { src: '132557/mr_001.jpg' };

    Object.assign(window, {
      chapterData: {
        base: 'https://manread.xyz/1628',
      },
    });

    const image = document.getElementById('page-image') as HTMLImageElement;
    const adapter = matchSiteAdapter(
      'https://manhwaread.com/manhwa/demo/chapter-1/'
    );

    expect(getRealImageSource(image, adapter)).toBe(
      'https://manread.xyz/1628/132557/mr_001.jpg'
    );
  });

  it('prepares manhwaread image by assigning resolved source', async () => {
    document.body.innerHTML = `
      <div class="reading-page" id="page-wrapper">
        <img id="page-image" class="reading-image" width="720" height="5000" />
      </div>
    `;

    const pageWrapper = document.getElementById('page-wrapper') as HTMLElement & {
      img?: { src?: string };
    };
    pageWrapper.img = { src: '132557/mr_002.jpg' };

    Object.assign(window, {
      chapterData: {
        base: 'https://manread.xyz/1628',
      },
    });

    const image = document.getElementById('page-image') as HTMLImageElement;
    const adapter = matchSiteAdapter(
      'https://manhwaread.com/manhwa/demo/chapter-1/'
    );

    setTimeout(() => {
      Object.defineProperty(image, 'complete', { configurable: true, value: true });
      Object.defineProperty(image, 'naturalWidth', {
        configurable: true,
        value: 720,
      });
      image.dispatchEvent(new Event('load'));
    }, 0);

    await prepareImageForTranslation(image, adapter);

    expect(image.src).toBe('https://manread.xyz/1628/132557/mr_002.jpg');
    expect(image.crossOrigin).toBe('anonymous');
  });
});
