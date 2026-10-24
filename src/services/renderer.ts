/**
 * Overlay Renderer Service
 *
 * Renders translation overlays on manga images:
 * - Creates positioned overlay elements
 * - Auto-adjusts font size based on text area
 * - Hover toggle: show translation on hover, original on leave
 * - Control buttons: toggle and close
 * - Manages overlay lifecycle (create, remove, removeAll)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import type { TextArea } from '@/providers/base';
import { getOverlayStyleFromConfig } from '@/content/config-snapshot';
import { APP_CONFIG_STORAGE_KEY } from '@/shared/app-config';
import { sortTextAreasByReadingOrder } from '@/services/reading-order';

// ==================== Type Definitions ====================

interface OverlayStyleConfig {
  backgroundColor: string;
  textColor: string;
  minFontSize: number;
  maxFontSize: number;
  verticalText: boolean;
}

export interface OverlayStyle {
  /** Background color with opacity */
  backgroundColor: string;
  /** Text color */
  textColor: string;
  /** Font family */
  fontFamily: string;
  /** Border radius in pixels */
  borderRadius: number;
  /** Padding in pixels */
  padding: number;
  /** Minimum font size in pixels */
  minFontSize: number;
  /** Maximum font size in pixels */
  maxFontSize: number;
  /** Vertical text mode for Japanese manga */
  verticalText: boolean;
}

interface RenderedOverlay {
  /** The wrapper element containing the image and overlays */
  wrapper: HTMLElement;
  /** The original image element */
  image: HTMLImageElement;
  /** Array of overlay elements */
  overlays: HTMLElement[];
  /** The overlay container for hover toggle */
  overlayContainer: HTMLElement;
  /** The control strip (pin / remove / save) */
  controls: HTMLElement;
  /** Whether translation is pinned (manually toggled on) */
  pinned: boolean;
  /**
   * The source text areas, kept so overlays can be re-laid out when the image
   * is resized. Without this, a window resize or a responsive layout change
   * leaves every overlay at the pixel coordinates captured at render time,
   * which drifts away from the artwork.
   */
  textAreas: TextArea[];
}

// ==================== Constants ====================

const WRAPPER_CLASS = 'manga-translator-wrapper';
const OVERLAY_CLASS = 'manga-translator-overlay';
/**
 * Marks an overlay whose text runs top to bottom.
 *
 * Japanese manga is read vertically, and a horizontal translation of a
 * vertical page reads wrong: the eye has to travel back to the left for
 * every line.
 */
const OVERLAY_VERTICAL_CLASS = 'manga-translator-overlay-vertical';
const OVERLAY_CONTAINER_CLASS = 'manga-translator-overlay-container';
/**
 * Marks an overlay whose text did not fit the bubble.
 *
 * The class puts an ellipsis in the corner, so a reader can tell that the
 * translation continues somewhere else — the reading panel — instead of
 * taking a cut-off sentence for the whole thing.
 */
const OVERLAY_CLIPPED_CLASS = 'manga-translator-overlay-clipped';
const CONTROLS_CLASS = 'manga-translator-controls';

/**
 * Paint the pin button for the current state.
 *
 * The glyph used to read backwards: a pinned translation — the one that stays
 * on screen — showed an eye, and the transient one showed a pin. The eye now
 * means "shown while you hover" and the pin means "always on screen", and
 * both the tooltip and the accessible name follow the state instead of
 * describing an action the user has not taken yet.
 */
function paintToggleButton(button: HTMLButtonElement, pinned: boolean): void {
  button.textContent = pinned ? '📌' : '👁';
  button.title = pinned
    ? '取消固定（译文恢复为鼠标悬停时显示）'
    : '固定译文（按住 Alt 键可临时看原文）';
  button.setAttribute('aria-label', pinned ? '取消固定译文' : '固定译文');
}
const DATA_ATTR = 'data-manga-translator';
/** The translated text layer inside an overlay. */
const TRANSLATED_TEXT_CLASS = 'manga-translator-text-translated';
/**
 * The original text layer inside an overlay.
 *
 * Kept in the DOM but hidden until the reader asks for it, so the source can
 * be shown on demand without another API call or another layout pass.
 */
const ORIGINAL_TEXT_CLASS = 'manga-translator-text-original';

// Hover debounce delay (ms) - prevents flicker when mouse quickly enters/leaves
const HOVER_HIDE_DELAY = 120; // delay hide on mouseleave to prevent rapid toggle flicker

/**
 * 覆盖层文字的字重。
 *
 * 页面、量字和导出三处必须用同一个数字：字重一变，同一句话的宽度就变。
 * 之前页面按 500 画，量字却按默认的 400 量——量出来的宽度比画出来的窄，
 * 导出的 PNG 于是把该换行的地方换在了别处，读者看到的行数和屏幕上不一样。
 */
export const OVERLAY_FONT_WEIGHT = 500;

/**
 * 一段文字的字体描述。
 *
 * 量字和画字都必须用这一条，否则排版用的宽度和画出来的宽度不是一回事。
 */
export function overlayFont(fontSize: number, style: OverlayStyle): string {
  return `${OVERLAY_FONT_WEIGHT} ${fontSize}px ${style.fontFamily}`;
}

const DEFAULT_STYLE: OverlayStyle = {
  // Fully opaque, not "almost opaque".
  //
  // The overlay is drawn on top of the source text, so anything the panel
  // does not completely hide stays visible next to the translation. At 94%
  // opacity the source Japanese showed through at a contrast of 7:1 — four
  // times the threshold for readable text — so the panel looked like a
  // half-finished translation: you could read the original behind the
  // Chinese. The box is now snapped to the real extent of the glyphs
  // (see services/text-box-refiner.ts), so the panel can afford to be
  // opaque, and a reader who wants to see the artwork through it can set
  // the alpha in the options.
  backgroundColor: 'rgb(240, 240, 235)',
  textColor: '#111111',
  fontFamily:
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  borderRadius: 6,
  padding: 7,
  minFontSize: 10,
  maxFontSize: 22,
  verticalText: false,
};

// ==================== Utility Functions ====================

/**
 * Read the overlay style the user configured.
 *
 * The renderer used to pick the style up from a `chrome.storage.onChanged`
 * event, which only reaches a tab that was already open when the setting
 * changed. A freshly opened page therefore never saw it: the user watched
 * their font size and colours apply in one tab and silently revert in the
 * next one, which reads as "this setting is broken".
 *
 * The *raw* stored record is read here, not the config store, so nothing
 * on this path ever touches the API key — the overlay style does not need
 * it, and the content script should not be holding it.
 */
async function loadPersistedOverlayStyle(): Promise<OverlayStyleConfig | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return null;
    }
    const result = await chrome.storage.local.get([APP_CONFIG_STORAGE_KEY]);
    return getOverlayStyleFromConfig(result[APP_CONFIG_STORAGE_KEY]);
  } catch (error) {
    console.error('[Renderer] 读取覆盖层样式失败:', error);
    return null;
  }
}

// 全角字符正则表达式：涵盖汉字、日文平假名/片假名、韩文音节、全角标点符号等，实现更精准的多语言宽度估算
const FULL_WIDTH_REGEX =
  /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f]/g;

/**
 * How the text is laid out inside a speech bubble.
 *
 * `horizontal` stacks one line under another; `vertical` — the way Japanese
 * manga is actually read — runs a column down the height of the bubble and
 * stacks the columns across its width.
 */
type TextDirection = 'horizontal' | 'vertical';

/**
 * The result of fitting a piece of text into a box.
 */
