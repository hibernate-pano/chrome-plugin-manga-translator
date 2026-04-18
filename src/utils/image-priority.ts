/**
 * Image Priority and Parallel Processing Utilities
 *
 * Implements performance optimizations for manga translation:
 * - Viewport-first image processing (Requirements 9.4)
 * - Parallel processing with limits (Requirements 9.2)
 *
 * Requirements: 9.2, 9.4
 */

// ==================== Type Definitions ====================

export interface ImageWithPriority {
  /** The image element */
  image: HTMLImageElement;
  /** Priority score (higher = process first) */
  priority: number;
  /** Whether the image is in the viewport */
  inViewport: boolean;
  /** Distance from viewport center (for sorting) */
  distanceFromCenter: number;
}

export interface ParallelProcessingOptions {
  /** Maximum number of concurrent operations */
  maxConcurrent: number;
  /** Callback for each completed item */
  onItemComplete?: (index: number, total: number) => void;
  /** Callback for errors */
  onError?: (error: Error, index: number) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

// ==================== Viewport Detection ====================

/**
 * Check if an element is in the viewport
 *
 * @param element Element to check
 * @param margin Extra margin around viewport (in pixels)
 * @returns True if element is in or near viewport
 */
export function isInViewport(
  element: HTMLElement,
  margin: number = 100
): boolean {
  const rect = element.getBoundingClientRect();
  const windowHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  // Check if element is within viewport + margin
  return (
    rect.bottom >= -margin &&
    rect.top <= windowHeight + margin &&
    rect.right >= -margin &&
    rect.left <= windowWidth + margin
  );
}

/**
 * Calculate distance from viewport center
 *
 * @param element Element to measure
 * @returns Distance in pixels from viewport center
 */
export function getDistanceFromViewportCenter(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const windowHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  // Calculate element center
  const elementCenterX = rect.left + rect.width / 2;
  const elementCenterY = rect.top + rect.height / 2;

  // Calculate viewport center
  const viewportCenterX = windowWidth / 2;
  const viewportCenterY = windowHeight / 2;

  // Calculate Euclidean distance
  const dx = elementCenterX - viewportCenterX;
  const dy = elementCenterY - viewportCenterY;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate priority score for an image
 *
 * Higher score = higher priority
 * - Images in viewport get highest priority
 * - Closer to viewport center = higher priority
 * - Larger images get slightly higher priority
 *
 * @param img Image element
 * @returns Priority score
 */
export function calculateImagePriority(img: HTMLImageElement): number {
  let priority = 0;

  // Base priority for being in viewport (1000 points)
  const inViewport = isInViewport(img);
  if (inViewport) {
    priority += 1000;
  }

  // Distance from center (closer = higher priority, max 500 points)
  const distance = getDistanceFromViewportCenter(img);
  const maxDistance = Math.sqrt(
    Math.pow(window.innerWidth, 2) + Math.pow(window.innerHeight, 2)
  );
  const distanceScore = Math.max(0, 500 * (1 - distance / maxDistance));
  priority += distanceScore;

  // Size bonus (larger images slightly higher priority, max 100 points)
  const area =
    (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
  const sizeScore = Math.min(100, area / 10000);
  priority += sizeScore;

  return priority;
}

// ==================== Image Sorting ====================

/**
 * Sort images by priority (viewport-first)
 *
 * Requirements: 9.4 - Prioritize viewport images
 *
 * @param images Array of image elements
 * @returns Sorted array with priority information
 */
export function sortImagesByPriority(
  images: HTMLImageElement[]
): ImageWithPriority[] {
  const imagesWithPriority: ImageWithPriority[] = images.map(img => ({
    image: img,
    priority: calculateImagePriority(img),
    inViewport: isInViewport(img),
    distanceFromCenter: getDistanceFromViewportCenter(img),
  }));

  // Sort by priority (descending)
  return imagesWithPriority.sort((a, b) => b.priority - a.priority);
}

/**
 * Get images sorted by viewport priority
 *
 * @param images Array of image elements
 * @returns Sorted array of image elements (viewport first)
 */
export function getViewportFirstImages(
  images: HTMLImageElement[]
): HTMLImageElement[] {
  return sortImagesByPriority(images).map(item => item.image);
}

// ==================== Parallel Processing ====================

/**
 * Process items in parallel with a concurrency limit
 *
 * Requirements: 9.2 - Support parallel processing with limits
 *
 * @param items Array of items to process
 * @param processor Function to process each item
 * @param options Processing options
 * @returns Array of results
 */
export async function processInParallel<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: ParallelProcessingOptions
): Promise<R[]> {
  const { maxConcurrent, onItemComplete, onError, signal } = options;
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  let completedCount = 0;
  const total = items.length;

  // Create a pool of workers
  const workers: Promise<void>[] = [];

  const processNext = async (): Promise<void> => {
    while (currentIndex < items.length) {
      // Check for cancellation
      if (signal?.aborted) {
        return;
      }

      const index = currentIndex++;
      const item = items[index];

      if (item === undefined) continue;

      try {
        const result = await processor(item, index);
        results[index] = result;
        completedCount++;
        onItemComplete?.(completedCount, total);
      } catch (error) {
        onError?.(
          error instanceof Error ? error : new Error(String(error)),
          index
        );
        // Store undefined for failed items
        results[index] = undefined as unknown as R;
        completedCount++;
        onItemComplete?.(completedCount, total);
      }
    }
  };

  // Start workers up to maxConcurrent
  for (let i = 0; i < Math.min(maxConcurrent, items.length); i++) {
    workers.push(processNext());
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  return results;
}

/**
 * Process images with viewport priority and parallel limits
 *
 * This is the main function for optimized image processing:
 * 1. Sorts images by viewport priority
 * 2. Processes in parallel with concurrency limit
 *
 * @param images Array of image elements
 * @param processor Function to process each image
 * @param options Processing options
 * @returns Array of results
 */
export async function processImagesOptimized<R>(
  images: HTMLImageElement[],
  processor: (img: HTMLImageElement, index: number) => Promise<R>,
  options: ParallelProcessingOptions
): Promise<R[]> {
  // Sort images by viewport priority
  const sortedImages = getViewportFirstImages(images);

  // Process with parallel limits
  return processInParallel(sortedImages, processor, options);
}

// ==================== Batch Processing Utilities ====================

/**
 * Split array into batches
 *
 * @param items Array to split
 * @param batchSize Size of each batch
 * @returns Array of batches
 */
export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Process items in sequential batches with parallel processing within each batch
 *
 * Useful for rate-limited APIs where you want some parallelism
 * but need to avoid overwhelming the server
 *
 * @param items Array of items
 * @param processor Processing function
 * @param batchSize Items per batch
 * @param delayBetweenBatches Delay in ms between batches
 * @param options Parallel processing options
 * @returns Array of results
 */
export async function processInBatches<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  batchSize: number,
  delayBetweenBatches: number = 0,
  options: Omit<ParallelProcessingOptions, 'maxConcurrent'>
): Promise<R[]> {
  const batches = splitIntoBatches(items, batchSize);
  const allResults: R[] = [];
  let globalIndex = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    if (!batch) continue;

    // Check for cancellation
    if (options.signal?.aborted) {
      break;
    }

    // Process batch in parallel
    const batchResults = await processInParallel(
      batch,
      async (item, localIndex) => {
        return processor(item, globalIndex + localIndex);
      },
      {
        maxConcurrent: batch.length,
        ...options,
      }
    );

    allResults.push(...batchResults);
    globalIndex += batch.length;

    // Delay between batches (except for last batch)
    if (delayBetweenBatches > 0 && batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return allResults;
}

// ==================== Viewport Observer ====================

/**
 * Create an intersection observer for lazy loading images
 *
 * @param onEnterViewport Callback when image enters viewport
 * @param options Observer options
 * @returns IntersectionObserver instance
 */
export function createViewportObserver(
  onEnterViewport: (img: HTMLImageElement) => void,
  options: IntersectionObserverInit = {}
): IntersectionObserver {
  const defaultOptions: IntersectionObserverInit = {
    root: null,
    rootMargin: '100px',
    threshold: 0,
    ...options,
  };

  return new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.target instanceof HTMLImageElement) {
        onEnterViewport(entry.target);
      }
    });
  }, defaultOptions);
}

// ==================== Exports ====================

export {
  isInViewport as isElementInViewport,
  getDistanceFromViewportCenter as getElementDistanceFromCenter,
};
