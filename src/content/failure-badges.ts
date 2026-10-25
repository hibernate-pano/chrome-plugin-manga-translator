/**
 * FailureBadges — 失败的图上打一个标记
 *
 * 一张图翻译失败时，页面上没有任何痕迹：译文没有覆盖上去，图看起来和
 * 翻译之前一模一样。读者唯一能看到的，是整轮跑完之后右下角那张卡片上的
 * 一个数字——「失败 3 张」——而**是哪三张**，卡片从来不说。
 *
 * 这个模块把那张图指出来：一个红色的小圆点，画在图的左上角。
 *
 * 为什么在左上角：阅读面板固定在右边，而且够高，会一直伸到屏幕底部。
 * 右上角会被面板压住。编号锚点（`reading-anchors.ts`）早就踩过这个坑，
 * 这里跟着它。
 *
 * 为什么它不点：这一轮角标只负责"是哪一张"。原因写在 HUD 的卡片上，
 * 按张列出来。把"点一下就重试这一张"也做进来，意味着角标变成一个会花钱
 * 的按钮——它得先问一次，而卡片上已经有「重新翻译失败的 N 张」这个入口了。
 */

interface FailureBadge {
  badge: HTMLElement;
  image: HTMLImageElement;
  reason: string;
}

export class FailureBadges {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private badges: FailureBadge[] = [];

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-manga-translator-failure-badges', 'true');

    Object.assign(this.host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
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
    /*
     * 红色，而不是产品的青色。
     *
     * 青色在这个扩展里表示"这里有译文"（覆盖层、编号锚点、阅读面板的编号
     * 徽章）。失败是另一件事，得一眼能分开——读者扫一眼页面就知道哪张坏了，
     * 不需要读文字。
     */
    background: #dc2626;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    border: 2px solid rgba(255, 255, 255, 0.9);
    user-select: none;
  }
</style>
<div id="container"></div>
`;

    document.body.appendChild(this.host);
  }

  /**
   * Mark one image as failed.
   *
   * Marking the same image twice replaces the reason: the second failure is
   * the one the reader needs to see.
   */
  mark(image: HTMLImageElement, reason: string): void {
    const existing = this.badges.find(b => b.image === image);
    if (existing) {
      existing.reason = reason;
      existing.badge.setAttribute('aria-label', this.describe(reason));
      existing.badge.setAttribute('title', reason);
      this.reposition(existing);
      return;
    }

    const container = this.shadow.getElementById('container');
    if (!container) {
      return;
    }

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '!';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', this.describe(reason));
    badge.setAttribute('title', reason);
    container.appendChild(badge);

    const entry: FailureBadge = { badge, image, reason };
    this.badges.push(entry);
    this.reposition(entry);
  }

  /**
   * Drop the mark for one image.
   *
   * The image was translated on a retry: a badge that outlived its failure
   * would claim a translated page still has a broken page on it.
   */
  clear(image: HTMLImageElement): void {
    const index = this.badges.findIndex(b => b.image === image);
    if (index === -1) {
      return;
    }
    const [entry] = this.badges.splice(index, 1);
    entry?.badge.remove();
  }

  /** Forget every mark on the page. */
  reset(): void {
    this.badges = [];
    const container = this.shadow.getElementById('container');
    if (container) {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }
  }

  /**
   * Is the badge host still in the document?
   *
   * A page that replaces its own `document.body` detaches the host without
   * telling us; the badges would then be invisible for the rest of the
   * page's life. The reading anchors have the same problem and the same
   * check.
   */
  isAttached(): boolean {
    return this.host.isConnected;
  }

  /** Keep the badges where their images are. Called on scroll and resize. */
  repositionAll(): void {
    this.badges.forEach(badge => this.reposition(badge));
  }

  destroy(): void {
    // Drop the image references too: the badges hold strong references to
    // <img> elements, and a torn-down page must not keep the DOM alive.
    this.badges = [];
    this.host.remove();
  }

  private describe(reason: string): string {
    return `这张图翻译失败：${reason}`;
  }

  private reposition(entry: FailureBadge): void {
    const rect = entry.image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // The image is hidden or detached — hide the badge.
      entry.badge.style.display = 'none';
      return;
    }

    /*
     * 漫画页通常比屏幕高，所以钉在图角上的标记，读者往下一滚就看不见了。
     * 图片本身还在视野里时标记就跟着图走，图滚过去了标记也跟着走——它指
     * 的是一张图，不是一个位置。
     */
    const margin = 12;
    if (rect.bottom < margin) {
      entry.badge.style.display = 'none';
      return;
    }

    entry.badge.style.display = 'flex';
    const cx = rect.left + margin;
    const cy = Math.max(rect.top + margin, margin);
    entry.badge.style.left = `${cx}px`;
    entry.badge.style.top = `${cy}px`;
  }
}