interface TextFit {
  /** The font size the text was laid out at. */
  fontSize: number;
  /** The lines (horizontal) or columns (vertical) the text was split into. */
  lines: string[];
  /** How wide the laid-out text is, in screen pixels. */
  width: number;
  /** How tall the laid-out text is, in screen pixels. */
  height: number;
  /**
   * The text did not fit even at the smallest allowed size.
   *
   * The overlay still shows what it can, but the user has to be able to
   * tell that something was cut off: a silently truncated translation reads
   * like a complete one, and a reader has no way to guess that the last
   * line is missing.
   */
  clipped: boolean;
}

/**
 * Where an overlay sits on the image, and how it is laid out.
 *
 * Exported so the image exporter can lay the translation out exactly the way
 * the DOM overlay does. The exported PNG has to match what the reader sees on
 * screen, and a second implementation of the layout would drift from this one
 * the first time the layout was tuned.
 */
export interface OverlayLayout {
  fontSize: number;
  lines: string[];
  width: number;
  height: number;
  left: number;
  top: number;
  /** The text was cut off — the overlay has to say so. */
  clipped: boolean;
}

/**
 * The line height of a line of text, as a multiple of the font size.
 *
 * Exported because the image exporter draws the same bubbles on a canvas:
 * the two numbers have to be the same number.
 */
export const LINE_HEIGHT_RATIO = 1.3;

/**
 * The thickness of a column of vertical text, as a multiple of the font size.
 *
 * A column is as wide as the line height is tall, so this is the same
 * number the horizontal layout uses for its line height.
 */
export const COLUMN_THICKNESS_RATIO = 1.3;

/**
 * A canvas used to measure text, created once and kept.
 *
 * The first version of this created a canvas for every single measurement.
 * The layout measures every line at every candidate font size, so a page
 * with a few hundred speech bubbles created thousands of canvases — the
 * kind of cost that shows up as a stutter while a chapter scrolls into
 * view. One canvas, with the font set before each measurement, does the
 * same work.
 */
let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      measureContext =
        ctx && typeof ctx.measureText === 'function' ? ctx : null;
    } catch {
      measureContext = null;
    }
  }
  return measureContext;
}

/**
 * Estimate the width of a piece of text at a given size.
 *
 * This is the fallback for environments without a 2D canvas. Full-width
 * characters count as one em and ASCII characters as about half an em,
 * which is the rule the real font metrics follow.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  const fullWidthCount = (text.match(FULL_WIDTH_REGEX) || []).length;
  const latinCount = Math.max(0, text.length - fullWidthCount);
  return fullWidthCount * fontSize + latinCount * fontSize * 0.55;
}

/**
 * How a piece of text is measured.
 *
 * The default measures with a canvas, which knows the real font metrics of
 * the font the overlay is actually drawn in. It is a parameter because the
 * canvas in the test environment is a stub that reports the same width for
 * every string: testing the layout against it would only prove that the
 * layout follows the stub.
 */
export type TextMeasurer = (
  text: string,
  fontSize: number,
  style: OverlayStyle
) => number;

const measureTextWidth: TextMeasurer = (text, fontSize, style) => {
  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = overlayFont(fontSize, style);
    return ctx.measureText(text).width;
  }

  return estimateTextWidth(text, fontSize);
};

function wrapTextToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  style: OverlayStyle,
  measure: TextMeasurer
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let currentLine = '';

    for (const char of paragraph) {
      const candidate = currentLine + char;
      if (currentLine && measure(candidate, fontSize, style) > maxWidth) {
        lines.push(currentLine.trimEnd());
        currentLine = char.trimStart();
      } else {
        currentLine = candidate;
      }
    }

    lines.push(currentLine.trimEnd() || paragraph.trim());
  }

  return lines;
}

/**
 * 是不是可以断行的位置上的字符（中日韩文字和全角标点）。
 */
const CJK_CHARACTER =
  /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/;

/**
 * 不能出现在行首的标点（句号、逗号、问号……）。
 *
 * 浏览器不会让一行以这些字开头；导出如果会，读者就会看到一行孤零零的
 * 句号挂在左边，而屏幕上不是这样。
 */
const CLOSING_PUNCTUATION =
  /[\u3001\u3002\uFF0C\uFF01\uFF1F\uFF1A\uFF1B\u3009\u300D\u300F\u3011\u2019\u201D\u2026]/;

/**
 * 不能出现在行尾的标点（开引号、开括号……）。
 */
const OPENING_PUNCTUATION =
  /[\u3008\u300A\u300C\u300E\u3010\u2018\u201C\uFF08]/;

/**
 * 按浏览器的方式折行。
 *
 * 页面把译文交给浏览器排版（`white-space: pre-wrap; word-break: break-word`）：
 * 拉丁词整体不拆，中日韩字符之间可以断，句号不会跑到行首。导出到画布上
 * 时没有浏览器可用，如果沿用那份"逐字符断开"的估算，导出的断行会和屏幕上
 * 的不一样 —— 一个拉丁词会被从中间劈开。
 *
 * 所以这里按同一套规则重新折一次：先切成"不可再分的块"（一个拉丁词、一个
 * 汉字、一个空格），再按宽度贪心地装行；一个块本身比整行还宽时（超长英文
 * 单词）再按字符拆开，这正是 `word-break: break-word` 的做法。
 */
export function wrapTextLikeBrowser(
  text: string,
  maxWidth: number,
  fontSize: number,
  style: OverlayStyle,
  measure: TextMeasurer
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    const blocks = splitIntoBlocks(paragraph);
    let current = '';

    for (const block of blocks) {
      if (block === ' ') {
        // 行尾的空格不留：浏览器会把它折到下一行，行首的空格也会被吃掉。
        if (current) {
          current += ' ';
        }
        continue;
      }

      const candidate = current + block;
      if (
        current.trim() &&
        measure(candidate.trimEnd(), fontSize, style) > maxWidth
      ) {
        // 这一行装不下了：先收下这一行，再从这个块开始新的一行。
        lines.push(current.trimEnd());
        current = '';
      }

      if (!current.trim() && measure(block, fontSize, style) > maxWidth) {
        // 这个块自己就比一整行还宽（超长英文单词）：按字符拆开。
        let chunk = '';
        for (const char of Array.from(block)) {
          const withChar = chunk + char;
          if (chunk && measure(withChar, fontSize, style) > maxWidth) {
            lines.push(chunk);
            chunk = char;
          } else {
            chunk = withChar;
          }
        }
        current = chunk;
        continue;
      }

      current += block;
    }

    lines.push(current.trimEnd() || paragraph.trim());
  }

  return lines;
}

/**
 * 把一段文字切成"不能再拆"的块。
 *
 * 一个拉丁词、一个汉字、一个空格是三块；标点跟着它该跟的那一侧：句号跟着
 * 前面的字（不能出现在行首），开引号带着后面的字（不能出现在行尾）。
 */
function splitIntoBlocks(paragraph: string): string[] {
  const blocks: string[] = [];
  let pendingOpen = '';

  for (const char of Array.from(paragraph)) {
    if (char === ' ') {
      flushBlock(blocks, pendingOpen);
      pendingOpen = '';
      blocks.push(' ');
      continue;
    }

    if (CJK_CHARACTER.test(char)) {
      if (CLOSING_PUNCTUATION.test(char) && blocks.length > 0) {
        // 句号跟着前一个块——但前一个块是空格的话，句号自己成块：把空格和
        // 句号粘在一起会让折行时把行首的空格也带出来。
        const last = blocks[blocks.length - 1];
        if (last !== ' ') {
          blocks[blocks.length - 1] = last + char;
          continue;
        }
      }
      flushBlock(blocks, pendingOpen);
      pendingOpen = '';
      blocks.push(char);
      continue;
    }

    // 拉丁字母、数字和它们的标点：连成一个词。
    const last = blocks[blocks.length - 1];
    if (
      last !== undefined &&
      last !== ' ' &&
      !CJK_CHARACTER.test(last[0] ?? '') &&
      !OPENING_PUNCTUATION.test(last[0] ?? '')
    ) {
      blocks[blocks.length - 1] = last + char;
      continue;
    }

    flushBlock(blocks, pendingOpen);
    pendingOpen = OPENING_PUNCTUATION.test(char) ? char : '';
    blocks.push(char);
  }

  flushBlock(blocks, pendingOpen);
  return blocks;
}

