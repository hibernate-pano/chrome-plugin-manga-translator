import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'manga-translator-theme';

export function useTheme(): ThemeProviderState {
  const [theme, setThemeState] = useState<Theme>(() => {
    // 从Chrome Storage读取主题设置
    if (typeof chrome !== 'undefined' && chrome.storage) {
      return 'system'; // 默认值，实际值会在useEffect中异步加载
    }
    return 'system';
  });

  useEffect(() => {
    // 异步加载主题设置
    const loadTheme = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          const result = await chrome.storage.sync.get([STORAGE_KEY]);
          const savedTheme = result[STORAGE_KEY] as Theme;
          if (savedTheme) {
            setThemeState(savedTheme);
            applyTheme(savedTheme);
          } else {
            // 首次使用，使用系统主题
            setThemeState('system');
            applyTheme('system');
          }
        }
      } catch (error) {
        console.error('Failed to load theme:', error);
        // 降级到localStorage
        const savedTheme = localStorage.getItem(STORAGE_KEY) as Theme;
        if (savedTheme) {
          setThemeState(savedTheme);
          applyTheme(savedTheme);
        }
      }
    };

    loadTheme();
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    applyTheme(newTheme);

    // 保存到Chrome Storage
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.set({ [STORAGE_KEY]: newTheme });
      } else {
        // 降级到localStorage
        localStorage.setItem(STORAGE_KEY, newTheme);
      }
    } catch (error) {
      console.error('Failed to save theme:', error);
      localStorage.setItem(STORAGE_KEY, newTheme);
    }
  };

  return { theme, setTheme };
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyTheme(theme: Theme) {
  const root = window.document.documentElement;

  // 移除现有的主题类
  root.classList.remove('light', 'dark');

  if (theme === 'system') {
    const systemTheme = getSystemTheme();
    root.classList.add(systemTheme);
  } else {
    root.classList.add(theme);
  }
}

// 监听系统主题变化
if (typeof window !== 'undefined' && window.matchMedia) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  mediaQuery.addEventListener('change', () => {
    // 只有在使用系统主题时才响应系统主题变化
    const currentTheme = localStorage.getItem(STORAGE_KEY) as Theme;
    if (!currentTheme || currentTheme === 'system') {
      applyTheme('system');
    }
  });
}
