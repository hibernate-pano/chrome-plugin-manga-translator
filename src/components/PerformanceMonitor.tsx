import { ComponentType, useEffect, useRef, useState } from 'react';
import { usePerformanceRecorder } from '../hooks/usePerformanceMonitoring';

/**
 * 性能监控配置
 */
interface PerformanceMonitorConfig {
  componentName: string;
  trackRender?: boolean;
  trackMount?: boolean;
  trackUnmount?: boolean;
  trackProps?: boolean;
  trackState?: boolean;
  enableDetailedMetrics?: boolean;
}

/**
 * 性能监控高阶组件
 */
export function withPerformanceMonitoring<P extends object>(
  WrappedComponent: ComponentType<P>,
  config: PerformanceMonitorConfig
) {
  const MonitoredComponent = (props: P) => {
    const { recordMetric } = usePerformanceRecorder();
    const mountTimeRef = useRef<number>(0);
    const renderCountRef = useRef<number>(0);
    const lastRenderTimeRef = useRef<number>(0);
    const [isFirstRender, setIsFirstRender] = useState(true);

    // 组件挂载监控
    useEffect(() => {
      mountTimeRef.current = performance.now();

      if (config.trackMount) {
        recordMetric(
          `${config.componentName}_mount`,
          0, // 挂载时间在卸载时计算
          'ui',
          {
            component: config.componentName,
            action: 'mount',
          }
        );
      }

      return () => {
        // 组件卸载监控
        if (config.trackUnmount) {
          const mountDuration = performance.now() - mountTimeRef.current;
          recordMetric(
            `${config.componentName}_lifetime`,
            mountDuration,
            'ui',
            {
              component: config.componentName,
              action: 'unmount',
              renderCount: renderCountRef.current,
            }
          );
        }
      };
    }, []);

    // 渲染性能监控
    useEffect(() => {
      const renderStartTime = performance.now();

      if (config.trackRender) {
        const renderTime = isFirstRender ?
          renderStartTime - mountTimeRef.current :
          renderStartTime - lastRenderTimeRef.current;

        recordMetric(
          `${config.componentName}_render`,
          renderTime,
          'ui',
          {
            component: config.componentName,
            action: isFirstRender ? 'initial_render' : 'rerender',
            renderCount: renderCountRef.current,
          }
        );
      }

      renderCountRef.current += 1;
      lastRenderTimeRef.current = renderStartTime;

      if (isFirstRender) {
        setIsFirstRender(false);
      }
    });

    // Props变化监控
    const prevPropsRef = useRef<P>();
    useEffect(() => {
      if (config.trackProps && prevPropsRef.current) {
        const changedProps = Object.keys(props).filter(
          key => (props as any)[key] !== (prevPropsRef.current as any)?.[key]
        );

        if (changedProps.length > 0) {
          recordMetric(
            `${config.componentName}_props_change`,
            changedProps.length,
            'ui',
            {
              component: config.componentName,
              action: 'props_change',
              changedProps,
            }
          );
        }
      }
      prevPropsRef.current = props;
    });

    return <WrappedComponent {...props} />;
  };

  MonitoredComponent.displayName = `withPerformanceMonitoring(${config.componentName})`;
  return MonitoredComponent;
}

/**
 * 性能监控装饰器钩子
 */
export function useComponentPerformanceMonitoring(
  componentName: string,
  options: {
    trackRender?: boolean;
    trackEffects?: boolean;
    trackState?: boolean;
  } = {}
) {
  const { recordMetric } = usePerformanceRecorder();
  const renderStartTimeRef = useRef<number>(0);
  const effectTimersRef = useRef<Map<string, number>>(new Map());

  // 渲染开始
  const startRender = () => {
    renderStartTimeRef.current = performance.now();
  };

  // 渲染结束
  const endRender = (renderType: 'initial' | 'rerender' = 'rerender') => {
    if (options.trackRender && renderStartTimeRef.current > 0) {
      const renderTime = performance.now() - renderStartTimeRef.current;
      recordMetric(
        `${componentName}_render_${renderType}`,
        renderTime,
        'ui',
        {
          component: componentName,
          action: `render_${renderType}`,
        }
      );
    }
  };

  // Effect开始
  const startEffect = (effectName: string) => {
    if (options.trackEffects) {
      effectTimersRef.current.set(effectName, performance.now());
    }
  };

  // Effect结束
  const endEffect = (effectName: string) => {
    if (options.trackEffects) {
      const startTime = effectTimersRef.current.get(effectName);
      if (startTime) {
        const effectTime = performance.now() - startTime;
        recordMetric(
          `${componentName}_effect_${effectName}`,
          effectTime,
          'ui',
          {
            component: componentName,
            action: `effect_${effectName}`,
          }
        );
        effectTimersRef.current.delete(effectName);
      }
    }
  };

  // 状态变化
  const trackStateChange = (stateName: string, oldValue: any, newValue: any) => {
    if (options.trackState) {
      recordMetric(
        `${componentName}_state_change`,
        1,
        'ui',
        {
          component: componentName,
          action: 'state_change',
          stateName,
          hasValueChange: oldValue !== newValue,
        }
      );
    }
  };

  return {
    startRender,
    endRender,
    startEffect,
    endEffect,
    trackStateChange,
  };
}

