/**
 * Renderer Overlay Integration Tests
 *
 * Tests the OverlayRenderer with realistic scenarios:
 * - Multiple text areas rendering
 * - Collision detection and resolution
 * - Font size calculation
 * - Text wrapping
 * - Overlay lifecycle (create, update, remove)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  calculateFontSize,
  OverlayRenderer,
  type OverlayStyle,
} from './renderer';
import type { TextArea } from '@/providers/base';

describe('OverlayRenderer Integration', () => {
  let renderer: OverlayRenderer;
  let container: HTMLDivElement;

  const createMockImage = (
    id: string,
    width: number,
    height: number
  ): HTMLImageElement => {
    const img = document.createElement('img');
    img.id = id;
    img.src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    Object.defineProperty(img, 'offsetWidth', {
      value: width,
      configurable: true,
    });
    Object.defineProperty(img, 'offsetHeight', {
      value: height,
      configurable: true,
    });
    Object.defineProperty(img, 'naturalWidth', {
      value: width,
      configurable: true,
    });
    Object.defineProperty(img, 'naturalHeight', {
      value: height,
      configurable: true,
    });
    return img;
  };

  beforeEach(() => {
    // Create a clean DOM environment
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);

    renderer = new OverlayRenderer();
  });

  afterEach(() => {
    renderer.removeAll();
    container.remove();
  });

  describe('Basic Rendering', () => {
    it('renders single text area overlay', () => {
      const img = createMockImage('test-img-1', 720, 1000);
      container.appendChild(img);

      const textAreas: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.1,
          originalText: 'Hello',
          translatedText: '你好',
        },
      ];

      const wrapper = renderer.render(img, textAreas, false);

      expect(wrapper).toBeTruthy();
      expect(wrapper.className).toContain('manga-translator-wrapper');
      expect(renderer.hasOverlays(img)).toBe(true);
      expect(renderer.getOverlayCount()).toBe(1);
    });

    it('renders multiple text area overlays', () => {
      const img = createMockImage('test-img-2', 720, 1000);
      container.appendChild(img);

      const textAreas: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.1,
          originalText: 'Hello',
          translatedText: '你好',
        },
        {
          x: 0.5,
          y: 0.3,
          width: 0.2,
          height: 0.1,
          originalText: 'World',
          translatedText: '世界',
        },
        {
          x: 0.2,
          y: 0.5,
          width: 0.4,
          height: 0.15,
          originalText: 'Test',
          translatedText: '测试',
        },
      ];

      renderer.render(img, textAreas, false);

      expect(renderer.getOverlayCount()).toBe(1); // One image
      const overlays = container.querySelectorAll('.manga-translator-overlay');
      expect(overlays.length).toBe(3);
    });

    it('replaces existing overlays when re-rendering', () => {
      const img = createMockImage('test-img-3', 720, 1000);
      container.appendChild(img);

      const textAreas1: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.1,
          originalText: 'A',
          translatedText: '甲',
        },
      ];
      const textAreas2: TextArea[] = [
        {
          x: 0.2,
          y: 0.2,
          width: 0.4,
          height: 0.15,
          originalText: 'B',
          translatedText: '乙',
        },
        {
          x: 0.3,
          y: 0.3,
          width: 0.3,
          height: 0.1,
          originalText: 'C',
          translatedText: '丙',
        },
      ];

      renderer.render(img, textAreas1, false);
      expect(renderer.getOverlayCount()).toBe(1);

      renderer.render(img, textAreas2, false);
      // Should still be 1 image, but with new overlays
      expect(renderer.getOverlayCount()).toBe(1);
      const overlays = container.querySelectorAll('.manga-translator-overlay');
      expect(overlays.length).toBe(2);
    });
  });

  describe('Auto-pin Mode', () => {
    it('renders with auto-pin enabled', () => {
      const img = createMockImage('test-img-4', 720, 1000);
      container.appendChild(img);

      const textAreas: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.1,
          originalText: 'Hello',
          translatedText: '你好',
        },
      ];

      const wrapper = renderer.render(img, textAreas, true);

      expect(wrapper.classList.contains('manga-translator-pinned')).toBe(true);
    });

    it('auto-pin shows translation without hover', () => {
      const img = createMockImage('test-img-5', 720, 1000);
      container.appendChild(img);

      const textAreas: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.1,
          originalText: 'Hello',
          translatedText: '你好',
        },
      ];

      renderer.render(img, textAreas, true);

      const _overlay = container.querySelector('.manga-translator-overlay');
      const overlayContainer = container.querySelector(
        '.manga-translator-overlay-container'
      ) as HTMLElement;
      const wrapper = container.querySelector(
        '.manga-translator-wrapper'
      ) as HTMLElement;

      // Auto-pinned means overlay container should be visible (opacity: 1)
      // Check via computed styles or wrapper class
      expect(
        overlayContainer.style.opacity !== '0' ||
          wrapper.classList.contains('manga-translator-pinned')
      ).toBeTruthy();
    });
  });

  describe('Overlay Removal', () => {
    it('removes overlay from specific image', () => {
      const img = createMockImage('test-img-6', 720, 1000);
      container.appendChild(img);

      const textAreas: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.1,
          originalText: 'Hello',
          translatedText: '你好',
        },
      ];

      renderer.render(img, textAreas, false);
      expect(renderer.hasOverlays(img)).toBe(true);

      renderer.remove(img);
      expect(renderer.hasOverlays(img)).toBe(false);
      expect(renderer.getOverlayCount()).toBe(0);
    });

    it('removes all overlays', () => {
      const img1 = createMockImage('test-img-7', 720, 1000);
      const img2 = createMockImage('test-img-8', 720, 1000);
      container.appendChild(img1);
      container.appendChild(img2);

      renderer.render(
        img1,
        [
          {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.1,
            originalText: 'A',
            translatedText: '甲',
          },
        ],
        false
      );
      renderer.render(
        img2,
        [
          {
            x: 0.2,
            y: 0.2,
            width: 0.3,
            height: 0.1,
            originalText: 'B',
            translatedText: '乙',
          },
        ],
        false
      );

      expect(renderer.getOverlayCount()).toBe(2);

      renderer.removeAll();

      expect(renderer.getOverlayCount()).toBe(0);
    });

    it('restores original image after removal', () => {
      const img = createMockImage('test-img-9', 720, 1000);
      container.appendChild(img);
      const parent = img.parentElement;

      renderer.render(
        img,
        [
          {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.1,
            originalText: 'A',
            translatedText: '甲',
          },
        ],
        false
      );

      renderer.remove(img);

      // Image should be back in container
      expect(img.parentElement).toBe(parent);
      expect(container.contains(img)).toBe(true);
    });
  });

  describe('Loading Overlay', () => {
    it('shows loading overlay', () => {
      const img = createMockImage('test-img-10', 720, 1000);
      container.appendChild(img);

      renderer.renderLoading(img);

      const loading = container.querySelector('.manga-translator-loading');
      expect(loading).toBeTruthy();
    });

    it('removes loading overlay', () => {
      const img = createMockImage('test-img-11', 720, 1000);
      container.appendChild(img);

      renderer.renderLoading(img);
      expect(container.querySelector('.manga-translator-loading')).toBeTruthy();

      renderer.removeLoading(img);
      expect(container.querySelector('.manga-translator-loading')).toBeFalsy();
    });
  });

  describe('Control Buttons', () => {
    it('renders control buttons', () => {
      const img = createMockImage('test-img-12', 720, 1000);
      container.appendChild(img);

      renderer.render(
        img,
        [
          {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.1,
            originalText: 'A',
            translatedText: '甲',
          },
        ],
        false
      );

      const controls = container.querySelector('.manga-translator-controls');
      expect(controls).toBeTruthy();

      const buttons = controls?.querySelectorAll('button');
      expect(buttons?.length).toBe(2); // Toggle and Close
    });
  });

  describe('Style Configuration', () => {
    it('applies custom style', () => {
      const customRenderer = new OverlayRenderer({
        backgroundColor: 'rgba(255, 255, 0, 0.8)',
        textColor: '#ff0000',
        fontFamily: 'Arial',
        minFontSize: 12,
        maxFontSize: 24,
      });

      const img = createMockImage('test-img-13', 720, 1000);
      container.appendChild(img);

      customRenderer.render(
        img,
        [
          {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.1,
            originalText: 'A',
            translatedText: '甲',
          },
        ],
        false
      );

      const overlay = container.querySelector(
        '.manga-translator-overlay'
      ) as HTMLElement;
      expect(overlay.style.backgroundColor).toContain('255, 255, 0');
      expect(overlay.style.color).toBe('rgb(255, 0, 0)');

      customRenderer.removeAll();
    });

    it('updates style dynamically', () => {
      renderer.render(
        createMockImage('test-img-14', 720, 1000),
        [
          {
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.1,
            originalText: 'A',
            translatedText: '甲',
          },
        ],
        false
      );

      const initialStyle = renderer.getStyle();
      expect(initialStyle.backgroundColor).toBe('rgba(240, 240, 235, 0.94)');

      renderer.updateStyle({ backgroundColor: 'rgba(0, 0, 0, 0.5)' });
      const updatedStyle = renderer.getStyle();
      expect(updatedStyle.backgroundColor).toBe('rgba(0, 0, 0, 0.5)');
    });
  });

  describe('Text Area Layout', () => {
    it('handles empty text areas array', () => {
      const img = createMockImage('test-img-15', 720, 1000);
      container.appendChild(img);

      const wrapper = renderer.render(img, [], false);

      // Should return the parent element
      expect(wrapper).toBeTruthy();
      expect(renderer.getOverlayCount()).toBe(0);
    });

    it('renders text with special characters', () => {
      const img = createMockImage('test-img-16', 720, 1000);
      container.appendChild(img);

      const textAreas: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.4,
          height: 0.15,
          originalText: 'Special: !@#$%^&*()',
          translatedText: '特殊字符：！@#￥%……&*（）',
        },
      ];

      renderer.render(img, textAreas, true);

      const overlay = container.querySelector(
        '.manga-translator-overlay'
      ) as HTMLElement;
      expect(overlay.textContent).toContain('特殊字符');
    });

    it('handles multiline text', () => {
      const img = createMockImage('test-img-17', 720, 1000);
      container.appendChild(img);

      const textAreas: TextArea[] = [
        {
          x: 0.1,
          y: 0.1,
          width: 0.5,
          height: 0.2,
          originalText: 'Line1\nLine2\nLine3',
          translatedText: '第一行\n第二行\n第三行',
        },
      ];

      renderer.render(img, textAreas, true);

      const overlay = container.querySelector(
        '.manga-translator-overlay'
      ) as HTMLElement;
      expect(overlay.textContent).toContain('\n');
    });
  });
});

describe('Overlay Collision Resolution', () => {
  let renderer: OverlayRenderer;
  let container: HTMLDivElement;

  const createMockImage = (
    id: string,
    width: number,
    height: number
  ): HTMLImageElement => {
    const img = document.createElement('img');
    img.id = id;
    img.src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    Object.defineProperty(img, 'offsetWidth', {
      value: width,
      configurable: true,
    });
    Object.defineProperty(img, 'offsetHeight', {
      value: height,
      configurable: true,
    });
    Object.defineProperty(img, 'naturalWidth', {
      value: width,
      configurable: true,
    });
    Object.defineProperty(img, 'naturalHeight', {
      value: height,
      configurable: true,
    });
    return img;
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    renderer = new OverlayRenderer();
  });

  afterEach(() => {
    renderer.removeAll();
    container.remove();
  });

  it('resolves overlapping text areas', () => {
    const img = createMockImage('collision-test', 720, 1000);
    container.appendChild(img);

    // Two overlapping text areas
    const textAreas: TextArea[] = [
      {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.2,
        originalText: 'A',
        translatedText: '甲',
      },
      {
        x: 0.25,
        y: 0.25,
        width: 0.3,
        height: 0.2,
        originalText: 'B',
        translatedText: '乙',
      }, // Overlaps with A
    ];

    renderer.render(img, textAreas, true);

    const overlays = container.querySelectorAll('.manga-translator-overlay');
    expect(overlays.length).toBe(2);

    // Get the top positions of both overlays
    const positions = Array.from(overlays).map(el =>
      parseFloat((el as HTMLElement).style.top || '0')
    );
    // They should have different top positions after collision resolution
    expect(positions[0]).not.toBe(positions[1]);
  });

  it('keeps non-overlapping text areas at original positions', () => {
    const img = createMockImage('no-collision-test', 720, 1000);
    container.appendChild(img);

    // Two non-overlapping text areas
    const textAreas: TextArea[] = [
      {
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.1,
        originalText: 'A',
        translatedText: '甲',
      },
      {
        x: 0.5,
        y: 0.5,
        width: 0.2,
        height: 0.1,
        originalText: 'B',
        translatedText: '乙',
      },
    ];

    renderer.render(img, textAreas, true);

    const overlays = Array.from(
      container.querySelectorAll<HTMLElement>('.manga-translator-overlay')
    );
    expect(overlays).toHaveLength(2);

    // The test name promises the areas stay put; counting them proved nothing
    // about placement. Each overlay is centred on its region's centre, so
    // assert that mapping holds and that neither box was nudged by collision
    // resolution.
    const centreOf = (overlay: HTMLElement): [number, number] => [
      parseFloat(overlay.style.left) + parseFloat(overlay.style.width) / 2,
      parseFloat(overlay.style.top) + parseFloat(overlay.style.height) / 2,
    ];

    const [first, second] = overlays as [HTMLElement, HTMLElement];
    const [cx1, cy1] = centreOf(first);
    const [cx2, cy2] = centreOf(second);

    // Area A spans x 0.1-0.3 and y 0.1-0.2; area B spans 0.5-0.7 / 0.5-0.6.
    expect(cx1).toBeCloseTo(0.2 * 720, 0);
    expect(cy1).toBeCloseTo(0.15 * 1000, 0);
    expect(cx2).toBeCloseTo(0.6 * 720, 0);
    expect(cy2).toBeCloseTo(0.55 * 1000, 0);
  });
});

describe('Font Size Calculation', () => {
  // This suite previously defined its own copy of `calculateFontSize` and
  // asserted against that, so deleting the production function entirely would
  // not have failed a single test. It now imports the real one.
  it('shrinks the font as the text grows for a fixed box', () => {
    const longText = '这是一个很长的中文字符串，需要使用较小的字体';
    const shortText = '短';

    const shortFontSize = calculateFontSize(200, 100, shortText);
    const longFontSize = calculateFontSize(200, 100, longText);

    expect(longFontSize).toBeLessThan(shortFontSize);
  });

  it('respects the configured min and max bounds', () => {
    const style: OverlayStyle = {
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      textColor: '#ffffff',
      fontFamily: 'sans-serif',
      borderRadius: 6,
      padding: 4,
      minFontSize: 12,
      maxFontSize: 18,
      verticalText: false,
    };
    // A one-character label in a huge box wants far more than the cap.
    expect(calculateFontSize(2000, 2000, '短', style)).toBe(18);
    // A wall of text in a tiny box wants less than the floor.
    expect(
      calculateFontSize(20, 20, '这是一个非常非常非常长的字符串', style)
    ).toBe(12);
  });

  it('weights full-width characters at twice the width of ASCII', () => {
    // The CJK-aware weighting is the whole point of the function: eight
    // full-width characters occupy the same run as sixteen ASCII ones. The box
    // is deliberately narrow and short so width binds and the max cap does not
    // flatten every result to the same number.
    const cjk = calculateFontSize(100, 100, '文字文字文字文字');
    const asciiEquivalent = calculateFontSize(100, 100, 'abcdefghijklmnop');
    const asciiShort = calculateFontSize(100, 100, 'ab');

    expect(cjk).toBe(asciiEquivalent);
    expect(cjk).toBeLessThan(asciiShort);
    // Unweighted, these would be identical; the 2x weighting is what separates
    // eight CJK characters from eight ASCII ones.
    const asciiSameCharCount = calculateFontSize(100, 100, 'abcdefgh');
    expect(cjk).toBeLessThan(asciiSameCharCount);
  });
});
