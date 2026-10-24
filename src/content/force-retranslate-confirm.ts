/**
 * 忽略缓存重翻的二次确认。
 *
 * 弹窗里的「忽略缓存重翻」按钮有一层确认，写明了会花多少钱：
 * 「本页有 N 张图片会重新调用 Vision LLM 翻译，会产生额外的 API 调用费用。」
 * 而同一个动作的键盘快捷键（Ctrl/⌘+Shift+X）没有任何确认——
 * 用户按下一个键，整页图片被重新请求一遍，账单上多出这一页的钱，而反馈
 * 只有一行「翻译完成 成功 12」。
 *
 * 更糟的是弹窗把这条快捷键写进了常驻的快捷键列表：扩展在教用户按那个
 * 唯一会静默花钱的键。
 *
 * 确认框放在页面里而不是弹窗里，有三个原因：
 *
 * 1. 内容脚本知道本页真实的图片数。弹窗要问一次才拿得到（一次可能失败的
 *    往返），而用户看到的金额必须是真的。
 * 2. 快捷键和右键菜单走的是同一条路径，一处确认，两处生效。
 * 3. 不依赖 `chrome.action.openPopup()`——那个 API 在不同 Chrome 版本上的
 *    可用性不一样，命令处理器里用它会让确认在旧版本上直接消失。
 *
 * 实现：原生 DOM + Shadow DOM，类比 reading-panel.ts / floating-hud.ts。
 */

import { describeForceRetranslate } from '@/shared/cost-wording';

/** 一次确认请求。 */
export interface ForceRetranslateConfirmRequest {
  /** 本页已经加载好、会被重新请求的图片数。 */
  imageCount: number;
  /**
   * 通过了过滤、但字节还没到的图片数。
   *
   * 它们不在 `imageCount` 里，却会在这之后被翻译：自动续翻开着的时候，
   * 它们一加载就会送去模型并计费。只报 `imageCount` 而写着「本页全部
   * N 张」，是把一笔正在路上的钱说成了零 —— 一个偏低的报价比没有报价更糟。
   */
  pending?: number;
  /**
   * 这一页此刻会不会自动翻译新加载的图片。
   *
   * 「加载后会自动翻译」是设置和预算决定的，不是页面决定的。不确定的时候
   * 传 false：宁可少承诺一次自动翻译，也不要在没发生的时候让用户以为发生了。
   */
  autoContinueArmed?: boolean;
  /**
   * 用的是哪个服务商。
   *
   * 本地服务商不花钱：这个确认框是花钱之前唯一的一次说明，不能对本地用户
   * 也说"会产生费用"。
   */
  provider?: string | null;
  /** 用户点了「重新翻译」。 */
  onConfirm: () => void;
  /** 用户点了「取消」，或者按了 Esc。 */
  onCancel: () => void;
}

const HOST_ATTRIBUTE = 'data-manga-translator-confirm';

export class ForceRetranslateConfirm {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private request: ForceRetranslateConfirmRequest | null = null;
  /** 打开之前焦点在哪儿，关掉时还回去。 */
  private opener: HTMLElement | null = null;
  private opened = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute(HOST_ATTRIBUTE, 'true');

