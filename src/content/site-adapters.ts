export interface SiteAdapter {
  id: string;
  matches: (url: URL) => boolean;
  candidateSelectors: string[];
  ignoredSelectors?: string[];
  realSrcAttributes: string[];
  resolveImageSource?: (image: HTMLImageElement) => string | null;
  prepareImageForTranslation?: (
    image: HTMLImageElement,
    resolvedSrc: string
  ) => Promise<void> | void;
}

const COMMON_REAL_SRC_ATTRIBUTES = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-url',
  'data-cfsrc',
];

const SITE_ADAPTERS: SiteAdapter[] = [
  {
    id: 'mangadex',
    matches: url => url.hostname.includes('mangadex.org'),
    candidateSelectors: [
      'main img',
      '[data-testid="reader-container"] img',
      '.reader--img img',
    ],
    ignoredSelectors: ['header img', 'nav img', 'aside img'],
    realSrcAttributes: [...COMMON_REAL_SRC_ATTRIBUTES],
  },
  {
    id: 'comic-walker',
    matches: url => url.hostname.includes('comic-walker.com'),
    candidateSelectors: [
      '.viewer img',
      '.comicContent img',
      'main img',
    ],
    ignoredSelectors: ['header img', 'footer img'],
    realSrcAttributes: [...COMMON_REAL_SRC_ATTRIBUTES, 'data-image-path'],
  },
  {
    id: 'web-ace',
    matches: url => url.hostname.includes('web-ace.jp'),
    candidateSelectors: ['.comic-page img', '.viewer__page img', 'article img'],
    ignoredSelectors: ['header img', '.share img'],
    realSrcAttributes: [...COMMON_REAL_SRC_ATTRIBUTES, 'data-srcset'],
  },
  {
    id: 'manhwaread',
    matches: url => url.hostname.includes('manhwaread.com'),
    candidateSelectors: ['#reader #imagesList img.reading-image', '#imagesList img'],
    ignoredSelectors: [
      '#readingNavTop img',
      '#readingNavBottom img',
      'header img',
      'footer img',
      'aside img',
      '.manga-item__img-inner img',
    ],
    realSrcAttributes: [...COMMON_REAL_SRC_ATTRIBUTES],
    resolveImageSource: image => getManhwaReadImageSource(image),
    prepareImageForTranslation: async (image, resolvedSrc) => {
      if (image.src === resolvedSrc && image.complete && image.naturalWidth > 0) {
        return;
      }

      if (/^https?:\/\//.test(resolvedSrc)) {
        image.crossOrigin = 'anonymous';
      }

      if (!image.src || image.src.startsWith('blob:') || image.src !== resolvedSrc) {
        image.src = resolvedSrc;
      }

      image.loading = 'eager';
      image.decoding = 'async';

      await waitForImageLoad(image);
    },
  },
];

export function matchSiteAdapter(
  value: string | URL = window.location.href
): SiteAdapter | null {
  const url = typeof value === 'string' ? new URL(value) : value;
  return SITE_ADAPTERS.find(adapter => adapter.matches(url)) ?? null;
}

export function collectSiteCandidateImages(
  adapter: SiteAdapter | null,
  root: ParentNode = document
): HTMLImageElement[] {
  if (!adapter) {
    return [];
  }

  const candidates = new Set<HTMLImageElement>();

  for (const selector of adapter.candidateSelectors) {
    root.querySelectorAll(selector).forEach(node => {
      if (node instanceof HTMLImageElement) {
        candidates.add(node);
      }
    });
  }

  if (adapter.ignoredSelectors) {
    for (const selector of adapter.ignoredSelectors) {
      root.querySelectorAll(selector).forEach(node => {
        if (node instanceof HTMLImageElement) {
          candidates.delete(node);
        }
      });
    }
  }

  return [...candidates];
}

export function getRealImageSource(
  image: HTMLImageElement,
  adapter: SiteAdapter | null = null
): string {
  const resolvedSource = adapter?.resolveImageSource?.(image);
  if (resolvedSource && resolvedSource.trim().length > 0) {
    return resolvedSource;
  }

  const attributes = adapter?.realSrcAttributes ?? COMMON_REAL_SRC_ATTRIBUTES;

  for (const attribute of attributes) {
    const value = image.getAttribute(attribute);
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  return image.currentSrc || image.src;
}

export async function prepareImageForTranslation(
  image: HTMLImageElement,
  adapter: SiteAdapter | null = null
): Promise<void> {
  const resolvedSrc = getRealImageSource(image, adapter);
  if (!resolvedSrc) {
    return;
  }

  if (adapter?.prepareImageForTranslation) {
    await adapter.prepareImageForTranslation(image, resolvedSrc);
    return;
  }

  if (!image.complete || image.naturalWidth === 0) {
    await waitForImageLoad(image);
  }
}

interface ManhwaReadChapterData {
  base?: string;
}

interface ManhwaReadPageElement extends HTMLElement {
  img?: {
    src?: string;
  };
}

function getManhwaReadImageSource(image: HTMLImageElement): string | null {
  const readingPage = image.closest('.reading-page') as ManhwaReadPageElement | null;
  const pageSrc = readingPage?.img?.src;
  const chapterData = (window as Window & {
    chapterData?: ManhwaReadChapterData;
  }).chapterData;
  const base = chapterData?.base;

  if (!pageSrc) {
    return image.currentSrc || image.src || null;
  }

  if (/^https?:\/\//.test(pageSrc)) {
    return pageSrc;
  }

  if (base) {
    return `${base.replace(/\/$/, '')}/${pageSrc.replace(/^\//, '')}`;
  }

  return pageSrc;
}

function waitForImageLoad(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Image load timed out'));
    }, 10000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };

    const handleLoad = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error(`Failed to load image: ${image.currentSrc || image.src}`));
    };

    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
  });
}
