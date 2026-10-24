/**
 * ImageExportDialog — 保存译文图片
 *
 * 用户付了钱给这一页译文，译文却只活在别人的页面上：换个浏览器就没了，
 * 关掉标签页就没了。这个弹窗把"原图 + 译文气泡"合成成一张 PNG 交给用户，
 * 让译文变成一个用户真的能留下的东西。
 *
 * 弹窗做的事很薄：合成交给 `@/services/image-exporter`，这里只负责
 * - 展示预览（一张长条漫画不能把按钮挤出屏幕，所以预览有高度上限）
 * - 让用户改文件名
 * - 走一次真实的用户手势把文件下载下来
 *
 * 实现：原生 DOM + Shadow DOM 隔离样式，类比 reading-panel.ts。
 * 本类是单例（同一页面只一个弹窗），重复打开复用同一个宿主元素。
 */

import {
  buildDefaultFilename,
  exportTranslatedImage,
  sanitizeFilename,
} from '@/services/image-exporter';
import {
  parseTranslationError,
  TranslationErrorCode,
} from '@/utils/error-handler';
import type { OverlayStyle } from '@/services/renderer';
import type { TextArea } from '@/providers/base';

/**
 * 一张图 + 这张图上的译文 + 覆盖层样式。
 */
export interface ImageExportRequest {
  /** 要导出的图片元素。 */
  image: HTMLImageElement;
  /** 这张图上的译文。 */
  textAreas: TextArea[];
  /** 覆盖层样式，必须和页面上用的是同一份，否则导出的和看到的对不上。 */
  style: OverlayStyle;
  /** 这张图在本章里的编号，用在默认文件名里。 */
  index?: number;
  /** 打开弹窗的按钮；关闭时焦点回到它。 */
  trigger?: HTMLElement | null;
}

/**
 * 把一个错误变成一句能给人看的话。
 *
 * 弹窗以前直接把原始错误文本显示出来，于是用户看到的是
 * 「合成失败：Failed to fetch image: 403」—— worker 内部用语，一句英文，
 * 而且没有告诉他该怎么办。全产品其它错误出口都走
 * `parseTranslationError`（同一个分类器、同一套建议），这里也不例外。
 */
function describeError(error: unknown): string {
  const friendly = parseTranslationError(error);
  return friendly.suggestion
    ? `${friendly.message}。${friendly.suggestion}`
    : friendly.message;
}

/**
 * 这个错误重试一次有意义吗。
 *
 * 「Blocked image URL」「Image too large」这类失败重试一万次也是同样的
 * 结果；按钮上写着「重试」却永远不会成功，比没有按钮更让人白等。
 * 取图失败里的"站点临时抽风"才值得再试一次。
 */
function isRetryableError(error: unknown): boolean {
  const code = parseTranslationError(error).code;
  if (code === TranslationErrorCode.IMAGE_FETCH_ERROR) {
    // 护栏拦下的内网地址、超过尺寸上限的图：换一页也没用。
    const detail = error instanceof Error ? error.message : String(error);
    return !(
      detail.includes('Blocked image URL') ||
      detail.includes('Image too large') ||
      detail.includes('Response is not an image')
    );
  }
  return true;
}

export class ImageExportDialog {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private card: HTMLElement;
  private preview: HTMLImageElement;
  private status: HTMLElement;
  private filenameInput: HTMLInputElement;
  private downloadBtn: HTMLButtonElement;
  private retryBtn: HTMLButtonElement;

  /** 当前要导出的那一份请求。 */
  private request: ImageExportRequest | null = null;
  /** 合成好的 PNG。 */
  private composedBlob: Blob | null = null;
  /** 预览用的 object URL。 */
  private previewUrl: string | null = null;
  /** 打开弹窗之前焦点在哪儿，关闭时还回去。 */
  private opener: HTMLElement | null = null;
  /** 弹窗是不是开着。 */
  private opened = false;
  /** 弹窗是不是已经被拆掉。 */
  private destroyed = false;
  /**
   * 合成任务的代号。
   *
   * 合成要等 worker 取回原图，慢的时候用户可能已经关了弹窗或者换了一张图。
   * 代号用来把过期的结果扔掉，否则旧的结果会盖掉新图的结果。
   */
  private composeToken = 0;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-manga-translator-image-export', 'true');

