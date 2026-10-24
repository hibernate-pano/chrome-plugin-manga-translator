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
import {
  SKIPPED_IMAGES_REASON,
  describeFee,
  describeRetryFailedCost,
  describeRetryFee,
} from '@/shared/cost-wording';

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
      /**
       * What this run is about to cost, when the number of requests is not
       * the number of images.
       *
       * Right-clicking one long strip is one image and many requests: the
       * strip is cut into tiles, and each tile is a separate billed call.
       * The progress line says "1 / 1", which is true about images and
       * silent about the bill. This line is the difference between "one
       * request" and "ten requests", and it is on screen while the money
       * is being spent, so the user can still cancel.
       */
      costNote?: string;
    }
  | {
      status: 'complete';
      translatedCount: number;
      failedCount: number;
      cachedCount: number;
      skippedCount?: number;
      /**
       * Images that passed the filter but whose bytes have not arrived yet
       * (lazy-loaded comic pages).
       *
       * The content script counts them inside `scanImages()` and passes the
       * number on; without it the HUD cannot tell "the pages have not
       * loaded yet" from "these images are too small to be comic pages".
       */
      pendingCount?: number;
      /**
       * Images that were already translated, so this run skipped them.
       *
       * Without it, "nothing was translated" reads as "the page is broken",
       * when the page was simply already done.
       */
      skippedDuplicateCount?: number;
      /**
       * Whether the page is armed to keep translating on its own.
       *
       * The content script decides this (`enabled && autoContinueEnabled &&
       * (the host is allowlisted || the reader asked for this page)`) and
       * reports it with the page state; the HUD only reads the answer.
       *
       * It matters because the HUD has to say what will happen next. "It
       * will carry on by itself" is only true when the page is armed, and
       * promising it when it is not leaves the reader scrolling and
       * waiting for a translation that was never coming.
       */
      autoContinueArmed?: boolean;
      /**
       * Whether the follow-up budget on this page ran out.
       *
       * "Not armed" and "armed but out of budget" are different facts, and a
       * reader waiting for a continuation that will never come deserves to
       * be told which one it is. Without it the HUD could only promise or
       * stay silent.
       */
      autoContinueBudgetExhausted?: boolean;
      /**
       * The first image's failure reason. Without it the user only sees
       * "failed 20" and has to guess whether the key is wrong, the provider
       * is throttling, or the model choked.
       */
      lastError?: string;
      /**
       * How many spots on the page were found but not translated.
       *
       * The model answered, the run finished, and the card used to say
       * 「翻译完成」 — while a few bubbles were still in the source
       * language. "Done" and "fully translated" are different facts, and
       * the reader is the one who has to live with the difference.
       */
      missingCount?: number;
      /**
       * Which provider this page is using.
       *
       * A local provider (Ollama, LM Studio) does not charge the reader and
       * does not take the picture off the machine. The HUD used to say
       * "会再次计费" and "会产生费用" to those readers anyway.
       */
      provider?: string | null;
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
  /** The state currently on screen, so a button can re-render it. */
  private lastState: HudState | null = null;
  /**
   * Whether the retry button is waiting for its second click.
   *
   * The retry spends money, and this card is the surface a reader clicks in
   * a hurry, in the middle of a chapter. The popup asks before it spends;
   * this one used not to, so the same action cost money without a word on
   * the page that asked for it.
   */
  private retryArmed = false;

  /**
   * 卡片是不是收起来了。
   *
   * HUD 钉在左下角：右边是阅读面板，它够高，会一直伸到屏幕底部，所以
   * 同一角落的 HUD 会被面板压住。
   *
   * 但左下角也常常是画面本身——内容左对齐的阅读器上，整轮翻译都压着
   * 漫画。以前读者只有两个选择：忍着，或者刷新页面。
   *
   * 收起来之后它只剩一颗小药丸（"翻译中 3/20"），还在原地，还看得见
   * 进度，但几乎不挡画面；点一下就展开。
   */
  private collapsed = false;

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
      } else if (target.id === 'collapse-btn') {
        this.collapsed = !this.collapsed;
        this.render();
      } else if (target.id === 'cancel-btn') {
        this.container.dispatchEvent(
          new CustomEvent('hud-cancel', { bubbles: true, composed: true })
        );
      } else if (target.id === 'retry-failed-btn') {
        if (!this.retryArmed) {
          // The first click only arms the button. The second one spends.
          this.retryArmed = true;
          this.render();
          return;
        }
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
   * Draw the card again, without changing what it says.
   *
   * The retry button arms itself: the first click turns it into a
   * confirmation, and that has to happen on screen — the reader has to see
   * that a second click is what spends the money.
   */
  private render(): void {
    if (!this.lastState) return;
    // 重画不播报：这一条路径是"重新翻译失败项"按钮的第一次点击（把按钮
    // 变成待确认状态），内容没变，只是要让它变成"需要再点一次"的样子。
    // 让读屏再念一遍整张卡片，等于用噪音盖住了真正要说的那句。
    this.replaceContent(this.renderState(this.lastState), false);
  }

  /**
   * Put the card's HTML in place, keeping the keyboard where it was.
   *
   * The card is one innerHTML blob, so every progress update replaces it
   * wholesale — and the focused button goes with it. A reader who pressed
   * Tab to reach 「取消当前翻译」 lost the button (and the focus) every time
   * the counter moved, and the retry button was worse: its second click
   * *is* the confirmation, so a keyboard user could arm it and then have
   * nothing left to press.
   *
   * The focused element is remembered by its id and put back afterwards.
   * When the new card has no such button — the error card replaced the
   * cancel button — there is nothing to restore and focus stays where the
   * browser put it.
   */
  private replaceContent(html: string, announce: boolean): void {
    const hud = this.shadow.getElementById('hud');
    if (!hud) return;

    const focused = this.shadow.activeElement;
    const focusedId =
      focused instanceof HTMLElement && focused.id ? focused.id : null;

    /*
     * 屏幕阅读器只在"结论"上播报一次。
     *
     * 翻译进行中，每翻完一张都会把整张卡片重画一遍。把这些都念出来是一串
     * 噪音，而且念的是"正在翻译 7/12"这种读者无法据此做任何事的话。而
     * 「没有找到可翻译的图片 / 翻译完成 / 翻译失败」通常是一个人按下快捷键
     * 之后得到的唯一反馈 —— 没有它，读屏用户永远不知道刚才那一下有没有发生。
     *
     * 属性在改 innerHTML **之前**设置：先播报资格、然后换内容，读屏软件
     * 才会把新内容当作一次更新念出来。
     */
    if (announce) {
      hud.setAttribute('role', 'status');
      hud.setAttribute('aria-live', 'polite');
    } else {
      hud.removeAttribute('role');
      hud.removeAttribute('aria-live');
    }

    hud.innerHTML = html;

    if (!focusedId) return;
    const restored = this.shadow.getElementById(focusedId);
    if (restored instanceof HTMLElement) {
      restored.focus();
    }
  }

  /**
   * 更新 HUD 状态
   */
  update(state: HudState): void {
    this.clearAutoHide();
    this.lastState = state;
    // A new state is a new decision: the button starts unarmed again.
    this.retryArmed = false;

    const hud = this.shadow.getElementById('hud');
    if (!hud) return;

    if (state.status === 'hidden') {
      hud.style.display = 'none';
      return;
    }

    hud.style.display = 'block';
    const announce = state.status === 'complete' || state.status === 'error';
    this.replaceContent(this.renderState(state), announce);

    // 完成状态：
    // - 有失败项：等待用户操作（显示重新翻译按钮），不自动隐藏
    // - 全部成功：2 秒后自动隐藏
    // - 一张都没翻出来：这是一条"为什么没有结果"的解释，不是通知，
    //   两秒钟读不完，所以同样不自动隐藏
    if (state.status === 'complete') {
      if (state.failedCount > 0) {
        // 有失败项，不自动隐藏，等待用户点击按钮或手动关闭
        // 可选：可以加一个明确的关闭方式
      } else if (state.translatedCount === 0 && state.cachedCount === 0) {
        // Nothing came out of the run. The card explains why, and a
        // diagnosis the reader cannot finish reading in two seconds is no
        // diagnosis at all.
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

  /**
   * 收起之后的样子：一颗小药丸。
   *
   * 进度还在（读者最关心的就是它），但几乎不挡画面。按钮本身就是展开的
   * 入口——读者想看细节的时候点一下。
   */
  private renderCollapsed(state: HudState): string {
    let label = '';
    if (state.status === 'scanning') {
      label = '扫描中';
    } else if (state.status === 'translating') {
      label = `翻译中 ${state.current}/${state.total}`;
    } else if (state.status === 'complete') {
      label = '翻译完成';
    } else if (state.status === 'error') {
      label = '出错了';
    }
    return `
      <div class="hud-card hud-card--collapsed">
        <button id="collapse-btn" class="hud-collapse" type="button" aria-label="展开进度详情">${escapeHtml(label)}</button>
      </div>
    `;
  }

  private renderState(state: HudState): string {
    if (this.collapsed) {
      return this.renderCollapsed(state);
    }
    switch (state.status) {
      case 'scanning': {
        const candidate =
          typeof state.candidateCount === 'number'
            ? `（候选 ${state.candidateCount} 张）`
            : '';
        return `
          <div class="hud-card">
            <button id="collapse-btn" class="hud-collapse" type="button" aria-label="收起">收起</button>
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
            <button id="collapse-btn" class="hud-collapse" type="button" aria-label="收起">收起</button>
            <div class="hud-title">${escapeHtml(phaseLabel)}</div>
            <div class="hud-progress-track">
              <div class="hud-progress-bar" style="width:${pct}%"></div>
            </div>
            <div class="hud-sub">${escapeHtml(imageLabel)} / ${state.total}${escapeHtml(etaLabel)}</div>
            ${
              state.costNote
                ? `<div class="hud-sub hud-sub-muted">${escapeHtml(state.costNote)}</div>`
                : ''
            }
            <button id="cancel-btn" class="hud-cancel">取消当前翻译</button>
          </div>
        `;
      }

      case 'complete': {
        const skipped = state.skippedCount ?? 0;
        const skippedLine =
          skipped > 0
            ? `<div class="hud-sub hud-sub-muted">已跳过 ${skipped} 张（${SKIPPED_IMAGES_REASON}）</div>`
            : '';
        const cachedLine =
          state.cachedCount > 0
            ? `<div class="hud-sub hud-sub-muted">其中 ${state.cachedCount} 张来自缓存（没有产生费用）</div>`
            : '';
        const errorLine = state.lastError
          ? `<div class="hud-sub hud-sub-error">失败原因：${escapeHtml(
              state.lastError
            )}</div>`
          : '';
        /*
         * 这一轮跑完了，但有几处没有翻出来。
         *
         * 「翻译完成」说的是"这一轮结束了"，不是"这一页每一句都翻了"。
         * 模型找到了气泡却没给出译文（或者长条图有一片没有回答）的那几处，
         * 留在画面上还是原文。卡片以前只说成功，读者只当自己看漏了。
         */
        const missingLine =
          (state.missingCount ?? 0) > 0
            ? `<div class="hud-sub hud-sub-muted">有 ${state.missingCount} 处文字没有翻出来（仍是原文）</div>`
            : '';

        // A run that translated nothing is not a success, and "成功 0，失败 0，
        // 缓存 0" is not a diagnosis: it leaves the reader with three
        // possible causes and no way to tell them apart. The popup used to
        // guess wrong here — it told the reader their images were too small
        // when the page was really lazy-loading them.
        if (
          state.translatedCount === 0 &&
          state.cachedCount === 0 &&
          state.failedCount === 0
        ) {
          return `
            <div class="hud-card">
              <button id="close-btn" class="hud-close" type="button" aria-label="关闭">×</button>
              <div class="hud-title">没有找到可翻译的图片</div>
              ${this.renderEmptyReason(state)}
            </div>
          `;
        }

        if (state.failedCount > 0) {
          /*
           * The button says how many images it will re-request.
           *
           * The popup's version of this action says "重新翻译失败的 N 张"
           * and asks before it spends. The HUD's version said "重新翻译失败项"
           * and did not — one click, on the surface a reader clicks in a
           * hurry, with the money already moving. The number was on the card
           * all along; it just was not on the button.
           */
          const retryLabel = this.retryArmed
            ? `再点一次确认：重新翻译 ${state.failedCount} 张（${describeRetryFee(
                state.provider
              )}）`
            : `重新翻译失败的 ${state.failedCount} 张（${describeRetryFee(
                state.provider
              )}）`;
          /*
           * A run that failed every image is not "翻译完成".
           *
           * The card used to lead with 翻译完成 and put 成功 0 on the second
           * line, so the sentence a reader actually reads said the job was
           * done when none of their pages had been translated. The popup has
           * always split this case ("没有翻译成功（N 张待重试）"); the card
           * that sits on top of the page did not.
           */
          const title = state.translatedCount === 0 ? '翻译失败' : '部分完成';
          return `
            <div class="hud-card">
              <button id="close-btn" class="hud-close" type="button" aria-label="关闭">×</button>
              <div class="hud-title">${title}</div>
              <div class="hud-sub">成功 ${state.translatedCount}，失败 ${state.failedCount}，缓存 ${state.cachedCount}</div>
              ${missingLine}
              ${cachedLine}
              ${skippedLine}
              ${errorLine}
              <button id="retry-failed-btn" class="hud-retry">${retryLabel}</button>
              <div class="hud-sub">${describeRetryFailedCost(state.provider)}</div>
            </div>
          `;
        }
        return `
          <div class="hud-card">
            <div class="hud-title">翻译完成</div>
            <div class="hud-sub">成功 ${state.translatedCount}，失败 ${state.failedCount}，缓存 ${state.cachedCount}</div>
            ${missingLine}
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

  /**
   * Why a run that translated nothing came out empty.
   *
   * Three causes, three different things for the reader to do about them:
   * the pages have not loaded yet (scroll and wait), they are too small to
   * be comic pages (nothing to do), or they were already translated
   * (nothing to do). The popup used to lead with the second one, so a
   * reader whose chapter was lazy-loading went off to resize images that
   * were perfectly fine.
   *
   * `pendingCount` is what tells the first from the rest. Without it the
   * HUD falls back to `skippedCount`: no image was rejected for its size
   * either, which on a comic reader means they simply have not arrived
   * yet.
   *
   * The pending case has two endings, and they are not the same promise.
   * When the page is armed for auto-continue, scrolling is enough. When it
   * is not, the reader has to press the button again — and telling them
   * otherwise leaves them waiting for a translation that never comes.
   */
  private renderEmptyReason(
    state: Extract<HudState, { status: 'complete' }>
  ): string {
    const pending = state.pendingCount ?? 0;
    const duplicate = state.skippedDuplicateCount ?? 0;
    const filtered = state.skippedCount ?? 0;

    if (pending > 0) {
      /*
       * The budget ran out on this page.
       *
       * This used to be the "armed" wording, and it was a promise the page
       * could not keep: the follow-up budget was spent, the observer was
       * stopped, and yet the HUD kept telling the reader that scrolling
       * would bring the translation. The reader scrolled, waited, and got
       * nothing — with no way to tell a broken promise from a finished run.
       *
       * Saying it plainly is also the honest billing news: nothing more will
       * be requested, so nothing more will be charged. The way back is the
       * same button, and one press refills the budget.
       */
      if (state.autoContinueBudgetExhausted) {
        return `<div class="hud-sub">本页有 ${pending} 张图片还在加载。这一页的自动续翻已经用完次数，不会再自动翻译（不会再产生费用）；再点一次「翻译当前页面」可以重新开始。</div>`;
      }
      // Unknown means "not armed": the HUD must not promise a continuation
      // it cannot know about.
      return state.autoContinueArmed
        ? `<div class="hud-sub">本页有 ${pending} 张图片还在加载，滚动到它们出现后会自动继续翻译（${describeFee(
            state.provider
          )}）。</div>`
        : `<div class="hud-sub">本页有 ${pending} 张图片还在加载，滚动到它们出现后，需要再点一次「翻译当前页面」才会处理它们。</div>`;
    }
    if (duplicate > 0) {
      return `<div class="hud-sub">本页 ${duplicate} 张图片已经翻译过了。</div>`;
    }
    if (filtered > 0) {
      return `<div class="hud-sub">${filtered} 张${SKIPPED_IMAGES_REASON}。</div>`;
    }
    return `<div class="hud-sub">图片可能还没加载出来。向下滚动页面，等图片出现后再试一次。</div>`;
  }

  private buildStyles(): string {
    return `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .hud-card {
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          /* The card has to have an edge on somebody else's page. On a dark
             page the translucent black card *is* the page — without a border
             the card's boundary was 1.00:1 against it and the HUD looked
             like part of the background. The reading panel already solved
             this the same way, so the HUD copies its border and shadow
             instead of inventing a second treatment. */
          border: 1px solid rgba(255, 255, 255, 0.5);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
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

        /* 收起之后：只剩一颗药丸，几乎不挡画面。 */
        .hud-card--collapsed {
          padding: 4px 6px;
          min-width: 0;
          border-radius: 999px;
        }

        .hud-collapse {
          border: none;
          background: transparent;
          color: #fff;
          font-family: inherit;
          font-size: 12px;
          line-height: 1.4;
          padding: 2px 8px;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
        }

        .hud-collapse:hover {
          background: rgba(255, 255, 255, 0.15);
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
           The fill is the product's own accent — the same cyan-400 as the
           focus ring and the reading panel's number badge — because a blue
           widget bolted onto a cyan product reads as a different tool.
           Cyan-400 and the old blue-300 happen to share a luminance, so
           the 3.18:1 against the track is the same either way; the reason
           to change it is that it is now the colour the user already
           knows. */
        .hud-progress-bar {
          background: #22d3ee;
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        /* The cancel button is the only way to stop a translation that is
           currently being billed, so it needs a real target: WCAG 2.5.8
           asks for 24x24 CSS pixels, and the old 12px text box measured
           about 24x14. It stays an inline link rather than a full-width
           button — that shape belongs to the retry button. */
        .hud-cancel {
          margin-top: 10px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.8);
          font-size: 12px;
          cursor: pointer;
          padding: 4px 0;
          min-height: 24px;
          display: inline-flex;
          align-items: center;
          text-decoration: underline;
        }

        .hud-cancel:hover {
          color: #fff;
        }

        /* The primary action is the product's accent with the dark ink on
           it — the same pairing the reading panel's number badge uses.
           White text on this cyan measured 1.81:1; the dark ink is 8.08:1
           on the 0.85-alpha fill over the card. */
        .hud-retry {
          margin-top: 10px;
          background: rgba(34, 211, 238, 0.85);
          border: none;
          border-radius: 6px;
          color: #0f172a;
          font-size: 12px;
          cursor: pointer;
          padding: 6px 12px;
          display: inline-block;
          width: 100%;
        }

        .hud-retry:hover {
          background: rgba(34, 211, 238, 1);
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
