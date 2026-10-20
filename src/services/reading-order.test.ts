import { describe, expect, it } from 'vitest';
import {
  compareImagesByDocumentOrder,
  sortTextAreasByReadingOrder,
} from './reading-order';
import type { TextArea } from '@/providers/base';

function area(
  x: number,
  y: number,
  label: string,
  width = 0.1,
  height = 0.1
): TextArea {
  return {
    x,
    y,
    width,
    height,
    originalText: label,
    translatedText: label,
  };
}

describe('compareImagesByDocumentOrder', () => {
  it('puts the earlier image first', () => {
    document.body.innerHTML = '<img id="a" /><img id="b" />';
    const first = document.querySelector<HTMLImageElement>('#a');
    const second = document.querySelector<HTMLImageElement>('#b');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;

    expect(compareImagesByDocumentOrder(first, second)).toBeLessThan(0);
    expect(compareImagesByDocumentOrder(second, first)).toBeGreaterThan(0);
  });

  it('treats an image as equal to itself', () => {
    document.body.innerHTML = '<img id="a" />';
    const only = document.querySelector<HTMLImageElement>('#a');

    expect(only).not.toBeNull();
    if (!only) return;

    expect(compareImagesByDocumentOrder(only, only)).toBe(0);
  });

  it('keeps the existing order for images it cannot compare', () => {
    document.body.innerHTML = '<img id="a" />';
    const attached = document.querySelector<HTMLImageElement>('#a');
    const detached = document.createElement('img');

    expect(attached).not.toBeNull();
    if (!attached) return;

    expect(compareImagesByDocumentOrder(attached, detached)).toBe(0);
    expect(compareImagesByDocumentOrder(detached, attached)).toBe(0);
  });
});

describe('sortTextAreasByReadingOrder', () => {
  it('reads horizontal text top to bottom, left to right', () => {
    const sorted = sortTextAreasByReadingOrder([
      area(0.6, 0.5, 'right-middle'),
      area(0.1, 0.5, 'left-middle'),
      area(0.3, 0.1, 'top'),
      area(0.3, 0.9, 'bottom'),
    ]);

    expect(sorted.map(item => item.originalText)).toEqual([
      'top',
      'left-middle',
      'right-middle',
      'bottom',
    ]);
  });

  it('reads vertical text right to left, top to bottom', () => {
    const sorted = sortTextAreasByReadingOrder(
      [
        area(0.1, 0.2, 'left-column'),
        area(0.7, 0.2, 'right-column'),
        area(0.7, 0.8, 'right-column-lower'),
      ],
      true
    );

    expect(sorted.map(item => item.originalText)).toEqual([
      'right-column',
      'right-column-lower',
      'left-column',
    ]);
  });

  it('keeps bubbles that share a row in left-to-right order', () => {
    // The second bubble sits slightly lower, but it is still the same row:
    // a reader reads the left one first.
    const sorted = sortTextAreasByReadingOrder([
      area(0.7, 0.4, 'right'),
      area(0.1, 0.395, 'left'),
    ]);

    expect(sorted.map(item => item.originalText)).toEqual(['left', 'right']);
  });

  it('keeps bubbles in the same column in top-to-bottom order', () => {
    const sorted = sortTextAreasByReadingOrder(
      [area(0.7, 0.8, 'lower'), area(0.7, 0.2, 'upper')],
      true
    );

    expect(sorted.map(item => item.originalText)).toEqual(['upper', 'lower']);
  });

  it('does not mutate the array it is given', () => {
    const areas = [area(0.6, 0.5, 'right'), area(0.1, 0.1, 'top')];
    const originalOrder = areas.map(item => item.originalText);

    sortTextAreasByReadingOrder(areas);

    expect(areas.map(item => item.originalText)).toEqual(originalOrder);
  });

  it('returns an empty list unchanged', () => {
    expect(sortTextAreasByReadingOrder([])).toEqual([]);
  });
});