    Object.assign(this.host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'none',
    });

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `${this.buildStyles()}
<div id="backdrop">
  <div id="card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" tabindex="-1">
    <h2 id="confirm-title">忽略缓存重新翻译？</h2>
    <p id="confirm-body"></p>
    <div id="actions">
      <button id="cancel" type="button">取消</button>
      <button id="confirm" type="button" class="danger">重新翻译</button>
    </div>
  </div>
</div>
`;

    this.shadow.getElementById('cancel')?.addEventListener('click', () => {
      this.settle(false);
    });
    this.shadow.getElementById('confirm')?.addEventListener('click', () => {
      this.settle(true);
    });

    // 点背景也算取消。和"确认"相反：误触背景不该花钱。
    const backdrop = this.shadow.getElementById('backdrop');
    backdrop?.addEventListener('click', event => {
      if (event.target === backdrop) {
        this.settle(false);
      }
    });

    // Esc 取消，Tab 锁在对话框内。
    this.keyHandler = (event: KeyboardEvent) => {
      if (!this.opened) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.settle(false);
        return;
      }
      if (event.key === 'Tab') {
        this.trapFocus(event);
      }
    };
    document.addEventListener('keydown', this.keyHandler, true);

    document.body.appendChild(this.host);
  }

  private keyHandler: (event: KeyboardEvent) => void;

  /** Shadow root，测试和外部代码要看弹窗内部时用。 */
  get shadowRoot(): ShadowRoot {
    return this.shadow;
  }

  /** 弹窗是不是开着。 */
  isOpen(): boolean {
    return this.opened;
  }

  /** 打开确认框。 */
  open(request: ForceRetranslateConfirmRequest): void {
    this.request = request;

    this.opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (!this.host.isConnected) {
      document.body.appendChild(this.host);
    }

    const body = this.shadow.getElementById('confirm-body');
    if (body) {
      /*
       * 弹窗里那一句「忽略缓存……已经翻译成功的图片也会重新计费」在这里
       * 也得说全。快捷键走的是这条路，弹窗走的是另一条；同一个动作，两
       * 种说法，就有一处会漏掉最贵的那半句 —— 已经翻好的页面会再被计
       * 一次费，而这个用户根本看不出来。
       */
      const provider = request.provider ?? null;
      body.textContent = describeForceRetranslate(
        request.imageCount,
        provider,
        request.pending ?? 0,
        request.autoContinueArmed ?? false
      );
    }

    this.opened = true;
    this.host.style.display = 'flex';

    // 焦点落在「取消」上：危险动作的安全默认是不执行。
    this.shadow.getElementById('cancel')?.focus();
  }

  /** 拆掉（页面卸载场景）。 */
  destroy(): void {
    this.opened = false;
    this.request = null;
    document.removeEventListener('keydown', this.keyHandler, true);
    this.host.remove();
  }

  /**
   * 结束这一次确认。
   *
   * `confirmed` 决定走确认还是取消；两条路都必须把请求清掉，否则确认框
   * 会一直留在页面上。
   */
  private settle(confirmed: boolean): void {
    if (!this.opened) {
      return;
    }
    this.opened = false;
    this.host.style.display = 'none';

    const request = this.request;
    this.request = null;

    const opener = this.opener;
    this.opener = null;
    opener?.focus();

    if (confirmed) {
      request?.onConfirm();
    } else {
      request?.onCancel();
    }
  }

  /**
   * Keep Tab inside the dialog.
   *
   * The dialog claims `aria-modal="true"`, so it has to behave like one: a
   * Tab that walks out into the third-party page behind leaves the user
   * focused on something they cannot see.
   */
  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.shadow.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    const active = this.shadow.activeElement as HTMLElement | null;
    const index = active ? focusable.indexOf(active) : -1;
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (index === -1 || index === focusable.length - 1) {
      event.preventDefault();
      first.focus();
    }
  }

  private buildStyles(): string {
    return `
      :host {
        all: initial;
      }

      #backdrop {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(2, 6, 23, 0.72);
        font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      }

      #card {
        width: 100%;
        max-width: 380px;
        box-sizing: border-box;
        padding: 20px;
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.6);
        background: #0f172a;
        color: #e2e8f0;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      }

      #card:focus {
        outline: none;
      }

      h2 {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 600;
        color: #f8fafc;
      }

      p {
        margin: 0 0 16px;
        font-size: 13px;
        line-height: 1.6;
        color: #cbd5e1;
      }

      #actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      button {
        min-height: 32px;
        padding: 0 14px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: #020617;
        color: #e2e8f0;
        font-size: 13px;
        cursor: pointer;
      }

      button.danger {
        border-color: transparent;
        background: #b91c1c;
        color: #ffffff;
        font-weight: 500;
      }

      button:hover {
        filter: brightness(1.15);
      }

      button:focus-visible {
        outline: 2px solid #22d3ee;
        outline-offset: 2px;
      }

      @media (prefers-reduced-motion: reduce) {
        button {
          transition: none;
        }
      }
    `;
  }
}

let instance: ForceRetranslateConfirm | null = null;

/** 页面里唯一的确认框。 */
export function getForceRetranslateConfirm(): ForceRetranslateConfirm {
  if (!instance) {
    instance = new ForceRetranslateConfirm();
  }
  return instance;
}
