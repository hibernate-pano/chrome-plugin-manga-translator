import { describe, expect, it } from 'vitest';

import { isTranslatableImage } from './image-filter';

interface ImageOverrides {
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
  complete?: boolean;
  className?: string;
  id?: string;
  currentSrc?: string;
  src?: string;
  attributes?: Record<string, string>;
  /** What `closest(selector)` answers with, per exact selector. */
  closest?: Record<string, Element | null>;
  parentElement?: Element | null;
}

function createImage(overrides: ImageOverrides = {}): HTMLImageElement {
  const attributes = overrides.attributes ?? {};
  const closestMap = overrides.closest ?? {};
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
    getAttribute: (name: string) => attributes[name] ?? null,
    src: 'https://cdn.example.com/page-1.webp',
    parentElement: null,
  } as unknown as HTMLImageElement;

  // `closest` is a lookup table in the overrides rather than a function, so
  // it is installed after the assignment.
  const { closest: _closest, ...rest } = overrides;
  const merged = Object.assign(image, rest) as HTMLImageElement;
  merged.closest = (selector: string) => closestMap[selector] ?? null;
  return merged;
}

/**
 * An image whose bytes have not arrived: no intrinsic size, no layout size.
 *
 * This is the case the pending count is made of.
 */
function createUnloadedImage(overrides: ImageOverrides = {}): HTMLImageElement {
  return createImage({
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    width: 0,
    height: 0,
    ...overrides,
  });
}

/**
 * An element that reports a box, for the "is it in a small box" judgement.
 */
function createBox(
  className: string,
  rect: { width: number; height: number }
): Element {
  return {
    className,
    id: '',
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: rect.width,
      bottom: rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }),
  } as unknown as Element;
}

