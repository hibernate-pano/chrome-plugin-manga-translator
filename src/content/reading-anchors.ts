/**
 * ReadingAnchors — 图上编号锚点
 *
 * 给每张已翻译的图片加一个右上角的小圆形编号徽章。
 * 用户点击徽章 → 触发 'reading-anchor-click' 自定义事件，
 * content.ts 监听后将对应 entry 滚入阅读面板视口。
 *
 * 实现：原生 DOM + Shadow DOM，类比 ReadingPanel。
 */

interface Anchor {
  badge: HTMLElement;
  image: HTMLImageElement;
  index: number;
}

export class ReadingAnchors {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private anchors: Anchor[] = [];

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-manga-translator-reading-anchors', 'true');

    Object.assign(this.host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      pointerEvents: 'none',
      zIndex: '2147483645',
    });

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
<style>
  :host { all: initial; }
  /* A proof-sheet mark on the artwork: a square of paper with an ink frame
     and a serif numeral. No rounding, no soft shadow — the one depth cue is
     a hard offset, the same as the reading panel's. */
  .badge {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 0;
    background: #E9E9E2;
    color: #161616;
    border: 1px solid #161616;
    font-family: 'Songti SC', 'Noto Serif SC', Georgia, serif;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums lining-nums;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 2px 2px 0 rgba(22, 22, 22, 0.85);
    pointer-events: auto;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s;
    user-select: none;
  }
  /* Hover and press invert to ink, the same rule the panel's controls use. */
  .badge:hover,
  .badge:active {
    background: #161616;
    color: #E9E9E2;
    box-shadow: 2px 2px 0 rgba(22, 22, 22, 0.35);
  }
  /* The badge is 22px of paper on the artwork, but a finger needs 44px.
     The ::after pseudo-element widens the button's hit area without
     painting anything. */
  .badge::after {
    content: '';
    position: absolute;
    inset: -11px;
  }
  .badge:focus-visible {
    /* The content script lives in the host page's DOM, so it cannot read the
       extension's CSS variables — the vermilion has to be spelled out here.
       It is a ring, never text: vermilion on paper is 3.9:1. */
    outline: 2px solid #D33A2C;
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .badge { transition: none; }
  }
</style>
<div id="container"></div>
`;

    document.body.appendChild(this.host);

    // Click delegation: forward to host as CustomEvent so content.ts can listen.
    this.shadow.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('badge')) return;
      const index = Number(target.dataset['index']);
      this.host.dispatchEvent(
        new CustomEvent('reading-anchor-click', {
          bubbles: true,
          composed: true,
          detail: { index },
        })
      );
    });
  }

  upsert(image: HTMLImageElement, index: number): void {
    const existing = this.anchors.find(a => a.image === image);
    if (existing) {
      existing.index = index;
      existing.badge.dataset['index'] = String(index);
      existing.badge.textContent = String(index);
      this.reposition(existing);
      return;
    }

    const container = this.shadow.getElementById('container');
    if (!container) return;

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'badge';
    badge.dataset['index'] = String(index);
    badge.textContent = String(index);
    badge.setAttribute('aria-label', `跳到第 ${index} 张图的译文`);
    container.appendChild(badge);

    const anchor: Anchor = { badge, image, index };
    this.anchors.push(anchor);
    this.reposition(anchor);
  }

  reset(): void {
    this.anchors = [];
    const container = this.shadow.getElementById('container');
    if (container) {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }
  }

  /**
   * Is the anchor host still in the document?
   *
   * A page that replaces its own `document.body` detaches the host without
   * telling us; the badges would then be invisible for the rest of the
   * page's life.
   */
  isAttached(): boolean {
    return this.host.isConnected;
  }

  /**
   * 把徽章编号同步成阅读面板重排后的编号。
   *
   * 编号来自图片在 DOM 中的位置，而阅读面板会在一批翻译结束后统一重排。
   * 锚点必须跟着改，否则图上的"3"会指向面板里的另一张图。
   */
  syncIndices(indices: ReadonlyMap<HTMLImageElement, number>): void {
    this.anchors.forEach(anchor => {
      const index = indices.get(anchor.image);
      if (index === undefined || index === anchor.index) {
        return;
      }
      anchor.index = index;
      anchor.badge.dataset['index'] = String(index);
      anchor.badge.textContent = String(index);
      anchor.badge.setAttribute('aria-label', `跳到第 ${index} 张图的译文`);
    });
  }

  destroy(): void {
    // Drop the image references too: the anchors hold strong references to
    // <img> elements, and a torn-down panel must not keep the page's DOM
    // alive.
    this.anchors = [];
    this.host.remove();
  }

  /**
   * Reposition all anchors. Called on scroll/resize to keep badges anchored
   * to their images. content.ts should invoke this on the relevant events.
   */
  repositionAll(): void {
    this.anchors.forEach(anchor => this.reposition(anchor));
  }

  private reposition(anchor: Anchor): void {
    const rect = anchor.image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // Image is hidden or detached — hide badge
      anchor.badge.style.display = 'none';
      return;
    }

    // A manga page is usually taller than the screen, so a badge pinned to
    // the image's top corner scrolled out of view as soon as the reader
    // moved down the page. The badge is held at the top of the viewport
    // while the image is being read, and it follows the image again once
    // the image itself is back in view.
    const margin = 12;
    if (rect.bottom < margin) {
      // The image has been scrolled past. The badge goes with it, instead of
      // sticking to the top of the screen pointing at nothing.
      anchor.badge.style.display = 'none';
      return;
    }

    anchor.badge.style.display = 'flex';
    // The left edge, not the right: the reading panel is docked on the
    // right and covers that corner of the image, so a badge there was
    // hidden behind the panel and could not be clicked at all.
    const cx = rect.left + margin;
    const cy = Math.max(rect.top + margin, margin);
    anchor.badge.style.left = `${cx}px`;
    anchor.badge.style.top = `${cy}px`;
  }

  /**
   * Drop the badge for one image.
   *
   * The user can remove a translation from the image itself. The badge is
   * another view of the same translations, so it has to go with it —
   * otherwise the badge still claims the image was translated.
   */
  remove(image: HTMLImageElement): void {
    const index = this.anchors.findIndex(anchor => anchor.image === image);
    if (index === -1) {
      return;
    }
    const [anchor] = this.anchors.splice(index, 1);
    anchor?.badge.remove();
  }
}
