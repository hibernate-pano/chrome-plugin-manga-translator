import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, queryOptions, queryErrorHandler } from './query-client';
import { APIManager } from '@/api/api-manager';

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
  return useQuery({
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
      const apiManager = APIManager.getInstance();
      const results = await apiManager.translateText(params.texts, params.targetLang, {
        sourceLanguage: params.sourceLanguage,
        context: params.context,
      });

      // 确保结果是数组格式
      return Array.isArray(results) ? results : [results];
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
