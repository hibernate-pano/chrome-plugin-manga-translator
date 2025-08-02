import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, queryOptions } from './query-client';
import { useCacheStore } from '@/stores/cache';

/**
 * 缓存统计信息
 */
export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
  translationCache: {
    entries: number;
    size: number;
  };
  ocrCache: {
    entries: number;
    size: number;
  };
  imageCache: {
    entries: number;
    size: number;
  };
}

/**
 * 缓存条目
 */
export interface CacheEntry {
  key: string;
  value: any;
  timestamp: number;
  size: number;
  type: 'translation' | 'ocr' | 'image' | 'other';
  hits: number;
  lastAccessed: number;
}

/**
 * 缓存统计查询钩子
 */
export function useCacheStats() {
  const cacheStore = useCacheStore();

  return useQuery({
    queryKey: queryKeys.cache.stats(),
    queryFn: async (): Promise<CacheStats> => {
      const state = cacheStore;

      // 计算各类缓存的统计信息
      const translationEntries = Object.keys(state.translationCache || {});
      const ocrEntries = Object.keys(state.ocrCache || {});
      const imageEntries = Object.keys(state.imageCache || {});

      const totalEntries = translationEntries.length + ocrEntries.length + imageEntries.length;

      // 使用缓存存储的统计方法
      const cacheStats = state.getCacheStats();

      return {
        totalEntries,
        totalSize: cacheStats.totalSize,
        hitRate: 0, // 暂时设为0，可以后续实现
        missRate: 0, // 暂时设为0，可以后续实现
        translationCache: {
          entries: translationEntries.length,
          size: translationEntries.reduce((size, key) => {
            const entry = state.translationCache?.[key];
            return size + (entry ? JSON.stringify(entry).length : 0);
          }, 0),
        },
        ocrCache: {
          entries: ocrEntries.length,
          size: ocrEntries.reduce((size, key) => {
            const entry = state.ocrCache?.[key];
            return size + (entry ? JSON.stringify(entry).length : 0);
          }, 0),
        },
        imageCache: {
          entries: imageEntries.length,
          size: imageEntries.reduce((size, key) => {
            const entry = state.imageCache?.[key];
            return size + (entry ? JSON.stringify(entry).length : 0);
          }, 0),
        },
      };
    },
    ...queryOptions.fast,
    refetchInterval: 5000, // 每5秒更新一次统计信息
    throwOnError: false,
  });
}

/**
 * 缓存条目查询钩子
 */
export function useCacheEntries(type?: string) {
  const cacheStore = useCacheStore();

  return useQuery({
    queryKey: queryKeys.cache.entries(type),
    queryFn: async (): Promise<CacheEntry[]> => {
      const state = cacheStore;
      const entries: CacheEntry[] = [];

      // 收集翻译缓存条目
      if (!type || type === 'translation') {
        Object.entries(state.translationCache || {}).forEach(([key, value]) => {
          entries.push({
            key,
            value,
            timestamp: value.timestamp || Date.now(),
            size: JSON.stringify(value).length,
            type: 'translation',
            hits: 0, // CacheItem没有hits属性，设为默认值
            lastAccessed: value.timestamp || Date.now(),
          });
        });
      }

      // 收集OCR缓存条目
      if (!type || type === 'ocr') {
        Object.entries(state.ocrCache || {}).forEach(([key, value]) => {
          entries.push({
            key,
            value,
            timestamp: value.timestamp || Date.now(),
            size: JSON.stringify(value).length,
            type: 'ocr',
            hits: 0, // CacheItem没有hits属性，设为默认值
            lastAccessed: value.timestamp || Date.now(),
          });
        });
      }

      // 收集图像缓存条目
      if (!type || type === 'image') {
        Object.entries(state.imageCache || {}).forEach(([key, value]) => {
          entries.push({
            key,
            value,
            timestamp: value.timestamp || Date.now(),
            size: JSON.stringify(value).length,
            type: 'image' as const,
            hits: 0, // CacheItem没有hits属性，设为默认值
            lastAccessed: value.timestamp || Date.now(),
          });
        });
      }

      // 按最后访问时间排序
      return entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
    },
    ...queryOptions.standard,
    throwOnError: false,
  });
}

