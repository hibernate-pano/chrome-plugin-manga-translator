/**
 * Image Processor Service
 *
 * Handles image processing operations for manga translation:
 * - Convert images to base64
 * - Compress large images
 * - Calculate image hashes for caching
 *
 * Requirements: 9.3
 */

import { getErrorMessage } from '@/utils/error-message';

// ==================== Type Definitions ====================

export interface ImageProcessingOptions {
  /** Maximum dimension (width or height) before compression */
  maxSize?: number;
  /** JPEG/WebP quality for compression (0-1) */
  quality?: number;
  /** Output format */
  format?: 'jpeg' | 'png' | 'webp' | 'auto';
  /** Whether to crop the image to only the visible viewport part (useful for very long images) */
  viewportCrop?: boolean;
  /** Whether to add visual indices for hybrid region stitching */
  isHybridRegions?: boolean;
}

export interface ProcessedImage {
  /** Base64 encoded image data (without data URL prefix) */
  base64: string;
  /** MIME type of the processed image */
  mimeType: string;
  /** Original width */
  originalWidth: number;
  /** Original height */
  originalHeight: number;
  /** Processed width (after compression if applied) */
  width: number;
  /** Processed height (after compression if applied) */
  height: number;
  /** Whether the image was compressed */
  wasCompressed: boolean;
  /** Hash of the processed image for caching */
  hash: string;
  /** Start Y coordinate of crop in original image (0 if not cropped) */
  cropY?: number;
  /** Height of the cropped area in original image (equal to originalHeight if not cropped) */
  cropHeight?: number;
}

// ==================== Default Configuration ====================

export const DEFAULT_OPTIONS: Required<ImageProcessingOptions> = {
  /**
   * Default image size for translation.
   * 1024px is sufficient for text extraction while being ~4x faster than 2048px.
   */
  maxSize: 1024,
  quality: 0.85,
  format: 'jpeg',
  viewportCrop: false,
  isHybridRegions: false,
};

export function shouldPreserveTallMangaPage(
  width: number,
  height: number,
  maxSize: number = DEFAULT_OPTIONS.maxSize
): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }

  const aspectRatio = height / width;
  return width <= Math.min(maxSize, 1400) && height > maxSize && aspectRatio >= 2.4;
}

// ==================== Core Functions ====================

/**
 * Calculate SHA-256 hash of image data
 *
 * Uses SubtleCrypto SHA-256 for cryptographically secure hashes.
 * Falls back to a simple string hash only if SubtleCrypto is completely unavailable.
 *
 * @param data String data to hash
 * @returns 64-character hexadecimal hash
 */
export async function calculateHash(data: string): Promise<string> {
  // Use SubtleCrypto for hashing - available in all modern browsers including Chrome extension content scripts
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple string hash using djb2 - NOTE: only used when crypto.subtle is unavailable
  // WARNING: This produces only 32 bits of entropy and risks hash collisions.
  // This fallback should rarely trigger in modern browser environments.
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) + hash) ^ char;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Convert an HTMLImageElement to base64
 *
 * @param image Image element to convert
 * @param options Processing options
 * @returns Base64 encoded image data
 */
export function imageToBase64(
  image: HTMLImageElement,
  options: ImageProcessingOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas 2D context');
  }

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);

  const mimeType = `image/${opts.format}`;
  const dataUrl = canvas.toDataURL(mimeType, opts.quality);

  // Remove data URL prefix to get pure base64
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * Compress an image if it exceeds the maximum size
 *
 * @param image Image element to compress
 * @param maxSize Maximum dimension (width or height)
 * @param quality JPEG quality (0-1)
 * @returns Object with compressed base64 and dimensions
 */
