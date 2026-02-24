/**
 * Text Detection Service
 *
 * Uses Tesseract.js to detect text regions in images.
 * This enables sending only cropped text regions to VLM for translation,
 * significantly reducing token usage.
 */

import Tesseract, { createWorker, type Worker } from 'tesseract.js';

// ==================== Type Definitions ====================

export interface TextRegion {
  /** X coordinate of top-left corner */
  x: number;
  /** Y coordinate of top-left corner */
  y: number;
  /** Width of the text region */
  width: number;
  /** Height of the text region */
  height: number;
  /** Detected text content */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface TextDetectionResult {
  /** Array of detected text regions */
  regions: TextRegion[];
  /** Original image dimensions */
  imageWidth: number;
  /** Original image dimensions */
  imageHeight: number;
  /** Processing time in milliseconds */
  processingTime: number;
}

export interface TextDetectionOptions {
  /** Language codes (e.g., 'jpn', 'eng', 'chi_sim') */
  languages?: string[];
  /** Whether to expand regions for better coverage (0-1 ratio) */
  expandMargin?: number;
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
}

// ==================== Configuration ====================

const DEFAULT_OPTIONS: Required<TextDetectionOptions> = {
  languages: ['jpn', 'eng', 'chi_sim'],
  expandMargin: 0.05, // Expand by 5% to capture full text
  minConfidence: 0.3,
};

// ==================== Cached Worker ====================

let worker: Worker | null = null;
let workerLanguages: string[] = [];

/**
 * Get or create a Tesseract worker with specified languages
 */
async function getWorker(languages: string[]): Promise<Worker> {
  const langKey = languages.sort().join('+');

  // Reuse existing worker if languages match
  if (worker && workerLanguages.join('+') === langKey) {
    return worker;
  }

  // Terminate existing worker if languages changed
  if (worker) {
    await worker.terminate();
    worker = null;
  }

  // Create new worker
  worker = await createWorker(langKey, 1, {
    logger: (m) => {
      if (import.meta.env.DEV && m.status === 'recognizing text') {
        console.log(`[TextDetector] 识别进度: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  workerLanguages = languages;

  if (import.meta.env.DEV) {
    console.log(`[TextDetector] Tesseract worker 已初始化, 语言: ${langKey}`);
  }

  return worker;
}

/**
 * Terminate the cached worker (call when done)
 */
export async function terminateWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
    workerLanguages = [];
  }
}

// ==================== Core Functions ====================

/**
 * Detect text regions in an image
 *
 * @param imageSource Image source (base64, data URL, or HTMLImageElement)
 * @param options Detection options
 * @returns TextDetectionResult with detected regions
 */
export async function detectTextRegions(
  imageSource: string | HTMLImageElement,
  options: TextDetectionOptions = {}
): Promise<TextDetectionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = performance.now();

  // Convert image to base64 if needed
  const base64 = await ensureBase64(imageSource);

  try {
    // Get Tesseract worker
    const tesseractWorker = await getWorker(opts.languages);

    if (import.meta.env.DEV) {
      console.log('[TextDetector] 开始检测文字区域...');
    }

    // Recognize text
    const result = await tesseractWorker.recognize(base64);
    const data = result.data;

    const processingTime = performance.now() - startTime;

    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wordsCount = (data as any).words?.length || 0;
      console.log(
        `[TextDetector] 检测完成, 耗时: ${processingTime.toFixed(0)}ms, 文字区域数: ${wordsCount}`
      );
    }

    // Convert words to regions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const words = (data as any).words as Array<{ bbox: { x0: number; y0: number; x1: number; y1: number }; text: string; confidence: number }> | undefined;
    const regions = convertToRegions(
      words,
      data.confidence ?? 0,
      opts.expandMargin,
      opts.minConfidence
    );

    return {
      regions,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      imageWidth: (data as any).imageWidth ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      imageHeight: (data as any).imageHeight ?? 0,
      processingTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[TextDetector] 文字检测失败:', errorMessage);
    throw new Error(`文字检测失败: ${errorMessage}`);
  }
}

/**
 * Convert Tesseract words to TextRegion format with optional expansion
 */
function convertToRegions(
  words: Array<{ bbox: { x0: number; y0: number; x1: number; y1: number }; text: string; confidence: number }> | undefined,
  overallConfidence: number,
  expandMargin: number,
  minConfidence: number
): TextRegion[] {
  if (!words || words.length === 0) {
    return [];
  }

  const regions: TextRegion[] = [];

  for (const word of words) {
    if (!word || !word.bbox) continue;

    const confidence = (word.confidence ?? overallConfidence) / 100;

    // Skip low confidence detections
    if (confidence < minConfidence) {
      continue;
    }

    const bbox = word.bbox;
    const x0 = bbox.x0 ?? 0;
    const y0 = bbox.y0 ?? 0;
    const x1 = bbox.x1 ?? x0;
    const y1 = bbox.y1 ?? y0;

    // Expand the region by margin
    const width = x1 - x0;
    const height = y1 - y0;
    const marginX = width * expandMargin;
    const marginY = height * expandMargin;

    regions.push({
      x: Math.max(0, x0 - marginX),
      y: Math.max(0, y0 - marginY),
      width: width + marginX * 2,
      height: height + marginY * 2,
      text: word.text || '',
      confidence,
    });
  }

  return regions;
}

/**
 * Ensure input is base64 string
 */
async function ensureBase64(
  imageSource: string | HTMLImageElement
): Promise<string> {
  if (typeof imageSource === 'string') {
    // Already a string (base64 or URL)
    if (imageSource.startsWith('data:')) {
      return imageSource;
    }
    // Assume it's a base64 string without prefix
    return imageSource;
  }

  // It's an HTMLImageElement, convert to base64
  return imageToBase64(imageSource);
}

/**
 * Convert HTMLImageElement to base64
 */
function imageToBase64(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Merge overlapping text regions into larger blocks
 *
 * This is useful for manga where multiple words in a speech bubble
 * should be treated as one region.
 *
 * @param regions Array of text regions
 * @param overlapThreshold Overlap ratio threshold for merging (0-1)
 * @returns Merged regions
 */
export function mergeOverlappingRegions(
  regions: TextRegion[],
  overlapThreshold: number = 0.3
): TextRegion[] {
  if (regions.length <= 1) {
    return regions;
  }

  const merged: TextRegion[] = [];
  const used = new Set<number>();

  for (let i = 0; i < regions.length; i++) {
    if (used.has(i)) continue;

    const regionI = regions[i];
    if (!regionI) continue;

    let current: TextRegion = {
      x: regionI.x ?? 0,
      y: regionI.y ?? 0,
      width: regionI.width ?? 0,
      height: regionI.height ?? 0,
      text: regionI.text ?? '',
      confidence: regionI.confidence ?? 0,
    };
    used.add(i);

    for (let j = i + 1; j < regions.length; j++) {
      if (used.has(j)) continue;

      const other = regions[j];
      if (!other) continue;

      const overlap = calculateOverlap(current, other);

      if (overlap >= overlapThreshold) {
        // Merge regions
        const minX = Math.min(current.x, other.x);
        const minY = Math.min(current.y, other.y);
        const maxX = Math.max(current.x + current.width, other.x + other.width);
        const maxY = Math.max(current.y + current.height, other.y + other.height);

        current = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          text: current.text + ' ' + (other.text ?? ''),
          confidence: (current.confidence + (other.confidence ?? 0)) / 2,
        };

        used.add(j);
      }
    }

    merged.push(current);
  }

  return merged;
}

/**
 * Calculate overlap ratio between two regions
 */
function calculateOverlap(a: TextRegion, b: TextRegion): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0;
  }

  const intersection = (x2 - x1) * (y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const minArea = Math.min(areaA, areaB);

  return intersection / minArea;
}
