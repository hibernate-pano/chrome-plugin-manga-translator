/**
 * Overlay Renderer Service
 *
 * Renders translation overlays on manga images:
 * - Creates positioned overlay elements
 * - Auto-adjusts font size based on text area
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
}

// ==================== Constants ====================

const WRAPPER_CLASS = 'manga-translator-wrapper';
const OVERLAY_CLASS = 'manga-translator-overlay';
const DATA_ATTR = 'data-manga-translator';

const DEFAULT_STYLE: OverlayStyle = {
  backgroundColor: 'rgba(255, 255, 255, 0.92)',
  textColor: '#1a1a1a',
  fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif',
  borderRadius: 4,
  padding: 4,
  minFontSize: 10,
  maxFontSize: 24,
};

// ==================== Utility Functions ====================

/**
 * Calculate optimal font size based on text area dimensions
 *
 * @param areaHeight Height of the text area in pixels
 * @param textLength Length of the text
 * @param style Style configuration
 * @returns Calculated font size in pixels
 */
export function calculateFontSize(
  areaHeight: number,
  textLength: number,
  style: OverlayStyle = DEFAULT_STYLE
): number {
  // Base calculation: font size should be roughly 60-70% of area height
  // to leave room for padding and line spacing
  let fontSize = Math.floor(areaHeight * 0.65);

  // Adjust for very long text (reduce font size)
  if (textLength > 20) {
    const reductionFactor = Math.min(1, 20 / textLength);
    fontSize = Math.floor(fontSize * (0.7 + 0.3 * reductionFactor));
  }

  // Clamp to min/max bounds
  return Math.max(style.minFontSize, Math.min(style.maxFontSize, fontSize));
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
    
    .${OVERLAY_CLASS} {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      word-break: break-word;
      overflow: hidden;
      pointer-events: none;
      z-index: 1000;
      box-sizing: border-box;
      line-height: 1.2;
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
   *
   * @param image Image element to overlay
   * @param textAreas Array of text areas with translations
   * @returns The wrapper element containing the image and overlays
   */
  render(image: HTMLImageElement, textAreas: TextArea[]): HTMLElement {
    if (process.env['NODE_ENV'] === 'development') {
      console.log('[Renderer] 渲染翻译覆盖层');
      console.log('[Renderer] 文字区域数量:', textAreas.length);
    }

    // Remove existing overlays for this image
    this.remove(image);

    // Skip if no text areas
    if (textAreas.length === 0) {
      if (process.env['NODE_ENV'] === 'development') {
        console.log('[Renderer] 无文字区域，跳过渲染');
      }
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

    // Create overlay elements
    const overlays: HTMLElement[] = [];

    for (const area of textAreas) {
      const overlay = this.createOverlayElement(area, imageWidth, imageHeight);
      wrapper.appendChild(overlay);
      overlays.push(overlay);
    }

    // Store reference for later removal
    this.renderedOverlays.set(image, {
      wrapper,
      image,
      overlays,
    });

    return wrapper;
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

    // Calculate pixel positions from relative coordinates
    const left = area.x * imageWidth;
    const top = area.y * imageHeight;
    const width = area.width * imageWidth;
    const height = area.height * imageHeight;

    // Calculate font size
    const fontSize = calculateFontSize(
      height,
      area.translatedText.length,
      this.style
    );

    // Apply styles
    Object.assign(overlay.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      backgroundColor: this.style.backgroundColor,
      color: this.style.textColor,
      fontFamily: this.style.fontFamily,
      fontSize: `${fontSize}px`,
      borderRadius: `${this.style.borderRadius}px`,
      padding: `${this.style.padding}px`,
    });

    overlay.textContent = area.translatedText;

    // Store original text as data attribute for debugging
    overlay.setAttribute('data-original', area.originalText);

    return overlay;
  }

  /**
   * Remove overlays from a specific image
   *
   * @param image Image element or wrapper to remove overlays from
   */
  remove(image: HTMLImageElement | HTMLElement): void {
    // Handle if wrapper was passed
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

    // Move image back to original position
    const parent = wrapper.parentElement;
    if (parent) {
      parent.insertBefore(originalImage, wrapper);
      wrapper.remove();
    }

    // Clean up reference
    this.renderedOverlays.delete(originalImage);
  }

  /**
   * Remove all rendered overlays
   */
  removeAll(): void {
    // Create a copy of keys to avoid modification during iteration
    const images = Array.from(this.renderedOverlays.keys());

    for (const image of images) {
      this.remove(image);
    }
  }

  /**
   * Check if an image has overlays rendered
   *
   * @param image Image element to check
   * @returns True if overlays are rendered
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
   *
   * @param style New style configuration
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
 *
 * @param style Optional style configuration
 * @returns OverlayRenderer instance
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
 * (Alternative to using renderer instance)
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
