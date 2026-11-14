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

interface ReadingPanelOptions {
  /** 关闭/展开按钮的初始状态；默认 false（首次出现时展开） */
  initiallyCollapsed?: boolean;
  /** 跳转到目标元素时的高亮时长（毫秒），默认 1200 */
  highlightDurationMs?: number;
}

/** Which language the entry text leads with. */
type ReadingMode = 'translated' | 'original';

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
 * 滚动到某处时该用什么动画。
 *
 * 系统里开了"减少动态效果"的用户，被一段平滑滚动带着跑会晕 ——
 * 尤其是漫画页这种又长又窄的内容。浏览器把这个设置交给了网页，
 * 扩展自己的样式表管不到别人的页面（面板活在 shadow root 里），
 * 所以这里问一次浏览器就够了。
 *
 * 三个滚动调用点共用这一个判断，别把 `matchMedia` 的表达式抄三遍：
 * 抄一遍就有一处会漏。
 */
export function scrollBehavior(): ScrollBehavior {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return 'smooth';
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

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
  private modeOriginalBtn: HTMLButtonElement;
  private modeTranslatedBtn: HTMLButtonElement;

  private entries: Entry[] = [];
  private collapsed: boolean;
  /**
   * Which language the entries lead with. 「译文」 is the default — the
   * panel is a reading surface for the translation — and 「原文」 swaps the
   * two so a bilingual reader can compare the other way round.
   */
  private mode: ReadingMode = 'translated';
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
    <div id="header-title">
      <strong id="panel-title">译文阅读面板</strong>
      <span id="count" data-testid="count">0 张</span>
    </div>
    <div id="mode-switch" role="group" aria-label="显示原文或译文">
      <button id="mode-original" type="button" aria-pressed="false">原文</button>
      <button id="mode-translated" type="button" aria-pressed="true">译文</button>
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
    this.modeOriginalBtn = this.shadow.getElementById(
      'mode-original'
    ) as HTMLButtonElement;
    this.modeTranslatedBtn = this.shadow.getElementById(
      'mode-translated'
    ) as HTMLButtonElement;

    const empty = this.shadow.getElementById('empty') as HTMLElement;
    this.collapseBtn.addEventListener('click', () => this.toggleCollapsed());
    this.hideBtn.addEventListener('click', () => this.requestHide());
    this.modeOriginalBtn.addEventListener('click', () =>
      this.setMode('original')
    );
    this.modeTranslatedBtn.addEventListener('click', () =>
      this.setMode('translated')
    );

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
    entryNode.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    entryNode.classList.add('flash');
    setTimeout(() => entryNode.classList.remove('flash'), this.highlightMs);
    // The badge the user clicked sits on the image, but a manga page is
    // usually taller than the screen. Bringing the image's top into view
    // takes the reader to where that page starts, and puts the badge back
    // in its natural corner.
    entry?.image.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
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

  /**
   * Lead each entry with the translation or with the source text.
   *
   * Both languages already travel with every entry; this only decides which
   * one is set as the reading text and which one sits behind the 「原文」 /
   * 「译文」 disclosure. Every entry is re-rendered because the teaser is
   * cut from the leading text.
   */
  private setMode(mode: ReadingMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.root.classList.toggle('mode-original', mode === 'original');
    this.modeOriginalBtn.setAttribute(
      'aria-pressed',
      String(mode === 'original')
    );
    this.modeTranslatedBtn.setAttribute(
      'aria-pressed',
      String(mode === 'translated')
    );
    this.entries.forEach(entry => this.renderEntryContent(entry));
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
    entry.image.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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
    target.style.outline = '3px solid #D33A2C';
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
    const translated = entry.textAreas
      .map(area => (area.translatedText ?? '').trim())
      .filter(text => text.length > 0);

    // The source text travels with the translation (`TextArea.originalText`
    // is already populated by the model). The panel used to drop it, so the
    // one surface that is *for reading* was the one surface where the
    // original could not be read — a bilingual reader had nowhere to look.
    const originals = entry.textAreas
      .map(area => (area.originalText ?? '').trim())
      .filter(text => text.length > 0);

    // The header switch decides which language this entry leads with. A
    // translation with no source text (an OCR-only run, say) keeps leading
    // with the translation rather than going blank.
    const leadWithOriginal = this.mode === 'original' && originals.length > 0;
    const texts = leadWithOriginal ? originals : translated;
    const alternate = leadWithOriginal ? translated : originals;

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
      this.buildEntryInner(
        entry.index,
        preview,
        bodyTexts,
        texts.length > 0,
        alternate,
        leadWithOriginal ? '译文' : '原文'
      )
    );
  }

  private buildEntryInner(
    index: number,
    preview: string,
    bodyTexts: string[],
    hasText: boolean,
    alternate: string[] = [],
    alternateLabel = '原文'
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

    // The other language, collapsed by default so it does not compete with
    // the text being read for attention, but always one click away.
    if (alternate.length > 0) {
      const details = document.createElement('details');
      details.className = 'entry-original';

      const summary = document.createElement('summary');
      summary.className = 'entry-original-summary';
      summary.textContent = alternateLabel;
      // The summary sits inside the entry, and the entry scrolls its image
      // into view when clicked. Expanding the original text therefore
      // scrolled the manga page away from the panel the reader was reading
      // — the one control that only reveals text was the one control that
      // moved the page. The disclosure still toggles (the browser's own
      // <summary> behaviour); only the bubble-up is stopped.
      //
      // The keyboard path needs the same guard: the entry also handles
      // Enter/Space on keydown, and a summary focused by keyboard is
      // exactly where that fires.
      summary.addEventListener('click', event => {
        event.stopPropagation();
      });
      summary.addEventListener('keydown', event => {
        event.stopPropagation();
      });

      const list = document.createElement('ul');
      list.className = 'entry-original-list';
      alternate.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      });
      details.appendChild(summary);
      details.appendChild(list);
      frag.appendChild(details);
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
    /* 校正紙: a sheet of cold paper laid over someone else's artwork. The
       palette is the extension's — paper, ink, vermilion for the current
       item, blueprint for structure — and the panel reads as print, not as
       a floating card: square corners, a 1px ink frame and a hard offset
       shadow. */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
                 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
    color: #161616;
    background: #E9E9E2;
    border: 1px solid #161616;
    border-radius: 0;
    box-shadow: 4px 4px 0 #161616;
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
    font-size: 14px;
    line-height: 1.5;
  }
  /* Collapsed, the panel is just its header bar. Keeping the full 320px width
     would leave an invisible rectangle over the page. */
  #root.collapsed {
    width: auto;
  }
  #root.collapsed #list,
  #root.collapsed #empty,
  #root.collapsed #mode-switch {
    display: none;
  }
  #header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid #161616;
    font-size: 13px;
    flex: none;
  }
  #header-title {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    min-width: 0;
    overflow: hidden;
    flex: 1 1 auto;
  }
  #panel-title {
    /* The page's name is a masthead: serif, tracked out, one line. */
    font-family: 'Songti SC', 'Noto Serif SC', Georgia, serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  #count {
    font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: #55554F;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* A segmented control, drawn as one ruled box: the active side is ink. */
  #mode-switch {
    display: flex;
    flex: none;
    border: 1px solid #161616;
  }
  #mode-switch button {
    appearance: none;
    min-width: 44px;
    height: 44px;
    padding: 0 8px;
    font-family: inherit;
    font-size: 12px;
    line-height: 1;
    color: #161616;
    background: #E9E9E2;
    border: 0;
    border-radius: 0;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s;
  }
  #mode-switch button + button {
    border-left: 1px solid #161616;
  }
  #mode-switch button[aria-pressed='true'] {
    background: #161616;
    color: #E9E9E2;
  }
  #mode-switch button:focus-visible {
    outline: 2px solid #D33A2C;
    outline-offset: 2px;
  }
  #header-actions {
    display: flex;
    flex: none;
    gap: 4px;
  }
  #collapse-btn, #hide-btn {
    appearance: none;
    border: 1px solid #161616;
    background: #E9E9E2;
    color: #161616;
    font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    min-width: 44px;
    height: 44px;
    border-radius: 0;
    padding: 0;
    transition: background-color 0.12s, color 0.12s;
  }
  #collapse-btn:hover, #hide-btn:hover {
    background: #161616;
    color: #E9E9E2;
  }
  #collapse-btn:focus-visible, #hide-btn:focus-visible {
    outline: 2px solid #D33A2C;
    outline-offset: 2px;
  }
  #list {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    flex: 1 1 auto;
    /* Without this the flex item refuses to shrink below its content and
       the panel grows instead of scrolling. */
    min-height: 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(22, 22, 22, 0.3) transparent;
  }
  #list::-webkit-scrollbar { width: 6px; }
  #list::-webkit-scrollbar-thumb {
    background: rgba(22, 22, 22, 0.3);
    border-radius: 0;
  }
  #empty {
    padding: 24px 16px;
    text-align: center;
    font-size: 12px;
    /* #55554F measures 6.15:1 on the paper surface — comfortably over the
       4.5:1 that 12px text owes. */
    color: #55554F;
    line-height: 1.6;
    margin: 0;
  }
  .entry {
    position: relative;
    border-radius: 0;
    padding: 12px 14px 12px 16px;
    cursor: pointer;
    border-top: 1px solid rgba(22, 22, 22, 0.18);
    /* Reserved so the current entry can be marked with a vermilion rule
       without the text shifting when the mark comes and goes. */
    border-left: 2px solid transparent;
    transition: background-color 0.15s, border-color 0.15s;
  }
  .entry:first-child {
    border-top: 0;
  }
  .entry:hover {
    background: rgba(22, 22, 22, 0.045);
  }
  .entry:focus-visible {
    outline: 2px solid #D33A2C;
    outline-offset: -2px;
  }
  /* The current entry is marked with a rule, not with a filled card. */
  .entry.flash {
    border-left-color: #D33A2C;
  }
  .entry-head { display: flex; gap: 8px; align-items: flex-start; }
  .entry-num {
    flex: none;
    min-width: 20px;
    height: 20px;
    padding: 0 3px;
    margin-top: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: #161616;
    border: 1px solid #161616;
    border-radius: 0;
    font-family: 'Songti SC', 'Noto Serif SC', Georgia, serif;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums lining-nums;
  }
  .entry-preview {
    /* The line the reader came for. 15px is the panel's reading size; the
       one-line teaser keeps the list scannable. */
    font-size: 15px;
    line-height: 1.6;
    color: #161616;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .entry-body {
    margin-top: 4px;
    padding-left: 28px;
  }
  .entry-body ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .entry-body li {
    font-size: 15px;
    color: #161616;
    line-height: 1.7;
    padding: 2px 0;
  }
  .entry-empty {
    margin-top: 4px;
    padding-left: 28px;
    font-size: 12px;
    color: #55554F;
    font-style: italic;
  }
  /* The other language, one click away. The summary is a real <summary>, so
     it gets the browser's own expand behaviour and keyboard handling for
     free — it only needs the list marker removed and the panel's own focus
     colour. */
  .entry-original {
    margin-top: 8px;
    padding-left: 28px;
  }
  .entry-original-summary {
    cursor: pointer;
    list-style: none;
    width: max-content;
    max-width: 100%;
    font-family: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: #55554F;
    transition: color 0.12s;
  }
  .entry-original-summary::before {
    content: '+ ';
  }
  .entry-original[open] .entry-original-summary::before {
    content: '− ';
  }
  .entry-original-summary::-webkit-details-marker {
    display: none;
  }
  .entry-original-summary:hover {
    color: #161616;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .entry-original-summary:focus-visible {
    outline: 2px solid #D33A2C;
    outline-offset: 2px;
  }
  .entry-original-list {
    list-style: none;
    margin: 4px 0 0;
    /* A thin rule sets the source text apart as a margin note under the
       translation it belongs to. */
    border-left: 1px solid rgba(31, 79, 168, 0.35);
    padding: 0 0 0 8px;
  }
  .entry-original-list li {
    font-size: 12px;
    line-height: 1.6;
    padding: 1px 0;
    /* The source text is structure, not a call to action: blueprint blue. */
    color: #1F4FA8;
  }
  /* In 「原文」 mode the disclosure holds the translation instead, and the
     translation is not the structural text — ink-muted keeps the blue for
     actual source lines. */
  #root.mode-original .entry-original-list {
    border-left-color: rgba(22, 22, 22, 0.18);
  }
  #root.mode-original .entry-original-list li {
    color: #55554F;
  }
  /* Reduced motion: the flash still paints (it is a state, not an
     animation), it just arrives without a transition. */
  @media (prefers-reduced-motion: reduce) {
    #mode-switch button,
    #collapse-btn,
    #hide-btn,
    .entry,
    .entry-original-summary {
      transition: none;
    }
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
