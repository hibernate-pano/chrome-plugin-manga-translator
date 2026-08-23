/**
 * Integration test: anchor click → panel entry focus
 *
 * Regression guard for v1.0.0 audit. The 'reading-anchor-click' custom event
 * was originally listened for on `readingPanel.host`, but ReadingAnchors
 * dispatches it on `readingAnchors.host`. The two are separate Shadow DOM
 * roots, so the event never reached the panel listener. Anchor clicks were
 * silent.
 *
 * The fix: content.ts wires the listener on `readingAnchors.host`. This test
 * simulates the same wiring without involving content.ts (which is heavy
 * with translator + renderer + chrome.runtime mocks).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { ReadingPanel } from './reading-panel';
import { ReadingAnchors } from './reading-anchors';
import type { TextArea } from '@/providers/base';

function makeAreas(text: string): TextArea[] {
  return [
    {
      originalText: '原文',
      translatedText: text,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  ];
}

describe('Reading panel + anchors integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = function () {
        /* noop */
      };
    }
  });

  it('anchor click triggers panel entry focus (regression for v1.0 bug)', () => {
    const panel = new ReadingPanel();
    const anchors = new ReadingAnchors();

    // Wire the same way content.ts does: listener on readingAnchors.host.
    const anchorsHost = (anchors as unknown as { host: HTMLElement }).host;
    anchorsHost.addEventListener('reading-anchor-click', e => {
      const detail = (e as CustomEvent<{ index: number }>).detail;
      panel.focusEntryByIndex(detail.index);
    });

    // Set up an entry + anchor for image #1.
    const img = document.createElement('img');
    panel.upsert(img, makeAreas('你好'));
    anchors.upsert(img, 1);

    // Simulate the click on the anchor badge inside the anchors shadow DOM.
    const shadow = (anchors as unknown as { shadow: ShadowRoot }).shadow;
    const badge = shadow.querySelector<HTMLElement>('.badge');
    expect(badge).toBeTruthy();
    badge?.click();

    // The entry in the panel should now have the 'flash' class.
    const panelShadow = (panel as unknown as { shadow: ShadowRoot }).shadow;
    const entry = panelShadow.querySelector<HTMLElement>('.entry');
    expect(entry?.classList.contains('flash')).toBe(true);

    panel.destroy();
    anchors.destroy();
  });
});
