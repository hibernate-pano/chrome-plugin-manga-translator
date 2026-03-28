export interface ChapterBootstrapPage {
  src: string;
  width: number;
  height: number;
  index: number;
}

export interface ChapterBootstrap {
  chapterId: string;
  baseUrl: string;
  pages: ChapterBootstrapPage[];
}

export interface RenderablePage {
  image: HTMLImageElement;
  canonicalUrl: string;
  index: number;
  key: string;
}

export interface SiteAdapter {
  id: 'manhwaread';
  matchesChapter: (url: URL) => boolean;
  getChapterBootstrap: (
    target: Window & typeof globalThis
  ) => ChapterBootstrap | null;
  listRenderablePages: (
    root: ParentNode,
    bootstrap: ChapterBootstrap
  ) => RenderablePage[];
  resolveCanonicalImage: (
    pageNode: HTMLImageElement,
    bootstrap: ChapterBootstrap
  ) => string | null;
  prepareImage: (
    pageNode: HTMLImageElement,
    canonicalUrl: string
  ) => Promise<void>;
}

interface ManhwaReadChapterData {
  data?: string;
  base?: string;
}

interface ManhwaReadWindow extends Window {
  chapterData?: ManhwaReadChapterData;
}

interface ChapterPageRecord {
  src?: string;
  w?: number;
  h?: number;
}

const MANHWAREAD_CHAPTER_PATTERN =
  /^\/manhwa\/[^/]+\/chapter-[^/]+\/?$/;

function decodeChapterPages(encoded: string): ChapterPageRecord[] {
  try {
    const bufferCtor = (
      globalThis as {
        Buffer?: {
          from: (
            data: string,
            encoding: string
          ) => { toString: (targetEncoding: string) => string };
        };
      }
    ).Buffer;

    const json = bufferCtor
      ? bufferCtor.from(encoded, 'base64').toString('utf8')
      : atob(encoded);
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as ChapterPageRecord[]) : [];
  } catch {
    return [];
  }
}

function createCanonicalUrl(baseUrl: string, src: string): string {
  if (/^https?:\/\//.test(src)) {
    return src;
  }

  return `${baseUrl.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
}

function getChapterId(url: URL): string {
  return url.pathname.replace(/\/$/, '');
}

function getReaderImages(root: ParentNode): HTMLImageElement[] {
  const container = root.querySelector('#reader #imagesList');
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLImageElement>(
      '.reading-page img, img.reading-image, img'
    )
  ).filter(image => !image.closest('#readingNavTop, #readingNavBottom'));
}

async function waitForImageLoad(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('章节图片加载超时'));
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
      reject(new Error('章节图片加载失败'));
    };

    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
  });
}

const MANHWAREAD_ADAPTER: SiteAdapter = {
  id: 'manhwaread',
  matchesChapter: url =>
    url.hostname === 'manhwaread.com' &&
    MANHWAREAD_CHAPTER_PATTERN.test(url.pathname),
  getChapterBootstrap: target => {
    const chapterData = (target as ManhwaReadWindow).chapterData;

    if (!chapterData?.data || !chapterData.base) {
      return null;
    }

    const pages = decodeChapterPages(chapterData.data)
      .filter(page => typeof page.src === 'string' && page.src.length > 0)
      .map((page, index) => ({
        src: createCanonicalUrl(chapterData.base as string, page.src as string),
        width: typeof page.w === 'number' ? page.w : 0,
        height: typeof page.h === 'number' ? page.h : 0,
        index,
      }));

    if (pages.length === 0) {
      return null;
    }

    return {
      chapterId: getChapterId(new URL(target.location.href)),
      baseUrl: chapterData.base,
      pages,
    };
  },
  listRenderablePages: (root, bootstrap) => {
    const images = getReaderImages(root);

    return images
      .slice(0, bootstrap.pages.length)
      .map((image, index) => {
        const page = bootstrap.pages[index];
        return page
          ? {
              image,
              canonicalUrl: page.src,
              index: page.index,
              key: `${bootstrap.chapterId}::${page.index}`,
            }
          : null;
      })
      .filter((page): page is RenderablePage => page !== null);
  },
  resolveCanonicalImage: (pageNode, bootstrap) => {
    const images = getReaderImages(document);
    const index = images.findIndex(image => image === pageNode);

    if (index === -1) {
      return null;
    }

    return bootstrap.pages[index]?.src ?? null;
  },
  prepareImage: async (pageNode, canonicalUrl) => {
    if (/^https?:\/\//.test(canonicalUrl)) {
      pageNode.crossOrigin = 'anonymous';
    }

    if (!pageNode.src || pageNode.src !== canonicalUrl) {
      pageNode.src = canonicalUrl;
    }

    pageNode.loading = 'eager';
    pageNode.decoding = 'async';

    await waitForImageLoad(pageNode);
  },
};

export function matchSiteAdapter(
  value: string | URL = window.location.href
): SiteAdapter | null {
  const url = typeof value === 'string' ? new URL(value) : value;
  return MANHWAREAD_ADAPTER.matchesChapter(url)
    ? MANHWAREAD_ADAPTER
    : null;
}

export function collectSiteCandidateImages(
  adapter: SiteAdapter | null,
  root: ParentNode = document
): HTMLImageElement[] {
  if (!adapter) {
    return [];
  }

  const bootstrap = adapter.getChapterBootstrap(window);
  if (!bootstrap) {
    return [];
  }

  return adapter.listRenderablePages(root, bootstrap).map(page => page.image);
}

export function getRealImageSource(
  image: HTMLImageElement,
  adapter: SiteAdapter | null = null
): string {
  if (!adapter) {
    return image.currentSrc || image.src;
  }

  const bootstrap = adapter.getChapterBootstrap(window);
  if (!bootstrap) {
    return image.currentSrc || image.src;
  }

  return (
    adapter.resolveCanonicalImage(image, bootstrap) ||
    image.currentSrc ||
    image.src
  );
}

export async function prepareImageForTranslation(
  image: HTMLImageElement,
  adapter: SiteAdapter | null = null
): Promise<void> {
  if (!adapter) {
    await waitForImageLoad(image);
    return;
  }

  const bootstrap = adapter.getChapterBootstrap(window);
  if (!bootstrap) {
    throw new Error('未检测到章节数据');
  }

  const canonicalUrl = adapter.resolveCanonicalImage(image, bootstrap);
  if (!canonicalUrl) {
    throw new Error('未找到章节图片地址');
  }

  await adapter.prepareImage(image, canonicalUrl);
}

export async function waitForRenderablePages(
  adapter: SiteAdapter,
  timeoutMs: number = 10000
): Promise<RenderablePage[]> {
  const initialBootstrap = adapter.getChapterBootstrap(window);
  if (!initialBootstrap) {
    throw new Error('未检测到章节数据');
  }

  const existingPages = adapter.listRenderablePages(document, initialBootstrap);
  if (existingPages.length > 0) {
    return existingPages;
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error('章节图片未在预期时间内出现'));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const bootstrap = adapter.getChapterBootstrap(window);
      if (!bootstrap) {
        return;
      }

      const pages = adapter.listRenderablePages(document, bootstrap);
      if (pages.length > 0) {
        window.clearTimeout(timeoutId);
        observer.disconnect();
        resolve(pages);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}
