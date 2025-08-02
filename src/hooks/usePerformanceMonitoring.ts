import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, queryOptions } from './query-client';
import {
  performanceMetricsCollector,
  PerformanceMetric,
  PerformanceStats,
  PerformanceThresholds
} from '../utils/performance-metrics';
import { useEffect, useCallback, useRef } from 'react';

/**
 * 性能监控钩子
 */
export function usePerformanceStats(
  category?: string,
  timeRange?: { start: number; end: number }
) {
  return useQuery({
    queryKey: queryKeys.performance.stats(category, timeRange),
    queryFn: async (): Promise<Record<string, PerformanceStats>> => {
      return performanceMetricsCollector.getStats(category, timeRange);
    },
    ...queryOptions.fast,
    refetchInterval: 5000, // 每5秒更新一次
    throwOnError: false,
  });
}

/**
 * 最近性能指标钩子
 */
export function useRecentMetrics(count: number = 100, category?: string) {
  return useQuery({
    queryKey: queryKeys.performance.recent(count, category),
    queryFn: async (): Promise<PerformanceMetric[]> => {
      return performanceMetricsCollector.getRecentMetrics(count, category);
    },
    ...queryOptions.fast,
    refetchInterval: 2000, // 每2秒更新一次
    throwOnError: false,
  });
}

/**
 * 性能阈值管理钩子
 */
export function usePerformanceThresholds() {
  const queryClient = useQueryClient();

  const thresholdsQuery = useQuery({
    queryKey: queryKeys.performance.thresholds(),
    queryFn: async (): Promise<PerformanceThresholds> => {
      // 从配置存储获取阈值设置
      const defaultThresholds: PerformanceThresholds = {
        api: {
          responseTime: { warning: 2000, critical: 5000 },
          errorRate: { warning: 0.05, critical: 0.1 },
        },
        translation: {
          responseTime: { warning: 3000, critical: 8000 },
          qualityScore: { warning: 0.7, critical: 0.5 },
        },
        ui: {
          renderTime: { warning: 100, critical: 300 },
          interactionDelay: { warning: 50, critical: 150 },
        },
        cache: {
          hitRate: { warning: 0.7, critical: 0.5 },
          responseTime: { warning: 10, critical: 50 },
        },
        ocr: {
          responseTime: { warning: 5000, critical: 15000 },
          confidence: { warning: 0.8, critical: 0.6 },
        },
      };

      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          const result = await chrome.storage.local.get('performanceThresholds');
          if (result['performanceThresholds']) {
            return { ...defaultThresholds, ...JSON.parse(result['performanceThresholds']) };
          }
        }
      } catch (error) {
        console.error('加载性能阈值失败:', error);
      }

      return defaultThresholds;
    },
    ...queryOptions.longTerm,
    throwOnError: false,
  });

  const updateThresholdsMutation = useMutation({
    mutationFn: async (newThresholds: Partial<PerformanceThresholds>) => {
      const currentThresholds = thresholdsQuery.data || {};
      const updatedThresholds = { ...currentThresholds, ...newThresholds };

      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({
          performanceThresholds: JSON.stringify(updatedThresholds)
        });
      }

      return updatedThresholds;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.performance.thresholds(),
      });
    },
    throwOnError: false,
  });

  return {
    thresholds: thresholdsQuery.data,
    isLoading: thresholdsQuery.isLoading,
    updateThresholds: updateThresholdsMutation.mutate,
    isUpdating: updateThresholdsMutation.isPending,
  };
}

/**
 * 性能警报钩子
 */
