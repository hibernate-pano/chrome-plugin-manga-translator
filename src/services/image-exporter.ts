/**
 * Image Exporter Service
 *
 * 把一张已经翻译过的漫画页合成成一张 PNG：原图 + 画在上面的译文气泡。
 *
 * 三件事决定了这里的做法：
 *
 * 1. 像素必须来自扩展自己的 worker。漫画图基本都是跨域的，直接把 `<img>`
 *    画到 canvas 上会污染画布，`toBlob` 会抛 SecurityError。worker 已经有
 *    一条带防护的取图通道（`FETCH_IMAGE_BYTES`），这里复用它。
 * 2. 版式必须和页面上看到的一致。所以排版用的是渲染器同一套
 *    `computeAdaptiveOverlayLayout`，而不是另写一份近似实现。
 * 3. 画布尺寸是原图像素尺寸，不是页面上显示的尺寸。导出的文件应该是全
 *    分辨率，而不是读者屏幕上那个缩放过的尺寸。
 */

import {
  COLUMN_THICKNESS_RATIO,
  LINE_HEIGHT_RATIO,
  computeAdaptiveOverlayLayout,
  estimateTextWidth,
  overlayFont,
  planVerticalText,
  resolveOverlayCollisions,
  wrapTextLikeBrowser,
} from '@/services/renderer';
import type {
  OverlayLayout,
  OverlayStyle,
  TextMeasurer,
} from '@/services/renderer';
import type { TextArea } from '@/providers/base';
import type { FetchImageBytesResponse } from '@/shared/runtime-contracts';

// ==================== Constants ====================

/**
 * 行高和竖排列厚都住在渲染器那边（`LINE_HEIGHT_RATIO` /
 * `COLUMN_THICKNESS_RATIO`），这里直接用。
 *
 * 以前这里是抄过去的。两边的数字一旦对不上，导出的文件里每一行都会错位，
 * 而且很难被发现——所以数字只有一个地方能改。
 */

/**
 * 任何一种操作系统都不允许出现在文件名里的字符（不含控制字符）。
 *
 * Windows 的限制最严：`< > : " / \ | ? *`，再加上文件名不能以空格或点结尾。
 * 用户输入 `a/b` 时想的是"子目录"，但浏览器会照字面执行，于是下载下来的
 * 文件跑去了别的地方。
 */
const ILLEGAL_FILENAME_CHARS = '<>:"/\\|?*';

/**
 * 控制字符（ASCII 0-31 和 DEL）在任何系统里都不能进文件名。
 *
 * 单独判断而不是写进正则：正则里的控制字符区间会触发 lint 规则，而且
 * 逐字符判断本来就更直白。
 */
function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

// ==================== Types ====================

/**
 * 一张已经解码好的图片。
 *
 * `source` 可以直接画到 canvas 上，`width`/`height` 是它的像素尺寸。
 */
export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface ComposeTranslatedImageOptions {
  /** 已经解码好的原图。 */
  source: CanvasImageSource;
  /** 原图的像素宽度。 */
  width: number;
  /** 原图的像素高度。 */
  height: number;
  /** 这张图上的译文。 */
  textAreas: TextArea[];
  /** 覆盖层样式，必须和页面上用的是同一份。 */
  style: OverlayStyle;
  /** 量文字的函数；默认用导出用的这块画布自己量。 */
  measure?: TextMeasurer;
  /**
   * 原图像素 ÷ 屏幕上显示像素。
   *
   * 页面上的气泡是按**显示尺寸**排的（`renderer.ts` 用 `image.offsetWidth`），
   * 而这块画布是原图的**像素尺寸**。版式先在显示尺寸里排好（和屏幕上完全
   * 一样），再整体乘以这个倍数放到原图像素上——所以视网膜屏（2×）上导出
   * 的译文是屏幕上的两倍大，而不是一半大；长条图（5×）上也是五倍。
   */
  scale?: number;
}

export interface ExportTranslatedImageOptions {
  /** 要导出的图片元素。 */
  image: HTMLImageElement;
  /** 这张图上的译文。 */
  textAreas: TextArea[];
  /** 覆盖层样式。 */
  style: OverlayStyle;
  /** 量文字的函数；默认用导出用的这块画布自己量。 */
  measure?: TextMeasurer;
}

// ==================== Filename ====================

/**
 * 把用户输入的文件名收拾成一个各系统都能接受的名字。
 *
 * 去掉的是任何系统都不允许的字符（Windows 最严），以及结尾的点和空格——
 * Windows 会直接把它们截掉，那样用户看到的文件名就和输入的不一样。
 * 结果可能是空串：调用方要自己决定兜底的名字。
 */
