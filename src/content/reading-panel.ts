/**
 * ReadingPanel — 沉浸式阅读侧栏
 *
 * 在已翻译的漫画页右侧展示译文列表，每张图对应一条编号 entry：
 * - 标题：图片编号 + 第一个气泡译文预览
 * - 内容：预览之外的气泡译文（按从上到下的顺序，不重复标题里已有的内容）
 *
 * 交互：
 * - 点击 entry：滚动对应图片到视口 + 短闪高亮
 * - 点击图片锚点：滚动 entry 到视口 + 短闪高亮
 *
 * 实现：原生 DOM + Shadow DOM 隔离样式，类比 floating-hud.ts。
 *
 * 本类是单例（同一页面只一个面板），由 content.ts 在首次翻译前创建并
 * 在所有图片清空时调用 reset() 重新开始。
 */

import type { TextArea } from '@/providers/base';
import { compareImagesByDocumentOrder } from '@/services/reading-order';

export interface ReadingPanelOptions {
  /** 关闭/展开按钮的初始状态；默认 false（首次出现时展开） */
  initiallyCollapsed?: boolean;
  /** 跳转到目标元素时的高亮时长（毫秒），默认 1200 */
  highlightDurationMs?: number;
}

interface Entry {
  /** DOM 中图片元素本身的弱引用（用于定位） */
  image: HTMLImageElement;
  /** 图片编号（1-based），按图片在 DOM 中的位置 */
  index: number;
  /** 该图所有气泡的译文（按 TextArea 数组顺序） */
  textAreas: TextArea[];
  /** entry 的 DOM 节点引用 */
  node: HTMLElement;
}

/**
 * How many characters of the first bubble the entry head shows.
 *
 * The head is a one-line teaser. The panel is 320px wide and the head has
 * roughly 264px of room, which fits 22 CJK glyphs at 12px, so 20 leaves a
 * small margin. The teaser used to be cut at 36 characters — more than the
 * CSS ellipsis can show — and the body then repeated the whole first bubble
 * from the beginning, so the same sentence appeared twice.
 *
 * The body now starts where the teaser stopped: the part of the first bubble
 * that did not fit is carried over instead of being repeated or dropped.
 */
const PREVIEW_MAX_CHARS = 20;

/**
 * Where to cut the first bubble between the head and the body.
 *
 * A fixed cut at 20 characters lands wherever it lands: often in the middle
 * of a sentence, and sometimes right before a full stop, which left the
 * body starting with a stranded "。" on a line of its own. Cutting at the
 * last sentence mark keeps the head a complete thought, and a leftover
 * that is nothing but punctuation is dropped rather than shown.
 */
function splitPreview(
  text: string,
  limit: number
): { preview: string; rest: string } {
  if (text.length <= limit) {
    return { preview: text, rest: '' };
  }

  const sentenceEnd = Math.max(
    text.lastIndexOf('。', limit),
    text.lastIndexOf('！', limit),
    text.lastIndexOf('？', limit),
    text.lastIndexOf('…', limit),
    text.lastIndexOf('!', limit),
    text.lastIndexOf('?', limit),
    text.lastIndexOf('\n', limit)
  );
  // Only cut at a sentence mark when it is not too early: a two-character
  // head is worse than a broken sentence.
  const cut = sentenceEnd >= Math.floor(limit / 2) ? sentenceEnd + 1 : limit;
  const preview = text.slice(0, cut);
  const rest = text
    .slice(cut)
    .replace(/^[\s。．.！!？?…、，,；;：:「」『』（）()]+/, '');

  return { preview, rest };
}

/**
 * Compare two images by their position in the document.
 *
 * The rule itself lives in `@/services/reading-order`, because the content
 * script needs the same one to number the images the way the panel does.
 */
export class ReadingPanel {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private root: HTMLElement;
  private list: HTMLElement;
  private collapseBtn: HTMLButtonElement;
  private hideBtn: HTMLButtonElement;

