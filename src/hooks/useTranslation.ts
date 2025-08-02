import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, queryOptions } from './query-client';
import { APIManager } from '@/api/api-manager';
import { unifiedCacheManager } from '../utils/unified-cache-manager';
import { cacheWarmupManager } from '../utils/cache-warmup';
import { offlineManager } from '../utils/offline-manager';
import { usePerformanceRecorder } from './usePerformanceMonitoring';

/**
 * 翻译请求参数
 */
export interface TranslationParams {
  text: string;
  targetLang: string;
  sourceLanguage?: string;
  context?: string;
}

/**
 * 批量翻译请求参数
 */
export interface BatchTranslationParams {
  texts: string[];
  targetLang: string;
  sourceLanguage?: string;
  context?: string;
}

/**
 * 翻译结果
 */
export interface TranslationResult {
  translatedText: string;
  sourceLanguage?: string;
  confidence?: number;
}

/**
 * 单文本翻译查询钩子
 */
export function useTranslateText(params: TranslationParams, enabled = true) {
  const { recordTranslationMetric } = usePerformanceRecorder();

  return useQuery({
    queryKey: queryKeys.translation.text(params.text, params.targetLang),
    queryFn: async (): Promise<TranslationResult> => {
      const startTime = performance.now();
      const cacheKey = `translation:${params.text}:${params.targetLang}`;

      try {
        // 记录用户行为用于缓存预热
        cacheWarmupManager.recordUserBehavior('translate', {
          text: params.text,
          language: params.targetLang
        });

        // 检查缓存
        const cachedResult = await unifiedCacheManager.get(cacheKey, 'translation');

        if (cachedResult) {
          const duration = performance.now() - startTime;
          recordTranslationMetric('translation_cache_hit', duration, {
            sourceLanguage: params.sourceLanguage || 'auto',
            targetLanguage: params.targetLang,
            textLength: params.text.length,
            provider: 'cache',
            cacheHit: true,
          });

          return cachedResult as TranslationResult;
        }

        // API调用
        const apiManager = APIManager.getInstance();
        const results = await apiManager.translateText([params.text], params.targetLang, {
          sourceLanguage: params.sourceLanguage,
          context: params.context,
        });

        // 确保结果是数组格式
        const resultArray = Array.isArray(results) ? results : [results];
        const result = {
          translatedText: resultArray[0] || '',
          sourceLanguage: params.sourceLanguage,
        };

        // 缓存结果
        await unifiedCacheManager.set(cacheKey, result, 'translation', {
          enableOffline: true,
          priority: 3
        });

        // 记录性能指标
        const duration = performance.now() - startTime;
        recordTranslationMetric('translation_api_call', duration, {
          sourceLanguage: params.sourceLanguage || 'auto',
          targetLanguage: params.targetLang,
          textLength: params.text.length,
          provider: 'api',
          cacheHit: false,
        });

        return result;
      } catch (error) {
        // 记录错误性能指标
        const duration = performance.now() - startTime;
        recordTranslationMetric('translation_error', duration, {
          sourceLanguage: params.sourceLanguage || 'auto',
          targetLanguage: params.targetLang,
          textLength: params.text.length,
          provider: 'api',
          cacheHit: false,
        });

        // 尝试离线数据
        const offlineData = offlineManager.getOfflineData(cacheKey);
        if (offlineData && offlineData.data) {
          return offlineData.data as unknown as TranslationResult;
        }

        throw error;
      }
    },
    enabled: enabled && !!params.text && !!params.targetLang,
    ...queryOptions.standard,
    throwOnError: false,
  });
}

/**
 * 批量翻译查询钩子
 */
export function useBatchTranslation(params: BatchTranslationParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.translation.batch(params.texts, params.targetLang),
    queryFn: async (): Promise<string[]> => {
      const apiManager = APIManager.getInstance();
      const results = await apiManager.translateText(params.texts, params.targetLang, {
        sourceLanguage: params.sourceLanguage,
        context: params.context,
      });

      // 确保结果是数组格式
      return Array.isArray(results) ? results : [results];
    },
    enabled: enabled && params.texts.length > 0 && !!params.targetLang,
    ...queryOptions.standard,
    throwOnError: false,
  });
}

/**
 * 翻译变更钩子（用于主动触发翻译）
 */