function flushBlock(blocks: string[], pendingOpen: string): void {
  if (!pendingOpen) {
    return;
  }
  // 开引号要粘在前面的字上；如果它是一段的开头，就自己成块。
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last !== ' ') {
    blocks[blocks.length - 1] = last + pendingOpen;
  } else {
    blocks.push(pendingOpen);
  }
}

/**
 * 竖排里的一块字。
 *
 * 页面上的竖排文字交给浏览器（`writing-mode: vertical-rl`），浏览器按"列"
 * 排：列从上往下走，列与列从右往左。导出到画布上没有浏览器可用，如果沿用
 * 那份"逐字断开"的估算，一段拉丁文会被拆到好几列里去 —— 而屏幕上它是斜着
 * 排在一列里的。
 *
 * 所以竖排按同一套块（一个拉丁词、一个汉字）装列。区别只在每块占多长：一个
 * 汉字竖着写占一个字高（`fontSize`），一段拉丁文斜着写，占的是它横着排出来
 * 的宽度。
 */
export interface VerticalBlock {
  /** 这一块的文字。 */
  text: string;
  /** 沿列方向（竖直）占多长。 */
  advance: number;
  /**
   * 直立着写（中日韩字），还是旋转 90°（拉丁文）。
   *
   * 浏览器在竖排里把拉丁文整个转 90°（`text-orientation: mixed` 的默认行为），
   * 导出必须做同一件事：横着排的字和竖着排的字看起来是两回事。
   */
  upright: boolean;
}

/**
 * 竖排的一列。
 */
export interface VerticalColumn {
  /** 这一列里的块，按阅读顺序。 */
  blocks: VerticalBlock[];
}

/**
 * 把一段文字排成竖排的列。
 *
 * 返回的是"列 → 块"的结构，而不是一列一列的字符串：导出到画布上时，每一块
 * 要么直立着画，要么转 90° 画，两者占的宽度也不一样，字符串说不出这些。
 */
export function planVerticalText(
  text: string,
  maxColumnLength: number,
  fontSize: number,
  style: OverlayStyle,
  measure: TextMeasurer
): VerticalColumn[] {
  const paragraphs = text.split('\n');
  const columns: VerticalColumn[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      columns.push({ blocks: [] });
      continue;
    }

    const blocks = splitIntoBlocks(paragraph);
    let current: VerticalBlock[] = [];
    let currentLength = 0;

    for (const block of blocks) {
      if (block === ' ') {
        // 竖排里的空格是直立的（UAX #50：空格在竖排里不跟着转），占一个字身
        // 的高度，但什么也画不出来。段首的空格丢掉，和横排一样。
        if (current.length > 0) {
          current.push({ text: ' ', advance: fontSize, upright: true });
          currentLength += fontSize;
        }
        continue;
      }

      const upright = CJK_CHARACTER.test(block[0] ?? '');
      const advance = verticalAdvance(block, fontSize, style, measure, upright);
      if (current.length > 0 && currentLength + advance > maxColumnLength) {
        columns.push({ blocks: hangTrailingSpace(current) });
        current = [];
        currentLength = 0;
      }

      current.push({ text: block, advance, upright });
      currentLength += advance;
    }

    columns.push({ blocks: hangTrailingSpace(current) });
  }

  return columns;
}

/**
 * 把列尾的空格吊在行外。
 *
 * 浏览器把行尾的空格"挂"在行外（不算进行的宽度），竖排也一样。留着它的话，
 * 一列会凭空多出一个字身的空白，最后一列还会比别的高一截。
 */
function hangTrailingSpace(blocks: VerticalBlock[]): VerticalBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.text === ' ') {
    return blocks.slice(0, -1);
  }
  return blocks;
}

/**
 * 一块文字在竖排里占多长。
 */
function verticalAdvance(
  block: string,
  fontSize: number,
  style: OverlayStyle,
  measure: TextMeasurer,
  upright: boolean
): number {
  if (upright) {
    return fontSize;
  }
  // 斜着排的拉丁文，占的是它横着排出来的宽度。
  return Math.max(measure(block, fontSize, style), fontSize);
}

/**
 * Lay the text out at one font size and report how much room it needs.
 */
function measureFit(
  text: string,
  safeLineLength: number,
  fontSize: number,
  style: OverlayStyle,
  direction: TextDirection,
  lineBudget: number,
  stackBudget: number,
  measure: TextMeasurer
): TextFit {
  const padding = style.padding * 2;
  const lines = wrapTextToWidth(text, safeLineLength, fontSize, style, measure);
  const longest = Math.max(
    fontSize,
    ...lines.map(line => measure(line, fontSize, style))
  );

  if (direction === 'vertical') {
    // 竖排：一列沿高度方向延伸，列与列沿宽度方向并排。
    // The column length is padded by a tenth before it becomes the box
    // height, because the browser's own font metrics are close to but not
    // exactly the estimate used here, and a box that is a few pixels too
    // short would cut the last character off.
    const columnLength = longest * 1.1 + padding;
    const columnStack =
      lines.length * fontSize * COLUMN_THICKNESS_RATIO + padding;
    return {
      fontSize,
      lines,
      width: columnStack,
      height: columnLength,
      clipped: columnLength > lineBudget + 1 || columnStack > stackBudget + 1,
    };
  }

  const textHeight = lines.length * fontSize * LINE_HEIGHT_RATIO + padding;
  const textWidth = longest + padding;
  return {
    fontSize,
    lines,
    width: textWidth,
    height: textHeight,
    clipped: textHeight > stackBudget + 1 || textWidth > lineBudget + 1,
  };
}

/**
 * Fit a piece of text into a box, at the largest font size that still fits.
 *
 * The question this answers used to be "how big can the font be so the
 * whole text fits on a single line?", and that answer was then used as the
 * starting point for a downward search. For any text longer than a line
 * that answer collapses onto the minimum font size, so most translations
 * were drawn at 10px no matter how much room the speech bubble actually
 * had — the reader had to squint at every bubble.
 *
 * This asks the question the reader cares about — "how big can it be while
 * it still fits?" — and answers it by trying the sizes from the top down.
 *
 * `lineBudget` is the room one line (one column, when the text runs
 * vertically) may take; `stackBudget` is the room all of them together may
 * take. For vertical text the two swap roles on screen: the line budget
 * is the height of the bubble, the stack budget is its width.
 */
export function fitTextToBox(
  text: string,
  lineBudget: number,
  stackBudget: number,
  style: OverlayStyle = DEFAULT_STYLE,
  direction: TextDirection = 'horizontal',
  measure: TextMeasurer = measureTextWidth
): TextFit {
  const padding = style.padding * 2;
  // 5% 的排版折行安全余量：浏览器实际排版与这里的估算之间总有像素级误差。
  const safeLineLength = Math.max((lineBudget - padding) * 0.95, 1);

  for (
    let fontSize = style.maxFontSize;
    fontSize >= style.minFontSize;
    fontSize--
  ) {
    const fit = measureFit(
      text,
      safeLineLength,
      fontSize,
      style,
      direction,
      lineBudget,
      stackBudget,
      measure
    );
    if (!fit.clipped) {
      return fit;
    }
  }

  // Even the smallest allowed size does not fit. Keep the text at that size
  // and let the overlay admit that it was cut, rather than dropping the
  // translation altogether.
  return measureFit(
    text,
    safeLineLength,
    style.minFontSize,
    style,
    direction,
    lineBudget,
    stackBudget,
    measure
  );
}

