/**
 * The overlays are the one place a theme cannot be a CSS variable swap.
 *
 * The HUD, the reading panel, the anchor badges and the failure badges render
 * into shadow roots on somebody else's page, where the document's
 * `[data-theme]` rules do not reach. Their palette is written into each shadow
 * root as `--mt-*` properties instead, and `setTheme()` rewrites it.
 *
 * What this pins:
 * 1. Every overlay is painted at construction, with the default theme.
 * 2. `setTheme()` repaints all of them, and the palette actually changes —
 *    a dark theme has to reach a black card, not just flip an attribute.
 * 3. Repainting reuses one palette sheet. Appending a second one per switch
 *    would grow the shadow root for the life of the page.
 */
import { describe, expect, it } from 'vitest';

import { FloatingHud } from '@/content/floating-hud';
import { ReadingPanel } from '@/content/reading-panel';
import { ReadingAnchors } from '@/content/reading-anchors';
import { FailureBadges } from '@/content/failure-badges';
import { THEME_NAMES, THEME_PALETTES } from '@/shared/theme';

describe('overlays follow the theme', () => {
  it('paints every overlay with the default palette at construction', () => {
    document.body.innerHTML = '';
    const overlays = [
      new FloatingHud(),
      new ReadingPanel(),
      new ReadingAnchors(),
      new FailureBadges(),
    ];
    try {
      for (const overlay of overlays) {
        const shadow = (overlay as unknown as { shadow: ShadowRoot }).shadow;
        const sheet =
          shadow.querySelector('style[data-mt-theme]')?.textContent ?? '';
        expect(sheet).toContain(THEME_PALETTES.proof.paper);
        expect(sheet).toContain('color-scheme: light');
      }
    } finally {
      for (const overlay of overlays) {
        (overlay as unknown as { destroy: () => void }).destroy();
      }
    }
  });

  it('repaints every overlay when the theme changes', () => {
    document.body.innerHTML = '';
    const hud = new FloatingHud();
    const panel = new ReadingPanel();
    const anchors = new ReadingAnchors();
    const badges = new FailureBadges();
    const overlays = [hud, panel, anchors, badges];
    try {
      for (const overlay of overlays) {
        overlay.setTheme('panel');
      }
      for (const overlay of overlays) {
        const shadow = (overlay as unknown as { shadow: ShadowRoot }).shadow;
        const sheet =
          shadow.querySelector('style[data-mt-theme]')?.textContent ?? '';
        expect(sheet).toContain(THEME_PALETTES.panel.paper);
        expect(sheet).toContain('color-scheme: dark');
        // The old palette must be gone, not merely overridden: both sheets
        // would declare `--mt-paper`, and the winner would depend on order.
        expect(sheet).not.toContain(THEME_PALETTES.proof.paper);
      }
    } finally {
      hud.destroy();
      panel.destroy();
      anchors.destroy();
      badges.destroy();
    }
  });

  it('keeps exactly one palette sheet per shadow root', () => {
    // A switch happens on every theme change and the overlays live for the
    // life of the page; appending a sheet per switch would leak.
    document.body.innerHTML = '';
    const hud = new FloatingHud();
    try {
      for (const name of THEME_NAMES) {
        hud.setTheme(name);
      }
      const shadow = (hud as unknown as { shadow: ShadowRoot }).shadow;
      expect(shadow.querySelectorAll('style[data-mt-theme]').length).toBe(1);
    } finally {
      hud.destroy();
    }
  });

  it('gives every theme a distinct surface colour', () => {
    // If two themes emitted the same paper the switch would look like a no-op
    // on the card, which is the bug this whole path exists to avoid.
    const papers = THEME_NAMES.map(name => THEME_PALETTES[name].paper);
    expect(new Set(papers).size).toBe(THEME_NAMES.length);
  });
});
