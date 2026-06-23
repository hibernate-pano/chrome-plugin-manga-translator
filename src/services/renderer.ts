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

// ==================== Type Definitions ====================

export interface OverlayStyleConfig {
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

export interface RenderedOverlay {
  /** The wrapper element containing the image and overlays */
  wrapper: HTMLElement;
  /** The original image element */
  image: HTMLImageElement;
  /** Array of overlay elements */
  overlays: HTMLElement[];
  /** The overlay container for hover toggle */
  overlayContainer: HTMLElement;
  /** Whether translation is pinned (manually toggled on) */
  pinned: boolean;
}

// ==================== Constants ====================

const WRAPPER_CLASS = 'manga-translator-wrapper';
const OVERLAY_CLASS = 'manga-translator-overlay';
const OVERLAY_CONTAINER_CLASS = 'manga-translator-overlay-container';
const CONTROLS_CLASS = 'manga-translator-controls';
const DATA_ATTR = 'data-manga-translator';

// Hover debounce delay (ms) - prevents flicker when mouse quickly enters/leaves
const HOVER_HIDE_DELAY = 120; // delay hide on mouseleave to prevent rapid toggle flicker

const DEFAULT_STYLE: OverlayStyle = {
  backgroundColor: 'rgba(240, 240, 235, 0.94)',
  textColor: '#111111',
  fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  borderRadius: 6,
  padding: 7,
  minFontSize: 10,
  maxFontSize: 22,
  verticalText: false,
};

export const DEFAULT_OVERLAY_STYLE_CONFIG: OverlayStyleConfig = {
  backgroundColor: 'rgba(240, 240, 235, 0.94)',
  textColor: '#111111',
  minFontSize: 10,
  maxFontSize: 22,
  verticalText: false,
};

// ==================== Utility Functions ====================

// 全角字符正则表达式：涵盖汉字、日文平假名/片假名、韩文音节、全角标点符号等，实现更精准的多语言宽度估算
const FULL_WIDTH_REGEX = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f]/g;

/**
 * 计算最优字体大小（感知中文字符宽度）
 *
 * 中文字符（CJK）及日韩全角字符宽度约为英文字符的 2 倍，需要据此调整排版计算。
 */
export function calculateFontSize(
  areaWidth: number,
  areaHeight: number,
  text: string,
  style: OverlayStyle = DEFAULT_STYLE
): number {
  const padding = style.padding * 2;
  const availWidth = Math.max(areaWidth - padding, 1);
  const availHeight = Math.max(areaHeight - padding, 1);

  // 按中文字符计算"等效字符数"（全角算 2，ASCII 算 1）
  const fullWidthCount = (text.match(FULL_WIDTH_REGEX) || []).length;
  const asciiCount = text.length - fullWidthCount;
  const effectiveLength = fullWidthCount * 2 + asciiCount;

  // 估算单行最大字体：宽度优先
  const fontByWidth = effectiveLength > 0
    ? Math.floor(availWidth / (effectiveLength / 2))
    : availHeight;

  // 高度限制：单行场景
  const fontByHeight = Math.floor(availHeight * 0.7);

  // 取较小值，确保文字不溢出
  const fontSize = Math.min(fontByWidth, fontByHeight);

  return Math.max(style.minFontSize, Math.min(style.maxFontSize, fontSize));
}

interface OverlayLayout {
  fontSize: number;
  lines: string[];
  width: number;
  height: number;
  left: number;
  top: number;
}

interface TextMeasureContext {
  measureText: (text: string) => { width: number };
}

function getTextMeasureContext(
  fontSize: number,
  style: OverlayStyle
): TextMeasureContext | null {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.measureText !== 'function') {
      return null;
    }

    ctx.font = `${fontSize}px ${style.fontFamily}`;
    return ctx;
  } catch {
    return null;
  }
}

function estimateTextWidth(text: string, fontSize: number): number {
  const fullWidthCount = (text.match(FULL_WIDTH_REGEX) || []).length;
  const latinCount = Math.max(0, text.length - fullWidthCount);
  return fullWidthCount * fontSize + latinCount * fontSize * 0.55;
}

function measureTextWidth(
  text: string,
  fontSize: number,
  style: OverlayStyle
): number {
  const ctx = getTextMeasureContext(fontSize, style);
  if (ctx) {
    return ctx.measureText(text).width;
  }

  return estimateTextWidth(text, fontSize);
}

function wrapTextToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  style: OverlayStyle
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
      if (
        currentLine &&
        measureTextWidth(candidate, fontSize, style) > maxWidth
      ) {
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

function computeAdaptiveOverlayLayout(
  area: TextArea,
  imageWidth: number,
  imageHeight: number,
  style: OverlayStyle
): OverlayLayout {
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
  const maxWidth = Math.min(
    imageWidth * 0.78,
    Math.max(areaWidth * widthExpansionFactor, Math.min(areaWidth, 120))
  );
  const maxHeight = Math.min(
    imageHeight * 0.58,
    Math.max(areaHeight * heightExpansionFactor, Math.min(areaHeight, 54))
  );
  const visualPaddingX = Math.max(style.padding * 2, 12);
  const visualPaddingY = Math.max(style.padding * 1.5, 10);

  // 引入 5% 的排版折行安全宽度缓冲区，以克服浏览器不同渲染引擎在文字排版上的像素级计算误差
  const safeContentWidth = Math.max((maxWidth - style.padding * 2) * 0.95, 1);

  let fontSize = calculateFontSize(maxWidth, maxHeight, area.translatedText, style);
  let lines = wrapTextToWidth(
    area.translatedText,
    safeContentWidth,
    fontSize,
    style
  );

  while (fontSize > style.minFontSize) {
    lines = wrapTextToWidth(
      area.translatedText,
      safeContentWidth,
      fontSize,
      style
    );
    const lineHeight = fontSize * 1.3;
    const textHeight = lines.length * lineHeight + style.padding * 2;
    const textWidth = Math.max(
      ...lines.map(line => measureTextWidth(line, fontSize, style)),
      fontSize
    ) + style.padding * 2;

    if (textHeight <= maxHeight && textWidth <= maxWidth) {
      const minimumWidth = Math.min(maxWidth, Math.max(fontSize * 2.4, 48));
      const minimumHeight = Math.min(maxHeight, Math.max(lineHeight + style.padding * 2, 28));
      const width = Math.min(
        maxWidth,
        Math.max(textWidth + visualPaddingX, minimumWidth)
      );
      const height = Math.min(
        maxHeight,
        Math.max(textHeight + visualPaddingY, minimumHeight)
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
        fontSize,
        lines,
        width,
        height,
        left,
        top,
      };
    }

    fontSize -= 1;
  }

  lines = wrapTextToWidth(
    area.translatedText,
    safeContentWidth,
    style.minFontSize,
    style
  );
  const lineHeight = style.minFontSize * 1.3;
  const textHeight = Math.min(
    maxHeight,
    lines.length * lineHeight + style.padding * 2
  );
  const textWidth = Math.min(
    maxWidth,
    Math.max(
      ...lines.map(line => measureTextWidth(line, style.minFontSize, style)),
      style.minFontSize
    ) +
      style.padding * 2
  );
  const width = Math.min(
    maxWidth,
    Math.max(textWidth + visualPaddingX, Math.min(maxWidth, Math.max(style.minFontSize * 2.4, 48)))
  );
  const height = Math.min(
    maxHeight,
    Math.max(
      textHeight + visualPaddingY,
      Math.min(maxHeight, Math.max(style.minFontSize * 1.8, 28))
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
    fontSize: style.minFontSize,
    lines,
    width,
    height,
    left,
    top,
  };
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
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
      font-weight: 500;
      text-shadow: 0 1px 2px rgba(255,255,255,0.8);
      box-shadow: 0 1px 4px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.6);
      animation: manga-overlay-fadein 0.3s ease-out;
      transition: opacity 0.18s ease-in-out;
    }

    .${OVERLAY_CLASS}:hover {
      opacity: 0.15 !important;
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

    .manga-translator-loading {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 20px;
      height: 20px;
      pointer-events: none;
      z-index: 1001;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .manga-translator-loading-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: manga-spin 0.8s linear infinite;
    }

    @keyframes manga-spin {
      to { transform: rotate(360deg); }
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
export class OverlayRenderer {
  private style: OverlayStyle;
  private renderedOverlays: Map<HTMLImageElement, RenderedOverlay> = new Map();
  // Hover debounce timers - keyed by image element
  private hoverTimers: Map<HTMLImageElement, ReturnType<typeof setTimeout> | null> = new Map();

  constructor(style: Partial<OverlayStyle> = {}) {
    this.style = { ...DEFAULT_STYLE, ...style };
    ensureStylesInjected();
  }

  /**
   * Render translation overlays on an image
   */
  render(image: HTMLImageElement, textAreas: TextArea[], autoPinned = false): HTMLElement {
    // Remove existing overlays for this image
    this.remove(image);

    if (textAreas.length === 0) {
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
    for (const area of textAreas) {
      const overlay = this.createOverlayElement(area, imageWidth, imageHeight);
      overlayContainer.appendChild(overlay);
      overlays.push(overlay);
    }

    this.resolveOverlayCollisions(overlays, imageWidth, imageHeight);

    // Create control buttons
    const controls = document.createElement('div');
    controls.className = CONTROLS_CLASS;

    // Toggle button: with autoPinned: true (the new default), the
    // user sees the translation. Clicking 📌 shows the ORIGINAL
    // text instead, so the user can compare. A second click
    // restores the translation.
    const toggleBtn = document.createElement('button');
    toggleBtn.title = '切换原文 / 译文';
    toggleBtn.textContent = '📌';
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rendered = this.renderedOverlays.get(image);
      if (!rendered) return;
      rendered.pinned = !rendered.pinned;
      wrapper.classList.toggle('manga-translator-pinned', rendered.pinned);
      toggleBtn.textContent = rendered.pinned ? '👁' : '📌';
      for (const overlay of rendered.overlays) {
        overlay.textContent = rendered.pinned
          ? (overlay.getAttribute('data-translated') ?? '')
          : (overlay.getAttribute('data-original') ?? '');
      }
    });
    controls.appendChild(toggleBtn);

    // Close button (remove overlay)
    const closeBtn = document.createElement('button');
    closeBtn.title = '移除翻译';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.remove(image);
    });
    controls.appendChild(closeBtn);

    wrapper.appendChild(controls);

    // Store reference for later removal
    this.renderedOverlays.set(image, {
      wrapper,
      image,
      overlays,
      overlayContainer,
      pinned: autoPinned,
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
      toggleBtn.textContent = '👁';
    }

    return wrapper;
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
   * Render a loading overlay over an image
   */
  renderLoading(image: HTMLImageElement): void {
    let wrapper = image.parentElement;
    if (!wrapper || !wrapper.classList.contains(WRAPPER_CLASS)) {
      wrapper = document.createElement('div');
      wrapper.className = WRAPPER_CLASS;
      wrapper.setAttribute(DATA_ATTR, 'true');

      const parent = image.parentElement;
      if (parent) {
        parent.insertBefore(wrapper, image);
      }
      wrapper.appendChild(image);
    }

    // Ensure no existing loading indicator
    this.removeLoading(image);

    const loading = document.createElement('div');
    loading.className = 'manga-translator-loading';
    loading.innerHTML = `<div class="manga-translator-loading-spinner"></div>`;
    wrapper.appendChild(loading);
  }

  /**
   * Remove loading overlay from an image
   */
  removeLoading(image: HTMLImageElement): void {
    const wrapper = image.parentElement;
    if (wrapper && wrapper.classList.contains(WRAPPER_CLASS)) {
      const loading = wrapper.querySelector('.manga-translator-loading');
      if (loading) {
        loading.remove();
      }
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

    const layout = computeAdaptiveOverlayLayout(
      area,
      imageWidth,
      imageHeight,
      this.style
    );

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
    });

    overlay.textContent = area.translatedText;
    overlay.setAttribute('data-original', area.originalText);
    overlay.setAttribute('data-translated', area.translatedText);

    return overlay;
  }

  private resolveOverlayCollisions(
    overlays: HTMLElement[],
    imageWidth: number,
    imageHeight: number
  ): void {
    const spacing = 4;
    const maxIterations = 3; // 采用迭代松弛法，上限 3 次以防止多重重叠场景无法收敛，确保性能无感
    
    for (let iter = 0; iter < maxIterations; iter++) {
      let hasCollision = false;
      
      for (let i = 0; i < overlays.length; i++) {
        const current = overlays[i];
        if (!current) continue;
        
        let currentRect = getStyledRect(current);
        
        for (let j = 0; j < overlays.length; j++) {
          if (i === j) continue;
          const other = overlays[j];
          if (!other) continue;
          
          const otherRect = getStyledRect(other);
          if (!overlaps(currentRect, otherRect)) {
            continue;
          }
          
          hasCollision = true;
          
          // 计算 X 和 Y 轴上的重叠像素值
          const overlapX = Math.min(currentRect.right, otherRect.right) - Math.max(currentRect.left, otherRect.left);
          const overlapY = Math.min(currentRect.bottom, otherRect.bottom) - Math.max(currentRect.top, otherRect.top);
          
          if (overlapX <= 0 || overlapY <= 0) continue;
          
          // 计算两翻译文本块的几何中心，决定避让反推的方向
          const currentCenter = {
            x: currentRect.left + currentRect.width / 2,
            y: currentRect.top + currentRect.height / 2
          };
          const otherCenter = {
            x: otherRect.left + otherRect.width / 2,
            y: otherRect.top + otherRect.height / 2
          };
          
          let dx = 0;
          let dy = 0;
          
          // 选择重叠度最小的维度轴线进行移动（最少干扰避让）
          if (overlapX < overlapY) {
            // 水平重叠较小，做左右推移
            const direction = currentCenter.x >= otherCenter.x ? 1 : -1;
            dx = direction * (overlapX + spacing);
          } else {
            // 垂直重叠较小，做上下推移
            const direction = currentCenter.y >= otherCenter.y ? 1 : -1;
            dy = direction * (overlapY + spacing);
          }
          
          // 将避让后的坐标裁剪限制在原图片画布矩形内部
          const newLeft = Math.max(0, Math.min(imageWidth - currentRect.width, currentRect.left + dx));
          const newTop = Math.max(0, Math.min(imageHeight - currentRect.height, currentRect.top + dy));
          
          current.style.left = `${newLeft}px`;
          current.style.top = `${newTop}px`;
          
          // 更新临时包围盒位置，使后续碰撞检测链路基于新避让位置执行
          currentRect = getStyledRect(current);
        }
      }
      
      // 如果本轮没有触发任何重合，意味着所有的碰撞已被完全消解，可提前退出
      if (!hasCollision) {
        break;
      }
    }
  }

  /**
   * Remove overlays from a specific image
   */
  remove(image: HTMLImageElement | HTMLElement): void {
    if (image.classList?.contains(WRAPPER_CLASS)) {
      const img = image.querySelector('img') as HTMLImageElement | null;
      if (img) {
        image = img;
      }
    }

    const rendered = this.renderedOverlays.get(image as HTMLImageElement);
    if (!rendered) {
      return;
    }

    // Clean up hover timer
    this.clearHoverTimer(image as HTMLImageElement);
    this.hoverTimers.delete(image as HTMLImageElement);

    const { wrapper, image: originalImage } = rendered;

    const parent = wrapper.parentElement;
    if (parent) {
      parent.insertBefore(originalImage, wrapper);
      wrapper.remove();
    }

    this.renderedOverlays.delete(originalImage);
  }

  /**
   * Remove all rendered overlays
   */
  removeAll(): void {
    const images = Array.from(this.renderedOverlays.keys());
    for (const image of images) {
      this.remove(image);
    }
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
    this.style = {
      ...this.style,
      backgroundColor: config.backgroundColor,
      textColor: config.textColor,
      minFontSize: config.minFontSize,
      maxFontSize: config.maxFontSize,
      verticalText: config.verticalText,
    };
  }

  /**
   * Update overlay style
   */
  updateStyle(style: Partial<OverlayStyle>): void {
    this.style = { ...this.style, ...style };
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

/**
 * Reset the singleton renderer instance
 */
export function resetRenderer(): void {
  if (rendererInstance) {
    rendererInstance.removeAll();
  }
  rendererInstance = null;
}

// ==================== DOM Query Utilities ====================

/**
 * Find all manga translator wrappers in the document
 */
export function findAllWrappers(): HTMLElement[] {
  return Array.from(document.querySelectorAll(`.${WRAPPER_CLASS}`));
}

/**
 * Find all overlay elements in the document
 */
export function findAllOverlays(): HTMLElement[] {
  return Array.from(document.querySelectorAll(`.${OVERLAY_CLASS}`));
}

/**
 * Remove all manga translator elements from the document
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
