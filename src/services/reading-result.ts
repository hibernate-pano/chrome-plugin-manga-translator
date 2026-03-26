export interface ReadingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ReadingEntryStatus = 'region-vlm' | 'fallback-full-image';

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
}

export type ReadingPipeline = 'hybrid-regions' | 'full-image-fallback';

export interface ImageReadingResult {
  imageKey: string;
  entries: ReadingEntry[];
  pipeline: ReadingPipeline;
  cached?: boolean;
  error?: string;
}

export function createReadingEntryId(
  imageKey: string,
  anchorIndex: number
): string {
  return `${imageKey}::${anchorIndex}`;
}
