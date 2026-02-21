/**
 * Hover Selector - 图片悬停选择模式
 *
 * 提供 hover 模式下的图片高亮和点击选择功能：
 * - 鼠标悬停时对可翻译图片高亮显示（蓝色边框 + 标签）
 * - 点击高亮图片触发翻译回调
 * - ESC 键退出选择模式
 * - 通过 Shadow DOM 注入样式，避免污染页面
 */

// ==================== 图片可翻译性判断 ====================

/**
 * 判断图片是否为可翻译图片
 *
 * 过滤条件：
 * - 尺寸 >= 200x200
 * - 已加载完成
 * - 不在 header/nav/footer/aside 内
 * - className/id 不含常见 UI 图片关键词
 * - 不是小正方形头像
 */
export function isTranslatableImage(img: HTMLImageElement): boolean {
  // 检查尺寸
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  if (width < 200 || height < 200) {
    return false;
  }

  // 检查是否已加载
  if (!img.complete || !img.src) {
    return false;
  }

  // 检查是否在语义性布局元素内（头部/导航/页脚/侧边栏）
  if (img.closest('header, nav, footer, aside')) {
    return false;
  }

  // 检查 className 和 id 是否含有 UI 图片关键词
  const classAndId = `${img.className} ${img.id}`.toLowerCase();
  const uiKeywords = ['avatar', 'logo', 'icon', 'banner', 'ad', 'emoji'];
  for (const keyword of uiKeywords) {
    if (classAndId.includes(keyword)) {
      return false;
    }
  }

  // 过滤小正方形头像（1:1 比例且尺寸小于 400x400）
  const aspectRatio = width / height;
  if (aspectRatio > 0.9 && aspectRatio < 1.1 && width < 400 && height < 400) {
    return false;
  }

  // 排除已翻译图片
  if (img.classList.contains('manga-translator-processed')) {
    return false;
  }

  // 排除翻译覆盖层内的图片
  if (img.closest('.manga-translator-wrapper')) {
    return false;
  }

  return true;
}

// ==================== HoverSelector 类 ====================

/**
 * HoverSelector - 悬停选图模式控制器
 *
 * 使用方式：
 * ```ts
 * const selector = new HoverSelector();
 * selector.onImageClick((img) => { ... });
 * selector.enter();
 * // 用户选择图片后会触发回调
 * // 或者手动退出：selector.exit();
 * ```
 */
export class HoverSelector {
  private isActive = false;
  private clickCallback: ((img: HTMLImageElement) => void) | null = null;

  // 当前高亮的图片和相关 DOM
  private highlightedImg: HTMLImageElement | null = null;
  private highlightHost: HTMLElement | null = null;

  // 绑定的事件处理函数（用于移除时保持引用）
  private boundMouseover = this.handleMouseover.bind(this);
  private boundClick = this.handleClick.bind(this);
  private boundKeydown = this.handleKeydown.bind(this);

  /**
   * 注册图片点击回调
   */
  onImageClick(callback: (img: HTMLImageElement) => void): void {
    this.clickCallback = callback;
  }

  /**
   * 进入 hover 选图模式
   */
  enter(): void {
    if (this.isActive) return;

    this.isActive = true;
    document.body.style.cursor = 'crosshair';

    document.addEventListener('mouseover', this.boundMouseover, true);
    document.addEventListener('click', this.boundClick, true);
    document.addEventListener('keydown', this.boundKeydown, true);
  }

  /**
   * 退出 hover 选图模式，清理所有高亮和事件
   */
  exit(): void {
    if (!this.isActive) return;

    this.isActive = false;
    document.body.style.cursor = '';

    document.removeEventListener('mouseover', this.boundMouseover, true);
    document.removeEventListener('click', this.boundClick, true);
    document.removeEventListener('keydown', this.boundKeydown, true);

    this.clearHighlight();
  }

  // ==================== 私有方法 ====================

  private handleMouseover(e: MouseEvent): void {
    if (!this.isActive) return;

    const target = e.target;
    if (!(target instanceof HTMLImageElement)) {
      // 移出图片时，如果新目标不是高亮 DOM 自身，则清除高亮
      if (
        this.highlightHost &&
        target instanceof Node &&
        !this.highlightHost.contains(target)
      ) {
        this.clearHighlight();
      }
      return;
    }

    const img = target;

    // 如果是同一张图片，不重复高亮
    if (img === this.highlightedImg) return;

    this.clearHighlight();

    if (isTranslatableImage(img)) {
      this.showHighlight(img);
    }
  }

  private handleClick(e: MouseEvent): void {
    if (!this.isActive) return;

    const target = e.target;

    // 如果点击的是高亮图片或其容器
    if (this.highlightedImg) {
      e.preventDefault();
      e.stopPropagation();

      const img = this.highlightedImg;
      this.exit();
      this.clickCallback?.(img);
    } else if (target instanceof HTMLImageElement && isTranslatableImage(target)) {
      e.preventDefault();
      e.stopPropagation();

      this.exit();
      this.clickCallback?.(target);
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.isActive) {
      this.exit();
    }
  }

  private showHighlight(img: HTMLImageElement): void {
    this.highlightedImg = img;

    // 创建 Shadow DOM 宿主，避免污染页面样式
    const host = document.createElement('div');
    host.setAttribute('data-manga-translator-highlight', 'true');

    // 定位到图片上方
    const rect = img.getBoundingClientRect();
    Object.assign(host.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      pointerEvents: 'none',
      zIndex: '2147483646',
    });

    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .border {
          position: absolute;
          inset: 0;
          border: 2px solid #3b82f6;
          box-sizing: border-box;
          pointer-events: none;
        }
        .label {
          position: absolute;
          top: 0;
          right: 0;
          background: #3b82f6;
          color: #fff;
          font-size: 12px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          padding: 2px 6px;
          border-bottom-left-radius: 4px;
          pointer-events: none;
          white-space: nowrap;
          line-height: 1.6;
        }
      </style>
      <div class="border"></div>
      <div class="label">点击翻译</div>
    `;

    document.body.appendChild(host);
    this.highlightHost = host;
  }

  private clearHighlight(): void {
    if (this.highlightHost) {
      this.highlightHost.remove();
      this.highlightHost = null;
    }
    this.highlightedImg = null;
  }
}