/**
 * 异步操作性能监控钩子
 */
export function useAsyncPerformanceMonitoring() {
  const { recordMetric } = usePerformanceRecorder();

  const measureAsyncOperation = async <T,>(
    operationName: string,
    category: 'api' | 'translation' | 'ui' | 'cache' | 'ocr',
    asyncFn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> => {
    const startTime = performance.now();
    let success = false;
    let error: any = null;

    try {
      const result = await asyncFn();
      success = true;
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const duration = performance.now() - startTime;
      recordMetric(
        operationName,
        duration,
        category,
        {
          ...metadata,
          success,
          error: error ? String(error) : undefined,
        }
      );
    }
  };

  return { measureAsyncOperation };
}

/**
 * 用户交互性能监控钩子
 */
export function useInteractionPerformanceMonitoring(componentName: string) {
  const { recordMetric } = usePerformanceRecorder();

  const trackClick = (elementName: string) => {
    const startTime = performance.now();

    return () => {
      const interactionTime = performance.now() - startTime;
      recordMetric(
        `${componentName}_click_${elementName}`,
        interactionTime,
        'ui',
        {
          component: componentName,
          action: 'click',
          element: elementName,
        }
      );
    };
  };

  const trackInput = (inputName: string, inputLength?: number) => {
    recordMetric(
      `${componentName}_input_${inputName}`,
      inputLength || 0,
      'ui',
      {
        component: componentName,
        action: 'input',
        element: inputName,
        inputLength,
      }
    );
  };

  const trackScroll = (scrollPosition: number) => {
    recordMetric(
      `${componentName}_scroll`,
      scrollPosition,
      'ui',
      {
        component: componentName,
        action: 'scroll',
        scrollPosition,
      }
    );
  };

  const trackResize = (width: number, height: number) => {
    recordMetric(
      `${componentName}_resize`,
      width * height,
      'ui',
      {
        component: componentName,
        action: 'resize',
        width,
        height,
      }
    );
  };

  return {
    trackClick,
    trackInput,
    trackScroll,
    trackResize,
  };
}

/**
 * 性能监控提供者组件
 */
interface PerformanceMonitorProviderProps {
  children: React.ReactNode;
  enableGlobalMonitoring?: boolean;
  enableErrorBoundaryMonitoring?: boolean;
}

export function PerformanceMonitorProvider({
  children,
  enableGlobalMonitoring = true,
  enableErrorBoundaryMonitoring = true,
}: PerformanceMonitorProviderProps) {
  const { recordMetric } = usePerformanceRecorder();

  useEffect(() => {
    if (!enableGlobalMonitoring) return undefined;

    // 监控页面加载性能
    const handleLoad = () => {
      if (typeof window !== 'undefined' && window.performance) {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

        recordMetric(
          'page_load_time',
          navigation.loadEventEnd - navigation.fetchStart,
          'ui',
          {
            component: 'global',
            action: 'page_load',
            domContentLoaded: navigation.domContentLoadedEventEnd - navigation.fetchStart,
            firstPaint: navigation.responseEnd - navigation.fetchStart,
          }
        );
      }
    };

    // 监控资源加载性能
    const handleResourceLoad = () => {
      if (typeof window !== 'undefined' && window.performance) {
        const resources = performance.getEntriesByType('resource');
        resources.forEach((resource) => {
          recordMetric(
            'resource_load_time',
            resource.duration,
            'ui',
            {
              component: 'global',
              action: 'resource_load',
              resourceType: (resource as any).initiatorType,
              resourceName: resource.name,
              transferSize: (resource as any).transferSize,
            }
          );
        });
      }
    };

    window.addEventListener('load', handleLoad);

    // 定期收集资源性能数据
    const resourceInterval = setInterval(handleResourceLoad, 30000);

    return () => {
      window.removeEventListener('load', handleLoad);
      clearInterval(resourceInterval);
    };
  }, [enableGlobalMonitoring, recordMetric]);

  // 错误边界监控
  useEffect(() => {
    if (!enableErrorBoundaryMonitoring) return undefined;

    const handleError = (event: ErrorEvent) => {
      recordMetric(
        'javascript_error',
        1,
        'ui',
        {
          component: 'global',
          action: 'error',
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        }
      );
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      recordMetric(
        'unhandled_promise_rejection',
        1,
        'ui',
        {
          component: 'global',
          action: 'promise_rejection',
          reason: String(event.reason),
        }
      );
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [enableErrorBoundaryMonitoring, recordMetric]);

  return <>{children}</>;
}
