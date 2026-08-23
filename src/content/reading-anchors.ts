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
  .badge {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: #22d3ee;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    pointer-events: auto;
    cursor: pointer;
    border: 2px solid rgba(255, 255, 255, 0.9);
    transition: transform 0.15s, background 0.15s;
    user-select: none;
  }
  .badge:hover {
    transform: translate(-50%, -50%) scale(1.15);
    background: #67e8f9;
  }
  .badge:focus-visible {
    outline: 2px solid #facc15;
    outline-offset: 2px;
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

  destroy(): void {
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
    anchor.badge.style.display = 'flex';
    const cx = rect.left + rect.width - 12;
    const cy = rect.top + 12;
    anchor.badge.style.left = `${cx}px`;
    anchor.badge.style.top = `${cy}px`;
  }
}
