import React from 'react';
import { cn } from '../../lib/utils';

const FONT_SIZE_OPTIONS = ['small', 'normal', 'large', 'extra-large'] as const;

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
        'sr-only absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0',
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
        'sr-only z-50 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
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
    if (!active || !containerRef.current) return undefined;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return undefined;

    firstFocusableRef.current = focusableElements[0] as HTMLElement;
    lastFocusableRef.current = focusableElements[
      focusableElements.length - 1
    ] as HTMLElement;

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
    <div aria-live={politeness} aria-atomic={atomic} className={className}>
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
      <ScreenReaderOnly>按 Ctrl+? 或 Cmd+? 查看键盘快捷键</ScreenReaderOnly>
    );
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50',
        className
      )}
      role='dialog'
      aria-modal='true'
      aria-labelledby='keyboard-shortcuts-title'
    >
      <FocusTrap>
        <div className='mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800'>
          <div className='mb-4 flex items-center justify-between'>
            <h2
              id='keyboard-shortcuts-title'
              className='text-lg font-semibold text-gray-900 dark:text-white'
            >
              键盘快捷键
            </h2>
            <button
              onClick={() => setIsVisible(false)}
              className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              aria-label='关闭快捷键帮助'
            >
              <svg
                className='h-6 w-6'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          </div>
          <div className='space-y-3'>
            {shortcuts.map((shortcut, index) => (
              <div key={index} className='flex items-center justify-between'>
                <span className='text-sm text-gray-600 dark:text-gray-300'>
                  {shortcut.description}
                </span>
                <kbd className='rounded border border-gray-200 bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'>
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
          <div className='mt-4 text-xs text-gray-500 dark:text-gray-400'>
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
  const [fontSize, setFontSize] = React.useState<
    'small' | 'normal' | 'large' | 'extra-large'
  >('normal');

  React.useEffect(() => {
    const savedFontSize = localStorage.getItem('fontSize') || 'normal';
    const normalizedFontSize = FONT_SIZE_OPTIONS.includes(
      savedFontSize as (typeof FONT_SIZE_OPTIONS)[number]
    )
      ? (savedFontSize as (typeof FONT_SIZE_OPTIONS)[number])
      : 'normal';
    setFontSize(normalizedFontSize);
    document.documentElement.setAttribute('data-font-size', normalizedFontSize);
  }, []);

  const changeFontSize = React.useCallback(
    (size: 'small' | 'normal' | 'large' | 'extra-large') => {
      setFontSize(size);
      localStorage.setItem('fontSize', size);
      document.documentElement.setAttribute('data-font-size', size);
    },
    []
  );

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
  const fontSizeOptions: Array<{
    value: 'small' | 'normal' | 'large' | 'extra-large';
    label: string;
  }> = [
    { value: 'small', label: '小' },
    { value: 'normal', label: '正常' },
    { value: 'large', label: '大' },
    { value: 'extra-large', label: '特大' },
  ];

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50',
        className
      )}
      role='dialog'
      aria-modal='true'
      aria-labelledby='accessibility-panel-title'
    >
      <FocusTrap>
        <div className='mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800'>
          <div className='mb-6 flex items-center justify-between'>
            <h2
              id='accessibility-panel-title'
              className='text-lg font-semibold text-gray-900 dark:text-white'
            >
              无障碍设置
            </h2>
            <button
              onClick={onClose}
              className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              aria-label='关闭无障碍设置'
            >
              <svg
                className='h-6 w-6'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          </div>

          <div className='space-y-6'>
            {/* 高对比度模式 */}
            <div>
              <label className='flex items-center justify-between'>
                <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                  高对比度模式
                </span>
                <button
                  onClick={toggleHighContrast}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                    isHighContrast
                      ? 'bg-blue-600'
                      : 'bg-gray-200 dark:bg-gray-700'
                  )}
                  role='switch'
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
              <label className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'>
                字体大小
              </label>
              <div className='grid grid-cols-2 gap-2'>
                {fontSizeOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => changeFontSize(option.value)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm transition-colors',
                      fontSize === option.value
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 减少动画提示 */}
            {prefersReducedMotion && (
              <div className='rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20'>
                <p className='text-sm text-blue-800 dark:text-blue-200'>
                  检测到您偏好减少动画效果，应用已自动调整。
                </p>
              </div>
            )}
          </div>

          <div className='mt-6 flex justify-end'>
            <button
              onClick={onClose}
              className='rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            >
              完成
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};