export function usePerformanceAlerts() {
  const { data: stats } = usePerformanceStats();
  const { thresholds } = usePerformanceThresholds();

  return useQuery({
    queryKey: queryKeys.performance.alerts(),
    queryFn: async () => {
      if (!stats || !thresholds) return [];

      const alerts: Array<{
        id: string;
        level: 'warning' | 'critical';
        category: string;
        metric: string;
        value: number;
        threshold: number;
        message: string;
        timestamp: number;
      }> = [];

      Object.entries(stats).forEach(([metricName, stat]) => {
        const category = stat.category as keyof PerformanceThresholds;
        const categoryThresholds = thresholds[category];

        if (!categoryThresholds) return;

        // 检查响应时间阈值
        if ('responseTime' in categoryThresholds && metricName.includes('responseTime')) {
          const { warning, critical } = categoryThresholds.responseTime;

          if (stat.average >= critical) {
            alerts.push({
              id: `${metricName}_critical_${Date.now()}`,
              level: 'critical',
              category,
              metric: metricName,
              value: stat.average,
              threshold: critical,
              message: `${metricName} 平均响应时间 (${stat.average.toFixed(1)}ms) 超过严重阈值 (${critical}ms)`,
              timestamp: Date.now(),
            });
          } else if (stat.average >= warning) {
            alerts.push({
              id: `${metricName}_warning_${Date.now()}`,
              level: 'warning',
              category,
              metric: metricName,
              value: stat.average,
              threshold: warning,
              message: `${metricName} 平均响应时间 (${stat.average.toFixed(1)}ms) 超过警告阈值 (${warning}ms)`,
              timestamp: Date.now(),
            });
          }
        }

        // 检查错误率阈值
        if ('errorRate' in categoryThresholds && metricName.includes('errorRate')) {
          const { warning, critical } = categoryThresholds.errorRate;

          if (stat.average >= critical) {
            alerts.push({
              id: `${metricName}_critical_${Date.now()}`,
              level: 'critical',
              category,
              metric: metricName,
              value: stat.average,
              threshold: critical,
              message: `${metricName} 错误率 (${(stat.average * 100).toFixed(1)}%) 超过严重阈值 (${(critical * 100).toFixed(1)}%)`,
              timestamp: Date.now(),
            });
          } else if (stat.average >= warning) {
            alerts.push({
              id: `${metricName}_warning_${Date.now()}`,
              level: 'warning',
              category,
              metric: metricName,
              value: stat.average,
              threshold: warning,
              message: `${metricName} 错误率 (${(stat.average * 100).toFixed(1)}%) 超过警告阈值 (${(warning * 100).toFixed(1)}%)`,
              timestamp: Date.now(),
            });
          }
        }

        // 检查缓存命中率阈值
        if ('hitRate' in categoryThresholds && metricName.includes('hitRate')) {
          const { warning, critical } = categoryThresholds.hitRate;

          if (stat.average <= critical) {
            alerts.push({
              id: `${metricName}_critical_${Date.now()}`,
              level: 'critical',
              category,
              metric: metricName,
              value: stat.average,
              threshold: critical,
              message: `${metricName} 命中率 (${(stat.average * 100).toFixed(1)}%) 低于严重阈值 (${(critical * 100).toFixed(1)}%)`,
              timestamp: Date.now(),
            });
          } else if (stat.average <= warning) {
            alerts.push({
              id: `${metricName}_warning_${Date.now()}`,
              level: 'warning',
              category,
              metric: metricName,
              value: stat.average,
              threshold: warning,
              message: `${metricName} 命中率 (${(stat.average * 100).toFixed(1)}%) 低于警告阈值 (${(warning * 100).toFixed(1)}%)`,
              timestamp: Date.now(),
            });
          }
        }
      });

      return alerts;
    },
    enabled: !!stats && !!thresholds,
    ...queryOptions.fast,
    refetchInterval: 10000, // 每10秒检查一次警报
    throwOnError: false,
  });
}

/**
 * 性能指标记录钩子
 */
