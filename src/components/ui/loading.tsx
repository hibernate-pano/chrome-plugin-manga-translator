import React from 'react';
import { cn } from '@/lib/utils';

// ==================== 基础加载组件 ====================

/**
 * 基础加载组件
 */
interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'primary' | 'secondary' | 'white';
  className?: string;
}

export const Loading: React.FC<LoadingProps> = ({ 
  size = 'md', 
  color = 'primary',
  className 
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  const colorClasses = {
    primary: 'text-blue-600',
    secondary: 'text-gray-600',
    white: 'text-white',
  };

  return (
    <div className={cn('animate-spin', sizeClasses[size], colorClasses[color], className)}>
      <svg
        className="w-full h-full"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
};

// ==================== 骨架屏组件 ====================

/**
 * 骨架屏组件
 */
interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  width,
  height,
  rounded = false,
}) => {
  const style: React.CSSProperties = {};
  
  if (width) {
    style.width = typeof width === 'number' ? `${width}px` : width;
  }
  
  if (height) {
    style.height = typeof height === 'number' ? `${height}px` : height;
  }

  return (
    <div
      className={cn(
        'animate-pulse bg-gray-200 dark:bg-gray-700',
        rounded && 'rounded',
        className
      )}
      style={style}
    />
  );
};

/**
 * 文本骨架屏
 */
interface TextSkeletonProps {
  lines?: number;
  className?: string;
}

export const TextSkeleton: React.FC<TextSkeletonProps> = ({ 
  lines = 1, 
  className 
}) => {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={16}
          className={cn(
            'w-full',
            index === lines - 1 ? 'w-3/4' : 'w-full'
          )}
        />
      ))}
    </div>
  );
};

/**
 * 卡片骨架屏
 */
interface CardSkeletonProps {
  className?: string;
  showImage?: boolean;
  showTitle?: boolean;
  showContent?: boolean;
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({
  className,
  showImage = true,
  showTitle = true,
  showContent = true,
}) => {
  return (
    <div className={cn('p-4 border rounded-lg', className)}>
      {showImage && (
        <Skeleton
          height={200}
          className="w-full mb-4 rounded"
        />
      )}
      {showTitle && (
        <Skeleton
          height={24}
          className="w-3/4 mb-2"
        />
      )}
      {showContent && (
        <TextSkeleton lines={3} />
      )}
    </div>
  );
};

// ==================== 进度条组件 ====================

/**
 * 进度条组件
 */
interface ProgressProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  color?: 'primary' | 'success' | 'warning' | 'error';
  showLabel?: boolean;
  className?: string;
}

export const Progress: React.FC<ProgressProps> = ({
  value,
  max = 100,
  size = 'md',
  color = 'primary',
  showLabel = false,
  className,
}) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const sizeClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  const colorClasses = {
    primary: 'bg-blue-600',
    success: 'bg-green-600',
    warning: 'bg-yellow-600',
    error: 'bg-red-600',
  };

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('bg-gray-200 rounded-full overflow-hidden', sizeClasses[size])}>
        <div
          className={cn('transition-all duration-300 ease-out', colorClasses[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {Math.round(percentage)}%
        </div>
      )}
    </div>
  );
};

// ==================== 加载状态容器 ====================

/**
 * 加载状态容器
 */
interface LoadingContainerProps {
  loading: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  className?: string;
}

export const LoadingContainer: React.FC<LoadingContainerProps> = ({
  loading,
  children,
  fallback,
  className,
}) => {
  if (loading) {
    return (
      <div className={cn('flex items-center justify-center p-4', className)}>
        {fallback || <Loading size="lg" />}
      </div>
    );
  }

  return <>{children}</>;
};

// ==================== 翻译进度组件 ====================

/**
 * 翻译进度组件
 */
interface TranslationProgressProps {
  current: number;
  total: number;
  status: 'preparing' | 'ocr' | 'translating' | 'rendering' | 'complete';
  onCancel?: () => void;
  className?: string;
}

export const TranslationProgress: React.FC<TranslationProgressProps> = ({
  current,
  total,
  status,
  onCancel,
  className,
}) => {
  const percentage = total > 0 ? (current / total) * 100 : 0;

  const statusMessages = {
    preparing: '准备中...',
    ocr: '识别文字中...',
    translating: '翻译中...',
    rendering: '渲染中...',
    complete: '完成',
  };

  const statusColors = {
    preparing: 'primary',
    ocr: 'warning',
    translating: 'success',
    rendering: 'primary',
    complete: 'success',
  } as const;

  return (
    <div className={cn('p-4 bg-white rounded-lg shadow-lg', className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          {statusMessages[status]}
        </span>
        <span className="text-sm text-gray-500">
          {current} / {total}
        </span>
      </div>
      
      <Progress
        value={current}
        max={total}
        color={statusColors[status]}
        size="md"
        className="mb-3"
      />
      
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {Math.round(percentage)}% 完成
        </span>
        
        {onCancel && status !== 'complete' && (
          <button
            onClick={onCancel}
            className="text-xs text-red-600 hover:text-red-700"
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
};

// ==================== 全局加载遮罩 ====================

/**
 * 全局加载遮罩
 */
interface GlobalLoadingProps {
  visible: boolean;
  message?: string;
  className?: string;
}

export const GlobalLoading: React.FC<GlobalLoadingProps> = ({
  visible,
  message = '加载中...',
  className,
}) => {
  if (!visible) return null;

  return (
    <div className={cn(
      'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50',
      className
    )}>
      <div className="bg-white rounded-lg p-6 flex flex-col items-center">
        <Loading size="lg" className="mb-4" />
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  );
};

// 所有组件已经在上面导出，这里不需要重复导出
