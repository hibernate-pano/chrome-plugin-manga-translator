import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'manga-translator-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    // 异步加载主题设置
    const loadTheme = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          const result = await chrome.storage.sync.get([storageKey]);
          const savedTheme = result[storageKey] as Theme;
          if (savedTheme) {
            setTheme(savedTheme);
          }
        } else {
          // 降级到localStorage
          const savedTheme = localStorage.getItem(storageKey) as Theme;
          if (savedTheme) {
            setTheme(savedTheme);
          }
        }
      } catch (error) {
        console.error('Failed to load theme:', error);
        // 降级到localStorage
        const savedTheme = localStorage.getItem(storageKey) as Theme;
        if (savedTheme) {
          setTheme(savedTheme);
        }
      }
    };

    loadTheme();
  }, [storageKey]);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      // 保存到Chrome Storage
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.sync.set({ [storageKey]: theme });
        } else {
          // 降级到localStorage
          localStorage.setItem(storageKey, theme);
        }
      } catch (error) {
        console.error('Failed to save theme:', error);
        localStorage.setItem(storageKey, theme);
      }
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