export function usePerformanceRecorder() {
  const queryClient = useQueryClient();

  const recordMetric = useCallback((
    name: string,
    value: number,
    category: PerformanceMetric['category'],
    metadata?: Record<string, any>
  ) => {
    performanceMetricsCollector.recordMetric({
      name,
      value,
      unit: 'ms',
      category,
      metadata,
    });

    // 使相关查询失效
    queryClient.invalidateQueries({
      queryKey: queryKeys.performance.all,
    });
  }, [queryClient]);

  const recordAPIMetric = useCallback((
    name: string,
    value: number,
    metadata: { provider: string; endpoint: string; method: string; statusCode?: number }
  ) => {
    performanceMetricsCollector.recordAPIMetric(name, value, metadata);
    queryClient.invalidateQueries({
      queryKey: queryKeys.performance.all,
    });
  }, [queryClient]);

  const recordTranslationMetric = useCallback((
    name: string,
    value: number,
    metadata: {
      sourceLanguage: string;
      targetLanguage: string;
      textLength: number;
      provider: string;
      cacheHit: boolean;
      qualityScore?: number;
    }
  ) => {
    performanceMetricsCollector.recordTranslationMetric(name, value, metadata);
    queryClient.invalidateQueries({
      queryKey: queryKeys.performance.all,
    });
  }, [queryClient]);

  return {
    recordMetric,
    recordAPIMetric,
    recordTranslationMetric,
  };
}

/**
 * 性能计时器钩子
 */
export function usePerformanceTimer() {
  const { recordMetric } = usePerformanceRecorder();
  const timersRef = useRef<Map<string, number>>(new Map());

  const startTimer = useCallback((timerId: string) => {
    timersRef.current.set(timerId, performance.now());
  }, []);

  const endTimer = useCallback((
    timerId: string,
    metricName: string,
    category: PerformanceMetric['category'],
    metadata?: Record<string, any>
  ) => {
    const startTime = timersRef.current.get(timerId);
    if (startTime) {
      const duration = performance.now() - startTime;
      recordMetric(metricName, duration, category, metadata);
      timersRef.current.delete(timerId);
      return duration;
    }
    return 0;
  }, [recordMetric]);

  const measureAsync = useCallback(async <T>(
    metricName: string,
    category: PerformanceMetric['category'],
    asyncFn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> => {
    const startTime = performance.now();
    try {
      const result = await asyncFn();
      const duration = performance.now() - startTime;
      recordMetric(metricName, duration, category, { ...metadata, success: true });
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      recordMetric(metricName, duration, category, { ...metadata, success: false, error: String(error) });
      throw error;
    }
  }, [recordMetric]);

  return {
    startTimer,
    endTimer,
    measureAsync,
  };
}

/**
 * 性能数据导出钩子
 */
export function usePerformanceExport() {
  return useMutation({
    mutationFn: async (options: {
      format: 'json' | 'csv';
      category?: string;
      timeRange?: { start: number; end: number };
    }) => {
      const { format, category, timeRange } = options;

      let metrics = performanceMetricsCollector.getRecentMetrics(10000);

      if (category) {
        metrics = metrics.filter(m => m.category === category);
      }

      if (timeRange) {
        metrics = metrics.filter(
          m => m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
        );
      }

      if (format === 'csv') {
        const headers = ['id', 'name', 'value', 'unit', 'timestamp', 'category', 'metadata'];
        const rows = metrics.map(metric => [
          metric.id,
          metric.name,
          metric.value.toString(),
          metric.unit,
          new Date(metric.timestamp).toISOString(),
          metric.category,
          JSON.stringify(metric.metadata || {}),
        ]);

        return [headers, ...rows].map(row => row.join(',')).join('\n');
      }

      return JSON.stringify(metrics, null, 2);
    },
    throwOnError: false,
  });
}

/**
 * 实时性能监控钩子
 */
export function useRealTimePerformanceMonitoring() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleMetric = (_metric: PerformanceMetric) => {
      // 实时更新查询缓存
      queryClient.invalidateQueries({
        queryKey: queryKeys.performance.recent(),
      });
    };

    performanceMetricsCollector.addListener(handleMetric);

    return () => {
      performanceMetricsCollector.removeListener(handleMetric);
    };
  }, [queryClient]);

  return {
    isMonitoring: true,
  };
}