  private entries: Entry[] = [];
  private collapsed: boolean;
  /**
   * Whether the panel is shown at all. Distinct from `collapsed`: collapsing
   * leaves a header handle, hiding removes the panel from the page.
   */
  private visible: boolean;
  private highlightMs: number;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ReadingPanelOptions = {}) {
    this.collapsed = opts.initiallyCollapsed ?? false;
    this.visible = true;
    this.highlightMs = opts.highlightDurationMs ?? 1200;

    this.host = document.createElement('section');
    this.host.setAttribute('data-manga-translator-reading-panel', 'true');
    this.host.setAttribute('aria-label', '漫画译文阅读面板');

    // The host is a fixed-position shrink-to-fit box: its width comes from
    // `#root`, not from itself.
    //
    // It used to carry `width: 320px` and `pointer-events: auto` itself.
    // That made the collapsed panel a 320px-wide invisible rectangle sitting
    // over the page's right margin, eating clicks on whatever was underneath
    // it. A reader who collapsed the panel to get it out of the way still
    // could not click the region it covered.
    Object.assign(this.host.style, {
      position: 'fixed',
      top: '80px',
      right: '16px',
      maxHeight: 'calc(100vh - 120px)',
      zIndex: '2147483646',
      // The host itself must not capture clicks; only the panel's own pixels
      // do, via `#root`.
      pointerEvents: 'none',
    });

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `${this.buildStyles()}
<div id="root">
  <header id="header">
    <div>
      <strong>阅读面板</strong>
      <span id="count" data-testid="count">0 张</span>
    </div>
    <div id="header-actions">
      <button id="collapse-btn" type="button" aria-label="收起面板">−</button>
      <button id="hide-btn" type="button" aria-label="隐藏面板" title="隐藏面板">✕</button>
    </div>
  </header>
  <ol id="list" role="list"></ol>
  <p id="empty">本页翻译完成后，译文会按图片顺序出现在这里。</p>
</div>
`;

    this.root = this.shadow.getElementById('root') as HTMLElement;
    this.list = this.shadow.getElementById('list') as HTMLElement;
    this.collapseBtn = this.shadow.getElementById(
      'collapse-btn'
    ) as HTMLButtonElement;
    this.hideBtn = this.shadow.getElementById('hide-btn') as HTMLButtonElement;

    const empty = this.shadow.getElementById('empty') as HTMLElement;
    this.collapseBtn.addEventListener('click', () => this.toggleCollapsed());
    this.hideBtn.addEventListener('click', () => this.requestHide());

    if (this.collapsed) {
      this.root.classList.add('collapsed');
      this.collapseBtn.textContent = '+';
      this.collapseBtn.setAttribute('aria-label', '展开面板');
    }

    // Update entry nodes when entries are upserted
    void empty;

    document.body.appendChild(this.host);
  }

  /**
   * 注册或更新某张图片的译文。
   * 如果 image 已有 entry，会用最新 textAreas 替换内容。
   *
   * 编号由图片在 DOM 中的位置决定（见 `reindex`），而不是翻译完成的顺序：
   * 翻译是并发跑的，完成顺序只反映视口优先级，不反映阅读顺序。
   *
   * 返回这条译文在章节里的编号，供调用方把图上的锚点编号对齐。
   */
  upsert(image: HTMLImageElement, textAreas: TextArea[]): number {
    const existing = this.entries.find(e => e.image === image);
    if (existing) {
      existing.textAreas = textAreas;
      this.renderEntryContent(existing);
      return existing.index;
    }

    const node = document.createElement('li');
    node.className = 'entry';
    node.setAttribute('role', 'listitem');
    node.tabIndex = 0;

    const entry: Entry = { image, index: 0, textAreas, node };

    // Wire click on entry → scroll image into view
    node.addEventListener('click', () => this.focusImage(entry));
    node.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.focusImage(entry);
      }
    });

    // The entry goes where it belongs in the chapter, not where it happens to
    // finish. Translation runs concurrently, so the completion order is the
    // viewport priority: a reader would get a shuffled list while the batch
    // runs, and then watch every entry jump to a new position at the end.
    const position = this.findInsertPosition(image);
    this.entries.splice(position, 0, entry);
    this.list.insertBefore(node, this.list.children[position] ?? null);

    // Inserting in the middle pushes the entries after it one place down, so
    // their numbers have to move with them.
    this.renumberFrom(position);
    this.renderEntryContent(entry);
    this.refreshCount();
    return entry.index;
  }

  /**
   * 找到这张图在阅读顺序里该待的位置。
   *
   * 列表始终按图片在 DOM 中的位置排列，所以新译文插到它该在的那一格，
   * 而不是排在最后。
   */
  private findInsertPosition(image: HTMLImageElement): number {
    let position = 0;
    while (position < this.entries.length) {
      const candidate = this.entries[position];
      if (!candidate) {
        break;
      }
      if (compareImagesByDocumentOrder(image, candidate.image) < 0) {
        break;
      }
      position += 1;
    }
    return position;
  }

  /**
   * 从某个位置开始重新编号。
   *
   * 只改编号，不重画内容：编号变了，句子没变，把整条 entry 重建一遍是浪费。
   */
  private renumberFrom(startPosition: number): void {
    for (
      let position = startPosition;
      position < this.entries.length;
      position++
    ) {
      const entry = this.entries[position];
      if (!entry) {
        continue;
      }
      const index = position + 1;
      if (entry.index === index) {
        continue;
      }
      entry.index = index;
      entry.node.setAttribute('data-index', String(index));
      const num = entry.node.querySelector<HTMLElement>('.entry-num');
      if (num) {
        num.textContent = String(index);
      } else {
        this.renderEntryContent(entry);
      }
    }
  }

  /**
   * 按图片在 DOM 中的位置重新排序并重新编号。
   *
   * 正常情况下 `upsert` 已经把顺序和编号都摆对了，这里只是一道保险：
   * 页面自己换了 DOM 顺序（例如把图片换了位置）之后，按钮跳转和编号
   * 仍然要指向正确的那一条。
   */
  reindex(): void {
    this.entries.sort((a, b) => compareImagesByDocumentOrder(a.image, b.image));

    this.entries.forEach((entry, position) => {
      const index = position + 1;
      if (entry.index === index) {
        return;
      }
      entry.index = index;
      entry.node.setAttribute('data-index', String(index));
      const num = entry.node.querySelector<HTMLElement>('.entry-num');
      if (num) {
        num.textContent = String(index);
      } else {
        this.renderEntryContent(entry);
      }
    });

    // The <ol> children must follow the same order as `entries`, otherwise
    // the list shows one order and the numbers another.
    this.entries.forEach(entry => {
      this.list.appendChild(entry.node);
    });
  }

  /**
   * 当前编号 → 图片 的映射，供外部（content.ts）在重排后同步锚点编号。
   */
  getIndexByImage(): Map<HTMLImageElement, number> {
    return new Map(this.entries.map(entry => [entry.image, entry.index]));
  }

  /**
   * 面板上现在列着的译文，按阅读顺序。
   *
   * 面板的承诺是"按阅读顺序列出每一句译文"，所以顺序本身就是要交付的
   * 东西，得能被外部（和测试）看见，不能只存在于 DOM 里。
   */
  getEntriesInOrder(): Array<{
    image: HTMLImageElement;
    index: number;
    textAreas: TextArea[];
  }> {
    return this.entries.map(entry => ({
      image: entry.image,
      index: entry.index,
      textAreas: entry.textAreas,
    }));
  }

  /** 清空面板与所有 entry */
  reset(): void {
    this.entries = [];
    while (this.list.firstChild) {
      this.list.removeChild(this.list.firstChild);
    }
    this.refreshCount();
  }

  /** 销毁面板 DOM（卸载场景） */
  destroy(): void {
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
    this.host.remove();
  }

  /** 暴露给外部以便测试或扩展 */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Is the panel still in the document?
   *
   * A page that replaces its own `document.body` (some SPAs do) detaches
   * the panel host without telling us. The next translation would then be
   * invisible, because `ensureServicesInitialized` only creates a panel when
   * the reference is null.
   */
  isAttached(): boolean {
    return this.host.isConnected;
  }

  /**
   * Show or hide the whole panel.
   *
   * Hiding is not the same as collapsing. Collapsing keeps the header bar
   * visible as a handle; hiding removes the panel from the page entirely,
   * which is what a "hide the panel" shortcut has to do — otherwise the
   * user is left with a strip of UI they cannot get rid of.
   *
   * The state is tracked separately from `collapsed` so that expanding a
   * hidden panel does not also un-collapse it, and vice versa.
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.host.style.display = visible ? '' : 'none';
    this.host.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  /** Whether the panel is currently shown. */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Collapse or expand the panel body.
   *
   * Exposed so that a caller outside the class (the content script, when it
   * handles the "toggle reading panel" command) can drive the same state the
   * header button drives.
   */
  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    this.toggleCollapsed();
  }

  /** Whether the panel body is currently collapsed. */
  isCollapsed(): boolean {
    return this.collapsed;
  }

  /**
   * 滚动指定编号的 entry 到视口，并闪高亮。
   * 由 content.ts 在收到 reading-anchor-click 事件时调用。
   */
  focusEntryByIndex(index: number): void {
    const entry = this.entries.find(e => e.index === index);
    const entryNode = this.shadow.querySelector<HTMLElement>(
      `.entry[data-index="${index}"]`
    );
    if (!entryNode) return;
    // A collapsed panel hides the list, so focusing an entry inside it
    // scrolls nothing and flashes nothing — the click would look like it
    // did nothing at all.
    if (this.collapsed) {
      this.setCollapsed(false);
    }
    entryNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    entryNode.classList.add('flash');
    setTimeout(() => entryNode.classList.remove('flash'), this.highlightMs);
    // The badge the user clicked sits on the image, but a manga page is
    // usually taller than the screen. Bringing the image's top into view
    // takes the reader to where that page starts, and puts the badge back
    // in its natural corner.
    entry?.image.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Drop the entry for one image.
   *
   * The user can remove a translation from the image itself. The panel is
   * another view of the same translations, so it has to drop it too —
   * otherwise the panel keeps listing a translation that is no longer on
   * the page.
   */
  remove(image: HTMLImageElement): void {
    const index = this.entries.findIndex(entry => entry.image === image);
    if (index === -1) {
      return;
    }
    const [entry] = this.entries.splice(index, 1);
    entry?.node.remove();
    // The numbers after the removed one shift down by one.
    this.reindex();
    this.refreshCount();
  }

  /**
   * 面板隐藏按钮按下的通知出口。
   *
   * 面板不能自己决定"消失"：它得先告诉宿主，宿主才知道要把状态报给弹窗
   * （弹窗上那个"隐藏阅读面板"按钮要跟着变），也才知道要把面板真的收起来。
   *
   * 网页当然也可以派发同名事件，但面板能做的只是"被隐藏"——没有比这更小的
   * 权限了，网页骗不出任何东西。
   */
  get hideEventTarget(): HTMLElement {
    return this.host;
  }

  /**
   * Ask the host to take the panel off the page.
   *
   * Collapsing leaves the header bar behind, and that bar still covers a
   * strip of the page. Some readers want the panel out of the way
   * entirely while they look at the artwork, and until now the only way to
   * get there was a keyboard shortcut nobody was told about.
   */
  private requestHide(): void {
    this.host.dispatchEvent(
      new CustomEvent('reading-panel-hide', { bubbles: true, composed: true })
    );
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    if (this.collapsed) {
      this.root.classList.add('collapsed');
      this.collapseBtn.textContent = '+';
      this.collapseBtn.setAttribute('aria-label', '展开面板');
    } else {
      this.root.classList.remove('collapsed');
      this.collapseBtn.textContent = '−';
      this.collapseBtn.setAttribute('aria-label', '收起面板');
    }
  }

  private focusImage(entry: Entry): void {
    entry.image.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.flashHighlight(entry.image);
    this.flashEntry(entry.node);
  }

  /**
   * 高亮图片。Shadow DOM 没法直接给页面图片加样式（页面 CSS 不受影响），
   * 所以用一次性 outline 样式 + class + 移除的方式。
   */
  private flashHighlight(target: HTMLElement): void {
    const originalOutline = target.style.outline;
    const originalOffset = target.style.outlineOffset;
    target.style.outline = '3px solid #22d3ee';
    target.style.outlineOffset = '2px';
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
    this.highlightTimer = setTimeout(() => {
      target.style.outline = originalOutline;
      target.style.outlineOffset = originalOffset;
    }, this.highlightMs);
  }

  private flashEntry(node: HTMLElement): void {
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), this.highlightMs);
  }

  private renderEntryContent(entry: Entry): void {
    const texts = entry.textAreas
      .map(area => (area.translatedText ?? '').trim())
      .filter(text => text.length > 0);

    const first = texts[0] ?? '';
    const split = splitPreview(first, PREVIEW_MAX_CHARS);
    const preview =
      split.preview.length > 0
        ? split.preview
        : `图片 #${entry.index}（无文字气泡）`;

    // The head already showed the beginning of the first bubble, so the body
    // starts where the head stopped. The rest of that bubble is carried over
    // instead of being repeated: printing the whole first bubble again under
    // its own teaser is how the same sentence used to show up twice.
    const bodyTexts =
      split.rest.length > 0 ? [split.rest, ...texts.slice(1)] : texts.slice(1);

    nodeSet(
      entry.node,
      this.buildEntryInner(entry.index, preview, bodyTexts, texts.length > 0)
    );
  }

  private buildEntryInner(
    index: number,
    preview: string,
    bodyTexts: string[],
    hasText: boolean
  ): DocumentFragment {
    const frag = document.createDocumentFragment();

    const head = document.createElement('div');
    head.className = 'entry-head';

    const num = document.createElement('span');
    num.className = 'entry-num';
    num.textContent = String(index);

    const previewEl = document.createElement('span');
    previewEl.className = 'entry-preview';
    previewEl.textContent = preview;

    head.appendChild(num);
    head.appendChild(previewEl);
    frag.appendChild(head);

    if (bodyTexts.length > 0) {
      const body = document.createElement('div');
      body.className = 'entry-body';
      const ul = document.createElement('ul');
      bodyTexts.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      body.appendChild(ul);
      frag.appendChild(body);
    } else if (!hasText) {
      // No bubble produced any text at all: the head is only a placeholder
      // and the body has to say so.
      const empty = document.createElement('div');
      empty.className = 'entry-empty';
      empty.textContent = '该图未识别出可翻译文字';
      frag.appendChild(empty);
    }

    return frag;
  }

  private refreshCount(): void {
    const counter = this.shadow.getElementById('count');
    if (counter) {
      counter.textContent = `${this.entries.length} 张`;
    }
    // The placeholder says "translations will appear here once the page is
    // translated". Once there ARE translations, that sentence is stale: the
    // list is right below it, and the two contradict each other.
    const empty = this.shadow.getElementById('empty');
    if (empty) {
      empty.hidden = this.entries.length > 0;
    }
  }

  private buildStyles(): string {
    return `
<style>
  :host, * { box-sizing: border-box; }
  #root {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
                 'Microsoft YaHei', sans-serif;
    color: #e2e8f0;
    background: rgba(15, 23, 42, 0.94);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 12px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: calc(100vh - 120px);
    overflow: hidden;
    /* Only the panel's own pixels capture clicks — the host is a shrink-to-fit
       wrapper around it. */
    pointer-events: auto;
    /* On a phone the fixed 320px was 85% of the screen: the panel covered
       the manga it was supposed to accompany. */
    width: min(320px, calc(100vw - 32px));
  }
  /* Collapsed, the panel is just its header bar. Keeping the full 320px width
     would leave an invisible rectangle over the page. */
  #root.collapsed {
    width: auto;
  }
  #root.collapsed #list,
  #root.collapsed #empty {
    display: none;
  }
  #header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    font-size: 13px;
  }
  #header strong { font-weight: 600; }
  #header > div { display: flex; align-items: center; gap: 8px; }
  #header-actions { gap: 2px; }
  #count {
    font-size: 11px;
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.2);
    padding: 1px 6px;
    border-radius: 999px;
  }
  #collapse-btn, #hide-btn {
    border: none;
    background: transparent;
    color: #94a3b8;
    font-size: 18px;
    cursor: pointer;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    transition: background 0.15s;
  }
  #hide-btn { font-size: 14px; }
  #collapse-btn:hover, #hide-btn:hover { background: rgba(148, 163, 184, 0.15); color: #e2e8f0; }
  #collapse-btn:focus-visible, #hide-btn:focus-visible {
    outline: 2px solid #22d3ee;
    outline-offset: 1px;
  }
  #list {
    list-style: none;
    padding: 8px;
    margin: 0;
    overflow-y: auto;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.3) transparent;
  }
  #list::-webkit-scrollbar { width: 6px; }
  #list::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.3);
    border-radius: 3px;
  }
  #empty {
    padding: 24px 16px;
    text-align: center;
    font-size: 12px;
    /* #64748b measured 3.22:1 against the panel surface (rgb(29,37,55) on
       a white page) — under the 4.5:1 that small text owes. #94a3b8 is
       5.97:1 and is the same grey the count badge already uses. */
    color: #94a3b8;
    line-height: 1.6;
    margin: 0;
  }
  .entry {
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 6px;
    cursor: pointer;
    transition: background 0.15s, transform 0.15s;
    border: 1px solid transparent;
  }
  .entry:hover {
    background: rgba(34, 211, 238, 0.08);
    border-color: rgba(34, 211, 238, 0.3);
  }
  .entry:focus-visible {
    outline: 2px solid #22d3ee;
    outline-offset: 1px;
  }
  .entry.flash {
    background: rgba(34, 211, 238, 0.18);
    border-color: rgba(34, 211, 238, 0.6);
  }
  .entry-head { display: flex; gap: 8px; align-items: center; }
  .entry-num {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #22d3ee;
    color: #0f172a;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
  }
  .entry-preview {
    font-size: 12px;
    color: #cbd5e1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .entry-body {
    margin-top: 6px;
    padding-left: 28px;
  }
  .entry-body ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .entry-body li {
    font-size: 12px;
    color: #e2e8f0;
    line-height: 1.6;
    padding: 2px 0;
  }
  .entry-empty {
    margin-top: 4px;
    padding-left: 28px;
    font-size: 12px;
    /* Same 3.22:1 -> 5.97:1 fix as #empty. */
    color: #94a3b8;
    font-style: italic;
  }
</style>
`;
  }
}

/**
 * 替换节点内容的轻量工具（避免引入 React 等运行时）。
 */
function nodeSet(node: HTMLElement, frag: DocumentFragment): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
  node.appendChild(frag);
}