const PENDING_OPTIONS = {
  allowIncomplete: true,
  allowUnknownSize: true,
} as const;

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
    expect(isTranslatableImage(createImage({ currentSrc: '', src: '' }))).toBe(
      false
    );
  });

  it('rejects incomplete images unless allowed', () => {
    expect(isTranslatableImage(createImage({ complete: false }))).toBe(false);
    expect(
      isTranslatableImage(createImage({ complete: false }), {
        allowIncomplete: true,
      })
    ).toBe(true);
  });

  it('cannot judge the size of an image whose bytes have not arrived', () => {
    // 字节没到的时候 naturalWidth 是 0，尺寸这一关没法判——它可能是一整
    // 页漫画。允许"尺寸未知"时它要算候选，否则懒加载的一章会被报成
    // "没有可翻译的图片"。
    const loading = createUnloadedImage();
    expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    // 尺寸已知但不达标时，这条豁免不生效。
    expect(
      isTranslatableImage(
        createImage({
          complete: false,
          naturalWidth: 100,
          naturalHeight: 100,
          width: 100,
          height: 100,
        }),
        PENDING_OPTIONS
      )
    ).toBe(false);
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
    const wrapped = createImage({
      closest: { '.manga-translator-wrapper': {} as Element },
    });
    expect(isTranslatableImage(wrapped)).toBe(false);
  });

  it('honours a custom allowImage predicate', () => {
    const image = createImage();
    expect(isTranslatableImage(image, { allowImage: () => false })).toBe(false);
    expect(isTranslatableImage(image, { allowImage: () => true })).toBe(true);
  });

  describe('a page that has not loaded yet', () => {
    // 这一节测的是"pending"这个数字。
    //
    // 弹窗告诉用户「另有 N 张还在加载，会一并翻译」，而这 N 张是会被送去
    // 模型的——用户按这个数字付钱。以前只要字节没到就算数，一个图标满天
    // 飞的页面上，这个数字被系统性地高估了：真正到账的是一张追踪像素，
    // 用户却被告知有一整页漫画要翻译。
    it('still counts a plausible comic page as pending', () => {
      const loading = createUnloadedImage({
        currentSrc: 'https://cdn.example.com/manga/chapter-12/page-03.webp',
        src: 'https://cdn.example.com/manga/chapter-12/page-03.webp',
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    });

    it('still counts a plain comic URL with no context as pending', () => {
      // 没有 URL 线索、没有包裹元素——这正是这个计数当初要覆盖的场景。
      // 猜成"不是漫画"会重新造成少报，那比多报更难发现。
      const loading = createUnloadedImage({
        currentSrc: 'https://cdn.example.com/a.webp',
        src: 'https://cdn.example.com/a.webp',
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    });

    it('does not count an unloaded icon as pending', () => {
      // 文件名自己说了它是什么。
      const loading = createUnloadedImage({
        currentSrc: 'https://cdn.example.com/assets/icon-star.png',
        src: 'https://cdn.example.com/assets/icon-star.png',
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(false);
    });

    it('does not count an unloaded inline image as pending', () => {
      const loading = createUnloadedImage({
        currentSrc: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(false);
    });

    it('does not count an unloaded asset whose URL names a small size', () => {
      const byPath = createUnloadedImage({
        currentSrc: 'https://cdn.example.com/16x16/close.png',
        src: 'https://cdn.example.com/16x16/close.png',
      });
      expect(isTranslatableImage(byPath, PENDING_OPTIONS)).toBe(false);

      const byQuery = createUnloadedImage({
        currentSrc: 'https://cdn.example.com/render?sprite&w=32&h=32',
        src: 'https://cdn.example.com/render?sprite&w=32&h=32',
      });
      expect(isTranslatableImage(byQuery, PENDING_OPTIONS)).toBe(false);
    });

    it('does not count an unloaded icon whose wrapper names it', () => {
      // 图标自己不带 class，word 在外面的 span 上。
      const loading = createUnloadedImage({
        parentElement: createBox('icon-button', { width: 32, height: 32 }),
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(false);
    });

    it('does not count an unloaded icon that sits in a link', () => {
      const loading = createUnloadedImage({
        closest: {
          'a, button, [role="button"]': createBox('link', {
            width: 24,
            height: 24,
          }),
        },
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(false);
    });

    it('does not count an unloaded image in a box too small for a page', () => {
      const loading = createUnloadedImage({
        parentElement: createBox('thumb', { width: 120, height: 90 }),
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(false);
    });

    it('counts an unloaded image whose URL only the lazy loader knows', () => {
      // 懒加载的站点把真正的地址放在 data-src 上，src 还是占位图。
      // 只看 src 会把这张漫画页误判成图标。
      const loading = createUnloadedImage({
        currentSrc: '',
        src: 'https://cdn.example.com/placeholder.png',
        attributes: {
          'data-src': 'https://cdn.example.com/manga/chapter-4/page-07.jpg',
        },
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    });

    it('counts a page thumbnail that links to a page', () => {
      // 缩略图本身不是要翻的那一页，但它指向那一页——用户点开就会付钱。
      const anchor = {
        className: '',
        id: '',
        getAttribute: (name: string) =>
          name === 'href' ? '/reader/chapter-12' : null,
      } as unknown as Element;
      const loading = createUnloadedImage({
        currentSrc: 'https://cdn.example.com/thumbs/chapter-12.jpg',
        src: 'https://cdn.example.com/thumbs/chapter-12.jpg',
        closest: { 'a, button, [role="button"]': anchor },
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    });

    it('counts a page that a reader wraps in a link', () => {
      // 阅读器常常把整页漫画包在一个 <a> 里。链接本身不说明什么，
      // 盒子有多大才说明——一个整页宽的容器装得下一页漫画。
      const anchor = createBox('page-link', { width: 800, height: 1200 });
      (anchor as unknown as { getAttribute: () => null }).getAttribute = () =>
        null;
      const loading = createUnloadedImage({
        currentSrc: 'https://cdn.example.com/img/a.webp',
        src: 'https://cdn.example.com/img/a.webp',
        closest: { 'a, button, [role="button"]': anchor },
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    });

    it('counts a page the reader sizes with CSS', () => {
      // `<img style="width:100%">`：字节没到，所以没有固有尺寸，高度只能
      // 是 0（没有宽高比就没有高度）；但布局宽度是知道的——容器有多宽，
      // 这一页就摆多宽。
      //
      // 以前这一项被当成"太小"：尺寸规则要求宽和高都不小于 200，高度 0
      // 于是把整章的漫画页全部挡掉。pending 永远是 0，弹窗告诉用户
      // 「已跳过 37 张（太小）」，而这 37 张是这一章的全部内容。
      const loading = createUnloadedImage({
        width: 800,
        height: 0,
        currentSrc: 'https://cdn.example.com/img/a.webp',
        src: 'https://cdn.example.com/img/a.webp',
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    });

    it('counts a CSS-sized page even when the reader wraps it in a link', () => {
      // 图片自己的布局宽度已经说明了它是一页漫画；外面那个链接有多窄
      // 反而说明不了——链接是行内元素，尺寸常常还没算出来。
      const anchor = createBox('page-link', { width: 0, height: 0 });
      (anchor as unknown as { getAttribute: () => null }).getAttribute = () =>
        null;
      const loading = createUnloadedImage({
        width: 800,
        height: 0,
        currentSrc: 'https://cdn.example.com/img/a.webp',
        src: 'https://cdn.example.com/img/a.webp',
        closest: { 'a, button, [role="button"]': anchor },
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(true);
    });

    it('does not count an icon that is laid out small', () => {
      // 反过来：布局宽度已知而且很小，就是图标，不该算成"还会翻译的一页"。
      const loading = createUnloadedImage({
        width: 24,
        height: 24,
        currentSrc: 'https://cdn.example.com/img/a.webp',
        src: 'https://cdn.example.com/img/a.webp',
      });
      expect(isTranslatableImage(loading, PENDING_OPTIONS)).toBe(false);
    });
  });
});
