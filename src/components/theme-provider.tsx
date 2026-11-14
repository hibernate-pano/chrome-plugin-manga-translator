import React, { useEffect, useState } from 'react';

/**
 * The extension renders exactly one theme: 校正紙 (proof sheet).
 *
 * The popup and options pages paint their own surfaces with the paper
 * utilities, and the shadcn primitives read the same semantic CSS variables.
 * There is no second theme: a `dark` class does not describe a design that
 * exists, and letting one through would repaint the body while the proof
 * sheet surfaces stayed paper — the half-black/half-white failure this
 * provider was originally written to prevent.
 *
 * The provider therefore resolves every request — stored, pinned or system —
 * to `light`, and `src/index.css` declares `color-scheme: light` to match.
 */
type Theme = 'light';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

/**
 * Resolve the stored preference into the theme that is actually rendered.
 *
 * The stored value can only narrow the theme, and there is only one theme.
 * A `dark` or `system` value left behind by an earlier version resolves to
 * the pinned default instead of repainting the page — the pinned default is
 * what the caller asked for, so it wins over whatever is in storage.
 */
export function resolveStoredTheme(saved: unknown, defaultTheme: Theme): Theme {
  if (saved === 'light') {
    return 'light';
  }
  return defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'light',
  storageKey = 'manga-translator-theme',
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    // 异步加载主题设置
    const loadTheme = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // storage.local, not storage.sync. The privacy policy states that
          // every preference is stored locally and never synced through the
          // user's Google account, and the background worker actively deletes
          // the legacy sync copy to honour that. Writing the theme to sync put
          // it straight back and contradicted the claim.
          const result = await chrome.storage.local.get([storageKey]);
          setTheme(resolveStoredTheme(result[storageKey], defaultTheme));
        } else {
          // 降级到localStorage
          setTheme(
            resolveStoredTheme(localStorage.getItem(storageKey), defaultTheme)
          );
        }
      } catch (error) {
        console.error('Failed to load theme:', error);
        // 降级到localStorage
        setTheme(
          resolveStoredTheme(localStorage.getItem(storageKey), defaultTheme)
        );
      }
    };

    loadTheme();
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    const root = window.document.documentElement;

    // One theme. The class is the `darkMode: 'class'` marker that Tailwind
    // keys its variants off; a `dark` class left by an older build is removed
    // so it can never repaint the page.
    root.classList.remove('dark');
    root.classList.add('light');
  }, [theme]);

  // The theme is applied to the document element, not consumed from a
  // context: the popup and the options page are hard-coded paper surfaces
  // that follow the `light` class on <html>, so no component needs to read
  // the theme back.
  return <>{children}</>;
}
