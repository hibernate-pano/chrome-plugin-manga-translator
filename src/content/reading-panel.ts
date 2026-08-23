/**
 * ReadingPanel — 沉浸式阅读侧栏
 *
 * 在已翻译的漫画页右侧展示译文列表，每张图对应一条编号 entry：
 * - 标题：图片编号 + 第一个气泡译文预览
 * - 内容：所有气泡的译文（按从上到下的顺序）
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

export interface ReadingPanelOptions {
  /** 关闭/展开按钮的初始状态；默认 false（首次出现时展开） */
  initiallyCollapsed?: boolean;
  /** 跳转到目标元素时的高亮时长（毫秒），默认 1200 */
  highlightDurationMs?: number;
}

interface Entry {
  /** DOM 中图片元素本身的弱引用（用于定位） */
  image: HTMLImageElement;
  /** 图片编号（1-based），按翻译完成的顺序 */
  index: number;
  /** 该图所有气泡的译文（按 TextArea 数组顺序） */
  textAreas: TextArea[];
  /** entry 的 DOM 节点引用 */
  node: HTMLElement;
}

export class ReadingPanel {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private root: HTMLElement;
  private header: HTMLElement;
  private list: HTMLElement;
  private collapseBtn: HTMLButtonElement;

  private entries: Entry[] = [];
  private collapsed: boolean;
  private highlightMs: number;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ReadingPanelOptions = {}) {
    this.collapsed = opts.initiallyCollapsed ?? false;
    this.highlightMs = opts.highlightDurationMs ?? 1200;

    this.host = document.createElement('section');
    this.host.setAttribute('data-manga-translator-reading-panel', 'true');
    this.host.setAttribute('aria-label', '漫画译文阅读面板');

    Object.assign(this.host.style, {
      position: 'fixed',
      top: '80px',
      right: '16px',
      width: '320px',
      maxHeight: 'calc(100vh - 120px)',
      zIndex: '2147483646',
      pointerEvents: 'auto',
    });

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `${this.buildStyles()}
<div id="root">
  <header id="header">
    <div>
      <strong>阅读面板</strong>
      <span id="count" data-testid="count">0 张</span>
    </div>
    <button id="collapse-btn" type="button" aria-label="收起面板">−</button>
  </header>
  <ol id="list" role="list"></ol>
  <p id="empty">本页翻译完成后，译文会按图片顺序出现在这里。</p>
</div>
`;

    this.root = this.shadow.getElementById('root') as HTMLElement;
    this.header = this.shadow.getElementById('header') as HTMLElement;
    this.list = this.shadow.getElementById('list') as HTMLElement;
    this.collapseBtn = this.shadow.getElementById('collapse-btn') as HTMLButtonElement;

    const empty = this.shadow.getElementById('empty') as HTMLElement;
    this.collapseBtn.addEventListener('click', () => this.toggleCollapsed());

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
   */
  upsert(image: HTMLImageElement, textAreas: TextArea[]): void {
    const existing = this.entries.find(e => e.image === image);
    if (existing) {
      existing.textAreas = textAreas;
      this.renderEntryContent(existing);
      return;
    }

    const index = this.entries.length + 1;
    const node = document.createElement('li');
    node.className = 'entry';
    node.setAttribute('data-index', String(index));
    node.setAttribute('role', 'listitem');
    node.tabIndex = 0;

    const entry: Entry = { image, index, textAreas, node };
    this.entries.push(entry);

    // Wire click on entry → scroll image into view
    node.addEventListener('click', () => this.focusImage(entry));
    node.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.focusImage(entry);
      }
    });

    this.list.appendChild(node);
    this.renderEntryContent(entry);
    this.refreshCount();
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
   * 滚动指定编号的 entry 到视口，并闪高亮。
   * 由 content.ts 在收到 reading-anchor-click 事件时调用。
   */
  focusEntryByIndex(index: number): void {
    const entryNode = this.shadow.querySelector<HTMLElement>(
      `.entry[data-index="${index}"]`
    );
    if (!entryNode) return;
    entryNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    entryNode.classList.add('flash');
    setTimeout(() => entryNode.classList.remove('flash'), 1200);
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

    const preview =
      texts[0]?.slice(0, 36) ?? `图片 #${entry.index}（无文字气泡）`;

    nodeSet(entry.node, this.buildEntryInner(entry.index, preview, texts));
  }

  private buildEntryInner(
    index: number,
    preview: string,
    texts: string[]
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

    if (texts.length > 1) {
      const body = document.createElement('div');
      body.className = 'entry-body';
      const ul = document.createElement('ul');
      texts.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      body.appendChild(ul);
      frag.appendChild(body);
    } else if (texts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'entry-empty';
      empty.textContent = '该图未识别出可翻译文字';
      frag.appendChild(empty);
    }

    return frag;
  }

  private refreshCount(): void {
    const counter = this.shadow.getElementById('count');
    if (!counter) return;
    counter.textContent = `${this.entries.length} 张`;
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
  #count {
    font-size: 11px;
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.2);
    padding: 1px 6px;
    border-radius: 999px;
  }
  #collapse-btn {
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
  #collapse-btn:hover { background: rgba(148, 163, 184, 0.15); color: #e2e8f0; }
  #collapse-btn:focus-visible {
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
    color: #64748b;
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
    font-size: 11px;
    color: #64748b;
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