/**
 * 缓存清理变更钩子
 */
export function useCacheClearMutation() {
  const queryClient = useQueryClient();
  const cacheStore = useCacheStore();

  return useMutation({
    mutationFn: async (options: {
      type?: 'translation' | 'ocr' | 'image' | 'all';
      olderThan?: number; // 清理指定时间之前的缓存（毫秒）
      maxEntries?: number; // 保留最多指定数量的条目
    }) => {
      const { type = 'all', olderThan, maxEntries } = options;

      if (type === 'all') {
        cacheStore.clearAllCache();
      } else if (type === 'translation') {
        cacheStore.clearTranslationCache();
      } else if (type === 'ocr') {
        cacheStore.clearOCRCache();
      } else if (type === 'image') {
        cacheStore.clearImageCache();
      }

      // 如果指定了时间或数量限制，进行更精细的清理
      if (olderThan || maxEntries) {
        // 这里可以实现更复杂的清理逻辑
        // 暂时使用简单的清理方式
      }

      return { type, cleared: true };
    },
    onSuccess: (data) => {
      // 使缓存相关查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.all,
      });

      // 根据清理类型，使相关查询失效
      if (data.type === 'all' || data.type === 'translation') {
        queryClient.invalidateQueries({
          queryKey: queryKeys.translation.all,
        });
      }

      if (data.type === 'all' || data.type === 'ocr') {
        queryClient.invalidateQueries({
          queryKey: queryKeys.ocr.all,
        });
      }

      if (data.type === 'all' || data.type === 'image') {
        // 图像缓存清理后可能需要重新获取相关数据
        // 这里可以添加特定的失效逻辑
      }
    },
    throwOnError: false,
  });
}

/**
 * 缓存优化变更钩子
 */
export function useCacheOptimizeMutation() {
  const queryClient = useQueryClient();
  const cacheStore = useCacheStore();

  return useMutation({
    mutationFn: async (options: {
      strategy?: 'lru' | 'lfu' | 'size' | 'time';
      targetSize?: number; // 目标缓存大小（字节）
      maxAge?: number; // 最大缓存时间（毫秒）
    }) => {
      const { strategy = 'lru' } = options;

      // 执行缓存优化（清理过期缓存）
      cacheStore.cleanExpiredCache();

      return { strategy, optimized: true };
    },
    onSuccess: () => {
      // 使缓存统计查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.stats(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.cache.entries(),
      });
    },
    throwOnError: false,
  });
}

/**
 * 缓存预热钩子
 */
export function useCacheWarmup() {
  const queryClient = useQueryClient();

  return {
    // 预热翻译缓存
    warmupTranslation: async (commonTexts: string[], targetLang: string) => {
      const promises = commonTexts.map(text => {
        return queryClient.prefetchQuery({
          queryKey: queryKeys.translation.text(text, targetLang),
          queryFn: async () => {
            // 这里可以调用实际的翻译API
            // 暂时返回模拟数据
            return { translatedText: `翻译: ${text}` };
          },
          ...queryOptions.longTerm,
        });
      });

      await Promise.all(promises);
    },

    // 预热OCR缓存
    warmupOCR: async (imageHashes: string[]) => {
      const promises = imageHashes.map(hash => {
        return queryClient.prefetchQuery({
          queryKey: queryKeys.ocr.detect(hash),
          queryFn: async () => {
            // 这里可以调用实际的OCR API
            // 暂时返回模拟数据
            return { textAreas: [] };
          },
          ...queryOptions.longTerm,
        });
      });

      await Promise.all(promises);
    },

    // 预热配置缓存
    warmupConfig: async (providerTypes: string[]) => {
      const promises = providerTypes.map(type => {
        return queryClient.prefetchQuery({
          queryKey: queryKeys.config.provider(type),
          queryFn: async () => {
            // 这里可以加载提供者配置
            // 暂时返回模拟数据
            return { type, config: {} };
          },
          ...queryOptions.longTerm,
        });
      });

      await Promise.all(promises);
    },
  };
}
