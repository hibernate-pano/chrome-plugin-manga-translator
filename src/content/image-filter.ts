/**
 * The smallest a comic page can be.
 *
 * A manga page is a full-page image; anything smaller is chrome.
 */
const MIN_PAGE_SIZE = 200;

/** A near-square image below this size is an icon, not a page. */
const ICON_MAX_SIZE = 400;

/** The largest dimension a URL may name and still be an icon-sized asset. */
const SMALL_ASSET_MAX_SIZE = 128;

/**
 * Class and id words that mark an image as page furniture.
 *
 * They used to be checked on the image alone. An icon, though, usually sits
 * inside a wrapper that carries the word — `<span class="icon-button">` — so
 * the same words are also looked for on the ancestors of an image whose
 * size is unknown.
 */
const UI_KEYWORD_PATTERNS = [
  /\bavatar\b/,
  /\blogo\b/,
  /\bicon\b/,
  /\bbanner\b/,
  /\bads?\b/,
  /\badvert/,
  /\bemoji\b/,
];

/**
 * The words a UI asset's own file name uses.
 *
 * An unloaded image has no size, so the "at least 200×200" rule cannot judge
 * it — and the judgement it *does* get is the one the user is billed on. The
 * popup tells the user 「另有 N 张还在加载，会一并翻译」, and those images are
 * sent to the model. On an icon-heavy page every one of those icons was
 * counted, so the number the user was shown was systematically too high and
 * the promise was one the extension would not keep.
 *
 * The file name is the cheapest honest evidence: an icon file says so.
 */
const UI_ASSET_URL_PATTERNS = [
  /\bicons?\b/,
  /\blogos?\b/,
  /\bavatars?\b/,
  /\bsprites?\b/,
  /\bspacers?\b/,
  /\bpixels?\b/,
  /\btrackers?\b/,
  /\bbeacons?\b/,
  /\banalytics\b/,
  /\bbadges?\b/,
  /\bplaceholders?\b/,
  /\bspinners?\b/,
  /\bskeletons?\b/,
  /\bblanks?\b/,
  /\bfavicons?\b/,
  /\bbuttons?\b/,
  /\bsocial\b/,
  /\bloading\b/,
  /\.svg$/i,
];

/**
 * The words a comic page's own address uses.
 *
 * A reader that serves pages from `/chapter-12/page-03.jpg` has said what
 * the file is. It is the one piece of evidence that can rescue an image the
 * surroundings would otherwise call chrome: a thumbnail inside a link is
 * still the page the user is going to be charged for.
 */
const PAGE_URL_PATTERNS = [
  /\bpage[-_]?\d+/i,
  /\bpages?[-_/]/i,
  /\bchapter[-_/]?\d+/i,
  /\bchap(?:ter)?[-_/]?\d+/i,
  /\bch\d+/i,
  /\bmanga\b/i,
  /\bcomic\b/i,
  /\bwebtoon\b/i,
  /\bscans?[-_]?\d+/i,
  /\bspread[-_]?\d+/i,
  /\bissue[-_]?\d+/i,
  /\bvol(?:ume)?[-_]?\d+/i,
  /\breader\b/i,
  /\bread[-_/]?\d+/i,
];

/**
 * The query parameters a reader addresses a page with.
 *
 * `?page=3` is as common as `/page-3`, and the query is part of the address
 * the browser was given.
 */
const PAGE_QUERY_PATTERNS = [/[?&](?:page|chapter|ch|issue|vol|scroll)=\d+/i];

/** A `16x16` style size token in the path. */
const PATH_SIZE_PATTERN = /(?<!\d)(\d{1,4})x(\d{1,4})(?!\d)/;

/** A `?w=32` style size hint in the query string. */
const QUERY_SIZE_PATTERN = /\b(?:w|width|h|height)=(\d{1,4})\b/i;

interface ImageFilterOptions {
  debug?: boolean;
  allowIncomplete?: boolean;
  /**
   * Judge an image whose bytes have not arrived yet.
   *
   * Such an image has no intrinsic size, so the "at least 200×200" rule
   * cannot be applied to it — it may well be a full comic page that is
   * simply still loading. This option lets the caller ask "would this be a
   * candidate if it had loaded?", which is what the page scanner needs to
   * tell the user how many images are still on their way.
   */
  allowUnknownSize?: boolean;
  allowImage?: (img: HTMLImageElement) => boolean;
}

/**
 * The part of a URL that describes the file.
 *
 * The host is dropped: a CDN can be named after anything (`cdn.logo-cdn.com`)
 * and the host says nothing about the file it serves. The scheme is only
 * recognised when it is followed by `//`, so a relative path like
 * `chapter/12` keeps its first segment instead of losing it to a host that
 * was never there.
 */