    Object.assign(this.host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'none',
    });

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `${this.buildStyles()}
<div id="backdrop">
  <div id="card" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1">
    <h2 id="dialog-title">保存译文图片</h2>
    <p id="status" role="status" aria-live="polite"></p>
    <div id="preview-area">
      <img id="preview" alt="译文图片预览" />
    </div>
    <div class="field">
      <label for="filename">文件名</label>
      <input id="filename" type="text" spellcheck="false" autocomplete="off" />
    </div>
    <div id="actions">
      <button id="download" type="button" class="primary" disabled>下载 PNG</button>
      <button id="retry" type="button" hidden>重试</button>
      <button id="close" type="button">关闭</button>
    </div>
  </div>
</div>
`;

    this.card = this.shadow.getElementById('card') as HTMLElement;
    this.preview = this.shadow.getElementById('preview') as HTMLImageElement;
    this.status = this.shadow.getElementById('status') as HTMLElement;
    this.filenameInput = this.shadow.getElementById(
      'filename'
    ) as HTMLInputElement;
    this.downloadBtn = this.shadow.getElementById(
      'download'
    ) as HTMLButtonElement;
    this.retryBtn = this.shadow.getElementById('retry') as HTMLButtonElement;

    this.shadow
      .getElementById('close')
      ?.addEventListener('click', () => this.close());
    this.downloadBtn.addEventListener('click', () => this.download());
    this.retryBtn.addEventListener('click', () => {
      void this.compose();
    });

    // 点背景（卡片以外的地方）也算关闭。用户按 Esc 是知道的，点背景不是，
    // 所以两条路都得通。
    //
    // 判断的是"点在卡片外面"，而不是"点的就是 host"：#backdrop 铺满了整个
    // host，点击的 target 永远是 backdrop。原来的写法让这条路径永远不成立，
    // 用户点了背景什么也不会发生。
    const backdrop = this.shadow.getElementById('backdrop');
    backdrop?.addEventListener('click', event => {
      if (event.target === backdrop) {
        this.close();
      }
    });

    // Escape 关闭，Tab 锁在弹窗内。监听挂在 document 上而不是卡片里：焦点
    // 可能已经被用户带到了别处（页面上的其它控件），卡片里的监听就收不到
    // 这个键了。
    this.escapeHandler = (event: KeyboardEvent) => {
      if (!this.opened) {
        return;
      }
      if (event.key === 'Escape') {
        this.close();
        return;
      }
      if (event.key === 'Tab') {
        this.trapFocus(event);
      }
    };
    document.addEventListener('keydown', this.escapeHandler, true);

    document.body.appendChild(this.host);
  }

  private escapeHandler: (event: KeyboardEvent) => void;

  /**
   * Keep Tab inside the dialog.
   *
   * The dialog says `aria-modal="true"`, so it has to behave like one: a Tab
   * that walks out into the third-party page behind leaves the user focused
   * on something they cannot see, with no way to tell where they are.
   */
  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.shadow.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  /** Shadow root，测试和外部代码要看弹窗内部时用。 */
  get shadowRoot(): ShadowRoot {
    return this.shadow;
  }

  /** 宿主元素。 */
  get hostElement(): HTMLElement {
    return this.host;
  }

  /** 弹窗是不是开着。 */
  isOpen(): boolean {
    return this.opened;
  }

  /** 弹窗是不是已经被拆掉了。 */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * 打开弹窗，开始合成。
   *
   * 同一个弹窗可以反复打开：宿主元素是复用的，每次打开换一份请求、重新
   * 合成一次。
   */
  open(request: ImageExportRequest): void {
    this.request = request;

    // 关掉焦点回到哪儿：优先用触发按钮，没有就用当前焦点。
    this.opener =
      request.trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);

    // 页面可能换掉自己的 document.body（SPA 常见），宿主元素会被静默
    // detach 掉。重新挂一次，不然弹窗开了但用户看不见。
    if (!this.host.isConnected) {
      document.body.appendChild(this.host);
    }

    this.opened = true;
    this.host.style.display = 'flex';

    this.filenameInput.value = buildDefaultFilename(
      // 用 hostname 而不是 host：host 带着端口号，`example.com:8080` 会被
      // 收拾成 `example.com8080`，读起来像个域名。
      window.location.hostname,
      request.index ?? 1
    );

    // 焦点进到弹窗里：读屏软件要能马上念出弹窗的名字。
    this.card.focus();

    void this.compose();
  }

  /** 关闭弹窗。 */
  close(): void {
    if (!this.opened) {
      return;
    }
    this.opened = false;
    this.host.style.display = 'none';

    this.preview.removeAttribute('src');
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
    this.composedBlob = null;

    // 在途的合成作废：它回来的时候弹窗已经关了。
    this.composeToken += 1;

    const opener = this.opener;
    this.opener = null;
    opener?.focus();
  }

  /** 拆掉弹窗（页面卸载场景）。 */
  destroy(): void {
    this.close();
    this.destroyed = true;
    document.removeEventListener('keydown', this.escapeHandler, true);
    this.host.remove();
  }

  /**
   * 取原图、合成、出 PNG。
   */
  private async compose(): Promise<void> {
    const request = this.request;
    if (!request) {
      return;
    }

    const token = ++this.composeToken;

    this.composedBlob = null;
    this.preview.removeAttribute('src');
    this.downloadBtn.disabled = true;
    this.retryBtn.hidden = true;
    this.setStatus('正在合成…');

    try {
      const blob = await exportTranslatedImage({
        image: request.image,
        textAreas: request.textAreas,
        style: request.style,
      });

      if (token !== this.composeToken) {
        return;
      }

      this.composedBlob = blob;
      this.previewUrl = URL.createObjectURL(blob);
      this.preview.src = this.previewUrl;
      this.downloadBtn.disabled = false;
      this.setStatus('');
    } catch (error) {
      if (token !== this.composeToken) {
        return;
      }
      // 弹窗留着。能不能重试取决于这个错误值不值得重试：CDN 抖一下值得，
      // 站点永久拒绝不值得 —— 后者再点一次只是白等。
      this.setStatus(`合成失败：${describeError(error)}`, true);
      this.retryBtn.hidden = !isRetryableError(error);
    }
  }

  /**
   * 下载 PNG。
   *
   * 必须是真实的用户手势路径：blob URL + 一个 `download` 的 `<a>` +
   * `click()`。`canvas.toDataURL` 走不了下载，而且大图会撑爆 data URL 的
   * 长度上限。
   */
  private download(): void {
    const blob = this.composedBlob;
    if (!blob) {
      return;
    }

    const filename = this.resolveFilename();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    // 锚点挂在 document.body 上而不是 shadow root 里：`download` 属性在
    // shadow root 里能不能触发下载依赖浏览器实现，挂在文档里是可靠的那条路。
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
  }

  /**
   * 用户想要的文件名。
   *
   * 存成一个真正合法的文件名，并在输入框里回显——用户得看见最后下载到的
   * 到底是什么名字。
   */
  private resolveFilename(): string {
    const cleaned = sanitizeFilename(this.filenameInput.value);
    const base = cleaned.length > 0 ? cleaned : 'manga';
    const filename = base.toLowerCase().endsWith('.png') ? base : `${base}.png`;
    this.filenameInput.value = filename;
    return filename;
  }

  private setStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('error', isError);
  }

  private buildStyles(): string {
    return `
<style>
  :host, * { box-sizing: border-box; }
  #backdrop {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(2, 6, 23, 0.72);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
                 'Microsoft YaHei', sans-serif;
    color: #e2e8f0;
  }
  #card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(560px, 100%);
    /* 预览有 60vh 的上限，加上输入框和按钮也还在一屏之内。 */
    max-height: 90vh;
    padding: 18px;
    border-radius: 12px;
    background: rgb(15, 23, 42);
    border: 1px solid rgba(148, 163, 184, 0.6);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  #card:focus { outline: none; }
  #card:focus-visible { outline: 2px solid #22d3ee; outline-offset: 2px; }
  #dialog-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  #status {
    margin: 0;
    min-height: 16px;
    font-size: 12px;
    /* #64748b 在这个面板底色上只有 3.22:1；#94a3b8 是 5.97:1。 */
    color: #94a3b8;
  }
  #status.error { color: #fca5a5; }
  #preview-area {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 120px;
    padding: 8px;
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.6);
  }
  #preview {
    display: block;
    max-width: 100%;
    /* 长条漫画不能把按钮挤出屏幕。 */
    max-height: 60vh;
    object-fit: contain;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field label { font-size: 12px; color: #94a3b8; }
  #filename {
    width: 100%;
    padding: 8px 10px;
    font-size: 13px;
    color: #e2e8f0;
    background: rgba(2, 6, 23, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px;
  }
  #filename:focus-visible { outline: 2px solid #22d3ee; outline-offset: 1px; }
  #actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  #actions button {
    padding: 8px 14px;
    font-size: 13px;
    color: #e2e8f0;
    background: rgba(148, 163, 184, 0.15);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
  }
  #actions button:hover:not(:disabled) { background: rgba(148, 163, 184, 0.28); }
  #actions button:focus-visible { outline: 2px solid #22d3ee; outline-offset: 1px; }
  #actions button:disabled { opacity: 0.5; cursor: not-allowed; }
  #actions button.primary {
    color: #0f172a;
    font-weight: 600;
    background: #22d3ee;
    border-color: #22d3ee;
  }
  #actions button.primary:hover:not(:disabled) { background: #67e8f9; }
</style>
`;
  }
}

let dialogInstance: ImageExportDialog | null = null;

/**
 * 拿到这一页的导出弹窗。
 *
 * 单例：重复打开复用同一个宿主元素，页面上不会攒出一堆弹窗。
 */
export function getImageExportDialog(): ImageExportDialog {
  if (!dialogInstance || dialogInstance.isDestroyed()) {
    dialogInstance = new ImageExportDialog();
  }
  return dialogInstance;
}