/**
 * The layout of one overlay against the image it covers.
 *
 * Exported for the image exporter — see `OverlayLayout`.
 *
 * 这个函数只回答"屏幕上"的事：图片按显示尺寸（`image.offsetWidth`）排版，
 * 气泡的宽高、字号、位置全是显示像素。导出到 PNG 时要把整张版式放大到原图
 * 像素，放大的是结果，不是这里——所以这里没有"缩放"这个参数。
 */
export function computeAdaptiveOverlayLayout(
  area: TextArea,
  imageWidth: number,
  imageHeight: number,
  style: OverlayStyle,
  measure: TextMeasurer
): OverlayLayout {
  if (style.verticalText) {
    return computeVerticalOverlayLayout(
      area,
      imageWidth,
      imageHeight,
      style,
      measure
    );
  }
  const areaLeft = area.x * imageWidth;
  const areaTop = area.y * imageHeight;
  const areaWidth = area.width * imageWidth;
  const areaHeight = area.height * imageHeight;

  const originalTextLength = Math.max(area.originalText.trim().length, 1);
  const translatedTextLength = Math.max(area.translatedText.trim().length, 1);
  const textGrowthRatio = translatedTextLength / originalTextLength;
  const widthExpansionFactor =
    textGrowthRatio > 1
      ? 1 + Math.min(0.9, Math.sqrt(textGrowthRatio) * 0.4)
      : 1;
  const heightExpansionFactor =
    textGrowthRatio > 1
      ? 1 + Math.min(0.8, Math.sqrt(textGrowthRatio) * 0.3)
      : 1;
  // The overlay may grow past the original bubble when the translation is
  // longer than the source, but never past this much of the image.
  //
  // These are budgets for the *text*, so they deliberately exclude the
  // padding: the box the text is measured against is the box the text is
  // drawn in, padding included.
  const textBudgetWidth = Math.min(
    imageWidth * 0.78,
    areaWidth * widthExpansionFactor
  );
  const textBudgetHeight = Math.min(
    imageHeight * 0.58,
    areaHeight * heightExpansionFactor
  );
  const visualPaddingX = Math.max(style.padding * 2, 12);
  const visualPaddingY = Math.max(style.padding * 1.5, 10);

  const fit = fitTextToBox(
    area.translatedText,
    textBudgetWidth,
    textBudgetHeight,
    style,
    'horizontal',
    measure
  );

  const minimumWidth = Math.min(
    textBudgetWidth,
    Math.max(fit.fontSize * 2.4, 48)
  );
  const minimumHeight = Math.min(
    textBudgetHeight,
    Math.max(fit.fontSize * LINE_HEIGHT_RATIO + style.padding * 2, 28)
  );
  // The overlay has to cover the original bubble, not just the translation.
  //
  // It used to be sized to the translation alone, so a translation shorter than
  // the original left the rest of the bubble uncovered: the reader
  // saw the original beside the translation, and where the two did
  // overlap the original ghosted through the panel's 6% transparency.
  // The store listing promises the bubble is covered, and it was not.
  //
  // So the original box is the floor, not the ceiling: the overlay is
  // at least as wide and as tall as the original it replaces, and it
  // grows past it only when the translation needs more room.
  //
  // The floor is the original box plus the padding, and it is
  // deliberately *not* clamped to the text budget above: that budget is what
  // the text may occupy, and the padding is what the box adds around it.
  // Clamping the floor to the budget threw the padding away and left the
  // bottom of a two-line bubble uncovered.
  const width = Math.min(
    imageWidth * 0.92,
    Math.max(
      fit.width + visualPaddingX,
      minimumWidth,
      areaWidth + visualPaddingX
    )
  );
  const height = Math.min(
    imageHeight * 0.78,
    Math.max(
      fit.height + visualPaddingY,
      minimumHeight,
      areaHeight + visualPaddingY
    )
  );
  const left = Math.min(
    Math.max(0, areaLeft + (areaWidth - width) / 2),
    Math.max(0, imageWidth - width)
  );
  const top = Math.min(
    Math.max(0, areaTop + (areaHeight - height) / 2),
    Math.max(0, imageHeight - height)
  );

  return {
    fontSize: fit.fontSize,
    lines: fit.lines,
    width,
    height,
    left,
    top,
    clipped: fit.clipped,
  };
}

/**
 * The layout for vertical text.
 *
 * A vertical line of text runs down the height of the box and the columns
 * stack across the width, so the two axes swap roles: what the horizontal
 * layout calls the width is the length of a column here, and what it calls
 * the height is the stack of columns.
 *
 * The measuring helpers do not care about direction — they only measure
 * text — so the same code produces the columns; only the interpretation
 * of the result changes.
 */
function computeVerticalOverlayLayout(
  area: TextArea,
  imageWidth: number,
  imageHeight: number,
  style: OverlayStyle,
  measure: TextMeasurer
): OverlayLayout {
  const areaLeft = area.x * imageWidth;
  const areaTop = area.y * imageHeight;
  const areaWidth = area.width * imageWidth;
  const areaHeight = area.height * imageHeight;

  // The text runs down the height, so the height is the length of a column
  // and the width is the room the columns have to stack in.
  const maxLength = Math.min(imageHeight * 0.72, areaHeight * 1.4);
  const maxThickness = Math.min(imageWidth * 0.78, areaWidth * 1.4);

  const fit = fitTextToBox(
    area.translatedText,
    maxLength,
    maxThickness,
    style,
    'vertical',
    measure
  );

  const width = Math.min(
    imageWidth * 0.92,
    Math.max(
      fit.width,
      Math.min(maxThickness, fit.fontSize * 1.8 + style.padding * 2),
      // Cover the original it replaces — see the horizontal
      // layout for why the original box is a floor, not a ceiling,
      // and why the floor is not clamped to the text budget.
      areaWidth + style.padding * 2
    )
  );
  const height = Math.min(
    imageHeight * 0.85,
    Math.max(
      fit.height,
      Math.min(maxLength, fit.fontSize * 2.4 + style.padding * 2),
      areaHeight + style.padding * 2
    )
  );
  const left = Math.min(
    Math.max(0, areaLeft + (areaWidth - width) / 2),
    Math.max(0, imageWidth - width)
  );
  const top = Math.min(
    Math.max(0, areaTop + (areaHeight - height) / 2),
    Math.max(0, imageHeight - height)
  );

  return {
    fontSize: fit.fontSize,
    lines: fit.lines,
    width,
    height,
    left,
    top,
    clipped: fit.clipped,
  };
}

/**
 * 一个气泡在图片上的位置和大小。
 *
 * 页面上的气泡是 DOM 元素，导出到 PNG 时是画布上的矩形 —— 两者是同一件
 * 事，只是载体不同，所以碰撞避让要写成一个纯函数，两个地方共用。
 */
export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function rectsOverlap(a: OverlayRect, b: OverlayRect): boolean {
  return !(
    a.left + a.width <= b.left ||
    a.left >= b.left + b.width ||
    a.top + a.height <= b.top ||
    a.top >= b.top + b.height
  );
}

/**
 * 往哪边让。
 *
 * 谁的中心离得远，谁就往那边让——两个气泡往相反方向分开。
 *
 * 两个气泡的中心一模一样的时候（同一个位置上的两个框，这在页面上很常见：
 * 同一个气泡被模型报了两遍），不能两个都往同一边让：那样挪完它们还叠在
 * 一起，避让等于没做。这种时候按顺序拆开——靠前的一个往上，靠后的往下。
 */
function resolveDirection(
  currentCenter: number,
  otherCenter: number,
  index: number,
  otherIndex: number
): number {
  if (currentCenter > otherCenter) {
    return 1;
  }
  if (currentCenter < otherCenter) {
    return -1;
  }
  return index > otherIndex ? 1 : -1;
}

