/**
 * The theme, delivered to a shadow root.
 *
 * The HUD, the reading panel, the failure badges, the export dialog and the
 * confirm dialog all render into shadow roots on somebody else's page. A
 * shadow root inherits no custom properties from the document, so the chosen
 * theme cannot simply be "the CSS variables on <html>" — the palette has to be
 * written into each sheet.
 *
 * This module is the one place that does it. Each overlay keeps a
 * `<style data-mt-theme>` element as the first child of its shadow root;
 * `applyOverlayTheme()` fills it from `overlayThemeCss()`, and calling it
 * again after the reader switches theme repaints every overlay in place
 * without rebuilding the DOM (which would lose scroll position, focus, and
 * the entries the panel is showing).
 */
import { DEFAULT_THEME, overlayThemeCss, type ThemeName } from '@/shared/theme';

const THEME_STYLE_ATTRIBUTE = 'data-mt-theme';

/** The storage key the theme is persisted under. */
export const THEME_STORAGE_KEY = 'manga-translator-theme';

/**
 * Write the theme into a shadow root.
 *
 * The element is created on first call and reused after that, so a theme
 * change is one `textContent` assignment rather than a re-render.
 */
export function applyOverlayTheme(shadow: ShadowRoot, theme: ThemeName): void {
  let style = shadow.querySelector<HTMLStyleElement>(
    `style[${THEME_STYLE_ATTRIBUTE}]`
  );
  if (!style) {
    style = document.createElement('style');
    style.setAttribute(THEME_STYLE_ATTRIBUTE, '');
    // First child: the palette has to be declared before the rules that read
    // it. Later rules win on equal specificity, and a stylesheet that uses a
    // variable before its declaration still resolves, but keeping the order
    // honest makes the sheet readable.
    shadow.prepend(style);
  }
  style.textContent = overlayThemeCss(theme);
}

/**
 * Read the theme the reader chose.
 *
 * Falls back to the default rather than to an unstyled overlay: a content
 * script that cannot read storage should still draw a legible card.
 */
export async function readStoredTheme(): Promise<ThemeName> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return DEFAULT_THEME;
    }
    const result = await chrome.storage.local.get([THEME_STORAGE_KEY]);
    const value = result[THEME_STORAGE_KEY];
    return typeof value === 'string' ? (value as ThemeName) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
