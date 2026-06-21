import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldPreserveTallMangaPage,
  compressImage,
  calculateHash,
  imageToBase64,
  loadImage,
  processImageFromUrl,
  processImage,
  meetsMinimumSize,
  getImageDimensions,
  base64ToDataUrl,
  dataUrlToBase64,
} from './image-processor';

/**
 * Helpers for the test mocks below. The shape mirrors the production
 * CanvasRenderingContext2D surface we exercise; intentionally narrow so
 * the test fails loudly if production starts depending on a method the
 * mocks do not provide.
 */
type MockCanvasContext = {
  drawImage: CanvasRenderingContext2D['drawImage'];
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
};

function buildCanvasContextMock(): MockCanvasContext {
  return {
    drawImage: vi.fn() as unknown as CanvasRenderingContext2D['drawImage'],
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  };
}

describe('image-processor', () => {
  // ================================================================
  // shouldPreserveTallMangaPage
  // ================================================================
  describe('shouldPreserveTallMangaPage', () => {
    it('preserves tall narrow manga pages', () => {
      expect(shouldPreserveTallMangaPage(720, 5000)).toBe(true);
    });

    it('does not preserve regular landscape images', () => {
      expect(shouldPreserveTallMangaPage(1600, 900)).toBe(false);
    });

    it('does not preserve tall pages when width is too large', () => {
      expect(shouldPreserveTallMangaPage(1800, 5000)).toBe(false);
    });

    // --- edge cases ---

    it('returns false when width is zero or negative', () => {
      expect(shouldPreserveTallMangaPage(0, 5000)).toBe(false);
      expect(shouldPreserveTallMangaPage(-10, 5000)).toBe(false);
    });

    it('returns false when height is zero or negative', () => {
      expect(shouldPreserveTallMangaPage(720, 0)).toBe(false);
      expect(shouldPreserveTallMangaPage(720, -500)).toBe(false);
    });

    it('returns false when aspect ratio is below 2.4 even if height exceeds maxSize', () => {
      // height 2500 > maxSize 1024, width 1200 => aspect 2500/1200 ≈ 2.08 < 2.4
      expect(shouldPreserveTallMangaPage(1200, 2500)).toBe(false);
    });

    it('respects custom maxSize parameter', () => {
      // width 500 > custom maxSize 400 => width constraint fails
      expect(shouldPreserveTallMangaPage(500, 2000, 400)).toBe(false);
      // width 400, height 2000 > maxSize 400, aspect 2000/400 = 5 >= 2.4
      expect(shouldPreserveTallMangaPage(400, 2000, 400)).toBe(true);
    });
  });

  // ================================================================
  // calculateHash
  // ================================================================
  describe('calculateHash', () => {
    it('computes a 64-character SHA-256 hex hash via SubtleCrypto', async () => {
      // jsdom's crypto.subtle.digest may not be functional in all environments.
      // Mock it to guarantee deterministic output.
      const digestSpy = vi.spyOn(crypto.subtle, 'digest');
      const fakeHash = new Uint8Array(32);
      fakeHash.fill(0xab);
      digestSpy.mockResolvedValue(fakeHash.buffer as ArrayBuffer);

      const result = await calculateHash('hello');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[0-9a-f]{64}$/);
      // 0xab → 'ab' repeated 32 times
      expect(result).toBe('ab'.repeat(32));
    });

    it('falls back to djb2 when SubtleCrypto is unavailable', async () => {
      // crypto.subtle is a getter-only property on the Crypto prototype.
      // Spy on the getter to simulate its absence.
      const subtleSpy = vi
        .spyOn(globalThis.crypto, 'subtle', 'get')
        .mockReturnValue(undefined as unknown as SubtleCrypto);

      try {
        const result = await calculateHash('test');
        // djb2 produces an 8-character hex string
        expect(result).toHaveLength(8);
        expect(result).toMatch(/^[0-9a-f]{8}$/);
      } finally {
        subtleSpy.mockRestore();
      }
    });

    it('handles empty string input', async () => {
      const digestSpy = vi.spyOn(crypto.subtle, 'digest');
      const fakeHash = new Uint8Array(32);
      digestSpy.mockResolvedValue(fakeHash.buffer as ArrayBuffer);

      const result = await calculateHash('');
      expect(result).toHaveLength(64);
    });
  });

  // ================================================================
  // imageToBase64
  // ================================================================
  describe('imageToBase64', () => {
    let mockCtx: MockCanvasContext;

    beforeEach(() => {
      mockCtx = buildCanvasContextMock();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        mockCtx as unknown as CanvasRenderingContext2D
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,abc123',
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('converts an image to a pure base64 string (strips data URL prefix)', () => {
      const img = {
        naturalWidth: 200,
        naturalHeight: 100,
      } as unknown as HTMLImageElement;

      const result = imageToBase64(img, { format: 'jpeg', quality: 0.9 });
      expect(result).toBe('abc123');
      expect(mockCtx.drawImage).toHaveBeenCalledWith(img, 0, 0);
    });

    it('throws when canvas 2D context is unavailable', () => {
      vi.restoreAllMocks(); // undo the beforeEach spy
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      const img = {
        naturalWidth: 10,
        naturalHeight: 10,
      } as unknown as HTMLImageElement;

      expect(() => imageToBase64(img)).toThrow('Failed to get canvas 2D context');
    });
  });

  // ================================================================
  // compressImage
  // ================================================================
  describe('compressImage', () => {
    let mockContext: MockCanvasContext;

    beforeEach(() => {
      mockContext = buildCanvasContextMock();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        mockContext as unknown as CanvasRenderingContext2D
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,mocked_base64_compressed',
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('compresses a very tall manga page down to 3000px max height', () => {
      const mockImage = {
        naturalWidth: 800,
        naturalHeight: 5000,
        getBoundingClientRect: () => ({ top: 0, bottom: 5000, height: 5000, width: 800 }),
      } as unknown as HTMLImageElement;

      const result = compressImage(mockImage, 1024, 0.85);

      expect(result.wasCompressed).toBe(true);
      expect(result.height).toBe(3000);
      expect(result.width).toBe(480);
      expect(result.base64).toBe('mocked_base64_compressed');

      expect(mockContext.drawImage).toHaveBeenCalledWith(
        mockImage,
        0,
        0,
        800,
        5000,
        0,
        0,
        480,
        3000,
      );
    });

    it('does not compress tall manga page if its height is already <= 3000px', () => {
      const mockImage = {
        naturalWidth: 800,
        naturalHeight: 2500,
        getBoundingClientRect: () => ({ top: 0, bottom: 2500, height: 2500, width: 800 }),
      } as unknown as HTMLImageElement;

      const result = compressImage(mockImage, 1024, 0.85);

      expect(result.wasCompressed).toBe(false);
      expect(result.height).toBe(2500);
      expect(result.width).toBe(800);
      expect(mockContext.drawImage).toHaveBeenCalledWith(
        mockImage,
        0,
        0,
        800,
        2500,
        0,
        0,
        800,
        2500,
      );
    });

    // --- new edge cases ---

    it('compresses a normal (non-manga-tall) image when dimensions exceed maxSize', () => {
      const mockImage = {
        naturalWidth: 2000,
        naturalHeight: 1500,
        getBoundingClientRect: () => ({ top: 0, bottom: 1500, height: 1500, width: 2000 }),
      } as unknown as HTMLImageElement;

      // aspect 1500/2000 = 0.75 < 2.4 → NOT preserved as tall manga
      // both dimensions > 1024 → compressed with ratio 1024/2000 = 0.512
      const result = compressImage(mockImage, 1024, 0.85);

      expect(result.wasCompressed).toBe(true);
      expect(result.width).toBe(Math.round(2000 * (1024 / 2000))); // 1024
      expect(result.height).toBe(Math.round(1500 * (1024 / 2000))); // 768
    });

    it('does not compress a small image that fits within maxSize', () => {
      const mockImage = {
        naturalWidth: 400,
        naturalHeight: 300,
        getBoundingClientRect: () => ({ top: 0, bottom: 300, height: 300, width: 400 }),
      } as unknown as HTMLImageElement;

      const result = compressImage(mockImage, 1024, 0.85);

      expect(result.wasCompressed).toBe(false);
      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
    });

    it('applies viewportCrop with visible area and margin', () => {
      const mockImage = {
        naturalWidth: 800,
        naturalHeight: 4000,
        // Image rect: starts at -500 (above viewport), extends to 3500 (below)
        getBoundingClientRect: () => ({
          top: -500,
          bottom: 3500,
          height: 4000,
          width: 800,
          left: 0,
          right: 800,
        }),
      } as unknown as HTMLImageElement;

      // window.innerHeight defaults to 768 in jsdom
      // The visible portion is from y=500 to y=768 in DOM pixels
      // scaleY = 4000 / 4000 = 1
      // visibleTopDOM = max(0, -(-500)) = max(0, 500) = 500
      // visibleBottomDOM = min(4000, 768 - (-500)) = min(4000, 1268) = 1268
      // marginDOM = 300
      // cropTopDOM = max(0, 500 - 300) = 200
      // cropBottomDOM = min(4000, 1268 + 300) = 1568
      // sourceY = floor(200 * 1) = 200
      // sourceHeight = floor((1568 - 200) * 1) = 1368
      const result = compressImage(mockImage, 1024, 0.85, true, 'jpeg');

      expect(result.cropY).toBeGreaterThan(0);
      expect(result.cropHeight).toBeLessThan(4000);
    });

    it('viewportCrop does nothing when image is fully above the viewport', () => {
      const mockImage = {
        naturalWidth: 800,
        naturalHeight: 4000,
        getBoundingClientRect: () => ({
          top: -5000,
          bottom: -1000,
          height: 4000,
          width: 800,
          left: 0,
          right: 800,
        }),
      } as unknown as HTMLImageElement;

      // Image completely above viewport → rect.bottom < 0
      // The condition (rect.bottom >= 0 && rect.top <= windowHeight) is false
      const result = compressImage(mockImage, 1024, 0.85, true, 'jpeg');

      expect(result.cropY).toBe(0);
      expect(result.cropHeight).toBe(4000);
    });

    it('uses webp mime type when format is webp', () => {
      vi.restoreAllMocks();
      const mockCtx = {
        drawImage: vi.fn(),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        mockCtx as unknown as CanvasRenderingContext2D
      );
      const toDataUrlSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
        .mockReturnValue('data:image/webp;base64,webp_mock');

      const mockImage = {
        naturalWidth: 400,
        naturalHeight: 300,
        getBoundingClientRect: () => ({ top: 0, bottom: 300, height: 300, width: 400 }),
      } as unknown as HTMLImageElement;

      const result = compressImage(mockImage, 1024, 0.85, false, 'webp');
      expect(result.base64).toBe('webp_mock');
      expect(toDataUrlSpy).toHaveBeenCalledWith('image/webp', 0.85);
    });

    it('throws when canvas 2D context is unavailable', () => {
      vi.restoreAllMocks();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      const mockImage = {
        naturalWidth: 100,
        naturalHeight: 100,
        getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100, width: 100 }),
      } as unknown as HTMLImageElement;

      expect(() => compressImage(mockImage)).toThrow('Failed to get canvas 2D context');
    });
  });

  // ================================================================
  // processImage
  // ================================================================
  describe('processImage', () => {
    beforeEach(() => {
      // Default: canvas works normally
      const mockCtx = {
        drawImage: vi.fn(),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        mockCtx as unknown as CanvasRenderingContext2D
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,proc_base64',
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('processes an image via canvas and returns a full ProcessedImage', async () => {
      const mockImage = {
        naturalWidth: 200,
        naturalHeight: 100,
        src: 'https://example.com/img.jpg',
        getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100, width: 200 }),
      } as unknown as HTMLImageElement;

      const result = await processImage(mockImage);

      expect(result.originalWidth).toBe(200);
      expect(result.originalHeight).toBe(100);
      expect(result.base64).toBe('proc_base64');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.hash).toHaveLength(64);
      expect(result.wasCompressed).toBe(false);
    });

    it('falls back to background proxy when canvas path throws', async () => {
      // Make canvas throw
      vi.restoreAllMocks();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
        success: true,
        imageBase64: 'proxy_base64',
        mimeType: 'image/png',
      });

      const mockImage = {
        naturalWidth: 200,
        naturalHeight: 100,
        src: 'https://cdn.example.com/cors-image.jpg',
        getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100, width: 200 }),
      } as unknown as HTMLImageElement;

      const result = await processImage(mockImage);

      expect(result.base64).toBe('proxy_base64');
      expect(result.mimeType).toBe('image/png');
      expect(result.originalWidth).toBe(200);
      expect(result.originalHeight).toBe(100);
      expect(result.wasCompressed).toBe(false);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'FETCH_IMAGE_BYTES',
        imageUrl: 'https://cdn.example.com/cors-image.jpg',
      });
    });

    it('throws when the background proxy also fails', async () => {
      vi.restoreAllMocks();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
        success: false,
        error: 'Network unreachable',
      });

      const mockImage = {
        naturalWidth: 200,
        naturalHeight: 100,
        src: 'https://cdn.example.com/bad.jpg',
        getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100, width: 200 }),
      } as unknown as HTMLImageElement;

      await expect(processImage(mockImage)).rejects.toThrow(
        'Failed to fetch image via background',
      );
    });

    it('rejects responses that use the legacy `base64` field name (regression guard for i1)', async () => {
      vi.restoreAllMocks();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      // Old contract: response.base64. This must NOT be accepted anymore.
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
        success: true,
        base64: 'legacy_field',
        mimeType: 'image/png',
      } as unknown as { success: boolean; imageBase64: string; mimeType: string });

      const mockImage = {
        naturalWidth: 200,
        naturalHeight: 100,
        src: 'https://cdn.example.com/legacy-response.jpg',
        getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100, width: 200 }),
      } as unknown as HTMLImageElement;

      await expect(processImage(mockImage)).rejects.toThrow(
        'Failed to fetch image via background',
      );
    });
  });

  // ================================================================
  // loadImage
  // ================================================================
  describe('loadImage', () => {
    let originalImage: typeof Image | undefined;

    beforeEach(() => {
      originalImage = globalThis.Image;
    });

    afterEach(() => {
      if (originalImage) {
        globalThis.Image = originalImage;
      }
    });

    it('resolves with the loaded HTMLImageElement on success', async () => {
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';

        set src(_val: string) {
          setTimeout(() => this.onload?.(), 0);
        }
        get src() {
          return 'https://example.com/ok.jpg';
        }
      } as unknown as typeof Image;

      const img = await loadImage('https://example.com/ok.jpg');
      expect(img).toBeDefined();
      expect(img.crossOrigin).toBe('anonymous');
    });

    it('rejects when the image fails to load', async () => {
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';

        set src(_val: string) {
          setTimeout(() => this.onerror?.(), 0);
        }
        get src() {
          return 'https://example.com/bad.jpg';
        }
      } as unknown as typeof Image;

      await expect(loadImage('https://example.com/bad.jpg')).rejects.toThrow(
        'Failed to load image',
      );
    });
  });

  // ================================================================
  // processImageFromUrl
  // ================================================================
  describe('processImageFromUrl', () => {
    let originalImage: typeof Image | undefined;

    beforeEach(() => {
      originalImage = globalThis.Image;
      const mockCtx = {
        drawImage: vi.fn(),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        mockCtx as unknown as CanvasRenderingContext2D
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,url_processed',
      );
    });

    afterEach(() => {
      if (originalImage) {
        globalThis.Image = originalImage;
      }
      vi.restoreAllMocks();
    });

    it('loads an image from URL and processes it', async () => {
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        naturalWidth = 300;
        naturalHeight = 200;

        set src(_val: string) {
          setTimeout(() => this.onload?.(), 0);
        }
        get src() {
          return 'https://example.com/manga.jpg';
        }
        getBoundingClientRect = () => ({ top: 0, bottom: 200, height: 200, width: 300 });
      } as unknown as typeof Image;

      const result = await processImageFromUrl('https://example.com/manga.jpg');
      expect(result.originalWidth).toBe(300);
      expect(result.originalHeight).toBe(200);
      expect(result.base64).toBe('url_processed');
      expect(result.hash).toHaveLength(64);
    });

    it('propagates load errors', async () => {
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';

        set src(_val: string) {
          setTimeout(() => this.onerror?.(), 0);
        }
        get src() {
          return 'https://example.com/missing.jpg';
        }
      } as unknown as typeof Image;

      await expect(processImageFromUrl('https://example.com/missing.jpg')).rejects.toThrow(
        'Failed to load image',
      );
    });
  });

  // ================================================================
  // meetsMinimumSize
  // ================================================================
  describe('meetsMinimumSize', () => {
    it('returns true when both dimensions meet the default minimums', () => {
      const img = { naturalWidth: 200, naturalHeight: 200 } as HTMLImageElement;
      expect(meetsMinimumSize(img)).toBe(true);
    });

    it('returns false when width is below the minimum', () => {
      const img = { naturalWidth: 100, naturalHeight: 200 } as HTMLImageElement;
      expect(meetsMinimumSize(img)).toBe(false);
    });

    it('returns false when height is below the minimum', () => {
      const img = { naturalWidth: 200, naturalHeight: 50 } as HTMLImageElement;
      expect(meetsMinimumSize(img)).toBe(false);
    });

    it('respects custom minimum dimensions', () => {
      const img = { naturalWidth: 200, naturalHeight: 200 } as HTMLImageElement;
      expect(meetsMinimumSize(img, 300, 300)).toBe(false);
      expect(meetsMinimumSize(img, 100, 100)).toBe(true);
    });
  });

  // ================================================================
  // getImageDimensions
  // ================================================================
  describe('getImageDimensions', () => {
    it('returns naturalWidth and naturalHeight', () => {
      const img = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
      expect(getImageDimensions(img)).toEqual({ width: 640, height: 480 });
    });
  });

  // ================================================================
  // base64ToDataUrl
  // ================================================================
  describe('base64ToDataUrl', () => {
    it('prepends a data URL prefix with the default jpeg mime type', () => {
      expect(base64ToDataUrl('abc123')).toBe('data:image/jpeg;base64,abc123');
    });

    it('uses the provided mime type', () => {
      expect(base64ToDataUrl('xyz', 'image/webp')).toBe('data:image/webp;base64,xyz');
    });
  });

  // ================================================================
  // dataUrlToBase64
  // ================================================================
  describe('dataUrlToBase64', () => {
    it('strips the data URL prefix and returns raw base64', () => {
      const url = 'data:image/png;base64,iVBORw0KGgo=';
      expect(dataUrlToBase64(url)).toBe('iVBORw0KGgo=');
    });
  });
});
