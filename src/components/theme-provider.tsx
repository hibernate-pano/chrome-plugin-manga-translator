import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  DEFAULT_THEME,
  isThemeName,
  resolveThemeName,
  type ThemeName,
} from '@/shared/theme';

/**
 * The extension renders one of three themes: 校正紙 (proof), 分镜黑 (panel)
 * and 巨字海报 (poster).
 *
 * A theme is a palette. The popup, the options page and the onboarding
 * wizard all paint with the same semantic utilities (`bg-paper`, `text-ink`,
 * `text-vermilion`), and the shadcn primitives read the same CSS variables,
 * so switching a theme swaps `data-theme` on <html> and nothing else has to
 * move. The overlays injected into a page — HUD, reading panel, failure
 * badges, export dialog — live in shadow roots that inherit nothing from the
 * page, so they read the chosen name out of storage themselves; the write
 * here is what tells them.
 *
 * The choice is stored in `chrome.storage.local`, never `sync`: the privacy
 * policy says preferences stay on this machine and do not follow the user's
 * Google account.
 */
type ThemeContextValue = {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: ThemeName;
  storageKey?: string;
};

/**
 * Resolve the stored preference into the theme that is actually rendered.
 *
 * Anything unrecognised falls back to the default rather than to an unstyled
 * page: a `dark` or `system` left by an older build, a null from a fresh
 * profile, or a name written by a future version.
 */
export function resolveStoredTheme(
  saved: unknown,
  defaultTheme: ThemeName = DEFAULT_THEME
): ThemeName {
  if (isThemeName(saved)) {
    return saved;
  }
  return resolveThemeName(defaultTheme);
}

/** Apply a theme to the document element. */
function applyTheme(theme: ThemeName): void {
  const root = window.document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme === 'panel' ? 'dark' : 'light';
  // No theme is expressed as a class any more. A `dark` class left by an
  // older build would still activate Tailwind's `dark:` variants, so it is
  // removed on every apply.
  root.classList.remove('dark');
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = 'manga-translator-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(() =>
    resolveThemeName(defaultTheme)
  );

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
          setThemeState(resolveStoredTheme(result[storageKey], defaultTheme));
        } else {
          // 降级到localStorage
          setThemeState(
            resolveStoredTheme(localStorage.getItem(storageKey), defaultTheme)
          );
        }
      } catch (error) {
        console.error('Failed to load theme:', error);
        // 降级到localStorage
        setThemeState(
          resolveStoredTheme(localStorage.getItem(storageKey), defaultTheme)
        );
      }
    };

    loadTheme();
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * Follow changes made in another surface.
   *
   * The popup and the options page are separate documents; without this,
   * picking a theme in the settings page left an open popup on the old one
   * until it was reopened.
   */
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
      return;
    }
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local' || !changes[storageKey]) {
        return;
      }
      setThemeState(resolveStoredTheme(changes[storageKey].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [storageKey]);

  const setTheme = useCallback(
    (next: ThemeName) => {
      const resolved = resolveThemeName(next);
      setThemeState(resolved);
      // Written, not just rendered: the content script's overlays are in
      // another document and learn about the change from storage.
      void (async () => {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage) {
            await chrome.storage.local.set({ [storageKey]: resolved });
          } else {
            localStorage.setItem(storageKey, resolved);
          }
        } catch (error) {
          console.error('Failed to save theme:', error);
          try {
            localStorage.setItem(storageKey, resolved);
          } catch {
            // The theme still applies to this document; only persistence
            // failed, and there is nowhere left to report it.
          }
        }
      })();
    },
    [storageKey]
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * The current theme and the setter.
 *
 * Components that only paint with utilities do not need this. The picker
 * does, and so does anything that has to label the current theme.
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return value;
}
