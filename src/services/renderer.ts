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

const DEFAULT_STYLE: OverlayStyle = {
  backgroundColor: 'rgba(240, 240, 235, 0.94)',
  textColor: '#111111',
  fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  borderRadius: 6,
  padding: 7,
  minFontSize: 10,
  maxFontSize: 22,
};

// ==================== Utility Functions ====================

/**
 * 计算最优字体大小（感知中文字符宽度）
 *
 * 中文字符（CJK）宽度约为英文字符的 2 倍，需要据此调整排版计算。
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

  // 按中文字符计算"等效字符数"（CJK 算 2，ASCII 算 1）
  const cjkCount = (text.match(/[\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f]/g) || []).length;
  const asciiCount = text.length - cjkCount;
  const effectiveLength = cjkCount * 2 + asciiCount;

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
  const cjkCount = (text.match(/[\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f]/g) || []).length;
  const latinCount = Math.max(0, text.length - cjkCount);
  return cjkCount * fontSize + latinCount * fontSize * 0.55;
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

  let fontSize = calculateFontSize(maxWidth, maxHeight, area.translatedText, style);
  let lines = wrapTextToWidth(
    area.translatedText,
    Math.max(maxWidth - style.padding * 2, 1),
    fontSize,
    style
  );

  while (fontSize > style.minFontSize) {
    lines = wrapTextToWidth(
      area.translatedText,
      Math.max(maxWidth - style.padding * 2, 1),
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
    Math.max(maxWidth - style.padding * 2, 1),
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
      transition: opacity 0.2s ease-in-out;
      pointer-events: none;
      z-index: 1000;
    }

    .${WRAPPER_CLASS}:hover .${OVERLAY_CONTAINER_CLASS},
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
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1001;
      border-radius: inherit;
    }
    
    .manga-translator-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: manga-spin 1s ease-in-out infinite;
    }
    
    @keyframes manga-spin {
      to { transform: rotate(360deg); }
    }

    @keyframes manga-overlay-fadein {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .manga-translator-loading-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .manga-translator-loading-text {
      color: #fff;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-weight: 500;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
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

    // Toggle button (pin/unpin translation)
    const toggleBtn = document.createElement('button');
    toggleBtn.title = '切换翻译显示';
    toggleBtn.textContent = '📌';
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rendered = this.renderedOverlays.get(image);
      if (rendered) {
        rendered.pinned = !rendered.pinned;
        wrapper.classList.toggle('manga-translator-pinned', rendered.pinned);
        toggleBtn.textContent = rendered.pinned ? '👁' : '📌';
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

    // 点击翻译场景下自动 pin，翻译结果直接显示无需 hover
    if (autoPinned) {
      wrapper.classList.add('manga-translator-pinned');
      toggleBtn.textContent = '👁';
    }

    return wrapper;
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
    loading.innerHTML = `
      <div class="manga-translator-loading-content">
        <div class="manga-translator-spinner"></div>
        <div class="manga-translator-loading-text">翻译中...</div>
      </div>
    `;
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

    return overlay;
  }

  private resolveOverlayCollisions(
    overlays: HTMLElement[],
    imageWidth: number,
    imageHeight: number
  ): void {
    const spacing = 4;
    const sorted = [...overlays].sort(
      (a, b) =>
        parseFloat(a.style.top || '0') - parseFloat(b.style.top || '0')
    );

    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      if (!current) {
        continue;
      }

      for (let j = 0; j < i; j += 1) {
        const previous = sorted[j];
        if (!previous) {
          continue;
        }
        const currentRect = getStyledRect(current);
        const previousRect = getStyledRect(previous);

        if (!overlaps(currentRect, previousRect)) {
          continue;
        }

        const currentTop = parseFloat(current.style.top || '0');
        const currentHeight = parseFloat(current.style.height || '0');
        const nextTop = previousRect.bottom + spacing;
        const maxTop = Math.max(0, imageHeight - currentHeight);
        const adjustedTop = Math.min(nextTop, maxTop);

        current.style.top = `${adjustedTop}px`;

        const updatedRect = getStyledRect(current);
        if (
          overlaps(updatedRect, previousRect) &&
          currentTop > previousRect.height + spacing
        ) {
          current.style.top = `${Math.max(0, previousRect.top - currentHeight - spacing)}px`;
        }

        const overflowRight =
          parseFloat(current.style.left || '0') +
            parseFloat(current.style.width || '0') -
            imageWidth >
          0;
        if (overflowRight) {
          current.style.left = `${Math.max(
            0,
            imageWidth - parseFloat(current.style.width || '0')
          )}px`;
        }
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