export function compressImage(
  image: HTMLImageElement,
  maxSize: number = DEFAULT_OPTIONS.maxSize,
  quality: number = DEFAULT_OPTIONS.quality,
  viewportCrop: boolean = false,
  format: string = 'jpeg'
): { base64: string; width: number; height: number; wasCompressed: boolean; cropY: number; cropHeight: number } {
  // Guard against zero-dimension images (e.g. failed image loads) so we
  // don't produce NaN canvas dimensions or empty base64.
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth <= 0 ||
    image.naturalHeight <= 0
  ) {
    throw new Error(
      `compressImage: invalid image dimensions (${image.naturalWidth}x${image.naturalHeight})`
    );
  }

  let sourceY = 0;
  let sourceHeight = image.naturalHeight;
  const sourceWidth = image.naturalWidth;

  // 1. 如果需要视口裁剪，计算当前视口中图片的范围
  if (viewportCrop) {
    const rect = image.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    // 如果图片完全不在视口中，就不裁剪了（或给一个默认行为），但通常我们只有在 hover/click 时才调用这个
    if (rect.bottom >= 0 && rect.top <= windowHeight) {
      const scaleY = image.naturalHeight / rect.height;

      // 在 DOM 像素下的可见顶部和底部
      const visibleTopDOM = Math.max(0, -rect.top);
      const visibleBottomDOM = Math.min(rect.height, windowHeight - rect.top);

      // 上下增加一些 margin 以提供上下文给大模型 (比如 300 DOM 像素)
      const marginDOM = 300;

      const cropTopDOM = Math.max(0, visibleTopDOM - marginDOM);
      const cropBottomDOM = Math.min(rect.height, visibleBottomDOM + marginDOM);

      // 映射回 naturalHeight
      sourceY = Math.floor(cropTopDOM * scaleY);
      sourceHeight = Math.floor((cropBottomDOM - cropTopDOM) * scaleY);

      // 确保不越界
      sourceY = Math.max(0, sourceY);
      sourceHeight = Math.min(image.naturalHeight - sourceY, sourceHeight);
    }
  }

  // 2. 判断是否需要压缩这部分图像
  const preserveTallPage = shouldPreserveTallMangaPage(
    sourceWidth,
    sourceHeight,
    maxSize
  );
  const needsCompression =
    !preserveTallPage && (sourceWidth > maxSize || sourceHeight > maxSize);

  let targetWidth = sourceWidth;
  let targetHeight = sourceHeight;
  let wasCompressed = false;

  const maxTallPageHeight = 3000;

  if (needsCompression) {
    // Calculate new dimensions maintaining aspect ratio
    const ratio = Math.min(maxSize / sourceWidth, maxSize / sourceHeight);
    targetWidth = Math.round(sourceWidth * ratio);
    targetHeight = Math.round(sourceHeight * ratio);
    wasCompressed = true;
  } else if (preserveTallPage && sourceHeight > maxTallPageHeight) {
    // 为长图引入安全高度上限，等比例缩放至高度等于 3000px
    const ratio = maxTallPageHeight / sourceHeight;
    targetWidth = Math.round(sourceWidth * ratio);
    targetHeight = maxTallPageHeight;
    wasCompressed = true;
  }

  // Create canvas and draw image
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas 2D context');
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  // Use high-quality image smoothing for better compression results
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ctx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
  ctx.drawImage(image, 0, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  // Compress to base64
  const mimeType = format === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

  return {
    base64,
    width: targetWidth,
    height: targetHeight,
    wasCompressed,
    cropY: sourceY,
    cropHeight: sourceHeight,
  };
}

/**
 * Process an image for translation
 *
 * This is the main entry point that:
 * 1. Tries canvas path (same-origin fast path)
 * 2. Falls back to background proxy for CORS images
 * 3. Calculates hash for caching
 *
 * @param image Image element to process
 * @param options Processing options
 * @returns Processed image data
 */
export async function processImage(
  image: HTMLImageElement,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const originalWidth = image.naturalWidth;
  const originalHeight = image.naturalHeight;

  try {
    // Try canvas path first (same-origin or CORS-enabled images)
    const { base64, width, height, wasCompressed, cropY, cropHeight } = compressImage(
      image,
      opts.maxSize,
      opts.quality,
      opts.viewportCrop,
      opts.format
    );

    const hash = await calculateHash(base64);

    return {
      base64,
      mimeType: opts.format === 'webp' ? 'image/webp' : 'image/jpeg',
      originalWidth,
      originalHeight,
      width,
      height,
      wasCompressed,
      hash,
      cropY,
      cropHeight,
    };
  } catch (error) {
    // Canvas tainted by CORS — fallback to background proxy
    console.log(
      '[ImageProcessor] Canvas path failed, falling back to background proxy:',
      getErrorMessage(error)
    );
    return processImageViaBackground(image.src, originalWidth, originalHeight);
  }
}

