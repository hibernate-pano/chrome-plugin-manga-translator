import React, { useEffect, useState } from 'react';

/**
 * The extension renders exactly one theme: dark.
 *
 * The popup and options pages paint their own surfaces with hard-coded dark
 * utilities (`bg-slate-950`, `text-slate-100`) while the shadcn primitives
 * — the switch, the slider — read the semantic CSS variables. A `light`
 * class therefore repainted the page background and those primitives white
 * while every card stayed dark: a half-black/half-white page, with an
 * unchecked switch whose white knob sat on its own track and vanished.
 *
 * A light theme is not a rendering bug to be patched, it is a second design
 * that does not exist yet. Rather than ship the broken half of it, the
 * provider resolves every request — stored, pinned or system — to `dark`,
 * and `src/index.css` declares `color-scheme: dark` to match, so native
 * controls, scrollbars and the focus ring follow the same theme.
 */
type Theme = 'dark';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

/**
 * Resolve the stored preference into the theme that is actually rendered.
 *
 * The stored value can only narrow the theme, and there is only one theme.
 * A `light` or `system` value left behind by an earlier version resolves to
 * the pinned default instead of repainting the page — the pinned default is
 * what the caller asked for, so it wins over whatever is in storage.
 */
export function resolveStoredTheme(saved: unknown, defaultTheme: Theme): Theme {
  if (saved === 'dark') {
    return 'dark';
  }
  return defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
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
    // and any future `dark:` variant key off; a `light` class left by an
    // older build is removed so it can never repaint the page either.
    root.classList.remove('light');
    root.classList.add('dark');
  }, [theme]);

  // The theme is applied to the document element, not consumed from a
  // context: the popup and the options page are hard-coded dark surfaces
  // that follow the `dark` class on <html>, so no component needs to read
  // the theme back.
  return <>{children}</>;
}
