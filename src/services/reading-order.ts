/**
 * Reading order for the text areas of a single image.
 *
 * The vision model returns the speech bubbles in whatever order it noticed
 * them, which is not the order they appear on the page. Everything that
 * lists bubbles — the reading panel, the numbering — inherits that order,
 * so an image with six bubbles could show them shuffled: the reader has to
 * hunt for the sentence that continues the one above.
 */

import type { TextArea } from '@/providers/base';

/**
 * How close two bubbles have to be to count as the same row.
 *
 * The coordinates are normalised to the image, so 0.03 is about three per
 * cent of the image's height. Two bubbles that close to each other are
 * read left to right, even when one of them sits a little lower.
 */
const ROW_TOLERANCE = 0.03;

/**
 * Compare two images by their position in the document.
 *
 * Reading order is a property of the page, not of the translation queue:
 * images are translated concurrently and viewport-first, so the order they
 * finish in says nothing about which one comes first in the chapter.
 * `compareDocumentPosition` gives us the document order directly.
 */
export function compareImagesByDocumentOrder(
  a: HTMLImageElement,
  b: HTMLImageElement
): number {
  if (a === b) {
    return 0;
  }

  // Node.DOCUMENT_POSITION_DISCONNECTED === 1
  //
  // The two images live in different trees, so there is no document order to
  // speak of. This has to be checked before the FOLLOWING bit: the spec says
  // a disconnected pair also reports PRECEDING/FOLLOWING, so without this
  // check a detached image would claim a position in the chapter.
  if (a.compareDocumentPosition(b) & 1) {
    return 0;
  }

  // Node.DOCUMENT_POSITION_FOLLOWING === 4
  if (a.compareDocumentPosition(b) & 4) {
    return -1;
  }
  return 1;
}

/**
 * Sort the text areas of one image into the order a reader reads them.
 *
 * Vertical manga is read top to bottom and right to left, so the x axis
 * decides the order there; horizontal text is read top to bottom and left
 * to right.
 *
 * The sort is stable and transitive: the row is decided by a quantised
 * bucket rather than by comparing two coordinates against each other, so
 * two bubbles in the same row always end up in the same order regardless
 * of which one the sort happens to look at first.
 */
export function sortTextAreasByReadingOrder(
  areas: readonly TextArea[],
  verticalText = false
): TextArea[] {
  return [...areas].sort((a, b) => {
    if (verticalText) {
      // 竖排：先从右往左分列，同一列内从上往下。
      const column =
        Math.round(b.x / ROW_TOLERANCE) - Math.round(a.x / ROW_TOLERANCE);
      if (column !== 0) {
        return column;
      }
      return a.y - b.y;
    }

    // 横排：先从上往下分行，同一行内从左往右。
    const row =
      Math.round(a.y / ROW_TOLERANCE) - Math.round(b.y / ROW_TOLERANCE);
    if (row !== 0) {
      return row;
    }
    return a.x - b.x;
  });
}
