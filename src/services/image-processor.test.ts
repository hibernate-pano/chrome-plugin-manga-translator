import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldPreserveTallMangaPage,
  combineCroppedRegions,
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
  cropRegions,
} from './image-processor';

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
    let mockCtx: any;

    beforeEach(() => {
      mockCtx = { drawImage: vi.fn() };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);
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
    let mockContext: any;

    beforeEach(() => {
      mockContext = {
        drawImage: vi.fn(),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext as any);
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
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
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
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
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
        action: 'fetchImage',
        url: 'https://cdn.example.com/cors-image.jpg',
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
    let originalImage: any;

    beforeEach(() => {
      originalImage = globalThis.Image;
    });

    afterEach(() => {
      globalThis.Image = originalImage;
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
      } as any;

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
      } as any;

      await expect(loadImage('https://example.com/bad.jpg')).rejects.toThrow(
        'Failed to load image',
      );
    });
  });

  // ================================================================
  // processImageFromUrl
  // ================================================================
  describe('processImageFromUrl', () => {
    let originalImage: any;

    beforeEach(() => {
      originalImage = globalThis.Image;
      const mockCtx = {
        drawImage: vi.fn(),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,url_processed',
      );
    });

    afterEach(() => {
      globalThis.Image = originalImage;
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
      } as any;

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
      } as any;

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

  // ================================================================
  // cropRegions
  // ================================================================
  describe('cropRegions', () => {
    let originalImage: any;

    beforeEach(() => {
      originalImage = globalThis.Image;
      const mockCtx = { drawImage: vi.fn() };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,cropped_region',
      );
      // Mock Image constructor so loadImage (used by ensureImageElement)
      // can resolve with an element that has naturalWidth / naturalHeight.
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        naturalWidth = 500;
        naturalHeight = 500;
        _src = '';

        set src(val: string) {
          this._src = val;
          setTimeout(() => this.onload?.(), 0);
        }
        get src() {
          return this._src;
        }
      } as any;
    });

    afterEach(() => {
      globalThis.Image = originalImage;
      vi.restoreAllMocks();
    });

    it('returns an empty array when regions list is empty', async () => {
      const img = { naturalWidth: 500, naturalHeight: 500 } as HTMLImageElement;
      const result = await cropRegions(img, []);
      expect(result).toEqual([]);
    });

    it('crops a single region from a base64 string input', async () => {
      const result = await cropRegions('raw_base64', [
        { x: 10, y: 20, width: 100, height: 50 },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('cropped_region');
    });

    it('crops multiple regions', async () => {
      const regions = [
        { x: 0, y: 0, width: 50, height: 50 },
        { x: 100, y: 200, width: 80, height: 60 },
      ];
      const result = await cropRegions('raw_base64', regions);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('cropped_region');
      expect(result[1]).toBe('cropped_region');
    });

    it('loads a base64 string with data: prefix correctly', async () => {
      const result = await cropRegions('data:image/png;base64,prefixed_base64', [
        { x: 0, y: 0, width: 50, height: 50 },
      ]);
      expect(result).toHaveLength(1);
    });

    it('clamps out-of-bounds region coordinates to image boundaries', async () => {
      // Region extends beyond the right and bottom edges (500x500 image)
      const result = await cropRegions('raw_base64', [
        { x: 450, y: 450, width: 100, height: 100 },
      ]);

      expect(result).toHaveLength(1);
      // Should crop at (450, 450, 50, 50) — clamped to remaining 50px each way
      const ctx = HTMLCanvasElement.prototype.getContext('2d')!;
      expect(ctx.drawImage).toHaveBeenCalled();
    });
  });

  // ================================================================
  // combineCroppedRegions
  // ================================================================
  describe('combineCroppedRegions', () => {
    let originalImage: any;

    beforeEach(() => {
      originalImage = globalThis.Image;
      // Mock Image element so that setting src calls onload automatically
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin: string = '';
        _src: string = '';
        width: number = 100;
        height: number = 200;

        set src(val: string) {
          this._src = val;
          setTimeout(() => {
            if (this.onload) {
              this.onload();
            }
          }, 0);
        }

        get src() {
          return this._src;
        }
      } as any;

      // Mock canvas functions
      const mockContext = {
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        rect: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        drawImage: vi.fn(),
      };

      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext as any);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,mocked_base64',
      );
    });

    afterEach(() => {
      globalThis.Image = originalImage;
      vi.restoreAllMocks();
    });

    it('combines images vertically and draws index labels when isHybridRegions is enabled', async () => {
      const croppedImages = ['image1_base64', 'image2_base64'];
      const result = await combineCroppedRegions(croppedImages, {
        format: 'jpeg',
        quality: 0.92,
        isHybridRegions: true,
      });

      expect(result.base64).toBe('mocked_base64');
      // For 2 images, each height = 200, spacing = 20. Total height = 200 + 20 + 200 = 420.
      expect(result.height).toBe(420);
      // Width = maxImgWidth (100) + labelWidth (60) = 160.
      expect(result.width).toBe(160);

      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]).toEqual({ index: 0, top: 0, height: 200 });
      // Next image top starts at height + spacing = 200 + 20 = 220
      expect(result.segments[1]).toEqual({ index: 1, top: 220, height: 200 });

      // Verify canvas draw operations
      const ctx = HTMLCanvasElement.prototype.getContext('2d')!;
      expect(ctx.fillRect).toHaveBeenCalled();
      expect(ctx.drawImage).toHaveBeenCalledTimes(2);
      expect(ctx.fillText).toHaveBeenCalledTimes(2);
      // Check if text '1' and '2' were written
      expect(ctx.fillText).toHaveBeenNthCalledWith(1, '1', 30, expect.any(Number));
      expect(ctx.fillText).toHaveBeenNthCalledWith(2, '2', 30, expect.any(Number));
    });

    it('falls back to single image directly without label drawing when isHybridRegions is false and single image is provided', async () => {
      const croppedImages = ['single_image_base64'];
      const result = await combineCroppedRegions(croppedImages, {
        format: 'jpeg',
        quality: 0.92,
        isHybridRegions: false,
      });

      expect(result.base64).toBe('single_image_base64');
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]?.index).toBe(0);
    });

    it('forces label drawing even for single image when isHybridRegions is true', async () => {
      const croppedImages = ['single_image_base64'];
      const result = await combineCroppedRegions(croppedImages, {
        format: 'jpeg',
        quality: 0.92,
        isHybridRegions: true,
      });

      expect(result.base64).toBe('mocked_base64');
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]?.index).toBe(0);

      const ctx = HTMLCanvasElement.prototype.getContext('2d')!;
      expect(ctx.fillText).toHaveBeenCalledTimes(1);
      expect(ctx.fillText).toHaveBeenNthCalledWith(1, '1', 30, expect.any(Number));
    });

    // --- new edge cases ---

    it('throws when given an empty array', async () => {
      await expect(combineCroppedRegions([])).rejects.toThrow('No images to combine');
    });

    it('throws when all images fail to load', async () => {
      // Override Image to always trigger onerror
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';

        set src(_val: string) {
          setTimeout(() => this.onerror?.(), 0);
        }
        get src() {
          return '';
        }
      } as any;

      await expect(combineCroppedRegions(['bad1', 'bad2'])).rejects.toThrow(
        'No images to combine',
      );
    });

    it('tolerates partial load failures and combines only successfully loaded images', async () => {
      // Allow 2 out of 3 images to load
      let callCount = 0;
      globalThis.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        width = 100;
        height = 200;

        set src(_val: string) {
          callCount++;
          const currentCall = callCount;
          setTimeout(() => {
            if (currentCall === 2) {
              // Second image fails
              this.onerror?.();
            } else {
              this.onload?.();
            }
          }, 0);
        }
        get src() {
          return '';
        }
      } as any;

      const result = await combineCroppedRegions(['ok1', 'fail', 'ok3'], {
        format: 'jpeg',
        quality: 0.92,
        isHybridRegions: false,
      });

      // 2 out of 3 loaded → 2 images combined in the filtered array
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]?.index).toBe(0);
      // The failed image (original index 1) is skipped; the third image
      // becomes the second element in the filtered images array → segment.index = 1
      expect(result.segments[1]?.index).toBe(1);
    });

    it('combines multiple images without index labels when isHybridRegions is false', async () => {
      const result = await combineCroppedRegions(['img1', 'img2'], {
        format: 'jpeg',
        quality: 0.92,
        isHybridRegions: false,
      });

      expect(result.segments).toHaveLength(2);
      // No label column, so width should just be maxImgWidth (100px)
      expect(result.width).toBe(100);

      const ctx = HTMLCanvasElement.prototype.getContext('2d')!;
      // No fillText calls expected since labels are disabled
      expect(ctx.fillText).not.toHaveBeenCalled();
    });

    it('uses roundRect when available, falls back to rect when not', async () => {
      const ctx = HTMLCanvasElement.prototype.getContext('2d')!;

      // roundRect IS available by default in our mock
      const resultWithRoundRect = await combineCroppedRegions(['img1'], {
        isHybridRegions: true,
      });
      expect(resultWithRoundRect.base64).toBe('mocked_base64');
      expect(ctx.roundRect).toHaveBeenCalled();

      // Now remove roundRect to trigger the rect fallback
      vi.clearAllMocks();
      const ctxWithoutRoundRect = {
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        // roundRect intentionally omitted
        rect: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        drawImage: vi.fn(),
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        ctxWithoutRoundRect as any,
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
        'data:image/jpeg;base64,mocked_fallback',
      );

      const resultFallback = await combineCroppedRegions(['img1'], {
        isHybridRegions: true,
      });
      expect(resultFallback.base64).toBe('mocked_fallback');
      expect(ctxWithoutRoundRect.rect).toHaveBeenCalled();

      // Verify roundRect was NOT called
      expect(ctxWithoutRoundRect).not.toHaveProperty('roundRect');
    });
  });
});