function filePath(url: string): string {
  const withoutFragment = url.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(withoutQuery);
  if (!scheme) {
    return withoutQuery;
  }
  const rest = withoutQuery.slice(scheme[0].length);
  const slash = rest.indexOf('/');
  return slash === -1 ? '' : rest.slice(slash);
}

/**
 * Does the URL name a size small enough to be an icon?
 *
 * Both the path (`/16x16/icon.png`) and the query (`?w=32`) are read, because
 * image CDNs put the size in either place.
 */
function namesSmallAsset(url: string): boolean {
  const pathMatch = PATH_SIZE_PATTERN.exec(url);
  if (pathMatch) {
    const width = Number(pathMatch[1]);
    const height = Number(pathMatch[2]);
    if (
      width > 0 &&
      height > 0 &&
      width <= SMALL_ASSET_MAX_SIZE &&
      height <= SMALL_ASSET_MAX_SIZE
    ) {
      return true;
    }
  }

  const queryMatch = QUERY_SIZE_PATTERN.exec(url);
  if (queryMatch) {
    const size = Number(queryMatch[1]);
    if (size > 0 && size <= SMALL_ASSET_MAX_SIZE) {
      return true;
    }
  }

  return false;
}

/**
 * Is this URL pointing at page furniture rather than at a comic page?
 */
function isUiAssetUrl(url: string): boolean {
  const value = url.trim();
  if (!value) {
    return false;
  }
  // An inline image is a logo, an avatar or a spacer. A comic page is never
  // a data URI — a page is too big to inline, and a reader that inlines one
  // keeps the real URL in a data attribute.
  if (/^data:/i.test(value)) {
    return true;
  }
  const path = filePath(value);
  if (UI_ASSET_URL_PATTERNS.some(pattern => pattern.test(path))) {
    return true;
  }
  return namesSmallAsset(value);
}

/**
 * Does this address point at a comic page?
 */
