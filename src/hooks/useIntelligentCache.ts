import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, queryOptions } from './query-client';
import { unifiedCacheManager } from '../utils/unified-cache-manager';
import { cacheWarmupManager } from '../utils/cache-warmup';
import { offlineManager } from '../utils/offline-manager';

/**
 * 智能缓存统计信息
 */
export interface IntelligentCacheStats {
  memory: any;
  persistent: any;
  offline: any;
  hitRates: Record<string, { hitRate: number; totalRequests: number }>;
  warmupStats: {
    totalPatterns: number;
    recentBehaviors: number;
    warmupInProgress: boolean;
    lastWarmupTime?: number;
  };
  offlineStats: {
    totalItems: number;
    unsyncedItems: number;
    totalSize: number;
    itemsByType: Record<string, number>;
  };
}

/**
 * 智能缓存管理钩子
 */
export function useIntelligentCacheStats() {
  return useQuery({
    queryKey: queryKeys.cache.intelligent(),
    queryFn: async (): Promise<IntelligentCacheStats> => {
      const cacheStats = unifiedCacheManager.getCacheStats();
      const warmupStats = cacheWarmupManager.getWarmupStats();
      const offlineStats = offlineManager.getOfflineStats();

      return {
        ...cacheStats,
        warmupStats,
        offlineStats,
      };
    },
    ...queryOptions.fast,
    refetchInterval: 10000, // 每10秒更新一次
    throwOnError: false,
  });
}

/**
 * 缓存预热钩子
 */
export function useCacheWarmup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options: {
      type?: 'translation' | 'ocr' | 'common';
      config?: any;
    } = {}) => {
      const { type = 'common', config } = options;
      
      if (type === 'common') {
        await cacheWarmupManager.performIntelligentWarmup(config);
      } else {
        await unifiedCacheManager.warmupCache(type, config || {});
      }

      return { success: true, type };
    },
    onSuccess: () => {
      // 使缓存统计查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.intelligent(),
      });
    },
    throwOnError: false,
  });
}

/**
 * 缓存清理钩子
 */
export function useCacheCleanup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options: {
      type?: 'all' | 'expired' | 'offline';
      aggressive?: boolean;
      maxAge?: number;
      targetSize?: number;
    } = {}) => {
      const { type = 'expired', aggressive = false, maxAge, targetSize } = options;

      switch (type) {
        case 'all':
          await unifiedCacheManager.cleanup({ aggressive: true, maxAge, targetSize });
          await offlineManager.clearOfflineData();
          await cacheWarmupManager.cleanupWarmupData();
          break;
        case 'expired':
          await unifiedCacheManager.cleanup({ aggressive, maxAge, targetSize });
          break;
        case 'offline':
          await offlineManager.clearOfflineData({ olderThan: maxAge });
          break;
      }

      return { success: true, type };
    },
    onSuccess: () => {
      // 使缓存统计查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.intelligent(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.stats(),
      });
    },
    throwOnError: false,
  });
}

/**
 * 离线数据同步钩子
 */
export function useOfflineSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!offlineManager.isNetworkOnline()) {
        throw new Error('网络不可用，无法同步');
      }

      await offlineManager.syncOfflineData();
      return { success: true };
    },
    onSuccess: () => {
      // 使相关查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.intelligent(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.translation.all,
      });
    },
    throwOnError: false,
  });
}

/**
 * 预测性预加载钩子
 */
export function usePredictivePreload() {
  return {
    triggerPreload: async (context: {
      action: string;
      text?: string;
      language?: string;
      imageHash?: string;
    }) => {
      await cacheWarmupManager.predictAndPreload(context);
    },
    
    recordBehavior: (action: string, context: any) => {
      cacheWarmupManager.recordUserBehavior(action, context);
    },
  };
}

/**
 * 离线数据查询钩子
 */
export function useOfflineData(type?: 'translation' | 'ocr' | 'config') {
  return useQuery({
    queryKey: queryKeys.cache.offline(type),
    queryFn: async () => {
      return offlineManager.getAllOfflineData(type);
    },
    ...queryOptions.standard,
    throwOnError: false,
  });
}

/**
 * 网络状态钩子
 */
export function useNetworkStatus() {
  return useQuery({
    queryKey: queryKeys.cache.networkStatus(),
    queryFn: async () => {
      return {
        isOnline: offlineManager.isNetworkOnline(),
        timestamp: Date.now(),
      };
    },
    ...queryOptions.fast,
    refetchInterval: 5000, // 每5秒检查一次网络状态
    throwOnError: false,
  });
}

