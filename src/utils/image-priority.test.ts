/**
 * Tests for Image Priority and Parallel Processing Utilities
 * 
 * Requirements: 9.2, 9.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInViewport,
  getDistanceFromViewportCenter,
  calculateImagePriority,
  sortImagesByPriority,
  getViewportFirstImages,
  processInParallel,
  processImagesOptimized,
  splitIntoBatches,
} from './image-priority';

// ==================== Test Utilities ====================

function createMockImage(
  rect: Partial<DOMRect> = {},
  dimensions: { width?: number; height?: number } = {}
): HTMLImageElement {
  const img = document.createElement('img');
  
  const defaultRect: DOMRect = {
    top: 100,
    left: 100,
    bottom: 200,
    right: 300,
    width: 200,
    height: 100,
    x: 100,
    y: 100,
    toJSON: () => ({}),
    ...rect,
  };
  
  vi.spyOn(img, 'getBoundingClientRect').mockReturnValue(defaultRect);
  
  Object.defineProperty(img, 'naturalWidth', { value: dimensions.width || 800 });
  Object.defineProperty(img, 'naturalHeight', { value: dimensions.height || 600 });
  Object.defineProperty(img, 'width', { value: dimensions.width || 800 });
  Object.defineProperty(img, 'height', { value: dimensions.height || 600 });
  
  return img;
}

// ==================== Tests ====================

describe('Viewport Detection', () => {
  beforeEach(() => {
    // Mock window dimensions
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  });

  describe('isInViewport', () => {
    it('should return true for element fully in viewport', () => {
      const img = createMockImage({ top: 100, left: 100, bottom: 200, right: 300 });
      expect(isInViewport(img)).toBe(true);
    });

    it('should return true for element partially in viewport', () => {
      const img = createMockImage({ top: -50, left: 100, bottom: 100, right: 300 });
      expect(isInViewport(img)).toBe(true);
    });

    it('should return false for element above viewport', () => {
      const img = createMockImage({ top: -300, left: 100, bottom: -200, right: 300 });
      expect(isInViewport(img)).toBe(false);
    });

    it('should return false for element below viewport', () => {
      const img = createMockImage({ top: 1000, left: 100, bottom: 1100, right: 300 });
      expect(isInViewport(img)).toBe(false);
    });

    it('should consider margin when checking viewport', () => {
      // Element just outside viewport
      const img = createMockImage({ top: -150, left: 100, bottom: -50, right: 300 });
      
      // Without margin, should be outside
      expect(isInViewport(img, 0)).toBe(false);
      
      // With 100px margin, should be inside
      expect(isInViewport(img, 100)).toBe(true);
    });
  });

  describe('getDistanceFromViewportCenter', () => {
    it('should return 0 for element at viewport center', () => {
      // Viewport center is (600, 400)
      const img = createMockImage({ 
        top: 350, 
        left: 550, 
        bottom: 450, 
        right: 650,
        width: 100,
        height: 100,
      });
      
      const distance = getDistanceFromViewportCenter(img);
      expect(distance).toBe(0);
    });

    it('should return correct distance for element away from center', () => {
      // Element at top-left corner
      const img = createMockImage({ 
        top: 0, 
        left: 0, 
        bottom: 100, 
        right: 100,
        width: 100,
        height: 100,
      });
      
      const distance = getDistanceFromViewportCenter(img);
      // Element center is (50, 50), viewport center is (600, 400)
      // Distance = sqrt((600-50)^2 + (400-50)^2) = sqrt(550^2 + 350^2) ≈ 652
      expect(distance).toBeGreaterThan(600);
      expect(distance).toBeLessThan(700);
    });
  });

  describe('calculateImagePriority', () => {
    it('should give higher priority to viewport images', () => {
      const inViewportImg = createMockImage({ top: 100, left: 100, bottom: 200, right: 300 });
      const outsideViewportImg = createMockImage({ top: 1000, left: 100, bottom: 1100, right: 300 });
      
      const inViewportPriority = calculateImagePriority(inViewportImg);
      const outsideViewportPriority = calculateImagePriority(outsideViewportImg);
      
      expect(inViewportPriority).toBeGreaterThan(outsideViewportPriority);
    });

    it('should give higher priority to images closer to center', () => {
      // Both in viewport, but different distances from center
      const centerImg = createMockImage({ 
        top: 350, left: 550, bottom: 450, right: 650,
        width: 100, height: 100,
      });
      const cornerImg = createMockImage({ 
        top: 0, left: 0, bottom: 100, right: 100,
        width: 100, height: 100,
      });
      
      const centerPriority = calculateImagePriority(centerImg);
      const cornerPriority = calculateImagePriority(cornerImg);
      
      expect(centerPriority).toBeGreaterThan(cornerPriority);
    });
  });
});

describe('Image Sorting', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  });

  describe('sortImagesByPriority', () => {
    it('should sort images with viewport images first', () => {
      const inViewportImg = createMockImage({ top: 100, left: 100, bottom: 200, right: 300 });
      const outsideViewportImg = createMockImage({ top: 1000, left: 100, bottom: 1100, right: 300 });
      
      const sorted = sortImagesByPriority([outsideViewportImg, inViewportImg]);
      
      expect(sorted[0]?.image).toBe(inViewportImg);
      expect(sorted[0]?.inViewport).toBe(true);
      expect(sorted[1]?.image).toBe(outsideViewportImg);
      expect(sorted[1]?.inViewport).toBe(false);
    });

    it('should include priority information', () => {
      const img = createMockImage({ top: 100, left: 100, bottom: 200, right: 300 });
      
      const sorted = sortImagesByPriority([img]);
      
      expect(sorted[0]?.priority).toBeGreaterThan(0);
      expect(sorted[0]?.distanceFromCenter).toBeDefined();
    });
  });

  describe('getViewportFirstImages', () => {
    it('should return images sorted by viewport priority', () => {
      const img1 = createMockImage({ top: 1000, left: 100, bottom: 1100, right: 300 });
      const img2 = createMockImage({ top: 100, left: 100, bottom: 200, right: 300 });
      const img3 = createMockImage({ top: 2000, left: 100, bottom: 2100, right: 300 });
      
      const sorted = getViewportFirstImages([img1, img2, img3]);
      
      // img2 is in viewport, should be first
      expect(sorted[0]).toBe(img2);
    });
  });
});

describe('Parallel Processing', () => {
  describe('processInParallel', () => {
    it('should process all items', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
      
      const results = await processInParallel(items, processor, { maxConcurrent: 2 });
      
      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(processor).toHaveBeenCalledTimes(5);
    });

    it('should respect concurrency limit', async () => {
      const items = [1, 2, 3, 4];
      let concurrentCount = 0;
      let maxConcurrent = 0;
      
      const processor = vi.fn().mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCount--;
        return true;
      });
      
      await processInParallel(items, processor, { maxConcurrent: 2 });
      
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should call onItemComplete callback', async () => {
      const items = [1, 2, 3];
      const onItemComplete = vi.fn();
      
      await processInParallel(
        items,
        async (item) => item,
        { maxConcurrent: 1, onItemComplete }
      );
      
      expect(onItemComplete).toHaveBeenCalledTimes(3);
      expect(onItemComplete).toHaveBeenLastCalledWith(3, 3);
    });

    it('should call onError callback for failed items', async () => {
      const items = [1, 2, 3];
      const onError = vi.fn();
      
      await processInParallel(
        items,
        async (item) => {
          if (item === 2) throw new Error('Test error');
          return item;
        },
        { maxConcurrent: 1, onError }
      );
      
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it('should stop processing when signal is aborted', async () => {
      const items = [1, 2, 3, 4, 5];
      const controller = new AbortController();
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2) {
          controller.abort();
        }
        return item;
      });
      
      await processInParallel(items, processor, { 
        maxConcurrent: 1, 
        signal: controller.signal 
      });
      
      // Should stop after abort
      expect(processor.mock.calls.length).toBeLessThanOrEqual(3);
    });
  });

  describe('processImagesOptimized', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    });

    it('should process images in viewport-first order', async () => {
      const outsideImg = createMockImage({ top: 1000, left: 100, bottom: 1100, right: 300 });
      const insideImg = createMockImage({ top: 100, left: 100, bottom: 200, right: 300 });
      
      const processOrder: HTMLImageElement[] = [];
      
      await processImagesOptimized(
        [outsideImg, insideImg],
        async (img) => {
          processOrder.push(img);
          return true;
        },
        { maxConcurrent: 1 }
      );
      
      // Inside viewport image should be processed first
      expect(processOrder[0]).toBe(insideImg);
      expect(processOrder[1]).toBe(outsideImg);
    });
  });
});

describe('Batch Processing Utilities', () => {
  describe('splitIntoBatches', () => {
    it('should split array into correct batch sizes', () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const batches = splitIntoBatches(items, 3);
      
      expect(batches).toHaveLength(3);
      expect(batches[0]).toEqual([1, 2, 3]);
      expect(batches[1]).toEqual([4, 5, 6]);
      expect(batches[2]).toEqual([7]);
    });

    it('should handle empty array', () => {
      const batches = splitIntoBatches([], 3);
      expect(batches).toHaveLength(0);
    });

    it('should handle array smaller than batch size', () => {
      const items = [1, 2];
      const batches = splitIntoBatches(items, 5);
      
      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual([1, 2]);
    });
  });
});
