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

import type { ErrorAction } from '@/utils/error-handler';
import { formatEta } from '@/shared/eta';

export type HudState =
  | { status: 'hidden' }
  | { status: 'scanning'; candidateCount?: number }
  | {
      status: 'translating';
      current: number;
      total: number;
      currentImageIndex?: number;
      phase?: 'translating' | 'rendering';
      /** Rough seconds remaining. Undefined = not enough signal yet. */
      etaSeconds?: number;
    }
  | {
      status: 'complete';
      translatedCount: number;
      failedCount: number;
      cachedCount: number;
      skippedCount?: number;
      /**
       * The first image's failure reason. Without it the user only sees
       * "failed 20" and has to guess whether the key is wrong, the provider
       * is throttling, or the model choked.
       */
      lastError?: string;
    }
  | {
      status: 'error';
      message: string;
      suggestion?: string;
      action?: ErrorAction;
    };

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
      // The bottom-left, not the bottom-right: the reading panel is docked
      // on the right and is tall enough to reach the bottom of the screen,
      // so a HUD in the same corner ended up underneath it — the progress
      // bar and the cancel button were covered by the panel.
      left: '20px',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });

    this.shadow = this.container.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `${this.buildStyles()}<div id="hud" style="display:none"></div>`;

    document.body.appendChild(this.container);

    // 事件委托：在 shadow root 上统一处理按钮点击
    this.shadow.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.id === 'close-btn') {
        // The HUD is pinned to the bottom-right of somebody else's page.
        // An error card or a "some images failed" card used to stay there
        // forever, with no way to dismiss it — the reader had to reload the
        // page to get the corner of the screen back.
        this.update({ status: 'hidden' });
      } else if (target.id === 'cancel-btn') {
        this.container.dispatchEvent(
          new CustomEvent('hud-cancel', { bubbles: true, composed: true })
        );
      } else if (target.id === 'retry-failed-btn') {
        this.container.dispatchEvent(
          new CustomEvent('hud-retry-failed', { bubbles: true, composed: true })
        );
      } else if (target.id === 'error-action-btn') {
        const actionType = target.dataset['actionType'] as
          | 'open-settings'
          | 'copy-command'
          | undefined;
        const actionCommand = target.dataset['actionCommand'];
        if (actionType) {
          this.container.dispatchEvent(
            new CustomEvent('hud-error-action', {
              bubbles: true,
              composed: true,
              detail: { type: actionType, command: actionCommand },
            })
          );
        }
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
  }

  private renderState(state: HudState): string {
    switch (state.status) {
      case 'scanning': {
        const candidate =
          typeof state.candidateCount === 'number'
            ? `（候选 ${state.candidateCount} 张）`
            : '';
        return `
          <div class="hud-card">
            <div class="hud-title">扫描页面中...</div>
            <div class="hud-sub">检测可翻译图片${escapeHtml(candidate)}</div>
          </div>
        `;
      }

      case 'translating': {
        const pct =
          state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
        const imageLabel = state.currentImageIndex
          ? `第 ${state.currentImageIndex} 张`
          : `${state.current}`;
        const phaseLabel =
          state.phase === 'rendering' ? '正在渲染...' : '正在翻译...';
        const etaLabel =
          typeof state.etaSeconds === 'number' && state.etaSeconds > 0
            ? ` · 约 ${formatEta(state.etaSeconds)}`
            : '';
        return `
          <div class="hud-card">
            <div class="hud-title">${escapeHtml(phaseLabel)}</div>
            <div class="hud-progress-track">
              <div class="hud-progress-bar" style="width:${pct}%"></div>
            </div>
            <div class="hud-sub">${escapeHtml(imageLabel)} / ${state.total}${escapeHtml(etaLabel)}</div>
            <button id="cancel-btn" class="hud-cancel">取消</button>
          </div>
        `;
      }

      case 'complete': {
        const skipped = state.skippedCount ?? 0;
        const skippedLine =
          skipped > 0
            ? `<div class="hud-sub hud-sub-muted">已跳过 ${skipped} 张（尺寸/位置不匹配）</div>`
            : '';
        const cachedLine =
          state.cachedCount > 0
            ? `<div class="hud-sub hud-sub-muted">其中 ${state.cachedCount} 张来自缓存</div>`
            : '';
        const errorLine = state.lastError
          ? `<div class="hud-sub hud-sub-error">失败原因：${escapeHtml(
              state.lastError
            )}</div>`
          : '';
        if (state.failedCount > 0) {
          return `
            <div class="hud-card">
              <button id="close-btn" class="hud-close" type="button" aria-label="关闭">×</button>
              <div class="hud-title">翻译完成</div>
              <div class="hud-sub">成功 ${state.translatedCount}，失败 ${state.failedCount}，缓存 ${state.cachedCount}</div>
              ${cachedLine}
              ${skippedLine}
              ${errorLine}
              <button id="retry-failed-btn" class="hud-retry">重新翻译失败项</button>
            </div>
          `;
        }
        return `
          <div class="hud-card">
            <div class="hud-title">翻译完成</div>
            <div class="hud-sub">成功 ${state.translatedCount}，失败 ${state.failedCount}，缓存 ${state.cachedCount}</div>
            ${cachedLine}
            ${skippedLine}
            ${errorLine}
            <div class="hud-sub hud-sub-muted">译文已直接覆盖在原图上</div>
          </div>
        `;
      }

      case 'error': {
        return `
          <div class="hud-card hud-card--error">
            <button id="close-btn" class="hud-close" type="button" aria-label="关闭">×</button>
            <div class="hud-title">翻译出错</div>
            <div class="hud-message">${escapeHtml(state.message)}</div>
            ${
              state.suggestion
                ? `
              <div class="hud-suggestion">${escapeHtml(state.suggestion)}</div>
            `
                : ''
            }
            ${
              state.action
                ? `<button id="error-action-btn" class="hud-action" data-action-type="${state.action.type}"${state.action.command ? ` data-action-command="${escapeHtml(state.action.command)}"` : ''}>${escapeHtml(state.action.label)}</button>`
                : ''
            }
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
          /* Room for the close button in the top-right corner. */
          position: relative;
        }

        /* The close button sits in the corner of somebody else's page, so it
           has to be reachable: WCAG 2.5.8 asks for a 24x24 CSS-pixel target
           and the old 22x22 box was below it. The box is now 32x32 while the
           glyph stays an 18px "×", centred with flex so it does not move.
           It is anchored 2px from the corner, which leaves the title — the
           only thing on that row — completely uncovered. */
        .hud-close {
          position: absolute;
          top: 2px;
          right: 2px;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          /* 0.9 alpha over the red error card (rgb(191,64,64) on a white
             page) is rgb(249,236,236): 4.53:1, where 0.65 managed 3.08:1. */
          color: rgba(255, 255, 255, 0.9);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
        }
        .hud-close:hover {
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
        }
        .hud-close:focus-visible {
          outline: 2px solid #22d3ee;
          outline-offset: 1px;
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

        /* Alpha ladder on the dark card (rgb(64,64,64) on a white page):
           title #fff -> sub 0.8 (7.36:1) -> muted 0.7 (6.07:1). The muted
           line used to sit at 0.5 / 11px, which measured 3.95:1 — below the
           4.5:1 that small text owes. */
        .hud-sub {
          color: rgba(255, 255, 255, 0.8);
          font-size: 12px;
          line-height: 1.4;
        }
        .hud-sub-muted {
          color: rgba(255, 255, 255, 0.7);
          font-size: 12px;
          margin-top: 2px;
        }

        .hud-sub-error {
          color: #fecaca;
          font-size: 11px;
          margin-top: 4px;
          line-height: 1.5;
          word-break: break-word;
        }

        /* The error text is the reason the card exists, so it is fully
           opaque: 5.22:1 on the red card, against 4.53:1 at 0.9 alpha. */
        .hud-message {
          color: #fff;
          font-size: 12px;
          line-height: 1.4;
          margin-top: 4px;
        }

        /* The hint under an error message is the text that tells the reader
           what to do next, so it has to be readable. 0.6 alpha over the red
           card (rgb(191,64,64) on a white page) was rgb(230,179,179) —
           2.83:1. 0.95 gives rgb(252,245,245), 4.87:1, and 12px keeps it
           out of the "too small to read" range. */
        .hud-suggestion {
          color: rgba(255, 255, 255, 0.95);
          font-size: 12px;
          line-height: 1.4;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.15);
        }

        /* The action button only ever appears on the red error card. A
           translucent *white* plate under a white label measured 4.05:1 —
           under the 4.5:1 that a 12px label owes. A translucent *black*
           plate keeps the label at 8.39:1 and still reads as a button,
           because the border is what outlines it. */
        .hud-action {
          margin-top: 10px;
          padding: 6px 12px;
          background: rgba(0, 0, 0, 0.28);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.45);
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          pointer-events: auto;
          transition: background 0.15s, border-color 0.15s;
        }

        .hud-action:hover {
          background: rgba(0, 0, 0, 0.18);
          border-color: rgba(255, 255, 255, 0.7);
        }

        .hud-progress-track {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          height: 4px;
          margin: 8px 0 4px;
          overflow: hidden;
        }

        /* The fill has to be told apart from the track it sits in, or the
           progress is unreadable: #3b82f6 on the track measured 1.56:1.
           #93c5fd reaches 3.18:1 against the track and 5.77:1 against the
           card, and it stays visible on a dark page too. */
        .hud-progress-bar {
          background: #93c5fd;
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .hud-cancel {
          margin-top: 10px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.8);
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
