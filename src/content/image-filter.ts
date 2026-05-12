import { getRealImageSource, type SiteAdapter } from './site-adapters';

export interface ImageFilterOptions {
  debug?: boolean;
  allowIncomplete?: boolean;
  siteAdapter?: SiteAdapter | null;
  allowImage?: (img: HTMLImageElement) => boolean;
}

export function isTranslatableImage(
  img: HTMLImageElement,
  options: ImageFilterOptions = {}
): boolean {
  const {
    debug: _debug = false,
    allowIncomplete = false,
    siteAdapter = null,
    allowImage,
  } = options;

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  if (width < 200 || height < 200) {
    return false;
  }

  const realSrc = getRealImageSource(img, siteAdapter);
  if (!realSrc) {
    return false;
  }

  if (!allowIncomplete && !img.complete) {
    return false;
  }

  if (img.closest('header, nav, footer, aside')) {
    return false;
  }

  const classAndId = `${img.className} ${img.id}`.toLowerCase();
  const uiKeywordPatterns = [
    /\bavatar\b/,
    /\blogo\b/,
    /\bicon\b/,
    /\bbanner\b/,
    /\bads?\b/,
    /\badvert/,
    /\bemoji\b/,
  ];
  for (const pattern of uiKeywordPatterns) {
    if (pattern.test(classAndId)) {
      return false;
    }
  }

  const aspectRatio = width / height;
  if (aspectRatio > 0.9 && aspectRatio < 1.1 && width < 400 && height < 400) {
    return false;
  }

  if (img.classList.contains('manga-translator-processed')) {
    return false;
  }

  if (img.closest('.manga-translator-wrapper')) {
    return false;
  }

  if (allowImage && !allowImage(img)) {
    return false;
  }

  return true;
}
