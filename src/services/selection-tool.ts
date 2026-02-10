/**
 * 智能图片选择工具
 *
 * 功能：
 * - 鼠标悬停自动高亮图片
 * - 点击选中图片进行翻译
 * - 智能过滤可翻译图片
 * - 提供视觉反馈和提示
 */

export class SmartImageSelector {
  private isActive = false;
  private overlay: HTMLDivElement | null = null;
  private hintText: HTMLDivElement | null = null;
  private currentHighlight: HTMLDivElement | null = null;
  private currentImage: HTMLImageElement | null = null;
  private onImageSelect: ((image: HTMLImageElement) => void) | null = null;
  private onCancel: (() => void) | null = null;

  /**
   * 激活选择模式
   */
  activate(
    onSelect: (image: HTMLImageElement) => void,
    onCancelCallback: () => void,
  ): void {
    if (this.isActive) return;

    this.isActive = true;
    this.onImageSelect = onSelect;
    this.onCancel = onCancelCallback;

    this.createOverlay();
    this.createHint();
    this.attachEventListeners();
  }

  /**
   * 取消选择模式
   */
  deactivate(): void {
    if (!this.isActive) return;

    this.isActive = false;
    this.removeOverlay();
    this.removeHint();
    this.removeHighlight();
    this.detachEventListeners();

    this.currentImage = null;
  }