function isPageLikeUrl(url: string): boolean {
  const value = url.trim();
  if (!value) {
    return false;
  }
  if (PAGE_URL_PATTERNS.some(pattern => pattern.test(filePath(value)))) {
    return true;
  }
  return PAGE_QUERY_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Every URL that could carry this image's bytes.
 *
 * `currentSrc` is what the browser actually picked, which matters for a page
 * that sets `srcset` and lets the browser choose a candidate. The data
 * attributes are what lazy loaders keep the real URL in while `src` still
 * holds a placeholder.
 */
function collectImageSources(img: HTMLImageElement): string[] {
  const sources: string[] = [];
  const push = (value: string | null | undefined): void => {
    if (typeof value === 'string' && value.trim()) {
      sources.push(value.trim());
    }
  };

  push(img.currentSrc);
  push(img.src);
  for (const attribute of [
    'data-src',
    'data-original',
    'data-lazy-src',
    'data-echo',
  ]) {
    push(img.getAttribute?.(attribute));
  }

  return sources;
}

function closestElement(
  img: HTMLImageElement,
  selector: string
): Element | null {
  if (typeof img.closest !== 'function') {
    return null;
  }
  return img.closest(selector);
}

function elementClassAndId(element: Element): string {
  const className =
    typeof element.className === 'string' ? element.className : '';
  const id = typeof element.id === 'string' ? element.id : '';
  return `${className} ${id}`.toLowerCase();
}

/**
 * Does an ancestor look like the wrapper an icon lives in?
 *
 * The image's own class and id are checked elsewhere; this is the wrapper
 * around it, which is where the word usually is.
 */
function hasUiAncestor(img: HTMLImageElement): boolean {
  let node = img.parentElement;
  for (let depth = 0; node && depth < 3; depth += 1) {
    const classAndId = elementClassAndId(node);
    if (UI_KEYWORD_PATTERNS.some(pattern => pattern.test(classAndId))) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * The box the image sits in.
 *
 * For an image that has not loaded, this is often the only size signal left:
 * a fixed-size icon wrapper keeps its size whether or not the image in it is
 * there yet.
 */
interface HostBox {
  /** The link or button wrapping the image, if any. */
  link: Element | null;
  /** The measured width, or 0 when the box has no size yet. */
  width: number;
  /** The measured height, or 0 when the box has no size yet. */
  height: number;
}

function readHostBox(img: HTMLImageElement): HostBox {
  const link = closestElement(img, 'a, button, [role="button"]');
  const element = link ?? img.parentElement;
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return { link, width: 0, height: 0 };
  }
  const rect = element.getBoundingClientRect();
  return {
    link,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
  };
}

/**
 * Could this image, whose bytes have not arrived yet, be a comic page?
 *
 * The size rule cannot judge an image that has not loaded, and the answer it
 * gives decides money: the popup counts these images as 「还在加载，会一并
 * 翻译」 and the auto-continue observer acts on them. So the judgement has to
 * come from somewhere else.
 *
 * The evidence, strongest first:
 *   1. every address the image could come from is page furniture → not a page;
 *   2. a box too small to hold a page → not a page. Geometry beats naming:
 *      a thumbnail called "chapter-12" will fail the size rule the moment
 *      the bytes arrive, so its name does not make it a page;
 *   3. an address that names a page → a page;
 *   4. a link that points at a page → a page;
 *   5. a wrapper named after an icon → not a page;
 *   6. a link or button that is not page-wide, around an image that is not
 *      page-wide either → not a page. An icon button is exactly this shape:
 *      a small clickable box whose image has not arrived yet.
 *
 * An image with no evidence either way stays a page: that is the case the
 * count was built for, and guessing "not a page" would under-report the
 * number of pages in a chapter — the failure this whole path once had.
 */
function isPlausibleComicPage(img: HTMLImageElement): boolean {
  const sources = collectImageSources(img);
  if (sources.length === 0) {
    return false;
  }

  if (sources.every(isUiAssetUrl)) {
    return false;
  }

  const box = readHostBox(img);

  // The image's own layout width is the most direct evidence there is: it is
  // what the page actually renders. A reader that lays its pages out at
  // `width: 100%` has already decided these are pages, and the box around
  // them (a link, a wrapper) says much less about it.
  const ownWidth = img.width;

  // A box smaller than a page cannot hold a page. Both dimensions have to
  // be known and small: a wide but flat box is a page that has not been
  // given its height yet, and a box that reports nothing says nothing.
  if (
    box.width > 0 &&
    box.height > 0 &&
    box.width < MIN_PAGE_SIZE &&
    box.height < MIN_PAGE_SIZE
  ) {
    return false;
  }

  // A reader that serves pages from `/chapter-12/page-03.jpg` has said what
  // the file is, and a lazy loader's real address counts as much as `src`.
  if (sources.some(isPageLikeUrl)) {
    return true;
  }

  // A link that points at a page is a thumbnail of a page, and the page is
  // what the user is going to be charged for.
  const href = box.link?.getAttribute?.('href');
  if (typeof href === 'string' && isPageLikeUrl(href)) {
    return true;
  }

  if (hasUiAncestor(img)) {
    return false;
  }

  // The image sits in a link or a button. A wide container holds a page —
  // readers wrap the page itself in a link all the time — but a narrow one,
  // or one whose size is not known yet, is an icon button. The image's own
  // width settles it: a page-sized image is not an icon button, however
  // narrow the link around it looks.
  if (box.link && box.width < MIN_PAGE_SIZE && ownWidth < MIN_PAGE_SIZE) {
    return false;
  }

  return true;
}

export function isTranslatableImage(
  img: HTMLImageElement,
  options: ImageFilterOptions = {}
): boolean {
  const {
    debug: _debug = false,
    allowIncomplete = false,
    allowUnknownSize = false,
    allowImage,
  } = options;

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  // The size is unknown when the *intrinsic* size is unknown: the bytes have
  // not arrived, so the browser has no width or height of its own for this
  // image. The layout size may still be known — a reader that gives its
  // pages `width: 100%` lays them out at the container's width while the
  // height is still 0, because there is no aspect ratio to go by yet.
  const sizeUnknown = allowUnknownSize && img.naturalWidth === 0;

  if (sizeUnknown) {
    // Only the dimensions that are actually known can be judged. A dimension
    // of 0 means "not known yet", not "too small": reading it as "too small"
    // is what made a whole chapter of CSS-sized pages invisible. The scanner
    // skipped them, the pending count stayed at 0, and the user was told
    // those pages would never be translated.
    if (width > 0 && width < MIN_PAGE_SIZE) return false;
    if (height > 0 && height < MIN_PAGE_SIZE) return false;
  } else if (width < MIN_PAGE_SIZE || height < MIN_PAGE_SIZE) {
    return false;
  }

  // The size rule could not judge this one, so it is judged by what the
  // image looks like instead. Without this an icon that has not loaded yet
  // is counted as a comic page on its way, and the user is told it will be
  // translated and billed.
  if (sizeUnknown && !isPlausibleComicPage(img)) {
    return false;
  }

  // `currentSrc` is what the browser actually picked, which matters for a
  // page that sets `srcset` and lets the browser choose a candidate.
  const realSrc = img.currentSrc || img.src;
  if (!realSrc) {
    return false;
  }

  if (!allowIncomplete && !img.complete) {
    return false;
  }

  if (img.closest('header, nav, footer, aside')) {
    return false;
  }

  const classAndId = elementClassAndId(img);
  for (const pattern of UI_KEYWORD_PATTERNS) {
    if (pattern.test(classAndId)) {
      return false;
    }
  }

  const aspectRatio = width / height;
  if (
    aspectRatio > 0.9 &&
    aspectRatio < 1.1 &&
    width < ICON_MAX_SIZE &&
    height < ICON_MAX_SIZE
  ) {
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
