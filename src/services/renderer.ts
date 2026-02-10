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
 */
export function calculateFontSize(
  areaHeight: number,
  textLength: number,
  style: OverlayStyle = DEFAULT_STYLE
): number {
  let fontSize = Math.floor(areaHeight * 0.65);

  if (textLength > 20) {
    const reductionFactor = Math.min(1, 20 / textLength);
    fontSize = Math.floor(fontSize * (0.7 + 0.3 * reductionFactor));
  }

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
      line-height: 1.2;
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
  render(image: HTMLImageElement, textAreas: TextArea[]): HTMLElement {
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

    // Create control buttons
    const controls = document.createElement('div');
    controls.className = CONTROLS_CLASS;

    // Toggle button (pin/unpin translation)
    const toggleBtn = document.createElement('button');
    toggleBtn.title = '切换翻译显示';
    toggleBtn.textContent = '📌';
    toggleBtn.addEventListener('click', (e) => {
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
    closeBtn.addEventListener('click', (e) => {
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
      pinned: false,
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

    const left = area.x * imageWidth;
    const top = area.y * imageHeight;
    const width = area.width * imageWidth;
    const height = area.height * imageHeight;

    const fontSize = calculateFontSize(
      height,
      area.translatedText.length,
      this.style
    );

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
    overlay.setAttribute('data-original', area.originalText);

    return overlay;
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
