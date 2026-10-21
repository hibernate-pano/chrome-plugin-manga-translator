/**
 * Reading the pixels of a page image so the boxes can be refined.
 *
 * The refiner needs the image itself, not a copy the model saw: the model
 * worked from a compressed thumbnail, and the thumbnail's JPEG ringing
 * would corrupt the ink analysis. The page's own <img> is the best
 * source — full resolution, already decoded by the browser.
 *
 * The canvas is the problem. Drawing a cross-origin image taints the
 * canvas, and `getImageData` then throws a SecurityError. That is not a
 * rare edge case: a manga reader hosting its images on a CDN is the
 * normal case, and the extension already asks for those hosts. So the
 * canvas path is attempted and its failure is treated as "no refinement
 * available" rather than an error.
 */

import type { TextArea } from '@/providers/base';
import {
  buildInkBitmap,
  type InkBitmap,
  type NormalizedBox,
  refineTextBoxes,
} from './text-box-refiner';

/**
 * The largest image the refiner will analyse.
 *
 * The analysis is O(pixels) and a manga page can be 8000px tall. The
 * boxes are read off the ink, and halving the resolution still leaves
 * glyphs far larger than the ink threshold, so the accuracy is not lost —
 * it is halved to a couple of pixels, against a model's error of tens of
 * pixels.
 */
const MAX_ANALYSIS_DIMENSION = 1400;

/**
 * Read the pixels of an image element.
 *
 * @returns The bitmap, or null when the pixels cannot be read (a tainted
 *   canvas, a zero-sized image, or no 2D context).
 */
export function readInkBitmap(image: HTMLImageElement): InkBitmap | null {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (!naturalWidth || !naturalHeight) {
    return null;
  }

  const scale = Math.min(
    1,
    MAX_ANALYSIS_DIMENSION / Math.max(naturalWidth, naturalHeight)
  );
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    ctx.drawImage(image, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return buildInkBitmap(data, width, height);
  } catch {
    // A tainted canvas throws here. The image belongs to another origin and
    // its pixels are off limits — which is exactly what the extension asks
    // the user for permission to read.
    return null;
  }
}

/**
 * Refine the boxes of a translation against the pixels of the image.
 *
 * The result is the model's boxes unchanged when the pixels are not
 * readable. A slightly-off box is a smaller problem than a translation
 * that has moved off its bubble.
 *
 * @param image The image the boxes belong to.
 * @param boxes The boxes the vision model reported, normalised.
 * @returns The refined boxes, in the same order.
 */
export function refineBoxesForImage(
  image: HTMLImageElement,
  boxes: readonly NormalizedBox[]
): NormalizedBox[] {
  if (boxes.length === 0) {
    return [];
  }
  const bitmap = readInkBitmap(image);
  if (!bitmap) {
    return [...boxes];
  }
  return refineTextBoxes(bitmap, boxes);
}

/**
 * Refine the text areas of a translation against the pixels of the image.
 *
 * This is the entry point the content script uses. It never throws: a
 * failure to read the pixels leaves the model's boxes alone, because a
 * translation that is drawn slightly off its bubble is a smaller problem
 * than a page that stops translating altogether.
 *
 * @param image The image the text areas belong to.
 * @param textAreas The text areas the vision model reported.
 * @returns The refined text areas, in the same order.
 */
export function refineTextAreasForImage(
  image: HTMLImageElement,
  textAreas: readonly TextArea[]
): TextArea[] {
  if (textAreas.length === 0) {
    return [...textAreas];
  }

  let refined: NormalizedBox[];
  try {
    refined = refineBoxesForImage(image, textAreas);
  } catch (error) {
    console.warn('[TextBoxRefiner] 精修失败，保留模型给的框:', error);
    return [...textAreas];
  }

  return textAreas.map((area, index) => {
    const box = refined[index];
    if (!box) {
      return area;
    }
    return {
      ...area,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  });
}
