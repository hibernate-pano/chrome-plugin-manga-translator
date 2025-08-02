/**
 * 懒加载组件系统
 * 实现组件的按需加载，减少初始包大小
 */

import React, { Suspense, lazy } from 'react';
// import { Skeleton } from './ui/skeleton';

// 简单的骨架屏组件
const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
);
import { performanceMetricsCollector } from '../utils/performance-metrics';

/**
 * 懒加载包装器
 */
interface LazyWrapperProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

export function LazyWrapper({ children, fallback, name }: LazyWrapperProps) {
  const defaultFallback = (
    <div className="flex items-center space-x-4 p-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-[250px]" />
        <Skeleton className="h-4 w-[200px]" />
      </div>
    </div>
  );

  return (
    <Suspense fallback={fallback || defaultFallback}>
      <PerformanceTracker componentName={name}>
        {children}
      </PerformanceTracker>
    </Suspense>
  );
}

/**
 * 性能追踪组件
 */
interface PerformanceTrackerProps {
  children: React.ReactNode;
  componentName?: string;
}

function PerformanceTracker({ children, componentName }: PerformanceTrackerProps) {
  React.useEffect(() => {
    if (componentName) {
      const startTime = performance.now();

      return () => {
        const endTime = performance.now();
        const loadTime = endTime - startTime;

        performanceMetricsCollector.recordUIMetric(
          'component_load_time',
          loadTime,
          {
            component: componentName,
            action: 'lazy_load',
          }
        );
      };
    }
    // 确保所有代码路径都有返回值
    return undefined;
  }, [componentName]);

  return <>{children}</>;
}

/**
 * 懒加载的设置面板
 */
// export const LazySettingsPanel = lazy(() =>
//   import('@/components/SettingsPanel').then(module => ({
//     default: module.SettingsPanel
//   }))
// );

/**
 * 懒加载的翻译历史
 */
// export const LazyTranslationHistory = lazy(() =>
//   import('@/components/TranslationHistory').then(module => ({
//     default: module.TranslationHistory
//   }))
// );

/**
 * 懒加载的性能监控面板
 */
// export const LazyPerformanceMonitor = lazy(() =>
//   import('@/components/PerformanceMonitor').then(module => ({
//     default: module.PerformanceMonitorPanel
//   }))
// );

/**
 * 懒加载的API配置
 */
// export const LazyAPIConfiguration = lazy(() =>
//   import('@/components/APIConfiguration').then(module => ({
//     default: module.APIConfiguration
//   }))
// );

/**
 * 懒加载的主题设置
 */
export const LazyThemeSettings = lazy(() =>
  import('@/components/ThemeSettings')
);

/**
 * 懒加载的缓存管理
 */
export const LazyCacheManager = lazy(() =>
  import('@/components/CacheManager')
);

/**
 * 懒加载的数据导入导出
 */
export const LazyDataImportExport = lazy(() =>
  import('@/components/DataImportExport')
);

/**
 * 懒加载的高级设置
 */
export const LazyAdvancedSettings = lazy(() =>
  import('@/components/AdvancedSettings')
);

/**
 * 预加载关键组件
 */
export function preloadCriticalComponents() {
  // 预加载用户最可能访问的组件
  const criticalComponents = [
    () => import('@/components/SettingsPanel'),
    () => import('@/components/TranslationHistory'),
  ];

  criticalComponents.forEach(importFn => {
    // 在空闲时间预加载
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        importFn().catch(console.error);
      });
    } else {
      // 降级到setTimeout
      setTimeout(() => {
        importFn().catch(console.error);
      }, 100);
    }
  });
}

/**
 * 智能预加载
 * 基于用户行为预测需要加载的组件
 */
export function smartPreload(userPreferences: any) {
  const preloadQueue: Array<() => Promise<any>> = [];

  // 根据用户偏好决定预加载策略
  if (userPreferences.frequentlyUsedFeatures?.includes('performance')) {
    preloadQueue.push(() => import('@/components/PerformanceMonitor'));
  }

  if (userPreferences.frequentlyUsedFeatures?.includes('cache')) {
    preloadQueue.push(() => import('@/components/CacheManager'));
  }

  if (userPreferences.frequentlyUsedFeatures?.includes('api')) {
    preloadQueue.push(() => import('@/components/APIConfiguration'));
  }

  // 批量预加载
  preloadQueue.forEach((importFn, index) => {
    setTimeout(() => {
      importFn().catch(console.error);
    }, index * 200); // 错开加载时间
  });
}

/**
 * 组件加载状态管理
 */
export function useComponentLoadingState() {
  const [loadingComponents, setLoadingComponents] = React.useState<Set<string>>(new Set());

  const startLoading = React.useCallback((componentName: string) => {
    setLoadingComponents(prev => new Set(prev).add(componentName));
  }, []);

  const finishLoading = React.useCallback((componentName: string) => {
    setLoadingComponents(prev => {
      const next = new Set(prev);
      next.delete(componentName);
      return next;
    });
  }, []);

  return {
    loadingComponents,
    startLoading,
    finishLoading,
    isLoading: (componentName: string) => loadingComponents.has(componentName),
  };
}

/**
 * 路由级别的代码分割
 */
export const LazyRoutes = {
  Popup: lazy(() => import('@/pages/Popup')),
  Options: lazy(() => import('@/pages/Options')),
  Settings: lazy(() => import('@/pages/Settings')),
  History: lazy(() => import('@/pages/History')),
  Performance: lazy(() => import('@/pages/Performance')),
};

/**
 * 错误边界用于懒加载组件
 */
interface LazyErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}

interface LazyErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class LazyErrorBoundary extends React.Component<
  LazyErrorBoundaryProps,
  LazyErrorBoundaryState
> {
  constructor(props: LazyErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): LazyErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('懒加载组件错误:', error, errorInfo);

    // 记录错误指标
    performanceMetricsCollector.recordMetric({
      name: 'lazy_load_error',
      value: 1,
      unit: 'count',
      category: 'ui',
      metadata: {
        component: 'lazy_component',
        action: 'load_error',
        error: error.message,
      },
    });

    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 text-center">
          <p className="text-red-500">组件加载失败</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
