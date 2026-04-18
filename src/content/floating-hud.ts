/**
 * Floating HUD - 页面内浮动状态显示
 *
 * 纯原生 DOM 实现（不依赖 React）。
 * 通过 Shadow DOM 注入样式，避免与页面样式冲突。
 *
 * HUD 状态：
 * - hidden: 不显示
 * - translating: 显示进度条
 * - complete: 显示完成信息（2 秒后自动隐藏）
 * - hover-select: 显示 hover 选图提示
 * - error: 显示错误信息
 */

// ==================== 类型定义 ====================

export type HudState =
  | { status: 'hidden' }
  | { status: 'translating'; current: number; total: number }
  | {
      status: 'complete';
      translatedCount: number;
      failedCount: number;
      cachedCount: number;
    }
  | { status: 'hover-select' }
  | { status: 'error'; message: string };

// ==================== FloatingHud 类 ====================

export class FloatingHud {
  private container: HTMLElement;
  private shadow: ShadowRoot;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.setAttribute('data-manga-translator-hud', 'true');

    Object.assign(this.container.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });

    this.shadow = this.container.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `${this.buildStyles()}<div id="hud" style="display:none"></div>`;

    document.body.appendChild(this.container);

    // 监听取消事件（由 HUD 内部取消按钮分发）
    this.shadow.addEventListener('hud-cancel', () => {
      // 将事件冒泡到外部，供 content.ts 监听
      this.container.dispatchEvent(
        new CustomEvent('hud-cancel', { bubbles: true, composed: true })
      );
    });
  }

  /**
   * 更新 HUD 状态
   */
  update(state: HudState): void {
    this.clearAutoHide();

    const hud = this.shadow.getElementById('hud');
    if (!hud) return;

    if (state.status === 'hidden') {
      hud.style.display = 'none';
      return;
    }

    hud.style.display = 'block';
    hud.innerHTML = this.renderState(state);

    // 重新绑定取消按钮
    const cancelBtn = hud.querySelector('#cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.shadow.dispatchEvent(
          new CustomEvent('hud-cancel', { bubbles: true })
        );
      });
    }

    // 完成状态：2 秒后自动隐藏
    if (state.status === 'complete') {
      this.autoHideTimer = setTimeout(() => {
        this.update({ status: 'hidden' });
      }, 2000);
    }
  }

  /**
   * 销毁 HUD，从 DOM 移除
   */
  destroy(): void {
    this.clearAutoHide();
    this.container.remove();
  }

  // ==================== 私有方法 ====================

  private clearAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  private renderState(state: HudState): string {
    switch (state.status) {
      case 'translating': {
        const pct =
          state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
        return `
          <div class="hud-card">
            <div class="hud-title">翻译中...</div>
            <div class="hud-progress-track">
              <div class="hud-progress-bar" style="width:${pct}%"></div>
            </div>
            <div class="hud-sub">${state.current} / ${state.total}</div>
            <button id="cancel-btn" class="hud-cancel">取消</button>
          </div>
        `;
      }

      case 'complete': {
        return `
          <div class="hud-card">
            <div class="hud-title">翻译完成</div>
            <div class="hud-sub">成功 ${state.translatedCount}，失败 ${state.failedCount}，缓存 ${state.cachedCount}</div>
          </div>
        `;
      }

      case 'hover-select': {
        return `
          <div class="hud-card">
            <div class="hud-title">点击选图翻译</div>
            <div class="hud-sub">将鼠标悬停在图片上，点击开始翻译</div>
            <button id="cancel-btn" class="hud-cancel">退出</button>
          </div>
        `;
      }

      case 'error': {
        return `
          <div class="hud-card hud-card--error">
            <div class="hud-title">翻译出错</div>
            <div class="hud-sub">${escapeHtml(state.message)}</div>
          </div>
        `;
      }

      default:
        return '';
    }
  }

  private buildStyles(): string {
    return `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .hud-card {
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-radius: 12px;
          padding: 14px 18px;
          min-width: 200px;
          max-width: 280px;
          pointer-events: auto;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        .hud-card--error {
          background: rgba(180, 30, 30, 0.85);
        }

        .hud-title {
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.4;
          margin-bottom: 6px;
        }

        .hud-sub {
          color: rgba(255, 255, 255, 0.7);
          font-size: 12px;
          line-height: 1.4;
        }

        .hud-progress-track {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          height: 4px;
          margin: 8px 0 4px;
          overflow: hidden;
        }

        .hud-progress-bar {
          background: #3b82f6;
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .hud-cancel {
          margin-top: 10px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.6);
          font-size: 12px;
          cursor: pointer;
          padding: 0;
          text-decoration: underline;
          display: inline-block;
        }

        .hud-cancel:hover {
          color: #fff;
        }
      </style>
    `;
  }
}

// ==================== 工具函数 ====================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
