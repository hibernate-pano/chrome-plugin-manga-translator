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

// ==================== Type Definitions ====================

export interface ImageProcessingOptions {
  /** Maximum dimension (width or height) before compression */
  maxSize?: number;
  /** JPEG/WebP quality for compression (0-1) */
  quality?: number;
  /** Output format */
  format?: 'jpeg' | 'png' | 'webp' | 'auto';
  /** Whether to preserve original format when possible */
  preserveFormat?: boolean;
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
}

// ==================== Default Configuration ====================

const DEFAULT_OPTIONS: Required<ImageProcessingOptions> = {
  maxSize: 1920,
  quality: 0.85,
  format: 'jpeg',
  preserveFormat: false,
};

// ==================== Core Functions ====================

/**
 * Calculate SHA-256 hash of image data
 *
 * @param data String data to hash
 * @returns Hash string
 */
export async function calculateHash(data: string): Promise<string> {
  // Use SubtleCrypto for hashing if available
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple string hash (djb2 algorithm)
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
  quality: number = DEFAULT_OPTIONS.quality
): { base64: string; width: number; height: number; wasCompressed: boolean } {
  const originalWidth = image.naturalWidth;
  const originalHeight = image.naturalHeight;

  // Check if compression is needed
  const needsCompression = originalWidth > maxSize || originalHeight > maxSize;

  let targetWidth = originalWidth;
  let targetHeight = originalHeight;

  if (needsCompression) {
    // Calculate new dimensions maintaining aspect ratio
    const ratio = Math.min(maxSize / originalWidth, maxSize / originalHeight);
    targetWidth = Math.round(originalWidth * ratio);
    targetHeight = Math.round(originalHeight * ratio);
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

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  // Convert to base64 JPEG
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

  return {
    base64,
    width: targetWidth,
    height: targetHeight,
    wasCompressed: needsCompression,
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
    const { base64, width, height, wasCompressed } = compressImage(
      image,
      opts.maxSize,
      opts.quality
    );

    const hash = await calculateHash(base64);

    return {
      base64,
      mimeType: 'image/jpeg',
      originalWidth,
      originalHeight,
      width,
      height,
      wasCompressed,
      hash,
    };
  } catch {
    // Canvas tainted by CORS — fallback to background proxy
    console.log('[ImageProcessor] Canvas tainted, falling back to background proxy');
    return processImageViaBackground(image.src, originalWidth, originalHeight);
  }
}

/**
 * Process an image via background script to bypass CORS
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

  if (!response?.success || !response.base64) {
    throw new Error(`Failed to fetch image via background: ${response?.error || 'Unknown error'}`);
  }

  const base64: string = response.base64;
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

  // Calculate scale factors (in case image was resized)
  const scaleX = imgElement.naturalWidth / (opts.maxSize || imgElement.naturalWidth);
  const scaleY = imgElement.naturalHeight / (opts.maxSize || imgElement.naturalHeight);

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
export function combineCroppedRegions(
  croppedImages: string[],
  options: ImageProcessingOptions = {}
): string {
  if (croppedImages.length === 0) {
    throw new Error('No images to combine');
  }

  if (croppedImages.length === 1) {
    return croppedImages[0] ?? '';
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };

  // First, load all images to get their dimensions
  const images: HTMLImageElement[] = [];
  let totalHeight = 0;
  let maxWidth = 0;

  for (const base64 of croppedImages) {
    const img = imageFromBase64(base64);
    images.push(img);
    totalHeight += img.height;
    maxWidth = Math.max(maxWidth, img.width);
  }

  // Add spacing between regions
  const spacing = 20;
  totalHeight += spacing * (images.length - 1);

  // Create canvas and draw all images
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
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
  for (const img of images) {
    const x = Math.round((maxWidth - img.width) / 2); // Center horizontally
    ctx.drawImage(img, x, currentY);
    currentY += img.height + spacing;
  }

  // Convert to base64
  const mimeType = `image/${opts.format}`;
  const dataUrl = canvas.toDataURL(mimeType, opts.quality);
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * Create an Image element from base64 string
 */
function imageFromBase64(base64: string): HTMLImageElement {
  const img = new Image();
  const dataUrl = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
  img.src = dataUrl;

  // Synchronously available if already loaded
  if (img.complete) {
    return img;
  }

  // This shouldn't happen in practice since we just created the base64
  throw new Error('Image not immediately available');
}
