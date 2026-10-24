import type { TextArea } from '@/providers/base';

interface ReadingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ReadingEntryStatus = 'region-vlm' | 'fallback-full-image';

export interface ReadingEntry {
  id: string;
  imageKey: string;
  anchorIndex: number;
  sourceRegion: ReadingRegion;
  displayRegion: ReadingRegion;
  originalText: string;
  translatedText: string;
  confidence: number;
  order: number;
  status: ReadingEntryStatus;
  /**
   * The individual text boxes inside this entry.
   *
   * An entry normally covers one region, but a region can hold more than one
   * bubble: the OCR regions are merged when they overlap, and the model can
   * split one bubble into several boxes. The entry still describes the region
   * as a whole, but the boxes are kept apart so each one gets its own
   * overlay on the page instead of all of them sharing one box.
   *
   * Coordinates are ratios of the ORIGINAL image, like every other
   * `TextArea`.
   */
  areas?: TextArea[];
}

type ReadingPipeline = 'hybrid-regions' | 'full-image-fallback';

export interface ImageReadingResult {
  imageKey: string;
  entries: ReadingEntry[];
  pipeline: ReadingPipeline;
  cached?: boolean;
  error?: string;
  /**
   * How many bubbles on this page were found but not translated.
   *
   * The reader has to be told: a page that says 「翻译完成」 while four of
   * its ten bubbles are still in the source language is a page that lies.
   * The count is the difference between "how many bubbles we found" and
   * "how many we managed to translate".
   */
  missingCount?: number;
}

export function createReadingEntryId(
  imageKey: string,
  anchorIndex: number
): string {
  return `${imageKey}::${anchorIndex}`;
}