/**
 * 把互相压住的气泡推开。
 *
 * 页面上两个挨得很近的译文气泡会互相盖住读者要读的字，所以渲染器会把
 * 它们推开：沿着重叠较小的那个轴，各自往反方向让出「重叠 + 间距」的距离，
 * 并且始终留在图片范围内。最多迭代三轮，够用又不至于在长页面上卡住。
 *
 * 导出 PNG 必须做同一件事 —— 屏幕上分开的两个气泡，在 PNG 里叠在一起，
 * 就等于"保存我看到的译文"这句话不成立。
 *
 * 这个函数不改传入的数组：它返回一份新的位置表，调用方自己决定写回哪里
 * （页面写回 DOM 的 style，导出写回画布坐标）。
 */
export function resolveOverlayCollisions(
  rects: OverlayRect[],
  imageWidth: number,
  imageHeight: number,
  spacing = 4
): OverlayRect[] {
  const maxIterations = 3;
  const moved: OverlayRect[] = rects.map(rect => ({ ...rect }));

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let hasCollision = false;

    for (let i = 0; i < moved.length; i++) {
      const current = moved[i];
      if (!current) continue;

      for (let j = 0; j < moved.length; j++) {
        if (i === j) continue;
        const other = moved[j];
        if (!other) continue;

        if (!rectsOverlap(current, other)) {
          continue;
        }

        hasCollision = true;

        const overlapX =
          Math.min(current.left + current.width, other.left + other.width) -
          Math.max(current.left, other.left);
        const overlapY =
          Math.min(current.top + current.height, other.top + other.height) -
          Math.max(current.top, other.top);

        if (overlapX <= 0 || overlapY <= 0) continue;

        // 选择重叠度最小的维度轴线进行移动（最少干扰避让）
        const currentCenterX = current.left + current.width / 2;
        const currentCenterY = current.top + current.height / 2;
        const otherCenterX = other.left + other.width / 2;
        const otherCenterY = other.top + other.height / 2;

        let dx = 0;
        let dy = 0;
        if (overlapX < overlapY) {
          const direction = resolveDirection(
            currentCenterX,
            otherCenterX,
            i,
            j
          );
          dx = direction * (overlapX + spacing);
        } else {
          const direction = resolveDirection(
            currentCenterY,
            otherCenterY,
            i,
            j
          );
          dy = direction * (overlapY + spacing);
        }

        // 将避让后的坐标裁剪限制在原图片画布矩形内部
        current.left = Math.max(
          0,
          Math.min(imageWidth - current.width, current.left + dx)
        );
        current.top = Math.max(
          0,
          Math.min(imageHeight - current.height, current.top + dy)
        );
      }
    }

    // 本轮没有重合就说明已经消解，可以提前退出
    if (!hasCollision) {
      break;
    }
  }

  return moved;
}

function getStyledRect(element: HTMLElement): DOMRect {
  const left = parseFloat(element.style.left || '0');
  const top = parseFloat(element.style.top || '0');
  const width = parseFloat(element.style.width || '0');
  const height = parseFloat(element.style.height || '0');

  return new DOMRect(left, top, width, height);
}

/**
 * Create CSS styles for overlay elements
 */
function createOverlayStyles(): string {
  return `
    .${WRAPPER_CLASS} {
      position: relative;
      display: inline-block;
    }

    .${OVERLAY_CONTAINER_CLASS} {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      transition: opacity 150ms ease-in-out;
      pointer-events: none;
      z-index: 1000;
    }

    .${WRAPPER_CLASS}.manga-translator-hover-active .${OVERLAY_CONTAINER_CLASS},
    .${WRAPPER_CLASS}.manga-translator-pinned .${OVERLAY_CONTAINER_CLASS} {
      opacity: 1;
    }

    .${OVERLAY_CLASS} {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      word-break: break-word;
      overflow: hidden;
      pointer-events: none;
      box-sizing: border-box;
      line-height: 1.3;
      font-weight: ${OVERLAY_FONT_WEIGHT};
      text-shadow: 0 1px 2px rgba(255,255,255,0.8);
      box-shadow: 0 1px 4px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.6);
      animation: manga-overlay-fadein 0.3s ease-out;
      transition: opacity 0.18s ease-in-out;
    }

    /* Original text sits behind the translation and is swapped in while the
       reader holds Alt. Both layers are always in the DOM, so revealing the
       source costs no layout work and no network call. */
    .${TRANSLATED_TEXT_CLASS},
    .${ORIGINAL_TEXT_CLASS} {
      display: block;
      width: 100%;
    }
    /* Vertical text runs down the height of the overlay and stacks its
       columns across the width, so the text layer fills the height and
       leaves the width to the columns. */
    .${OVERLAY_VERTICAL_CLASS} .${TRANSLATED_TEXT_CLASS},
    .${OVERLAY_VERTICAL_CLASS} .${ORIGINAL_TEXT_CLASS} {
      width: auto;
      height: 100%;
    }
    .${ORIGINAL_TEXT_CLASS} {
      display: none;
      opacity: 0.85;
      font-weight: 400;
    }
    body.manga-translator-show-original .${TRANSLATED_TEXT_CLASS} {
      display: none;
    }
    body.manga-translator-show-original .${ORIGINAL_TEXT_CLASS} {
      display: block;
    }

    /* The text was cut off to fit the bubble. Say so — a truncated
       translation that looks complete is worse than no translation. */
    .${OVERLAY_CLASS}.manga-translator-overlay-clipped::after {
      content: '…';
      position: absolute;
      right: 3px;
      bottom: 1px;
      font-size: 0.85em;
      line-height: 1;
      opacity: 0.8;
      pointer-events: none;
    }

    .${WRAPPER_CLASS}:hover .${OVERLAY_CLASS} {
      pointer-events: auto;
      user-select: text;
    }

    .${CONTROLS_CLASS} {
      position: absolute;
      top: 4px;
      right: 4px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
      pointer-events: none;
      z-index: 1001;
    }

    .${WRAPPER_CLASS}:hover .${CONTROLS_CLASS} {
      opacity: 1;
      pointer-events: auto;
    }

    /*
     * The controls were reachable with the mouse only. A keyboard user
     * tabbed onto an invisible button — the opacity-0 ancestor hides the
     * focus ring too, so there was no sign of where they were — and on a
     * touch device there is no hover at all, which made "remove this one
     * translation" and "save this image" impossible to reach.
     */
    .${WRAPPER_CLASS}:focus-within .${CONTROLS_CLASS} {
      opacity: 1;
      pointer-events: auto;
    }

    @media (pointer: coarse) {
      .${CONTROLS_CLASS} {
        opacity: 1;
        pointer-events: auto;
      }
    }

    .${CONTROLS_CLASS} button:focus-visible {
      outline: 2px solid #22d3ee;
      outline-offset: 2px;
    }

    /*
     * The overlay animates inside somebody else's page. The extension's own
     * pages honour prefers-reduced-motion (see src/index.css); the injected
     * stylesheet did not, so the user who asked their system for less motion
     * still got it here.
     */
    @media (prefers-reduced-motion: reduce) {
      .${OVERLAY_CLASS} {
        animation: none;
      }

      .${CONTROLS_CLASS} {
        transition: none;
      }

      .${CONTROLS_CLASS} button {
        transition: none;
      }
    }

    .${CONTROLS_CLASS} button {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      padding: 0;
      transition: background 0.15s;
    }

    .${CONTROLS_CLASS} button:hover {
      background: rgba(0, 0, 0, 0.85);
    }

    @keyframes manga-overlay-fadein {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
  `;
}

/**
 * Inject global styles if not already present
 */
function ensureStylesInjected(): void {
  const styleId = 'manga-translator-styles';
  if (document.getElementById(styleId)) {
    return;
  }

  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  styleElement.textContent = createOverlayStyles();
  document.head.appendChild(styleElement);
}

// ==================== Renderer Class ====================

