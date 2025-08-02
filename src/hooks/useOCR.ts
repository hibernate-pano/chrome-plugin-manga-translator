import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, queryOptions, queryErrorHandler } from './query-client';
import { APIManager } from '@/api/api-manager';

/**
 * 文字检测参数
 */
export interface TextDetectionParams {
  imageData: string;
  imageHash: string;
  options?: {
    preprocessingType?: string;
    timeout?: number;
    retryOptions?: {
      maxRetries: number;
      delayMs: number;
    };
  };
}

/**
 * 文字区域
 */
export interface TextArea {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
  type?: 'bubble' | 'narration' | 'sfx' | 'other';
  order?: number;
}

/**
 * 文字检测结果
 */
export interface TextDetectionResult {
  textAreas: TextArea[];
  processingTime?: number;
  method?: string;
}

/**
 * 文字检测查询钩子
 */
export function useTextDetection(params: TextDetectionParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ocr.detect(params.imageHash),
    queryFn: async (): Promise<TextDetectionResult> => {
      const apiManager = APIManager.getInstance();
      const textAreas = await apiManager.detectText(params.imageData, params.options);

      return {
        textAreas: textAreas || [],
        method: 'api',
      };
    },
    enabled: enabled && !!params.imageData && !!params.imageHash,
    ...queryOptions.standard,
    throwOnError: false,
  });
}

/**
 * 文字检测变更钩子（用于主动触发检测）
 */
export function useTextDetectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: TextDetectionParams): Promise<TextDetectionResult> => {
      const apiManager = APIManager.getInstance();
      const startTime = Date.now();
      const textAreas = await apiManager.detectText(params.imageData, params.options);
      const processingTime = Date.now() - startTime;

      return {
        textAreas: textAreas || [],
        processingTime,
        method: 'api',
      };
    },
    onSuccess: (data, variables) => {
      // 更新查询缓存
      queryClient.setQueryData(
        queryKeys.ocr.detect(variables.imageHash),
        data
      );

      // 使相关查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.ocr.all,
      });
    },
    throwOnError: false,
  });
}

/**
 * 文字提取查询钩子（用于提取特定区域的文字）
 */
export function useTextExtraction(
  imageHash: string,
  area: TextArea,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.ocr.extract(imageHash, area),
    queryFn: async (): Promise<string> => {
      // 这里可以实现特定区域的文字提取逻辑
      // 暂时返回区域中已有的文字
      return area.text || '';
    },
    enabled: enabled && !!imageHash && !!area,
    ...queryOptions.fast,
    throwOnError: false,
  });
}

/**
 * 预取OCR结果（用于优化用户体验）
 */
export function usePrefetchOCR() {
  const queryClient = useQueryClient();

  return {
    prefetchDetection: (params: TextDetectionParams) => {
      queryClient.prefetchQuery({
        queryKey: queryKeys.ocr.detect(params.imageHash),
        queryFn: async (): Promise<TextDetectionResult> => {
          const apiManager = APIManager.getInstance();
          const textAreas = await apiManager.detectText(params.imageData, params.options);

          return {
            textAreas: textAreas || [],
            method: 'api',
          };
        },
        ...queryOptions.standard,
      });
    },
  };
}

/**
 * OCR缓存管理钩子
 */
export function useOCRCache() {
  const queryClient = useQueryClient();

  return {
    // 清除特定图像的OCR缓存
    clearImageCache: (imageHash: string) => {
      queryClient.removeQueries({
        queryKey: queryKeys.ocr.detect(imageHash),
      });
    },

    // 清除所有OCR缓存
    clearAllCache: () => {
      queryClient.removeQueries({
        queryKey: queryKeys.ocr.all,
      });
    },

    // 获取缓存统计
    getCacheStats: () => {
      const cache = queryClient.getQueryCache();
      const ocrQueries = cache.findAll({
        queryKey: queryKeys.ocr.all,
      });

      return {
        totalQueries: ocrQueries.length,
        activeQueries: ocrQueries.filter(q => q.state.status === 'success').length,
        errorQueries: ocrQueries.filter(q => q.state.status === 'error').length,
        loadingQueries: ocrQueries.filter(q => q.state.status === 'pending').length,
      };
    },

    // 预热缓存（预加载常用的OCR结果）
    warmupCache: async (imageHashes: string[]) => {
      const promises = imageHashes.map(hash => {
        // 这里可以实现预热逻辑
        // 暂时只是标记为预热
        return Promise.resolve();
      });

      await Promise.all(promises);
    },
  };
}