export function sanitizeFilename(name: string): string {
  let kept = '';
  for (const char of name) {
    if (ILLEGAL_FILENAME_CHARS.includes(char) || isControlCharacter(char)) {
      continue;
    }
    kept += char;
  }
  return kept
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

/**
 * 默认文件名：`manga-<站点>-<序号>.png`。
 *
 * 站点名和序号是用户唯一认得出的两样东西——漫画站的图片 URL 里往往是
 * 一串无意义的哈希，页面标题又可能一模一样。
 */
export function buildDefaultFilename(host: string, index: number): string {
  const safeHost = sanitizeFilename(host) || 'page';
  return `manga-${safeHost}-${index}.png`;
}

// ==================== Fetching the artwork ====================

/**
 * 让 worker 去取原图的字节。
 *
 * 内容脚本自己 fetch 会被页面的 CORS 拦掉，而 worker 那边已经有一条带防护
 * 的取图通道（限流大小、超时、拒绝内网地址），不在这里另写一套。
 */
export async function fetchImageBytesForExport(
  imageUrl: string
): Promise<Blob> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('无法连接扩展后台');
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'FETCH_IMAGE_BYTES',
    imageUrl,
  })) as FetchImageBytesResponse | undefined;

  if (!response || response.success !== true) {
    throw new Error(response?.error || '图片获取失败');
  }
  if (!response.imageBase64) {
    throw new Error('图片获取失败：后台没有返回图像数据');
  }

  const bytes = base64ToBytes(response.imageBase64);
  return new Blob([bytes], { type: response.mimeType || 'image/png' });
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  // 明确给一块 ArrayBuffer：Blob 只收 ArrayBuffer 背书的视图。
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * 把字节解成可以画到 canvas 上的东西。
 *
 * 走 `createImageBitmap` 是因为它不污染画布：Blob 解出来的位图可以直接
 * `drawImage`，导出也就不会被 `toBlob` 的 SecurityError 拦下。老浏览器没有
 * 这个 API 时退回 `<img>` + object URL。
 */
export async function decodeImageBlob(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await waitForImage(image);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === 'function') {
    return image.decode();
  }
  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('图片解码失败')), {
      once: true,
    });
  });
}

// ==================== Composition ====================

/**
 * 量文字，用的正是最后画字的那块画布。
 *
 * 排版和画字必须用同一套字体度量，否则导出的文件里的换行位置和页面上看到
 * 的不一样——那正是"导出和屏幕对不上"的来源。
 */
function createCanvasMeasurer(ctx: CanvasRenderingContext2D): TextMeasurer {
  return (text, fontSize, style) => {
    ctx.font = overlayFont(fontSize, style);
    const measured = ctx.measureText(text);
    const width = measured?.width;
    return typeof width === 'number' && Number.isFinite(width)
      ? width
      : estimateTextWidth(text, fontSize);
  };
}

/**
 * 把屏幕上的版式整体放大到原图的像素。
 *
 * 排版本身是在"显示尺寸"里做的（和页面完全一样），放大的是结果：气泡的宽
 * 高、字号、位置一起乘以同一个倍数。所以导出的 PNG 是屏幕上那版版式的等比
 * 副本，而不是"重新排了一遍"——重新排的话，字号的候选值（整数）落在不同的
 * 刻度上，气泡就会比屏幕上大一点或小一点。
 */
function scaleLayout(layout: OverlayLayout, scale: number): OverlayLayout {
  return {
    ...layout,
    fontSize: layout.fontSize * scale,
    width: layout.width * scale,
    height: layout.height * scale,
    left: layout.left * scale,
    top: layout.top * scale,
  };
}

/**
 * 把原图和译文气泡合成到一块画布上。
 *
 * 画布是原图的像素尺寸——导出的文件应该是全分辨率，而不是读者屏幕上那个
 * 缩放过的尺寸。
 */