export function useTranslateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: TranslationParams): Promise<TranslationResult> => {
      const cacheKey = `translation:${params.text}:${params.targetLang}`;

      // 记录用户行为
      cacheWarmupManager.recordUserBehavior('translate', {
        text: params.text,
        language: params.targetLang,
      });

      // 检查离线模式
      if (!offlineManager.isNetworkOnline()) {
        const offlineData = await unifiedCacheManager.get<TranslationResult>(
          cacheKey,
          'translation',
          { fallbackToOffline: true }
        );

        if (offlineData) {
          return offlineData;
        }

        throw new Error('网络不可用且无缓存数据');
      }

      const apiManager = APIManager.getInstance();
      const results = await apiManager.translateText([params.text], params.targetLang, {
        sourceLanguage: params.sourceLanguage,
        context: params.context,
      });

      // 确保结果是数组格式
      const resultArray = Array.isArray(results) ? results : [results];

      const result: TranslationResult = {
        translatedText: resultArray[0] || '',
        sourceLanguage: params.sourceLanguage,
      };

      // 使用智能缓存存储结果
      await unifiedCacheManager.set(cacheKey, result, 'translation', {
        enableOffline: true,
        priority: 3,
      });

      // 触发预测性预加载
      cacheWarmupManager.predictAndPreload({
        action: 'translate',
        text: params.text,
        language: params.targetLang,
      });

      return result;
    },
    onSuccess: (data, variables) => {
      // 更新查询缓存
      queryClient.setQueryData(
        queryKeys.translation.text(variables.text, variables.targetLang),
        data
      );

      // 使相关查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.translation.all,
      });
    },
    throwOnError: false,
  });
}

/**
 * 批量翻译变更钩子
 */
export function useBatchTranslateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: BatchTranslationParams): Promise<string[]> => {
      // 记录批量翻译行为
      cacheWarmupManager.recordUserBehavior('batchTranslate', {
        language: params.targetLang,
      });

      // 检查离线模式
      if (!offlineManager.isNetworkOnline()) {
        const cachedResults: string[] = [];
        let allCached = true;

        for (const text of params.texts) {
          const cacheKey = `translation:${text}:${params.targetLang}`;
          const cached = await unifiedCacheManager.get<TranslationResult>(
            cacheKey,
            'translation',
            { fallbackToOffline: true }
          );

          if (cached) {
            cachedResults.push(cached.translatedText);
          } else {
            allCached = false;
            break;
          }
        }

        if (allCached) {
          return cachedResults;
        }

        throw new Error('网络不可用且部分文本无缓存数据');
      }

      const apiManager = APIManager.getInstance();
      const results = await apiManager.translateText(params.texts, params.targetLang, {
        sourceLanguage: params.sourceLanguage,
        context: params.context,
      });

      // 确保结果是数组格式
      const resultArray = Array.isArray(results) ? results : [results];

      // 缓存每个翻译结果
      for (let i = 0; i < params.texts.length; i++) {
        if (resultArray[i]) {
          const cacheKey = `translation:${params.texts[i]}:${params.targetLang}`;
          const result: TranslationResult = {
            translatedText: resultArray[i] || '',
            sourceLanguage: params.sourceLanguage,
          };

          await unifiedCacheManager.set(cacheKey, result, 'translation', {
            enableOffline: true,
            priority: 2, // 批量翻译优先级稍低
          });
        }
      }

      return resultArray;
    },
    onSuccess: (data, variables) => {
      // 更新查询缓存
      queryClient.setQueryData(
        queryKeys.translation.batch(variables.texts, variables.targetLang),
        data
      );

      // 缓存单个翻译结果
      variables.texts.forEach((text, index) => {
        if (data[index]) {
          queryClient.setQueryData(
            queryKeys.translation.text(text, variables.targetLang),
            {
              translatedText: data[index],
              sourceLanguage: variables.sourceLanguage,
            }
          );
        }
      });

      // 使相关查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.translation.all,
      });
    },
    throwOnError: false,
  });
}

/**
 * 翻译历史查询钩子
 */
export function useTranslationHistory() {
  return useQuery({
    queryKey: queryKeys.translation.history(),
    queryFn: async () => {
      // 这里可以从本地存储或API获取翻译历史
      // 暂时返回空数组
      return [];
    },
    ...queryOptions.longTerm,
    throwOnError: false,
  });
}

/**
 * 预取翻译结果（用于优化用户体验）
 */
export function usePrefetchTranslation() {
  const queryClient = useQueryClient();

  return {
    prefetchText: (params: TranslationParams) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.translation.text(params.text, params.targetLang),
        queryFn: async (): Promise<TranslationResult> => {
          const apiManager = APIManager.getInstance();
          const results = await apiManager.translateText([params.text], params.targetLang, {
            sourceLanguage: params.sourceLanguage,
            context: params.context,
          });

          // 确保结果是数组格式
          const resultArray = Array.isArray(results) ? results : [results];

          return {
            translatedText: resultArray[0] || '',
            sourceLanguage: params.sourceLanguage,
          };
        },
        ...queryOptions.standard,
      });
    },

    prefetchBatch: (params: BatchTranslationParams) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.translation.batch(params.texts, params.targetLang),
        queryFn: async (): Promise<string[]> => {
          const apiManager = APIManager.getInstance();
          const results = await apiManager.translateText(params.texts, params.targetLang, {
            sourceLanguage: params.sourceLanguage,
            context: params.context,
          });

          // 确保结果是数组格式
          return Array.isArray(results) ? results : [results];
        },
        ...queryOptions.standard,
      });
    },
  };
}