/**
 * Overlay Renderer
 *
 * Manages the rendering of translation overlays on manga images.
 */
/**
 * Body class that swaps every overlay between its translation and its
 * original text.
 *
 * The listener is module-level rather than per-renderer so that a page with
 * many translated images still has exactly one keydown/keyup pair bound, and
 * so the class is removed from `<body>` even if the renderer is torn down
 * while the key is held.
 */
const SHOW_ORIGINAL_CLASS = 'manga-translator-show-original';

/**
 * How many renderers are currently alive.
 *
 * This is a count of *live instances*, not of calls: `acquire` is called
 * once per renderer and `release` once per renderer, and the release is
 * idempotent per instance (see `OverlayRenderer.dispose`). Counting calls
 * instead of instances meant a renderer that was disposed twice released the
 * shared listener twice, and a renderer that was never disposed held it
 * forever — in both cases the `show-original` class stayed on
 * `<body>` and the page was stuck showing the original text.
 */
let showOriginalListenerCount = 0;
let originalTextKeyDownHandler: ((event: KeyboardEvent) => void) | null = null;
let originalTextKeyUpHandler: ((event: KeyboardEvent) => void) | null = null;

function setShowOriginal(show: boolean): void {
  if (typeof document === 'undefined' || !document.body) {
    return;
  }
  document.body.classList.toggle(SHOW_ORIGINAL_CLASS, show);
}

function handleOriginalTextKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Alt' || event.altKey) {
    setShowOriginal(true);
  }
}

function handleOriginalTextKeyUp(event: KeyboardEvent): void {
  if (event.key === 'Alt' || !event.altKey) {
    setShowOriginal(false);
  }
}

/**
 * Blur also ends the gesture: a reader who alt-tabs away while holding Alt
 * would otherwise come back to a page stuck on the original text.
 */
function handleOriginalTextBlur(): void {
  setShowOriginal(false);
}

function acquireShowOriginalListener(): void {
  showOriginalListenerCount += 1;
  if (showOriginalListenerCount > 1) {
    return;
  }
  originalTextKeyDownHandler = handleOriginalTextKeyDown;
  originalTextKeyUpHandler = handleOriginalTextKeyUp;
  window.addEventListener('keydown', originalTextKeyDownHandler, true);
  window.addEventListener('keyup', originalTextKeyUpHandler, true);
  window.addEventListener('blur', handleOriginalTextBlur);
}

function releaseShowOriginalListener(): void {
  showOriginalListenerCount = Math.max(0, showOriginalListenerCount - 1);
  if (showOriginalListenerCount > 0) {
    return;
  }
  if (originalTextKeyDownHandler) {
    window.removeEventListener('keydown', originalTextKeyDownHandler, true);
    originalTextKeyDownHandler = null;
  }
  if (originalTextKeyUpHandler) {
    window.removeEventListener('keyup', originalTextKeyUpHandler, true);
    originalTextKeyUpHandler = null;
  }
  window.removeEventListener('blur', handleOriginalTextBlur);
  setShowOriginal(false);
}

export class OverlayRenderer {
  private style: OverlayStyle;
  private renderedOverlays: Map<HTMLImageElement, RenderedOverlay> = new Map();
  // Hover debounce timers - keyed by image element
  private hoverTimers: Map<
    HTMLImageElement,
    ReturnType<typeof setTimeout> | null
  > = new Map();
  private resizeObserver: ResizeObserver | null = null;
  private onWindowResize: (() => void) | null = null;
  /** Handle of the queued re-layout, or null when none is pending. */
  private repositionFrame: number | null = null;
  /** Set by `dispose()` so a frame already queued becomes a no-op. */
  private disposed = false;
  /**
   * Whether the style was set explicitly after construction.
   *
   * The persisted style arrives asynchronously. If the user changes the
   * style in the meantime, the newer value has to win — a late arrival
   * must not overwrite it with the value that was stored a moment earlier.
   */
  private styleOverridden = false;
  /**
   * Called when the user removes a translation from an image.
   *
   * The reading panel and the number badges are separate views of the same
   * translations, so they have to hear about a removal — otherwise the panel
   * still lists a translation that is no longer on the page.
   */
  private removalListener: ((image: HTMLImageElement) => void) | null = null;
  /**
   * Called when the user asks to keep the translated image.
   *
   * The renderer draws on the page; it does not know how to compose a file.
   * The content script owns that, so it registers a handler and the renderer
   * only offers the button.
   */
  private exportHandler:
    | ((
        image: HTMLImageElement,
        textAreas: TextArea[],
        trigger: HTMLElement
      ) => void)
    | null = null;
  /** How a piece of text is measured when the layout is computed. */
  private measure: TextMeasurer;

  constructor(
    style: Partial<OverlayStyle> = {},
    options: { measure?: TextMeasurer } = {}
  ) {
    this.style = { ...DEFAULT_STYLE, ...style };
    this.measure = options.measure ?? measureTextWidth;
    ensureStylesInjected();
    acquireShowOriginalListener();
    void this.applyPersistedStyle();
  }

  /**
   * Adopt the style the user configured, unless a newer one already won.
   */
  private async applyPersistedStyle(): Promise<void> {
    const persisted = await loadPersistedOverlayStyle();
    if (!persisted || this.styleOverridden || this.disposed) {
      return;
    }
    this.updateStyleFromConfig(persisted);
  }