export function composeTranslatedImage(
  options: ComposeTranslatedImageOptions
): HTMLCanvasElement {
  const { source, width, height, textAreas, style } = options;
  if (width <= 0 || height <= 0) {
    throw new Error('图片尺寸无效，无法导出');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建画布，导出失败');
  }

  ctx.drawImage(source, 0, 0, width, height);

  const measure = options.measure ?? createCanvasMeasurer(ctx);
  const scale = options.scale ?? 1;
  const drawStyle = scaleOverlayStyle(style, scale);

  /*
   * 排版按"屏幕上显示的尺寸"做，再整体放大。
   *
   * 页面上的气泡是按显示尺寸排的（`renderer.ts` 用 `image.offsetWidth`），
   * 而这块画布是原图的像素尺寸。这里把两者接上：先在显示尺寸里排出和屏幕
   * 一模一样的版式，再把结果乘以 `scale` 放到原图像素上。
   */
  const displayWidth = width / scale;
  const displayHeight = height / scale;

  /*
   * 先算好所有气泡的位置，再一起解决重叠，最后才画。
   *
   * 页面上两个挨得很近的气泡会被推开（`renderer.ts` 的碰撞避让）。导出
   * 如果各画各的，屏幕上分开的两个气泡在 PNG 里就叠在了一起 —— 读者看到
   * 的是两层字，而页面上只看到一层。
   */
  const drawables = textAreas
    // 空的译文不是译文：盖上一个空盒子只会把画面和原文一起遮掉。
    .filter(area => area.translatedText && area.translatedText.trim() !== '')
    .map(area => ({
      area,
      layout: scaleLayout(
        computeAdaptiveOverlayLayout(
          area,
          displayWidth,
          displayHeight,
          style,
          measure
        ),
        scale
      ),
    }));

  const resolved = resolveOverlayCollisions(
    drawables.map(drawable => ({
      left: drawable.layout.left,
      top: drawable.layout.top,
      width: drawable.layout.width,
      height: drawable.layout.height,
    })),
    width,
    height,
    // 页面上的间距是 4 个屏幕像素；导出用的是原图像素，按比例放大。
    4 * scale
  );

  drawables.forEach((drawable, index) => {
    const rect = resolved[index];
    if (!rect) {
      return;
    }
    drawOverlay(
      ctx,
      drawable.area,
      { ...drawable.layout, left: rect.left, top: rect.top },
      drawStyle,
      measure
    );
  });

  return canvas;
}

/**
 * 把页面上的绝对像素（内边距、圆角）换算到原图的像素尺度。
 *
 * 只放大这两个数，不动颜色和字体：版式已经按显示尺寸排好了，放大的是结果；
 * 这里要放大的只是画的时候要用的那几笔。
 */
function scaleOverlayStyle(style: OverlayStyle, scale: number): OverlayStyle {
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) {
    return style;
  }
  return {
    ...style,
    padding: style.padding * scale,
    borderRadius: style.borderRadius * scale,
  };
}

/**
 * 画一个气泡：先铺底板，再写字。
 *
 * 顺序不能反——字必须落在自己的底板上，否则深色背景上的译文是一堆没有
 * 底色的字，读不下去。
 */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  area: TextArea,
  layout: OverlayLayout,
  style: OverlayStyle,
  measure: TextMeasurer
): void {
  const previousFont = ctx.font;
  const previousFillStyle = ctx.fillStyle;
  const previousTextAlign = ctx.textAlign;
  const previousTextBaseline = ctx.textBaseline;
  const previousAlpha = ctx.globalAlpha;

  ctx.fillStyle = style.backgroundColor;
  fillRoundedRect(
    ctx,
    layout.left,
    layout.top,
    layout.width,
    layout.height,
    style.borderRadius
  );

  ctx.fillStyle = style.textColor;
  ctx.font = overlayFont(layout.fontSize, style);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  /*
   * 字不能画出气泡。
   *
   * 页面上气泡是 `overflow: hidden`，放不下的部分会被裁掉（译文的完整
   * 版本在阅读面板里）。导出如果不裁，PNG 里就会有一行字横在气泡外面，
   * 压在原图上——而屏幕上根本没有这一行。
   */
  ctx.save();
  clipRoundedRect(
    ctx,
    layout.left,
    layout.top,
    layout.width,
    layout.height,
    style.borderRadius
  );

  if (style.verticalText) {
    drawVerticalText(ctx, layout, style, measure, area.translatedText);
  } else {
    drawHorizontalText(ctx, layout, style, measure, area.translatedText);
  }

  ctx.restore();

  if (layout.clipped) {
    drawClippedMarker(ctx, layout, style);
  }

  ctx.font = previousFont;
  ctx.fillStyle = previousFillStyle;
  ctx.textAlign = previousTextAlign;
  ctx.textBaseline = previousTextBaseline;
  ctx.globalAlpha = previousAlpha;
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, r);
  ctx.closePath();
  ctx.fill();
}

/**
 * 把后面的绘制裁在气泡里。
 *
 * 页面上气泡是 `overflow: hidden`，导出必须裁在同样的地方，否则多出来的那
 * 行字会压在原图上。
 */
function clipRoundedRect(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, r);
  ctx.closePath();
  ctx.clip();
}

