import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../components/theme-provider';
import { ThemeToggleSimple } from '../components/ui/theme-toggle';

// Mock Chrome API
const mockChromeStorage = {
  sync: {
    get: vi.fn(),
    set: vi.fn(),
  },
};

// @ts-ignore
global.chrome = {
  storage: mockChromeStorage,
};

// 测试组件
function TestThemeComponent() {
  const { theme, setTheme } = useTheme();
  
  return (
    <div>
      <div data-testid="current-theme">{theme}</div>
      <button onClick={() => setTheme('light')}>设置浅色</button>
      <button onClick={() => setTheme('dark')}>设置深色</button>
      <button onClick={() => setTheme('system')}>跟随系统</button>
    </div>
  );
}

describe('主题系统测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置DOM类
    document.documentElement.className = '';
  });

  describe('ThemeProvider', () => {
    it('应该正确初始化默认主题', () => {
      mockChromeStorage.sync.get.mockResolvedValue({});
      
      render(
        <ThemeProvider defaultTheme="light">
          <TestThemeComponent />
        </ThemeProvider>
      );
      
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    });

    it('应该正确切换主题', async () => {
      mockChromeStorage.sync.get.mockResolvedValue({});
      
      render(
        <ThemeProvider>
          <TestThemeComponent />
        </ThemeProvider>
      );
      
      const darkButton = screen.getByText('设置深色');
      fireEvent.click(darkButton);
      
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
      expect(mockChromeStorage.sync.set).toHaveBeenCalledWith({
        'manga-translator-theme': 'dark'
      });
    });

    it('应该正确应用CSS类', async () => {
      mockChromeStorage.sync.get.mockResolvedValue({});
      
      render(
        <ThemeProvider>
          <TestThemeComponent />
        </ThemeProvider>
      );
      
      const darkButton = screen.getByText('设置深色');
      fireEvent.click(darkButton);
      
      // 等待DOM更新
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  describe('ThemeToggleSimple', () => {
    it('应该正确渲染主题切换按钮', () => {
      mockChromeStorage.sync.get.mockResolvedValue({});
      
      render(
        <ThemeProvider defaultTheme="light">
          <ThemeToggleSimple />
        </ThemeProvider>
      );
      
      expect(screen.getByText('浅色模式')).toBeInTheDocument();
    });

    it('应该响应点击切换主题', async () => {
      mockChromeStorage.sync.get.mockResolvedValue({});
      
      render(
        <ThemeProvider defaultTheme="light">
          <ThemeToggleSimple />
        </ThemeProvider>
      );
      
      const toggleButton = screen.getByRole('button');
      fireEvent.click(toggleButton);
      
      // 应该切换到深色模式
      expect(screen.getByText('深色模式')).toBeInTheDocument();
    });
  });

  describe('Chrome Storage 集成', () => {
    it('应该从Chrome Storage加载保存的主题', async () => {
      mockChromeStorage.sync.get.mockResolvedValue({
        'manga-translator-theme': 'dark'
      });
      
      render(
        <ThemeProvider>
          <TestThemeComponent />
        </ThemeProvider>
      );
      
      // 等待异步加载
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockChromeStorage.sync.get).toHaveBeenCalledWith(['manga-translator-theme']);
    });

    it('应该在Chrome Storage不可用时降级到localStorage', () => {
      // @ts-ignore
      global.chrome = undefined;
      
      // Mock localStorage
      const mockLocalStorage = {
        getItem: vi.fn().mockReturnValue('dark'),
        setItem: vi.fn(),
      };
      Object.defineProperty(window, 'localStorage', {
        value: mockLocalStorage,
        writable: true,
      });
      
      render(
        <ThemeProvider>
          <TestThemeComponent />
        </ThemeProvider>
      );
      
      const lightButton = screen.getByText('设置浅色');
      fireEvent.click(lightButton);
      
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('manga-translator-theme', 'light');
      
      // 恢复Chrome mock
      // @ts-ignore
      global.chrome = { storage: mockChromeStorage };
    });
  });
});