  /**
   * Render translation overlays on an image
   */
  render(
    image: HTMLImageElement,
    textAreas: TextArea[],
    autoPinned = false
  ): HTMLElement {
    // Remove existing overlays for this image
    this.remove(image);

    // An empty translation is not a translation. Covering the speech bubble
    // with an empty box hides the artwork and the original text for nothing,
    // so the area is simply left alone.
    const areas = sortTextAreasByReadingOrder(
      textAreas.filter(area => area.translatedText.trim() !== ''),
      this.style.verticalText
    );

    if (areas.length === 0) {
      return image.parentElement || image;
    }

    // Create wrapper element
    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;
    wrapper.setAttribute(DATA_ATTR, 'true');

    // Get image dimensions
    const imageWidth = image.offsetWidth || image.naturalWidth;
    const imageHeight = image.offsetHeight || image.naturalHeight;

    // Insert wrapper and move image into it
    const parent = image.parentElement;
    if (parent) {
      parent.insertBefore(wrapper, image);
    }
    wrapper.appendChild(image);

    // Create overlay container (for hover toggle)
    const overlayContainer = document.createElement('div');
    overlayContainer.className = OVERLAY_CONTAINER_CLASS;
    wrapper.appendChild(overlayContainer);

    // Create overlay elements inside container
    const overlays: HTMLElement[] = [];
    for (const area of areas) {
      const overlay = this.createOverlayElement(area, imageWidth, imageHeight);
      overlayContainer.appendChild(overlay);
      overlays.push(overlay);
    }

    this.resolveOverlayCollisions(overlays, imageWidth, imageHeight);

    // Create control buttons
    const controls = document.createElement('div');
    controls.className = CONTROLS_CLASS;

    // Toggle button (pin/unpin translation)
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    paintToggleButton(toggleBtn, autoPinned);
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rendered = this.renderedOverlays.get(image);
      if (rendered) {
        rendered.pinned = !rendered.pinned;
        wrapper.classList.toggle('manga-translator-pinned', rendered.pinned);
        paintToggleButton(toggleBtn, rendered.pinned);
      }
    });
    controls.appendChild(toggleBtn);

    // Close button (remove overlay)
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = '移除翻译';
    // The accessible name of a button comes from its content, so a button
    // that reads "✕" is announced as "✕". `title` is only a fallback and is
    // never read out by a screen reader.
    closeBtn.setAttribute('aria-label', '移除这张图片的译文');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.removeTranslation(image);
    });
    controls.appendChild(closeBtn);

    // Save button (export the translated image as a PNG).
    //
    // The reader pays for every image, and until now the only thing they
    // got for it was an overlay on somebody else's page — which disappears
    // when the page does. The button is only rendered when somebody has
    // registered a handler: a renderer without one has nowhere to send the
    // request, and a button that does nothing is worse than no button.
    if (this.exportHandler) {
      controls.appendChild(this.createExportButton(image, areas));
    }

    wrapper.appendChild(controls);

    // Store reference for later removal
    this.renderedOverlays.set(image, {
      wrapper,
      image,
      overlays,
      overlayContainer,
      controls,
      pinned: autoPinned,
      textAreas: areas,
    });

    // Setup hover debounce handlers (CSS :hover alone causes flicker on fast mouse movement)
    const showOverlay = () => {
      this.clearHoverTimer(image);
      wrapper.classList.add('manga-translator-hover-active');
    };
    const hideOverlay = () => {
      // Only hide if not pinned
      const rendered = this.renderedOverlays.get(image);
      if (rendered && !rendered.pinned) {
        const timer = setTimeout(() => {
          wrapper.classList.remove('manga-translator-hover-active');
        }, HOVER_HIDE_DELAY);
        this.hoverTimers.set(image, timer);
      }
    };
    wrapper.addEventListener('mouseenter', showOverlay);
    wrapper.addEventListener('mouseleave', hideOverlay);

    // 点击翻译场景下自动 pin，翻译结果直接显示无需 hover
    if (autoPinned) {
      wrapper.classList.add('manga-translator-pinned');
      paintToggleButton(toggleBtn, true);
    }

    this.observeImage(image);

    return wrapper;
  }

  /**
   * Re-lay out every overlay for one image against its current box.
   *
   * Overlay geometry is stored in absolute pixels, so it is only correct for
   * the image size at render time. Anything that changes that size — a window
   * resize, a responsive breakpoint, a lazy-load that finally reports real
   * dimensions, or the host site toggling a zoom class — would otherwise leave
   * the translation floating off the speech bubble.
   */
  reposition(image: HTMLImageElement): void {
    const rendered = this.renderedOverlays.get(image);
    if (!rendered) {
      return;
    }

    const imageWidth = image.offsetWidth || image.naturalWidth;
    const imageHeight = image.offsetHeight || image.naturalHeight;
    if (imageWidth <= 0 || imageHeight <= 0) {
      return;
    }

    rendered.overlays.forEach((overlay, index) => {
      const area = rendered.textAreas[index];
      if (!area) {
        return;
      }
      this.applyOverlayLayout(overlay, area, imageWidth, imageHeight);
    });

    // Re-run collision resolution: at a different scale the previous pass may
    // have produced overlaps that no longer exist, or new ones that do.
    this.resolveOverlayCollisions(rendered.overlays, imageWidth, imageHeight);
  }

  /**
   * Re-lay out every rendered image. Safe to call on scroll/resize storms.
   */
  repositionAll(): void {
    for (const image of this.renderedOverlays.keys()) {
      this.reposition(image);
    }
  }

  /**
   * Track an image so layout changes re-flow its overlays.
   *
   * One shared ResizeObserver covers every rendered image; the window resize
   * listener is a fallback for browsers or environments where the observer
   * does not fire (and for zoom changes that do not alter the element box).
   */
  private observeImage(image: HTMLImageElement): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.ensureResizeObserver();
    this.resizeObserver?.observe(image);
  }

  private ensureResizeObserver(): void {
    if (this.resizeObserver || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const target = entry.target;
        if (target instanceof HTMLImageElement) {
          this.reposition(target);
        }
      }
    });
    if (typeof window !== 'undefined') {
      // Coalesced to one reflow per frame. `repositionAll` re-runs collision
      // resolution, and the adaptive font sizing measures text per character,
      // so a drag-resize across 60 rendered images was a measurement storm on
      // every event rather than once per frame.
      this.onWindowResize = () => this.scheduleRepositionAll();
      window.addEventListener('resize', this.onWindowResize, {
        passive: true,
      });
    }
  }

  /**
   * Queue a full re-layout for the next frame, collapsing any number of resize
   * events arriving before it into a single pass.
   */
  private scheduleRepositionAll(): void {
    if (this.repositionFrame !== null) {
      return;
    }
    const schedule =
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) =>
            setTimeout(() => callback(Date.now()), 16) as unknown as number;
    this.repositionFrame = schedule(() => {
      this.repositionFrame = null;
      // A frame can land after teardown; the overlays are gone and the page
      // may be heading for the bfcache, so there is nothing left to re-flow.
      if (this.disposed) {
        return;
      }
      this.repositionAll();
    });
  }

  /**
   * Release observers and window listeners. Call when the page-level renderer
   * is torn down so a re-initialised renderer does not stack listeners.
   */
  dispose(): void {
    // Disposing twice must not release the shared Alt-key listener twice:
    // the counter is a count of live renderers, and a double release would
    // take it below the number of renderers that are still alive — leaving
    // the `show-original` class stuck on `<body>`.
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    releaseShowOriginalListener();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.onWindowResize) {
      window.removeEventListener('resize', this.onWindowResize);
      this.onWindowResize = null;
    }
    if (this.repositionFrame !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.repositionFrame);
      } else {
        clearTimeout(
          this.repositionFrame as unknown as ReturnType<typeof setTimeout>
        );
      }
      this.repositionFrame = null;
    }
    this.removeAll();
    this.hoverTimers.clear();
    // `getRenderer()` caches the instance, so without this a page that
    // re-initialises after teardown — a bfcache restore, or an error path that
    // runs cleanup and then translates again — would be handed a disposed
    // renderer with no observer and no resize listener, and overlays would
    // silently stop following the art.
    if (rendererInstance === this) {
      rendererInstance = null;
    }
  }

  /**
   * Clear hover timer for an image
   */
  private clearHoverTimer(image: HTMLImageElement): void {
    const existing = this.hoverTimers.get(image);
    if (existing) {
      clearTimeout(existing);
      this.hoverTimers.set(image, null);
    }
  }

  /**
   * Create a single overlay element for a text area
   */
  private createOverlayElement(
    area: TextArea,
    imageWidth: number,
    imageHeight: number
  ): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute(DATA_ATTR, 'overlay');

    // The original text was already being kept — as a `data-original`
    // attribute nobody could read. Rendering it as a second, hidden layer
    // makes the source visible on demand (hold Alt) without adding a control
    // to every image or disturbing the layout of the translation itself.
    const translated = document.createElement('span');
    translated.className = TRANSLATED_TEXT_CLASS;
    translated.textContent = area.translatedText;

    const original = document.createElement('span');
    original.className = ORIGINAL_TEXT_CLASS;
    original.textContent = area.originalText;

    overlay.appendChild(translated);
    overlay.appendChild(original);
    overlay.setAttribute('data-original', area.originalText);

    this.applyOverlayLayout(overlay, area, imageWidth, imageHeight);

    return overlay;
  }

  /**
   * Position and style one overlay against its text area.
   *
   * The geometry is kept apart from the element creation so that the same
   * overlay can be re-laid out when the style changes — the user picked a
   * bigger font in the settings page and the translations already on the
   * page have to follow, not just the ones translated afterwards.
   */
  private applyOverlayLayout(
    overlay: HTMLElement,
    area: TextArea,
    imageWidth: number,
    imageHeight: number
  ): void {
    const layout = computeAdaptiveOverlayLayout(
      area,
      imageWidth,
      imageHeight,
      this.style,
      this.measure
    );

    overlay.classList.toggle(OVERLAY_VERTICAL_CLASS, this.style.verticalText);
    overlay.classList.toggle(OVERLAY_CLIPPED_CLASS, layout.clipped);

    Object.assign(overlay.style, {
      left: `${layout.left}px`,
      top: `${layout.top}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      backgroundColor: this.style.backgroundColor,
      color: this.style.textColor,
      fontFamily: this.style.fontFamily,
      fontSize: `${layout.fontSize}px`,
      borderRadius: `${this.style.borderRadius}px`,
      padding: `${this.style.padding}px`,
      whiteSpace: 'pre-wrap',
      writingMode: this.style.verticalText ? 'vertical-rl' : 'horizontal-tb',
    });
  }

  /**
   * 把互相压住的气泡推开。
   *
   * 算法本身是纯函数（`resolveOverlayCollisions`），因为导出的 PNG 必须
   * 做同一件事：屏幕上分开的两个气泡，在画布上不能叠在一起。
   */
  private resolveOverlayCollisions(
    overlays: HTMLElement[],
    imageWidth: number,
    imageHeight: number
  ): void {
    const rects = overlays.map(overlay => {
      const rect = getStyledRect(overlay);
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });

    const resolved = resolveOverlayCollisions(rects, imageWidth, imageHeight);
    resolved.forEach((rect, index) => {
      const overlay = overlays[index];
      if (!overlay) {
        return;
      }
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
    });
  }

  /**
   * Remove overlays from a specific image
   */
  remove(image: HTMLImageElement | HTMLElement): void {
    const target = this.resolveImage(image);
    const rendered = this.renderedOverlays.get(target);
    if (!rendered) {
      return;
    }

    this.resizeObserver?.unobserve(rendered.image);

    // Clean up hover timer
    this.clearHoverTimer(target);
    this.hoverTimers.delete(target);

    const { wrapper, image: originalImage } = rendered;

    const parent = wrapper.parentElement;
    if (parent) {
      parent.insertBefore(originalImage, wrapper);
      wrapper.remove();
    }

    this.renderedOverlays.delete(originalImage);
  }

  /**
   * Remove the translation from one image and tell the host about it.
   *
   * The reading panel and the number badges are other views of the same
   * translations, so a removal has to reach them: otherwise the panel keeps
   * listing a translation that is no longer on the page, and the badge still
   * claims the image was translated.
   */
  removeTranslation(image: HTMLImageElement | HTMLElement): void {
    const target = this.resolveImage(image);
    const hadOverlays = this.renderedOverlays.has(target);
    this.remove(target);
    if (hadOverlays) {
      this.removalListener?.(target);
    }
  }

  /**
   * Register the callback that hears about a translation the user removed.
   */
  setRemovalListener(
    listener: ((image: HTMLImageElement) => void) | null
  ): void {
    this.removalListener = listener;
  }

  /**
   * Register the callback that turns a translated image into a file.
   *
   * Registering it also gives the images that are already on the page a save
   * button: the button lives in the control strip, and an image translated
   * before the handler existed would otherwise have no way to be saved.
   */
  setExportHandler(
    handler:
      | ((
          image: HTMLImageElement,
          textAreas: TextArea[],
          trigger: HTMLElement
        ) => void)
      | null
  ): void {
    this.exportHandler = handler;
    if (!handler) {
      return;
    }
    for (const rendered of this.renderedOverlays.values()) {
      if (rendered.controls.querySelector('[data-export-button]')) {
        continue;
      }
      rendered.controls.appendChild(
        this.createExportButton(rendered.image, rendered.textAreas)
      );
    }
  }

  /**
   * The "save this image" control.
   *
   * The click is stopped from propagating: the control strip sits on top of
   * the image, and the page underneath must not see the click.
   */
  private createExportButton(
    image: HTMLImageElement,
    textAreas: TextArea[]
  ): HTMLElement {
    const exportBtn = document.createElement('button');
    exportBtn.title = '保存译文图片';
    exportBtn.textContent = '⬇';
    exportBtn.setAttribute('aria-label', '保存译文图片');
    exportBtn.setAttribute('data-export-button', 'true');
    exportBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rendered = this.renderedOverlays.get(image);
      this.exportHandler?.(image, rendered?.textAreas ?? textAreas, exportBtn);
    });
    return exportBtn;
  }

  /**
   * The image an element belongs to.
   *
   * The overlay wraps the image, so a caller may hold either.
   */
  private resolveImage(
    image: HTMLImageElement | HTMLElement
  ): HTMLImageElement {
    if (image.classList?.contains(WRAPPER_CLASS)) {
      const img = image.querySelector('img') as HTMLImageElement | null;
      if (img) {
        return img;
      }
    }
    return image as HTMLImageElement;
  }

  /**
   * Remove all rendered overlays
   */
  removeAll(): void {
    const images = Array.from(this.renderedOverlays.keys());
    for (const image of images) {
      this.remove(image);
    }
    this.hoverTimers.clear();
  }

  /**
   * Check if an image has overlays rendered
   */
  hasOverlays(image: HTMLImageElement): boolean {
    return this.renderedOverlays.has(image);
  }

  /**
   * Get the number of images with overlays
   */
  getOverlayCount(): number {
    return this.renderedOverlays.size;
  }

  /**
   * Update overlay style from config
   */
  updateStyleFromConfig(config: OverlayStyleConfig): void {
    this.styleOverridden = true;
    this.style = {
      ...this.style,
      backgroundColor: config.backgroundColor,
      textColor: config.textColor,
      minFontSize: config.minFontSize,
      maxFontSize: config.maxFontSize,
      verticalText: config.verticalText,
    };
    this.relayoutOverlays();
  }

  /**
   * Update overlay style
   */
  updateStyle(style: Partial<OverlayStyle>): void {
    this.styleOverridden = true;
    this.style = { ...this.style, ...style };
    this.relayoutOverlays();
  }

  /**
   * Re-lay out every overlay that is already on the page.
   *
   * The font size and the writing direction are part of the layout, so a
   * change to either of them has to reach the translations the user is
   * already looking at. Without this the setting only ever applied to the
   * images translated *after* the change: the user made the text bigger,
   * looked at the page, saw no difference, and concluded the setting was
   * broken.
   */
  private relayoutOverlays(): void {
    for (const rendered of this.renderedOverlays.values()) {
      const imageWidth =
        rendered.image.offsetWidth || rendered.image.naturalWidth;
      const imageHeight =
        rendered.image.offsetHeight || rendered.image.naturalHeight;
      rendered.overlays.forEach((overlay, index) => {
        const area = rendered.textAreas[index];
        if (!area) {
          return;
        }
        this.applyOverlayLayout(overlay, area, imageWidth, imageHeight);
      });
      this.resolveOverlayCollisions(rendered.overlays, imageWidth, imageHeight);
    }
  }

  /**
   * Get current style configuration
   */
  getStyle(): OverlayStyle {
    return { ...this.style };
  }
}

// ==================== Singleton Instance ====================

let rendererInstance: OverlayRenderer | null = null;

/**
 * Get or create the singleton renderer instance
 */
export function getRenderer(style?: Partial<OverlayStyle>): OverlayRenderer {
  if (!rendererInstance) {
    rendererInstance = new OverlayRenderer(style);
  } else if (style) {
    rendererInstance.updateStyle(style);
  }
  return rendererInstance;
}

// ==================== DOM Query Utilities ====================

/**
 * Find all manga translator wrappers in the document
 */
function findAllWrappers(): HTMLElement[] {
  return Array.from(document.querySelectorAll(`.${WRAPPER_CLASS}`));
}

/**
 * Reunite each translated image with its original parent and drop the wrapper
 * the renderer introduced. Used by the cancel path so a page is left exactly
 * as it was found.
 */
export function removeAllOverlaysFromDOM(): void {
  const wrappers = findAllWrappers();

  for (const wrapper of wrappers) {
    const image = wrapper.querySelector('img');
    if (image && wrapper.parentElement) {
      wrapper.parentElement.insertBefore(image, wrapper);
      wrapper.remove();
    }
  }
}
