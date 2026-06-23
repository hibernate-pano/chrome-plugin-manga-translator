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
 * - error: 显示错误信息
 */

// ==================== 类型定义 ====================

export type HudState =
  | { status: 'hidden' }
  | { status: 'translating'; current: number; total: number; currentImageIndex?: number }
  | {
      status: 'complete';
      translatedCount: number;
      failedCount: number;
      cachedCount: number;
    }
  | { status: 'error'; message: string; suggestion?: string }
  | { status: 'onboarding' };

// ==================== FloatingHud 类 ====================

export class FloatingHud {
  private container: HTMLElement;
  private shadow: ShadowRoot;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private onboardingCollapseTimer: ReturnType<typeof setTimeout> | null = null;

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

    // 事件委托：在 shadow root 上统一处理按钮点击
    this.shadow.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.id === 'cancel-btn') {
        this.container.dispatchEvent(
          new CustomEvent('hud-cancel', { bubbles: true, composed: true })
        );
      } else if (target.id === 'retry-failed-btn') {
        this.container.dispatchEvent(
          new CustomEvent('hud-retry-failed', { bubbles: true, composed: true })
        );
      } else if (target.id === 'onboarding-configure') {
        this.container.dispatchEvent(
          new CustomEvent('hud-configure', { bubbles: true, composed: true })
        );
      } else if (target.id === 'onboarding-close') {
        this.container.dispatchEvent(
          new CustomEvent('hud-dismiss-onboarding', { bubbles: true, composed: true })
        );
      }
    });

    this.shadow.addEventListener('mouseover', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('.hud-onboarding-collapsed')) {
        this.setOnboardingCollapsed(false);
        this.clearOnboardingTimers();
        this.onboardingCollapseTimer = setTimeout(() => {
          this.setOnboardingCollapsed(true);
        }, 4000);
      }
    });
  }

  /**
   * 更新 HUD 状态
   */
  update(state: HudState): void {
    this.clearAutoHide();

    const hud = this.shadow.getElementById('hud');
    if (!hud) return;

    if (state.status === 'onboarding') {
      this.startOnboardingCard(hud);
      return;
    }

    if (state.status === 'hidden') {
      hud.style.display = 'none';
      return;
    }

    hud.style.display = 'block';
    hud.innerHTML = this.renderState(state);

    // 完成状态：
    // - 有失败项：等待用户操作（显示重新翻译按钮），不自动隐藏
    // - 全部成功：2 秒后自动隐藏
    if (state.status === 'complete') {
      if (state.failedCount > 0) {
        // 有失败项，不自动隐藏，等待用户点击按钮或手动关闭
        // 可选：可以加一个明确的关闭方式
      } else {
        this.autoHideTimer = setTimeout(() => {
          this.update({ status: 'hidden' });
        }, 2000);
      }
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
    this.clearOnboardingTimers();
  }

  private startOnboardingCard(hud: HTMLElement): void {
    this.clearOnboardingTimers();
    hud.style.display = 'block';
    hud.innerHTML = this.renderState({ status: 'onboarding' });

    this.onboardingCollapseTimer = setTimeout(() => {
      this.setOnboardingCollapsed(true);
    }, 8000);
  }

  private setOnboardingCollapsed(collapsed: boolean): void {
    const card = this.shadow.getElementById('onboarding-card');
    if (!card) return;
    card.classList.toggle('hud-onboarding-collapsed', collapsed);
  }

  private clearOnboardingTimers(): void {
    if (this.onboardingCollapseTimer !== null) {
      clearTimeout(this.onboardingCollapseTimer);
      this.onboardingCollapseTimer = null;
    }
  }

  private renderState(state: HudState): string {
    switch (state.status) {
      case 'translating': {
        const pct =
          state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
        const imageLabel = state.currentImageIndex
          ? `第 ${state.currentImageIndex} 张`
          : `${state.current}`;
        return `
          <div class="hud-card">
            <div class="hud-title">翻译中...</div>
            <div class="hud-progress-track">
              <div class="hud-progress-bar" style="width:${pct}%"></div>
            </div>
            <div class="hud-sub">${imageLabel} / ${state.total}</div>
            <button id="cancel-btn" class="hud-cancel">取消</button>
          </div>
        `;
      }

      case 'complete': {
        if (state.failedCount > 0) {
          return `
            <div class="hud-card">
              <div class="hud-title">翻译完成</div>
              <div class="hud-sub">成功 ${state.translatedCount}，失败 ${state.failedCount}，缓存 ${state.cachedCount}</div>
              <button id="retry-failed-btn" class="hud-retry">重新翻译失败项</button>
            </div>
          `;
        }
        return `
          <div class="hud-card">
            <div class="hud-title">翻译完成</div>
            <div class="hud-sub">成功 ${state.translatedCount}，失败 ${state.failedCount}，缓存 ${state.cachedCount}</div>
          </div>
        `;
      }

      case 'onboarding': {
        return `
          <div class="hud-card hud-card--onboarding" id="onboarding-card">
            <button id="onboarding-close" class="hud-onboarding-close" title="关闭" aria-label="关闭">×</button>
            <div class="hud-title">需要 API key 才能翻译</div>
            <div class="hud-sub">点下面按钮完成配置（约 10 秒）</div>
            <button id="onboarding-configure" class="hud-onboarding-action">去配置</button>
          </div>
        `;
      }

      case 'error': {
        return `
          <div class="hud-card hud-card--error">
            <div class="hud-title">翻译出错</div>
            <div class="hud-message">${escapeHtml(state.message)}</div>
            ${state.suggestion ? `
              <div class="hud-suggestion">${escapeHtml(state.suggestion)}</div>
            ` : ''}
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

        .hud-message {
          color: rgba(255, 255, 255, 0.9);
          font-size: 12px;
          line-height: 1.4;
          margin-top: 4px;
        }

        .hud-suggestion {
          color: rgba(255, 255, 255, 0.6);
          font-size: 11px;
          line-height: 1.4;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.15);
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

        .hud-retry {
          margin-top: 10px;
          background: rgba(59, 130, 246, 0.8);
          border: none;
          border-radius: 6px;
          color: #fff;
          font-size: 12px;
          cursor: pointer;
          padding: 6px 12px;
          display: inline-block;
          width: 100%;
        }

        .hud-retry:hover {
          background: rgba(59, 130, 246, 1);
        }

        .hud-card--onboarding {
          background: rgba(180, 130, 30, 0.92);
          max-width: 280px;
          position: relative;
        }

        .hud-onboarding-close {
          position: absolute;
          top: 6px;
          right: 8px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          padding: 4px;
        }

        .hud-onboarding-close:hover {
          color: #fff;
        }

        .hud-onboarding-action {
          margin-top: 12px;
          width: 100%;
          background: rgba(255, 255, 255, 0.95);
          border: none;
          border-radius: 6px;
          color: #8a5a00;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 12px;
          cursor: pointer;
          transition: background 0.15s;
        }

        .hud-onboarding-action:hover {
          background: #fff;
        }

        .hud-onboarding-collapsed .hud-sub,
        .hud-onboarding-collapsed .hud-onboarding-action {
          display: none;
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
