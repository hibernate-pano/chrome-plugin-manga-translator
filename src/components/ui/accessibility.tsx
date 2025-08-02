import React from 'react';
import { cn } from '../../lib/utils';

// 屏幕阅读器专用文本组件
export interface ScreenReaderOnlyProps {
  children: React.ReactNode;
  className?: string;
}

export const ScreenReaderOnly: React.FC<ScreenReaderOnlyProps> = ({
  children,
  className,
}) => {
  return (
    <span
      className={cn(
        'sr-only absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0',
        className
      )}
    >
      {children}
    </span>
  );
};

// 跳转到主内容链接
export interface SkipToContentProps {
  targetId: string;
  className?: string;
}

export const SkipToContent: React.FC<SkipToContentProps> = ({
  targetId,
  className,
}) => {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        'sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium z-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
        className
      )}
    >
      跳转到主内容
    </a>
  );
};

// 焦点陷阱组件
export interface FocusTrapProps {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}

export const FocusTrap: React.FC<FocusTrapProps> = ({
  children,
  active = true,
  className,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const firstFocusableRef = React.useRef<HTMLElement | null>(null);
  const lastFocusableRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    firstFocusableRef.current = focusableElements[0] as HTMLElement;
    lastFocusableRef.current = focusableElements[focusableElements.length - 1] as HTMLElement;

    // 自动聚焦到第一个可聚焦元素
    firstFocusableRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusableRef.current) {
          e.preventDefault();
          lastFocusableRef.current?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusableRef.current) {
          e.preventDefault();
          firstFocusableRef.current?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
};

// 实时区域组件（用于动态内容更新）
export interface LiveRegionProps {
  children: React.ReactNode;
  politeness?: 'polite' | 'assertive' | 'off';
  atomic?: boolean;
  className?: string;
}

export const LiveRegion: React.FC<LiveRegionProps> = ({
  children,
  politeness = 'polite',
  atomic = false,
  className,
}) => {
  return (
    <div
      aria-live={politeness}
      aria-atomic={atomic}
      className={className}
    >
      {children}
    </div>
  );
};

// 键盘导航提示组件
export interface KeyboardHintProps {
  shortcuts: Array<{
    key: string;
    description: string;
  }>;
  className?: string;
}

export const KeyboardHint: React.FC<KeyboardHintProps> = ({
  shortcuts,
  className,
}) => {
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsVisible(!isVisible);
      }
      if (e.key === 'Escape') {
        setIsVisible(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible]);

  if (!isVisible) {
    return (
      <ScreenReaderOnly>
        按 Ctrl+? 或 Cmd+? 查看键盘快捷键
      </ScreenReaderOnly>
    );
  }

  return (
    <div
      className={cn(
        'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',
        className
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <FocusTrap>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 id="keyboard-shortcuts-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              键盘快捷键
            </h2>
            <button
              onClick={() => setIsVisible(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="关闭快捷键帮助"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-3">
            {shortcuts.map((shortcut, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {shortcut.description}
                </span>
                <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            按 Esc 键关闭此帮助
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};

// 高对比度模式检测和切换
export const useHighContrast = () => {
  const [isHighContrast, setIsHighContrast] = React.useState(false);

  React.useEffect(() => {
    // 检测系统高对比度模式
    const mediaQuery = window.matchMedia('(prefers-contrast: high)');
    setIsHighContrast(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsHighContrast(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleHighContrast = React.useCallback(() => {
    setIsHighContrast(!isHighContrast);
    document.documentElement.classList.toggle('high-contrast', !isHighContrast);
  }, [isHighContrast]);

  return {
    isHighContrast,
    toggleHighContrast,
  };
};

// 减少动画偏好检测
export const useReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
};

// 字体大小调整
export const useFontSize = () => {
  const [fontSize, setFontSize] = React.useState('normal');

  React.useEffect(() => {
    const savedFontSize = localStorage.getItem('fontSize') || 'normal';
    setFontSize(savedFontSize);
    document.documentElement.setAttribute('data-font-size', savedFontSize);
  }, []);

  const changeFontSize = React.useCallback((size: 'small' | 'normal' | 'large' | 'extra-large') => {
    setFontSize(size);
    localStorage.setItem('fontSize', size);
    document.documentElement.setAttribute('data-font-size', size);
  }, []);

  return {
    fontSize,
    changeFontSize,
  };
};

// 无障碍设置面板
export interface AccessibilityPanelProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export const AccessibilityPanel: React.FC<AccessibilityPanelProps> = ({
  isOpen,
  onClose,
  className,
}) => {
  const { isHighContrast, toggleHighContrast } = useHighContrast();
  const { fontSize, changeFontSize } = useFontSize();
  const prefersReducedMotion = useReducedMotion();

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',
        className
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="accessibility-panel-title"
    >
      <FocusTrap>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 id="accessibility-panel-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              无障碍设置
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="关闭无障碍设置"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-6">
            {/* 高对比度模式 */}
            <div>
              <label className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  高对比度模式
                </span>
                <button
                  onClick={toggleHighContrast}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                    isHighContrast ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                  )}
                  role="switch"
                  aria-checked={isHighContrast}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                      isHighContrast ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </label>
            </div>

            {/* 字体大小 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                字体大小
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'small', label: '小' },
                  { value: 'normal', label: '正常' },
                  { value: 'large', label: '大' },
                  { value: 'extra-large', label: '特大' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => changeFontSize(option.value as any)}
                    className={cn(
                      'px-3 py-2 text-sm rounded-md border transition-colors',
                      fontSize === option.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 减少动画提示 */}
            {prefersReducedMotion && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  检测到您偏好减少动画效果，应用已自动调整。
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              完成
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};