  /**
   * 创建半透明遮罩层
   */
  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'manga-translator-selection-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.25);
      z-index: 999998;
      cursor: crosshair;
      backdrop-filter: blur(1px);
    `;
    document.body.appendChild(this.overlay);
  }

  /**
   * 创建提示文字
   */
  private createHint(): void {
    this.hintText = document.createElement('div');
    this.hintText.className = 'manga-translator-selection-hint';
    this.hintText.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, rgba(13, 148, 136, 0.95), rgba(20, 184, 166, 0.95));
      color: white;
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      z-index: 1000000;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      backdrop-filter: blur(10px);
      animation: slideDown 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    this.hintText.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
      </svg>
      <span>将鼠标悬停在图片上，点击选择要翻译的图片</span>
      <span style="opacity: 0.7; font-size: 13px; margin-left: 8px;">ESC 取消</span>
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(this.hintText);
  }

  /**
   * 移除遮罩层
   */
  private removeOverlay(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /**
   * 移除提示
   */
  private removeHint(): void {
    if (this.hintText) {
      this.hintText.remove();
      this.hintText = null;
    }
  }

  /**
   * 移除高亮
   */
  private removeHighlight(): void {
    if (this.currentHighlight) {
      this.currentHighlight.remove();
      this.currentHighlight = null;
    }
  }

  /**
   * 高亮图片
   */
  private highlightImage(img: HTMLImageElement): void {
    // 如果已经是当前图片，不重复创建
    if (this.currentImage === img && this.currentHighlight) {
      return;
    }

    // 移除旧高亮
    this.removeHighlight();

    this.currentImage = img;

    // 创建高亮边框
    const rect = img.getBoundingClientRect();
    this.currentHighlight = document.createElement('div');
    this.currentHighlight.className = 'manga-translator-image-highlight';
    this.currentHighlight.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 4px solid #0D9488;
      background: rgba(13, 148, 136, 0.1);
      pointer-events: none;
      z-index: 999999;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.6),
                  0 0 30px rgba(13, 148, 136, 0.5),
                  inset 0 0 0 2px rgba(255, 255, 255, 0.3);
      animation: highlightPulse 1.5s ease-in-out infinite;
      transition: all 0.2s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes highlightPulse {
        0%, 100% {
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.6),
                      0 0 30px rgba(13, 148, 136, 0.5),
                      inset 0 0 0 2px rgba(255, 255, 255, 0.3);
        }
        50% {
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.8),
                      0 0 40px rgba(13, 148, 136, 0.7),
                      inset 0 0 0 2px rgba(255, 255, 255, 0.5);
        }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(this.currentHighlight);

    // 更新提示文字
    if (this.hintText) {
      this.hintText.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>点击图片开始翻译</span>
        <span style="opacity: 0.7; font-size: 13px; margin-left: 8px;">ESC 取消</span>
      `;
      this.hintText.style.background =
        'linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))';
    }
  }

  /**
   * 判断元素是否为有效的可翻译图片
   */
  private isValidImage(element: Element): boolean {
    if (!(element instanceof HTMLImageElement)) {
      return false;
    }

    const img = element as HTMLImageElement;

    // 检查图片是否已加载
    if (!img.complete || !img.naturalWidth) {
      return false;
    }

    // 检查图片尺寸（最小 150x150）
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < 150 || height < 150) {
      return false;
    }

    // 排除已翻译的图片
    if (img.classList.contains('manga-translator-processed')) {
      return false;
    }

    // 排除翻译覆盖层内的图片
    if (img.closest('.manga-translator-wrapper')) {
      return false;
    }

    // 排除选择工具自身的元素
    if (
      img.closest('.manga-translator-selection-overlay') ||
      img.closest('.manga-translator-selection-hint') ||
      img.closest('.manga-translator-image-highlight')
    ) {
      return false;
    }

    return true;
  }

  /**
   * 查找鼠标下的图片元素
   */
  private findImageAtPoint(x: number, y: number): HTMLImageElement | null {
    // 临时隐藏遮罩层和高亮，以便获取下方元素
    const overlayDisplay = this.overlay?.style.display;
    const highlightDisplay = this.currentHighlight?.style.display;

    if (this.overlay) this.overlay.style.display = 'none';
    if (this.currentHighlight) this.currentHighlight.style.display = 'none';

    // 获取鼠标位置的元素
    const element = document.elementFromPoint(x, y);

    // 恢复遮罩层显示
    if (this.overlay && overlayDisplay) this.overlay.style.display = overlayDisplay;
    if (this.currentHighlight && highlightDisplay)
      this.currentHighlight.style.display = highlightDisplay;

    // 检查是否为有效图片
    if (element && this.isValidImage(element)) {
      return element as HTMLImageElement;
    }

    // 检查父元素中是否包含图片
    let parent = element?.parentElement;
    while (parent) {
      const imgs = parent.querySelectorAll('img');
      for (const img of imgs) {
        if (this.isValidImage(img)) {
          const rect = img.getBoundingClientRect();
          if (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          ) {
            return img as HTMLImageElement;
          }
        }
      }
      parent = parent.parentElement;
    }

    return null;
  }

  /**
   * 鼠标移动事件 - 自动高亮图片
   */
  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isActive) return;

    const img = this.findImageAtPoint(e.clientX, e.clientY);

    if (img) {
      this.highlightImage(img);
      // 改变光标样式
      if (this.overlay) {
        this.overlay.style.cursor = 'pointer';
      }
    } else {
      this.removeHighlight();
      this.currentImage = null;

      // 恢复光标样式
      if (this.overlay) {
        this.overlay.style.cursor = 'crosshair';
      }

      // 恢复提示文字
      if (this.hintText) {
        this.hintText.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <span>将鼠标悬停在图片上，点击选择要翻译的图片</span>
          <span style="opacity: 0.7; font-size: 13px; margin-left: 8px;">ESC 取消</span>
        `;
        this.hintText.style.background =
          'linear-gradient(135deg, rgba(13, 148, 136, 0.95), rgba(20, 184, 166, 0.95))';
      }
    }
  };

  /**
   * 点击事件 - 选择图片
   */
  private handleClick = (e: MouseEvent): void => {
    if (!this.isActive) return;

    e.preventDefault();
    e.stopPropagation();

    if (this.currentImage && this.onImageSelect) {
      this.onImageSelect(this.currentImage);
      this.deactivate();
    }
  };

  /**
   * ESC 键取消
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isActive) {
      if (this.onCancel) {
        this.onCancel();
      }
      this.deactivate();
    }
  };

  /**
   * 附加事件监听
   */
  private attachEventListeners(): void {
    document.addEventListener('mousemove', this.handleMouseMove, true);
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
  }

  /**
   * 移除事件监听
   */
  private detachEventListeners(): void {
    document.removeEventListener('mousemove', this.handleMouseMove, true);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);
  }
}
