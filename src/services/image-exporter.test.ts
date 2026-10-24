import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  buildDefaultFilename,
  canvasToBlob,
  composeTranslatedImage,
  decodeImageBlob,
  displayScale,
  exportTranslatedImage,
  fetchImageBytesForExport,
  sanitizeFilename,
} from './image-exporter';
import {
  computeAdaptiveOverlayLayout,
  type OverlayStyle,
  type TextMeasurer,
} from '@/services/renderer';
import type { TextArea } from '@/providers/base';

/**
 * 一份和页面上一样的覆盖层样式。
 */
const STYLE: OverlayStyle = {
  backgroundColor: 'rgb(240, 240, 235)',
  textColor: '#111111',
  fontFamily: '"PingFang SC", sans-serif',
  borderRadius: 6,
  padding: 7,
  minFontSize: 10,
  maxFontSize: 22,
  verticalText: false,
};

/**
 * 量文字：每个字 10px 宽。
 *
 * 和测试环境里 canvas 的桩一致，所以排版结果是确定的。
 */
const measure: TextMeasurer = text => text.length * 10;

interface FakeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FakeContext {
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  measureText: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  roundRect: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  /** 填过色的盒子（气泡的底板）。 */
  filledBoxes: FakeBox[];
  /** 裁过的盒子（文字被裁在气泡里）。 */
  clippedBoxes: FakeBox[];
  /** 画过的字，连同它落在画布上的位置和转过的角度。 */
  drawnText: Array<{ text: string; x: number; y: number; angle: number }>;
}

function createFakeContext(): FakeContext {
  const context: FakeContext = {
    font: '',
    fillStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    filledBoxes: [],
    clippedBoxes: [],
    drawnText: [],
  };

  /*
   * 记下画布的变换：竖排里有一段拉丁文是被转 90° 画上去的，光看
   * fillText 的参数看不出它落在哪里。
   */
  let transform = { x: 0, y: 0, angle: 0 };
  const stack: Array<{ x: number; y: number; angle: number }> = [];
  context.save = vi.fn(() => {
    stack.push({ ...transform });
  });
  context.restore = vi.fn(() => {
    transform = stack.pop() ?? { x: 0, y: 0, angle: 0 };
  });
  context.translate = vi.fn((x: number, y: number) => {
    transform = { ...transform, x: transform.x + x, y: transform.y + y };
  });
  context.rotate = vi.fn((angle: number) => {
    transform = { ...transform, angle: transform.angle + angle };
  });
  context.fillText = vi.fn((text: string, x: number, y: number) => {
    context.drawnText.push({
      text,
      x: transform.x + x,
      y: transform.y + y,
      angle: transform.angle,
    });
  });

  // 画布的路径是"记下形状 → 填/裁"。这里照着记一遍，测试才能知道哪个
  // 形状被填了色、哪个被裁了。
  let pending: FakeBox | null = null;
  context.roundRect = vi.fn(
    (left: number, top: number, width: number, height: number) => {
      pending = { left, top, width, height };
    }
  );
  context.fill = vi.fn(() => {
    if (pending) {
      context.filledBoxes.push(pending);
    }
  });
  context.clip = vi.fn(() => {
    if (pending) {
      context.clippedBoxes.push(pending);
    }
  });

  return context;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

function installCanvas(context: FakeContext): void {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => context),
  });
}

function makeImage(src = 'https://cdn.example.com/page.jpg'): HTMLImageElement {
  const image = document.createElement('img');
  image.src = src;
  document.body.appendChild(image);
  return image;
}