/**
 * Process an image via background script to bypass CORS.
 *
 * NOTE on message protocols: this function uses the legacy
 * `{ action: 'fetchImage', url }` envelope, which is dispatched by the
 * background handler's action-based switch. The new envelope protocol
 * (`{ type: 'JOB_*', ... }`) is reserved for translation jobs handled
 * by ChromeRuntimeTranslationTransport (see
 * src/services/translation-transport.ts). The two protocols coexist
 * because the image-fetch path is a simple binary transport with no
 * job-queue semantics, while translation requires priority/scope/dedup.
 * Unifying them is a future refactor; for now, callers must read the
 * matching response field — `imageBase64` here, `textAreas` there.
 */
async function processImageViaBackground(
  imageUrl: string,
  originalWidth: number,
  originalHeight: number
): Promise<ProcessedImage> {
  const response = await chrome.runtime.sendMessage({
    action: 'fetchImage',
    url: imageUrl,
  });

  if (!response?.success || !response.imageBase64) {
    throw new Error(`Failed to fetch image via background: ${response?.error || 'Unknown error'}`);
  }

  const base64: string = response.imageBase64;
  const mimeType: string = response.mimeType || 'image/jpeg';
  const hash = await calculateHash(base64);

  return {
    base64,
    mimeType,
    originalWidth,
    originalHeight,
    width: originalWidth,
    height: originalHeight,
    wasCompressed: false,
    hash,
    cropY: 0,
    cropHeight: originalHeight,
  };
}

/**
 * Load an image from URL and return as HTMLImageElement
 *
 * @param url Image URL
 * @returns Promise resolving to loaded image element
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));

    img.src = url;
  });
}

/**
 * Process an image from URL
 *
 * @param url Image URL
 * @param options Processing options
 * @returns Processed image data
 */