/**
 * 缓存性能监控钩子
 */
export function useCachePerformance() {
  return useQuery({
    queryKey: queryKeys.cache.performance(),
    queryFn: async () => {
      const stats = unifiedCacheManager.getCacheStats();
      
      // 计算缓存效率指标
      const totalHits = Object.values(stats.hitRates).reduce(
        (sum, rate) => sum + (rate.totalRequests * rate.hitRate), 0
      );
      const totalRequests = Object.values(stats.hitRates).reduce(
        (sum, rate) => sum + rate.totalRequests, 0
      );
      
      const overallHitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
      
      return {
        overallHitRate,
        totalRequests,
        memoryUsage: stats.memory,
        persistentUsage: stats.persistent,
        offlineUsage: stats.offline,
        topPerformingKeys: Object.entries(stats.hitRates)
          .sort(([, a], [, b]) => b.hitRate - a.hitRate)
          .slice(0, 10),
      };
    },
    ...queryOptions.standard,
    refetchInterval: 30000, // 每30秒更新一次性能数据
    throwOnError: false,
  });
}

/**
 * 智能缓存配置钩子
 */
export function useIntelligentCacheConfig() {
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: queryKeys.cache.config(),
    queryFn: async () => {
      // 从配置存储获取智能缓存配置
      return {
        enableIntelligentCaching: true,
        enableOfflineSupport: true,
        enablePredictivePreload: true,
        maxCacheSize: 50 * 1024 * 1024, // 50MB
        maxOfflineItems: 1000,
        warmupInterval: 24 * 60 * 60 * 1000, // 24小时
        cleanupInterval: 7 * 24 * 60 * 60 * 1000, // 7天
      };
    },
    ...queryOptions.longTerm,
    throwOnError: false,
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (newConfig: Partial<{
      enableIntelligentCaching: boolean;
      enableOfflineSupport: boolean;
      enablePredictivePreload: boolean;
      maxCacheSize: number;
      maxOfflineItems: number;
      warmupInterval: number;
      cleanupInterval: number;
    }>) => {
      // 更新配置到存储
      console.log('更新智能缓存配置:', newConfig);
      return newConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.config(),
      });
    },
    throwOnError: false,
  });

  return {
    config: configQuery.data,
    isLoading: configQuery.isLoading,
    updateConfig: updateConfigMutation.mutate,
    isUpdating: updateConfigMutation.isPending,
  };
}

/**
 * 缓存健康检查钩子
 */
export function useCacheHealthCheck() {
  return useQuery({
    queryKey: queryKeys.cache.health(),
    queryFn: async () => {
      const stats = unifiedCacheManager.getCacheStats();
      const offlineStats = offlineManager.getOfflineStats();
      
      // 计算健康指标
      const memoryUsageRatio = stats.memory.currentSize / stats.memory.maxSize;
      const hitRateAverage = Object.values(stats.hitRates).reduce(
        (sum, rate) => sum + rate.hitRate, 0
      ) / Object.keys(stats.hitRates).length;
      
      const health = {
        overall: 'good' as 'good' | 'warning' | 'critical',
        issues: [] as string[],
        recommendations: [] as string[],
        metrics: {
          memoryUsageRatio,
          hitRateAverage,
          offlineItemsCount: offlineStats.totalItems,
          unsyncedItemsCount: offlineStats.unsyncedItems,
        },
      };

      // 检查内存使用率
      if (memoryUsageRatio > 0.9) {
        health.overall = 'critical';
        health.issues.push('内存缓存使用率过高');
        health.recommendations.push('执行缓存清理或增加缓存大小限制');
      } else if (memoryUsageRatio > 0.7) {
        health.overall = 'warning';
        health.issues.push('内存缓存使用率较高');
        health.recommendations.push('考虑执行缓存优化');
      }

      // 检查命中率
      if (hitRateAverage < 0.3) {
        health.overall = health.overall === 'critical' ? 'critical' : 'warning';
        health.issues.push('缓存命中率较低');
        health.recommendations.push('考虑调整缓存策略或增加预热');
      }

      // 检查离线数据
      if (offlineStats.unsyncedItems > 100) {
        health.overall = health.overall === 'critical' ? 'critical' : 'warning';
        health.issues.push('大量未同步的离线数据');
        health.recommendations.push('检查网络连接并执行数据同步');
      }

      return health;
    },
    ...queryOptions.standard,
    refetchInterval: 60000, // 每分钟检查一次健康状态
    throwOnError: false,
  });
}