describe('image-exporter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:mock'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: originalGetContext,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: originalToBlob,
    });
    vi.unstubAllGlobals();
  });

  describe('displayScale', () => {
    it('is the ratio between the source pixels and the pixels on screen', () => {
      const image = makeImage();
      Object.defineProperty(image, 'offsetWidth', {
        configurable: true,
        value: 400,
      });

      // 1600px of artwork shown in a 400px column: the page laid the text out
      // at a quarter of the scale the canvas draws it at.
      expect(displayScale(image, 1600)).toBe(4);
    });

    it('is 1 when the image has no layout size', () => {
      const image = makeImage();
      Object.defineProperty(image, 'offsetWidth', {
        configurable: true,
        value: 0,
      });

      // Not on screen yet (or hidden): the page falls back to naturalWidth
      // too, so both sides use the same reference.
      expect(displayScale(image, 1600)).toBe(1);
    });
  });

  describe('composeTranslatedImage', () => {
    it('draws the artwork at full resolution and the translation on top of it', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };

      const canvas = composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
        measure,
      });

      // 画布是原图的像素尺寸，不是页面上显示的尺寸。
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
      expect(context.drawImage).toHaveBeenCalledTimes(1);

      // 字落在和页面上同一个排版算出来的位置上：气泡正中，不是左上角
      // （页面用的是 `align-items/justify-content: center` + `text-align:
      // center`）。
      const layout = computeAdaptiveOverlayLayout(
        area,
        800,
        600,
        STYLE,
        measure
      );
      const lineHeight = layout.fontSize * 1.3;
      // 页面把文字块在内容框里垂直居中（flex 的 `align-items: center`），
      // 行高比字大的那点叫半行距，浏览器分一半放在字的上面。
      const contentHeight = Math.max(layout.height - STYLE.padding * 2, 0);
      const expectedY =
        layout.top +
        STYLE.padding +
        (contentHeight - lineHeight) / 2 +
        (lineHeight - layout.fontSize) / 2;
      expect(context.fillText).toHaveBeenCalledWith(
        '你好，世界',
        layout.left + layout.width / 2,
        expectedY
      );
      // 底板画过一次：字必须落在自己的底板上。
      expect(context.fill).toHaveBeenCalledTimes(1);
      expect(context.roundRect).toHaveBeenCalledWith(
        layout.left,
        layout.top,
        layout.width,
        layout.height,
        STYLE.borderRadius
      );
    });

    it('lays the text out at the size the reader saw, not at the raw pixel size', () => {
      // The page lays the bubbles out against the image's *displayed* size;
      // the canvas is the image's *natural* size. Font size, padding and
      // radius are absolute CSS pixels, so a 1600px image shown at 400px
      // used to export its translation at a quarter of the size the reader
      // had just been looking at.
      const context = createFakeContext();
      installCanvas(context);

      // 记下每一次被设置的字号：合成结束时会恢复原值。
      const fonts: string[] = [];
      let currentFont = '';
      Object.defineProperty(context, 'font', {
        configurable: true,
        get: () => currentFont,
        set: (value: string) => {
          currentFont = value;
          fonts.push(value);
        },
      });

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.6,
        height: 0.3,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 1600,
        height: 1200,
        textAreas: [area],
        style: STYLE,
        measure,
        scale: 4,
      });

      // 页面按显示尺寸（400×300）排版，导出把这套版式整体放大 4 倍。
      // 之前是在原图尺寸上重新排一遍：字号的候选值是整数，重新排落在不同的
      // 刻度上，气泡就会比屏幕上大一点或小一点——"保存我看到的译文"这句话
      // 就不成立了。
      const display = computeAdaptiveOverlayLayout(
        area,
        400,
        300,
        STYLE,
        measure
      );

      // The compositor restores the previous font when it is done, so the
      // only way to see what was drawn with is to watch the property.
      expect(
        fonts.some(value => value.includes(`${display.fontSize * 4}px`))
      ).toBe(true);
      expect(context.roundRect).toHaveBeenCalledWith(
        display.left * 4,
        display.top * 4,
        display.width * 4,
        display.height * 4,
        STYLE.borderRadius * 4
      );
    });

    it('measures and draws the text at the same weight', () => {
      const context = createFakeContext();
      installCanvas(context);

      const fonts: string[] = [];
      let currentFont = '';
      Object.defineProperty(context, 'font', {
        configurable: true,
        get: () => currentFont,
        set: (value: string) => {
          currentFont = value;
          fonts.push(value);
        },
      });

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };

      // 不传 measure：用导出自己那块画布量字，量字和画字走的才是同一条路。
      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
      });

      // 页面上的字是 500 字重。量字和画字必须用同一个字重：字重一变，同一
      // 句话的宽度就变，量出来的换行点就不是画出来的那几个。
      expect(fonts.length).toBeGreaterThan(0);
      for (const font of fonts) {
        expect(font.startsWith('500 ')).toBe(true);
      }
    });

    it('draws nothing at all for an empty translation', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '   ',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
        measure,
      });

      // 空的译文不是译文：盖上一个空盒子只会把画面和原文一起遮掉。
      expect(context.fillText).not.toHaveBeenCalled();
      expect(context.roundRect).not.toHaveBeenCalled();
      expect(context.fill).not.toHaveBeenCalled();
    });

    it('marks a translation that did not fit with an ellipsis', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0,
        y: 0,
        width: 0.1,
        height: 0.1,
        originalText: '長い',
        translatedText: '这是一段很长很长的译文，放不进这个小小的框子里',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 200,
        height: 200,
        textAreas: [area],
        style: STYLE,
        measure,
      });

      const layout = computeAdaptiveOverlayLayout(
        area,
        200,
        200,
        STYLE,
        measure
      );
      expect(layout.clipped).toBe(true);
      expect(context.fillText).toHaveBeenCalledWith(
        '…',
        layout.left + layout.width - 3,
        layout.top + layout.height - 1
      );
    });

    it('rotates a latin run in a vertical translation, the way the page does', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.3,
        originalText: 'こんにちは',
        translatedText: '你好 ok',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: { ...STYLE, verticalText: true },
        measure,
      });

      // 浏览器在竖排里把拉丁文整个转 90°（`text-orientation: mixed`），导出
      // 必须做同一件事：横着排的字和竖着排的字看起来是两回事。
      expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);

      const drawn = context.drawnText;
      const hao = drawn.find(call => call.text === '好');
      const latin = drawn.find(call => call.text === 'ok');
      expect(latin).toBeDefined();
      if (!hao || !latin) {
        throw new Error('expected the vertical run to be drawn');
      }

      // 拉丁文占的是它横着排出来的宽度（"ok" 两个字 = 20px），不是一个字一格。
      // 以前这里按每个字一格往下摆，一列被撑破气泡，读者在 PNG 里看到的比
      // 屏幕上少一大截。
      const layout = computeAdaptiveOverlayLayout(
        area,
        800,
        600,
        { ...STYLE, verticalText: true },
        measure
      );
      expect(latin.y - hao.y).toBe(2 * layout.fontSize);
      // 整段拉丁文是一个字形单元转 90° 画下去的。
      expect(latin.angle).toBe(Math.PI / 2);
    });

    it('stacks the characters of a vertical translation column by column', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.3,
        originalText: 'こんにちは',
        translatedText: '你好',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: { ...STYLE, verticalText: true },
        measure,
      });

      // 竖排是一个字一个字往下叠的，不是一整行。
      const drawn = context.fillText.mock.calls.map(call => call[0]);
      expect(drawn).toContain('你');
      expect(drawn).toContain('好');

      // 整组列在气泡里居中：页面的竖排文本层是 `width:auto` 被 flex 居中
      // 的，不是贴着右边缘排。以前导出从右边缘往左数，字比气泡窄时整组
      // 列会偏向右边。
      const layout = computeAdaptiveOverlayLayout(
        area,
        800,
        600,
        { ...STYLE, verticalText: true },
        measure
      );
      const xs = context.fillText.mock.calls
        .filter(call => call[0] === '你' || call[0] === '好')
        .map(call => call[1] as number);
      const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
      const thickness = layout.fontSize * 1.3;
      expect(Math.abs(mean - (layout.left + layout.width / 2))).toBeLessThan(
        thickness
      );
    });

    it('measures the text with the export canvas when no measurer is given', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
      });

      expect(context.measureText).toHaveBeenCalled();
      expect(context.fillText).toHaveBeenCalledWith(
        '你好，世界',
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('falls back to an estimate when the canvas cannot measure', () => {
      const context = createFakeContext();
      context.measureText = vi.fn(() => ({ width: Number.NaN }));
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
      });

      expect(context.fillText).toHaveBeenCalledWith(
        '你好，世界',
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('skips the blank line of a paragraph break', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '第一段\n\n第二段',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
        measure,
      });

      // 空行不用画，但行距要留着。
      expect(context.fillText).toHaveBeenCalledTimes(2);
    });

    it('pushes overlapping bubbles apart, the way the page does', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };
      const other: TextArea = { ...area, translatedText: '第二句台词' };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area, other],
        style: STYLE,
        measure,
      });

      const boxes = context.filledBoxes;
      expect(boxes).toHaveLength(2);

      // 屏幕上两个重叠的气泡会被推开；PNG 里如果还叠着，读者看到的就是
      // 两层字，而页面上只看到一层。
      const a = boxes[0];
      const b = boxes[1];
      if (!a || !b) {
        throw new Error('expected two bubbles');
      }
      const overlap =
        a.left < b.left + b.width &&
        a.left + a.width > b.left &&
        a.top < b.top + b.height &&
        a.top + a.height > b.top;
      expect(overlap).toBe(false);
    });

    it('keeps the text inside the bubble', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
        measure,
      });

      // 页面上气泡是 `overflow: hidden`，多出来的字会被裁掉。导出不裁的
      // 话，那行字会横在气泡外面、压在原图上——屏幕上根本没有它。
      expect(context.clippedBoxes).toHaveLength(1);
      expect(context.clippedBoxes[0]).toEqual({
        left: context.filledBoxes[0]?.left,
        top: context.filledBoxes[0]?.top,
        width: context.filledBoxes[0]?.width,
        height: context.filledBoxes[0]?.height,
      });
      expect(context.save).toHaveBeenCalled();
      expect(context.restore).toHaveBeenCalled();
    });

    it('breaks the lines the way the browser does', () => {
      const context = createFakeContext();
      installCanvas(context);

      const area: TextArea = {
        x: 0.05,
        y: 0.2,
        width: 0.1,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: 'the quick brown fox jumps over',
      };

      composeTranslatedImage({
        source: {} as CanvasImageSource,
        width: 800,
        height: 600,
        textAreas: [area],
        style: STYLE,
        measure,
      });

      // 气泡装不下这句话，气泡的宽度就由最长的那一行决定。估算器是逐字
      // 断行的（'the quick br' / 'own fox jump'），浏览器是按词断的
      // （'the quick' / 'brown fox'）。导出以前用的是估算器的那一套，于是
      // PNG 里的 "brown" 被劈成了两半。
      const drawn = context.fillText.mock.calls
        .map(call => call[0] as string)
        .filter(line => line !== '…');
      expect(drawn).toEqual(['the quick', 'brown fox', 'jumps over']);
    });

    it('fails when the canvas cannot be created', () => {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: vi.fn(() => null),
      });

      expect(() =>
        composeTranslatedImage({
          source: {} as CanvasImageSource,
          width: 800,
          height: 600,
          textAreas: [],
          style: STYLE,
          measure,
        })
      ).toThrow('无法创建画布');
    });

    it('refuses an image without pixels', () => {
      const context = createFakeContext();
      installCanvas(context);

      expect(() =>
        composeTranslatedImage({
          source: {} as CanvasImageSource,
          width: 0,
          height: 0,
          textAreas: [],
          style: STYLE,
          measure,
        })
      ).toThrow('图片尺寸无效');
    });
  });

  describe('fetchImageBytesForExport', () => {
    it('asks the worker for the bytes of the image', async () => {
      const sendMessage = vi
        .mocked(chrome.runtime.sendMessage)
        .mockImplementation(async () => ({
          success: true,
          imageBase64: btoa('hello'),
          mimeType: 'image/png',
        }));

      const blob = await fetchImageBytesForExport(
        'https://cdn.example.com/a.png'
      );

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'FETCH_IMAGE_BYTES',
        imageUrl: 'https://cdn.example.com/a.png',
      });
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBe(5);
    });

    it('surfaces the error when the worker refuses the image', async () => {
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(async () => ({
        success: false,
        error: 'Blocked image URL',
      }));

      await expect(
        fetchImageBytesForExport('http://127.0.0.1:9000/secret')
      ).rejects.toThrow('Blocked image URL');
    });

    it('surfaces an error when the worker answers without any bytes', async () => {
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(async () => ({
        success: true,
      }));

      await expect(
        fetchImageBytesForExport('https://cdn.example.com/a.png')
      ).rejects.toThrow('图片获取失败');
    });

    it('fails when there is no extension background to talk to', async () => {
      vi.stubGlobal('chrome', undefined);

      await expect(
        fetchImageBytesForExport('https://cdn.example.com/a.png')
      ).rejects.toThrow('无法连接扩展后台');
    });
  });

  describe('decodeImageBlob', () => {
    it('decodes through createImageBitmap so the canvas is not tainted', async () => {
      const bitmap = { width: 800, height: 600 };
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => bitmap)
      );

      const decoded = await decodeImageBlob(new Blob(['x']));

      expect(decoded.width).toBe(800);
      expect(decoded.height).toBe(600);
      expect(decoded.source).toBe(bitmap);
    });

    it('falls back to an <img> element when createImageBitmap is missing', async () => {
      vi.stubGlobal('createImageBitmap', undefined);

      const naturalWidth = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        'naturalWidth'
      );
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
        configurable: true,
        get: () => 800,
      });
      Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
        configurable: true,
        get: () => 600,
      });
      Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        value: vi.fn(async () => undefined),
      });

      try {
        const decoded = await decodeImageBlob(new Blob(['x']));
        expect(decoded.width).toBe(800);
        expect(decoded.height).toBe(600);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
      } finally {
        if (naturalWidth) {
          Object.defineProperty(
            HTMLImageElement.prototype,
            'naturalWidth',
            naturalWidth
          );
        }
        delete (
          HTMLImageElement.prototype as unknown as Record<string, unknown>
        )['naturalHeight'];
        delete (
          HTMLImageElement.prototype as unknown as Record<string, unknown>
        )['decode'];
      }
    });

    it('waits for the load event when the image cannot decode()', async () => {
      vi.stubGlobal('createImageBitmap', undefined);

      const srcDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        'src'
      );
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
        configurable: true,
        get: () => 640,
      });
      Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
        configurable: true,
        get: () => 480,
      });
      // 老浏览器没有 decode()：只能等 load 事件。
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        get(this: HTMLImageElement) {
          return this.getAttribute('src') ?? '';
        },
        set(this: HTMLImageElement, value: string) {
          this.setAttribute('src', value);
          setTimeout(() => this.dispatchEvent(new Event('load')), 0);
        },
      });

      try {
        const decoded = await decodeImageBlob(new Blob(['x']));
        expect(decoded.width).toBe(640);
        expect(decoded.height).toBe(480);
      } finally {
        if (srcDescriptor) {
          Object.defineProperty(
            HTMLImageElement.prototype,
            'src',
            srcDescriptor
          );
        }
        delete (
          HTMLImageElement.prototype as unknown as Record<string, unknown>
        )['naturalWidth'];
        delete (
          HTMLImageElement.prototype as unknown as Record<string, unknown>
        )['naturalHeight'];
      }
    });
  });

  describe('canvasToBlob', () => {
    it('rejects when the canvas cannot produce a blob', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
        callback => callback(null)
      );

      await expect(
        canvasToBlob(document.createElement('canvas'))
      ).rejects.toThrow('导出 PNG 失败');
    });

    it('rejects when the browser has no toBlob at all', async () => {
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'toBlob', {
        configurable: true,
        value: undefined,
      });

      await expect(canvasToBlob(canvas)).rejects.toThrow(
        '当前浏览器不支持导出 PNG'
      );
    });
  });

  describe('exportTranslatedImage', () => {
    it('exports the composed page as a PNG', async () => {
      const context = createFakeContext();
      installCanvas(context);

      const png = new Blob(['png-bytes'], { type: 'image/png' });
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
        callback => callback(png)
      );
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({ width: 800, height: 600 }))
      );
      const sendMessage = vi
        .mocked(chrome.runtime.sendMessage)
        .mockImplementation(async () => ({
          success: true,
          imageBase64: btoa('hello'),
          mimeType: 'image/png',
        }));

      const image = makeImage();
      const area: TextArea = {
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.15,
        originalText: 'こんにちは',
        translatedText: '你好，世界',
      };

      const result = await exportTranslatedImage({
        image,
        textAreas: [area],
        style: STYLE,
        measure,
      });

      expect(result).toBe(png);
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'FETCH_IMAGE_BYTES',
        imageUrl: 'https://cdn.example.com/page.jpg',
      });
      expect(context.fillText).toHaveBeenCalledWith(
        '你好，世界',
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('fails when the image has no address', async () => {
      const image = document.createElement('img');
      image.removeAttribute('src');

      await expect(
        exportTranslatedImage({ image, textAreas: [], style: STYLE })
      ).rejects.toThrow('找不到图片地址');
    });
  });

  describe('sanitizeFilename', () => {
    it('strips the characters no operating system accepts', () => {
      expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    });

    it('drops the trailing dots and spaces Windows would cut anyway', () => {
      expect(sanitizeFilename('  manga page.  ')).toBe('manga page');
    });

    it('keeps an ordinary name untouched', () => {
      expect(sanitizeFilename('manga-page-1.png')).toBe('manga-page-1.png');
    });

    it('returns an empty name when nothing survives', () => {
      expect(sanitizeFilename('///')).toBe('');
    });
  });

  describe('buildDefaultFilename', () => {
    it('names the file after the site and the page number', () => {
      expect(buildDefaultFilename('example.com', 3)).toBe(
        'manga-example.com-3.png'
      );
    });

    it('keeps the name usable when the site name has a port', () => {
      expect(buildDefaultFilename('localhost:8080', 1)).toBe(
        'manga-localhost8080-1.png'
      );
    });

    it('falls back to a generic site name', () => {
      expect(buildDefaultFilename('', 1)).toBe('manga-page-1.png');
    });
  });
});