/**
 * 横排：一行一行往下排。
 *
 * 基线间距是 `fontSize * 1.3`，和页面上气泡的 `line-height: 1.3` 一样。
 */
function drawHorizontalText(
  ctx: CanvasRenderingContext2D,
  layout: OverlayLayout,
  style: OverlayStyle,
  measure: TextMeasurer,
  text: string
): void {
  const lineHeight = layout.fontSize * LINE_HEIGHT_RATIO;
  /*
   * 折行按浏览器的方式再走一遍。
   *
   * 页面把文字交给浏览器排版：拉丁词不拆、中日韩字之间可以断、句号不会
   * 跑到行首。气泡的高度是按"逐字断开"的估算算出来的（所以总是够高），
   * 但真正显示出来的断行是浏览器给的。导出如果用估算的断行，一个英文单词
   * 会被从中间劈开，而且行数和屏幕上不一样。
   */
  const contentWidth = Math.max(layout.width - style.padding * 2, 1);
  const lines = wrapTextLikeBrowser(
    text,
    contentWidth,
    layout.fontSize,
    style,
    measure
  );
  /*
   * 页面上的气泡把译文放在正中：`align-items/justify-content: center` 加
   * `text-align: center`（`renderer.ts` 的样式表）。导出必须做同一件事。
   *
   * 这里以前从左上角 `left + padding` 开始画，而气泡的地板是**原气泡的
   * 宽度**（译文比原文短的时候是常态），于是屏幕上居中的一行字，在 PNG 里
   * 贴在左上角。读者导出的是"自己看到的译文"，看到的却不是同一个版式。
   */
  const contentHeight = Math.max(layout.height - style.padding * 2, 0);
  const blockHeight = lines.length * lineHeight;
  const startY =
    layout.top +
    style.padding +
    (contentHeight - blockHeight) / 2 +
    // 行高比字大，多出来的那点叫半行距：浏览器把它一分为二放在字的上下，
    // 画布上按基线画字，得自己补上。
    (lineHeight - layout.fontSize) / 2;

  ctx.textAlign = 'center';
  const centerX = layout.left + layout.width / 2;
  lines.forEach((line, index) => {
    if (line.length === 0) {
      return;
    }
    ctx.fillText(line, centerX, startY + index * lineHeight);
  });
}

/**
 * 竖排：每一"行"其实是一列，列从右往左排，列里的字从上往下叠。
 *
 * 这正是日漫的读法：从右往左读列。列的厚度是 `fontSize * 1.3`。
 */
function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  layout: OverlayLayout,
  style: OverlayStyle,
  measure: TextMeasurer,
  text: string
): void {
  const thickness = layout.fontSize * COLUMN_THICKNESS_RATIO;
  /*
   * 竖排的折行也按浏览器的方式走：一列能放多长由内容框的高度决定（页面
   * 上文字层是 `height: 100%`），一段拉丁文斜着排在一列里，不会被拆到
   * 好几列去。
   */
  const columnLength = Math.max(layout.height - style.padding * 2, 1);
  const columns = planVerticalText(
    text,
    columnLength,
    layout.fontSize,
    style,
    measure
  );
  /*
   * 竖排读法是右起第一列、往左排。页面上这组列是自动宽度、被 flex 居中
   * 的（`.manga-translator-overlay-vertical` 的文本层 `width: auto`），
   * 所以整组列在气泡里居中，而不是贴着右边缘。
   */
  const groupWidth = columns.length * thickness;
  const groupLeft = layout.left + (layout.width - groupWidth) / 2;
  const metrics = fontVerticalMetrics(ctx, layout.fontSize);

  columns.forEach((column, columnIndex) => {
    const columnLeft =
      groupLeft + (columns.length - 1 - columnIndex) * thickness;
    /*
     * 页面上的竖排文字在列里是上下居中的（`text-align: center` 在竖排里
     * 管的是行内方向），放不下的时候从顶上开始——浏览器对齐溢出的内容时
     * 也是这么做的。
     */
    const contentLength = column.blocks.reduce(
      (total, block) => total + block.advance,
      0
    );
    let y =
      layout.top +
      style.padding +
      Math.max(0, (columnLength - contentLength) / 2);

    for (const block of column.blocks) {
      if (block.upright) {
        drawUprightBlock(ctx, block.text, columnLeft, y, layout);
      } else {
        drawRotatedBlock(ctx, block.text, columnLeft, y, layout, metrics);
      }
      y += block.advance;
    }
  });
}

/**
 * 直立着写的一块字（中日韩字，或者竖排里不跟着转的空格）。
 *
 * 字身盒从列的顶端往下铺一格，字身在列的厚度里居中——和浏览器把字放进
 * 行盒的方式一样。
 */
function drawUprightBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  columnLeft: number,
  y: number,
  layout: OverlayLayout
): void {
  const thickness = layout.fontSize * COLUMN_THICKNESS_RATIO;
  const x = columnLeft + (thickness - layout.fontSize) / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

/**
 * 旋转 90° 写的一块字（拉丁文）。
 *
 * 浏览器在竖排里把拉丁文整个转 90°（`text-orientation: mixed` 的默认行为），
 * 导出必须做同一件事：横着排的字和竖着排的字看起来是两回事。
 *
 * 转过来之后，这一块在列里占的高度是它横着排出来的宽度——折行时算的也是
 * 这个宽度。之前这里按"每个字一格"往下摆，一个词就被撑成好几个字高，列
 * 撑破了气泡，读者在 PNG 里看到的比屏幕上少一大截。
 */
function drawRotatedBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  columnLeft: number,
  y: number,
  layout: OverlayLayout,
  metrics: { ascent: number; descent: number }
): void {
  const thickness = layout.fontSize * COLUMN_THICKNESS_RATIO;
  // 行盒比字身高，多出来的那点叫半行距：浏览器把它一分为二放在字的上下。
  const halfLeading = Math.max(
    (thickness - (metrics.ascent + metrics.descent)) / 2,
    0
  );
  ctx.save();
  // 转 90° 之后，基线沿着列往下走，字顶朝右——和浏览器一样。
  ctx.translate(columnLeft + halfLeading + metrics.descent, y);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * 字体的上高和下高。
 *
 * 旋转 90° 之后，字在列的厚度方向上占的是"上高 + 下高"，浏览器把这块放进
 * 行盒时留的半行距就是照这个算的。画布量得到这两个数就用它；量不到
 * （老浏览器）就用常见的近似值。
 */
function fontVerticalMetrics(
  ctx: CanvasRenderingContext2D,
  fontSize: number
): { ascent: number; descent: number } {
  const metrics = ctx.measureText('Mg');
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  if (
    typeof ascent === 'number' &&
    typeof descent === 'number' &&
    ascent > 0 &&
    descent > 0
  ) {
    return { ascent, descent };
  }
  return { ascent: fontSize * 0.88, descent: fontSize * 0.12 };
}

/**
 * 译文放不下时，在右下角画一个省略号。
 *
 * 页面上被截断的气泡有一个 CSS 伪元素写着 `…`。导出的文件里也得有，
 * 否则读者会把一句被截断的话当成完整的句子，而完整的下半句只存在于阅读
 * 面板里。
 */
function drawClippedMarker(
  ctx: CanvasRenderingContext2D,
  layout: OverlayLayout,
  style: OverlayStyle
): void {
  ctx.font = overlayFont(layout.fontSize * 0.85, style);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 0.8;
  ctx.fillText(
    '…',
    layout.left + layout.width - 3,
    layout.top + layout.height - 1
  );
}

// ==================== Export ====================

/**
 * 画布转 Blob。
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png'
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('当前浏览器不支持导出 PNG'));
      return;
    }
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('导出 PNG 失败'));
      }
    }, type);
  });
}

/**
 * 原图像素 ÷ 屏幕上占的像素。
 *
 * 页面按 `offsetWidth` 排版（`renderer.ts`），所以一张被缩小显示的图，这个
 * 比值大于 1。取不到布局尺寸时（还没上屏、被隐藏），页面自己也是退回
 * `naturalWidth` 排的，这里同样退回 1 —— 两边必须用同一个基准，否则导出的
 * 版式和屏幕上的还不是同一个。
 */
export function displayScale(
  image: HTMLImageElement,
  naturalWidth: number
): number {
  const displayed = image.offsetWidth;
  if (!displayed || displayed <= 0 || !naturalWidth || naturalWidth <= 0) {
    return 1;
  }
  const scale = naturalWidth / displayed;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 完整的导出流程：取原图 → 合成 → 出 Blob。
 */
export async function exportTranslatedImage(
  options: ExportTranslatedImageOptions
): Promise<Blob> {
  const imageUrl = options.image.currentSrc || options.image.src;
  if (!imageUrl) {
    throw new Error('找不到图片地址，无法导出');
  }

  const blob = await fetchImageBytesForExport(imageUrl);
  const decoded = await decodeImageBlob(blob);
  const canvas = composeTranslatedImage({
    source: decoded.source,
    width: decoded.width,
    height: decoded.height,
    textAreas: options.textAreas,
    style: options.style,
    measure: options.measure,
    scale: displayScale(options.image, decoded.width),
  });

  return canvasToBlob(canvas);
}
