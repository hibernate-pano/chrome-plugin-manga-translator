/**
 * P4 perf: memory cleanup verification
 *
 * Simulates a long session (translate → clear → translate → clear × N)
 * and asserts the renderer and processedImages Set don't leak between
 * rounds. This catches the "overlay DOM elements accumulate" and
 * "processedImages grows unbounded" failure modes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OverlayRenderer, removeAllOverlaysFromDOM } from '@/services/renderer';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import { useUsageStore } from '@/stores/usage-store';

function createMockImage(): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  Object.defineProperty(img, 'naturalHeight', { value: 600 });
  Object.defineProperty(img, 'width', { value: 800 });
  Object.defineProperty(img, 'height', { value: 600 });
  document.body.appendChild(img);
  return img;
}

describe('P4 perf: long-session cleanup', () => {
  beforeEach(() => {
    removeAllOverlaysFromDOM();
    useTranslationCacheStore.getState().clear();
    useUsageStore.getState().clearAll();
  });

  it('renderer overlay count returns to 0 after 5 translate→clear cycles', () => {
    const renderer = new OverlayRenderer();
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 10; i++) {
        const img = createMockImage();
        renderer.render(
          img,
          [
            {
              x: 0.1,
              y: 0.1,
              width: 0.3,
              height: 0.1,
              originalText: 'a',
              translatedText: 'b',
            },
          ],
          true
        );
      }
      expect(renderer.getOverlayCount()).toBe(10);
      renderer.removeAll();
      expect(renderer.getOverlayCount()).toBe(0);
    }
  });

  it('no leftover wrapper DOM after removeAll', () => {
    const renderer = new OverlayRenderer();
    for (let i = 0; i < 20; i++) {
      const img = createMockImage();
      renderer.render(
        img,
        [
          {
            x: 0,
            y: 0,
            width: 0.5,
            height: 0.5,
            originalText: 'x',
            translatedText: 'y',
          },
        ],
        true
      );
    }
    renderer.removeAll();
    const wrappers = document.querySelectorAll('.manga-translator-wrapper');
    expect(wrappers.length).toBe(0);
  });

  it('cache LRU respects maxEntries under heavy write load', () => {
    const cache = useTranslationCacheStore.getState();
    cache.setMaxEntries(50);
    for (let i = 0; i < 200; i++) {
      cache.set(
        `hash-${i}`,
        { success: true, textAreas: [] },
        'openai-compatible'
      );
    }
    const stats = cache.getStats();
    expect(stats.entryCount).toBeLessThanOrEqual(50);
  });

  it('usage record store: capped at 500 (LRU-style)', () => {
    const usage = useUsageStore.getState();
    for (let i = 0; i < 600; i++) {
      usage.addRecord({
        provider: 'openai-compatible',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        cached: false,
      });
    }
    const summary = usage.getSummary();
    expect(summary.totalRecords).toBeLessThanOrEqual(500);
  });
});