export async function processImageFromUrl(
  url: string,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> {
  const image = await loadImage(url);
  return processImage(image, options);
}

/**
 * Check if an image meets minimum size requirements
 *
 * @param image Image element to check
 * @param minWidth Minimum width in pixels
 * @param minHeight Minimum height in pixels
 * @returns True if image meets requirements
 */
export function meetsMinimumSize(
  image: HTMLImageElement,
  minWidth: number = 150,
  minHeight: number = 150
): boolean {
  return image.naturalWidth >= minWidth && image.naturalHeight >= minHeight;
}

/**
 * Get image dimensions from an HTMLImageElement
 *
 * @param image Image element
 * @returns Object with width and height
 */
export function getImageDimensions(image: HTMLImageElement): {
  width: number;
  height: number;
} {
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

/**
 * Convert base64 to data URL
 *
 * @param base64 Base64 encoded image data
 * @param mimeType MIME type of the image
 * @returns Data URL string
 */
export function base64ToDataUrl(
  base64: string,
  mimeType: string = 'image/jpeg'
): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Extract base64 from data URL
 *
 * @param dataUrl Data URL string
 * @returns Base64 encoded data
 */
export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

// ==================== Image Cropping ====================

export interface CropRegion {
  /** X coordinate of top-left corner */
  x: number;
  /** Y coordinate of top-left corner */
  y: number;
  /** Width of the region */
  width: number;
  /** Height of the region */
  height: number;
}

export interface CombinedRegionSegment {
  index: number;
  top: number;
  height: number;
}

export interface CombinedCroppedRegions {
  base64: string;
  width: number;
  height: number;
  segments: CombinedRegionSegment[];
}

/**
 * Crop regions from an image
 *
 * @param image Image element or base64 string
 * @param regions Array of regions to crop
 * @param options Processing options
 * @returns Array of cropped images as base64
 */
export async function cropRegions(
  image: HTMLImageElement | string,
  regions: CropRegion[],
  options: ImageProcessingOptions = {}
): Promise<string[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (regions.length === 0) {
    return [];
  }

  // Ensure we have an image element
  const imgElement = await ensureImageElement(image);

  // Regions are expected to be in the coordinate space of the provided image.
  const scaleX = 1;
  const scaleY = 1;

  const croppedImages: string[] = [];

  for (const region of regions) {
    // Scale coordinates if image was compressed
    const x = Math.round(region.x * scaleX);
    const y = Math.round(region.y * scaleY);
    const width = Math.round(region.width * scaleX);
    const height = Math.round(region.height * scaleY);

    // Ensure valid dimensions
    const cropX = Math.max(0, Math.min(x, imgElement.naturalWidth - 1));
    const cropY = Math.max(0, Math.min(y, imgElement.naturalHeight - 1));
    const cropWidth = Math.max(1, Math.min(width, imgElement.naturalWidth - cropX));
    const cropHeight = Math.max(1, Math.min(height, imgElement.naturalHeight - cropY));

    const cropped = cropImageElement(imgElement, cropX, cropY, cropWidth, cropHeight, opts);
    croppedImages.push(cropped);
  }

  return croppedImages;
}

/**
 * Ensure input is an HTMLImageElement
 */
async function ensureImageElement(
  image: HTMLImageElement | string
): Promise<HTMLImageElement> {
  if (image instanceof HTMLImageElement) {
    return image;
  }

  // It's a base64 string, load it into an image
  return loadImage(image.startsWith('data:') ? image : `data:image/png;base64,${image}`);
}

/**
 * Crop a specific region from an image element
 */
function cropImageElement(
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Required<ImageProcessingOptions>
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Draw the cropped region
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);

  // Convert to base64
  const mimeType = `image/${options.format}`;
  const dataUrl = canvas.toDataURL(mimeType, options.quality);
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * Combine multiple cropped regions into a single image
 *
 * This creates a vertical stack of all text regions,
 * which can be sent to VLM for translation in one call.
 *
 * @param croppedImages Array of cropped base64 images
 * @param options Processing options
 * @returns Combined image as base64
 */
export async function combineCroppedRegions(
  croppedImages: string[],
  options: ImageProcessingOptions = {}
): Promise<CombinedCroppedRegions> {
  if (croppedImages.length === 0) {
    throw new Error('No images to combine');
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (croppedImages.length === 1 && !opts.isHybridRegions) {
    const single = await imageFromBase64(croppedImages[0] ?? '');
    return {
      base64: croppedImages[0] ?? '',
      width: single.width,
      height: single.height,
      segments: [{ index: 0, top: 0, height: single.height }],
    };
  }

  // First, load all images to get their dimensions (parallel, tolerating individual failures)
  const settledResults = await Promise.allSettled(
    croppedImages.map((base64) => imageFromBase64(base64))
  );

  const images: HTMLImageElement[] = [];
  for (const result of settledResults) {
    if (result.status === 'fulfilled') {
      images.push(result.value);
    } else {
      console.error('[ImageProcessor] Failed to load image in combineCroppedRegions:', result.reason);
    }
  }

  if (images.length === 0) {
    throw new Error('No images to combine');
  }

  let totalHeight = 0;
  let maxWidth = 0;
  for (const img of images) {
    totalHeight += img.height;
    maxWidth = Math.max(maxWidth, img.width);
  }

  // Add spacing between regions
  const spacing = 20;
  totalHeight += spacing * (images.length - 1);

  // Width budget for label column on the left
  const labelWidth = opts.isHybridRegions ? 60 : 0;
  const canvasWidth = maxWidth + labelWidth;

  // Create canvas and draw all images
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = totalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Fill with white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw each image
  let currentY = 0;
  const segments: CombinedRegionSegment[] = [];
  for (let index = 0; index < images.length; index += 1) {
    const img = images[index];
    if (!img) continue;

    // Draw index anchor label if isHybridRegions is enabled
    if (opts.isHybridRegions) {
      // Vertically center the anchor label alongside the cropped region
      const labelY = currentY + Math.max(0, (img.height - 40) / 2);
      ctx.fillStyle = '#1e293b'; // Slate-800
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(10, labelY, 40, 40, 8);
      } else {
        ctx.rect(10, labelY, 40, 40);
      }
      ctx.fill();

      ctx.fillStyle = '#f8fafc'; // Slate-50
      ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${index + 1}`, 30, labelY + 20);
    }

    // Shift image drawing by labelWidth, centering horizontally in the remaining area
    const x = labelWidth + Math.round((maxWidth - img.width) / 2);
    ctx.drawImage(img, x, currentY);
    segments.push({
      index,
      top: currentY,
      height: img.height,
    });
    currentY += img.height + spacing;
  }

  // Convert to base64
  const mimeType = `image/${opts.format}`;
  const dataUrl = canvas.toDataURL(mimeType, opts.quality);
  return {
    base64: dataUrl.replace(/^data:image\/\w+;base64,/, ''),
    width: canvas.width,
    height: canvas.height,
    segments,
  };
}

/**
 * Create an Image element from base64 string
 */
async function imageFromBase64(base64: string): Promise<HTMLImageElement> {
  const dataUrl = base64.startsWith('data:')
    ? base64
    : `data:image/png;base64,${base64}`;
  return loadImage(dataUrl);
}
