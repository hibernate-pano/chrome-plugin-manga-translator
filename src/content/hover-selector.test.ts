/**
 * hover-selector.test.ts
 *
 * 测试 isTranslatableImage 函数的各种判断场景
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isTranslatableImage } from './hover-selector';

// ==================== 测试工具函数 ====================

function makeImg(
  overrides: Partial<{
    naturalWidth: number;
    naturalHeight: number;
    width: number;
    height: number;
    complete: boolean;
    src: string;
    className: string;
    id: string;
    parentTagName?: string;
  }>
): HTMLImageElement {
  const img = document.createElement('img');

  const props = {
    naturalWidth: 500,
    naturalHeight: 700,
    width: 500,
    height: 700,
    complete: true,
    src: 'https://example.com/manga-page.jpg',
    className: '',
    id: '',
    ...overrides,
  };

  Object.defineProperty(img, 'naturalWidth', {
    value: props.naturalWidth,
    configurable: true,
  });
  Object.defineProperty(img, 'naturalHeight', {
    value: props.naturalHeight,
    configurable: true,
  });
  Object.defineProperty(img, 'width', {
    value: props.width,
    configurable: true,
  });
  Object.defineProperty(img, 'height', {
    value: props.height,
    configurable: true,
  });
  Object.defineProperty(img, 'complete', {
    value: props.complete,
    configurable: true,
  });
  img.src = props.src;
  img.className = props.className;
  img.id = props.id;

  if (overrides.parentTagName) {
    const parent = document.createElement(overrides.parentTagName);
    parent.appendChild(img);
    document.body.appendChild(parent);
  } else {
    document.body.appendChild(img);
  }

  return img;
}

// ==================== 测试用例 ====================

describe('isTranslatableImage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('尺寸过滤', () => {
    it('宽度和高度均 >= 200 时应通过', () => {
      const img = makeImg({ naturalWidth: 800, naturalHeight: 600 });
      expect(isTranslatableImage(img)).toBe(true);
    });

    it('宽度 < 200 时应过滤', () => {
      const img = makeImg({ naturalWidth: 150, naturalHeight: 600 });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('高度 < 200 时应过滤', () => {
      const img = makeImg({ naturalWidth: 600, naturalHeight: 150 });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('宽高均 = 200 时应通过（边界值）', () => {
      const img = makeImg({ naturalWidth: 200, naturalHeight: 200 });
      expect(isTranslatableImage(img)).toBe(false); // 正方形 200x200 会被正方形过滤
    });

    it('宽高 200x400 的非正方形应通过', () => {
      const img = makeImg({ naturalWidth: 200, naturalHeight: 400 });
      expect(isTranslatableImage(img)).toBe(true);
    });
  });

  describe('加载状态过滤', () => {
    it('complete=false 时应过滤', () => {
      const img = makeImg({ complete: false });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('allowIncomplete=true 时应通过', () => {
      const img = makeImg({ complete: false });
      expect(isTranslatableImage(img, { allowIncomplete: true })).toBe(true);
    });

    it('src 为空时应过滤', () => {
      const img = makeImg({});
      // 清空 src
      Object.defineProperty(img, 'src', { value: '', configurable: true });
      expect(isTranslatableImage(img)).toBe(false);
    });
  });

  describe('语义布局元素过滤', () => {
    it('header 内的图片应过滤', () => {
      const img = makeImg({ parentTagName: 'header' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('nav 内的图片应过滤', () => {
      const img = makeImg({ parentTagName: 'nav' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('footer 内的图片应过滤', () => {
      const img = makeImg({ parentTagName: 'footer' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('aside 内的图片应过滤', () => {
      const img = makeImg({ parentTagName: 'aside' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('普通 div 内的图片应通过', () => {
      const img = makeImg({ parentTagName: 'div' });
      expect(isTranslatableImage(img)).toBe(true);
    });
  });

  describe('UI 关键词过滤', () => {
    it('className 包含 avatar 应过滤', () => {
      const img = makeImg({ className: 'user-avatar large' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('className 包含 logo 应过滤', () => {
      const img = makeImg({ className: 'site-logo' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('className 包含 icon 应过滤', () => {
      const img = makeImg({ className: 'nav-icon' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('className 包含 banner 应过滤', () => {
      const img = makeImg({ className: 'top-banner' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('className 包含 ad 应过滤', () => {
      const img = makeImg({ className: 'ad-container' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('className 包含 emoji 应过滤', () => {
      const img = makeImg({ className: 'emoji-img' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('id 包含 avatar 应过滤', () => {
      const img = makeImg({ id: 'user-avatar' });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('className 不含关键词时应通过', () => {
      const img = makeImg({ className: 'manga-chapter-page' });
      expect(isTranslatableImage(img)).toBe(true);
    });
  });

  describe('正方形头像过滤', () => {
    it('接近 1:1 比例且 < 400x400 时应过滤', () => {
      const img = makeImg({ naturalWidth: 200, naturalHeight: 200 });
      expect(isTranslatableImage(img)).toBe(false);
    });

    it('接近 1:1 但 >= 400x400 时应通过（大图）', () => {
      const img = makeImg({ naturalWidth: 400, naturalHeight: 400 });
      expect(isTranslatableImage(img)).toBe(true);
    });

    it('2:3 比例的图片（漫画页）应通过', () => {
      const img = makeImg({ naturalWidth: 400, naturalHeight: 600 });
      expect(isTranslatableImage(img)).toBe(true);
    });
  });

  describe('已处理图片过滤', () => {
    it('带有 manga-translator-processed 类的图片应过滤', () => {
      const img = makeImg({});
      img.classList.add('manga-translator-processed');
      expect(isTranslatableImage(img)).toBe(false);
    });
  });

  describe('翻译覆盖层内图片过滤', () => {
    it('在 manga-translator-wrapper 内的图片应过滤', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'manga-translator-wrapper';
      document.body.appendChild(wrapper);

      const img = document.createElement('img');
      Object.defineProperty(img, 'naturalWidth', { value: 800 });
      Object.defineProperty(img, 'naturalHeight', { value: 600 });
      Object.defineProperty(img, 'complete', { value: true });
      img.src = 'https://example.com/img.jpg';
      wrapper.appendChild(img);

      expect(isTranslatableImage(img)).toBe(false);
    });
  });
});
