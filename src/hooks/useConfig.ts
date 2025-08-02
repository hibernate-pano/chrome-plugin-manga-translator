import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, queryOptions } from './query-client';
import { useConfigStore } from '@/stores/config';
import { APIManager } from '@/api/api-manager';

/**
 * 提供者验证结果
 */
export interface ProviderValidationResult {
  isValid: boolean;
  message: string;
  errors?: string[];
}

/**
 * 提供者配置验证查询钩子
 */
export function useProviderValidation(
  providerType: string,
  config: any,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.config.validation(providerType, config),
    queryFn: async (): Promise<ProviderValidationResult> => {
      try {
        const apiManager = APIManager.getInstance();

        // 临时切换到指定提供者进行验证
        await apiManager.switchProvider(providerType as any, config);

        // 这里可以添加实际的验证逻辑
        // 例如：发送测试请求验证API密钥是否有效

        return {
          isValid: true,
          message: '配置验证成功',
        };
      } catch (error) {
        return {
          isValid: false,
          message: error instanceof Error ? error.message : '配置验证失败',
          errors: [error instanceof Error ? error.message : '未知错误'],
        };
      }
    },
    enabled: enabled && !!providerType && !!config,
    ...queryOptions.fast,
    throwOnError: false,
  });
}

/**
 * 配置保存变更钩子
 */
export function useConfigMutation() {
  const queryClient = useQueryClient();
  const configStore = useConfigStore();

  return useMutation({
    mutationFn: async (newConfig: any) => {
      // 更新配置存储
      configStore.updateConfig(newConfig);

      // 重新初始化API管理器
      const apiManager = APIManager.getInstance();
      await apiManager.initialize();

      return newConfig;
    },
    onSuccess: () => {
      // 使所有配置相关的查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.config.all,
      });

      // 清除翻译和OCR缓存，因为提供者可能已更改
      queryClient.invalidateQueries({
        queryKey: queryKeys.translation.all,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.ocr.all,
      });
    },
    throwOnError: false,
  });
}

/**
 * 提供者切换变更钩子
 */
export function useProviderSwitchMutation() {
  const queryClient = useQueryClient();
  const configStore = useConfigStore();

  return useMutation({
    mutationFn: async ({
      providerType,
      config
    }: {
      providerType: string;
      config: any;
    }) => {
      // 更新配置存储
      configStore.setProviderType(providerType as any);
      if (config) {
        configStore.updateProviderConfig(providerType as any, config);
      }

      // 切换API提供者
      const apiManager = APIManager.getInstance();
      await apiManager.switchProvider(providerType as any, config);

      return { providerType, config };
    },
    onSuccess: () => {
      // 使所有相关查询失效
      queryClient.invalidateQueries({
        queryKey: queryKeys.config.all,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.translation.all,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.ocr.all,
      });
    },
    throwOnError: false,
  });
}

/**
 * 配置重置变更钩子
 */
export function useConfigResetMutation() {
  const queryClient = useQueryClient();
  const configStore = useConfigStore();

  return useMutation({
    mutationFn: async () => {
      // 重置配置
      configStore.resetToDefaults();

      // 重新初始化API管理器
      const apiManager = APIManager.getInstance();
      await apiManager.initialize();

      return true;
    },
    onSuccess: () => {
      // 清除所有缓存
      queryClient.clear();
    },
    throwOnError: false,
  });
}

/**
 * 配置导出钩子
 */
export function useConfigExport() {
  const configStore = useConfigStore();

  return {
    exportConfig: () => {
      const config = configStore;
      const exportData = {
        version: '0.2.0',
        timestamp: new Date().toISOString(),
        config: {
          providerType: config.providerType,
          providerConfig: config.providerConfig,
          ocrSettings: config.ocrSettings,
          styleLevel: config.styleLevel,
          fontFamily: config.fontFamily,
          fontSize: config.fontSize,
          fontColor: config.fontColor,
          backgroundColor: config.backgroundColor,
          shortcuts: config.shortcuts,
          advancedSettings: config.advancedSettings,
        },
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manga-translator-config-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * 配置导入变更钩子
 */
export function useConfigImportMutation() {
  const queryClient = useQueryClient();
  const configStore = useConfigStore();

  return useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const importData = JSON.parse(text);

      // 验证导入数据格式
      if (!importData.config || !importData.version) {
        throw new Error('无效的配置文件格式');
      }

      // 更新配置
      configStore.updateConfig(importData.config);

      // 重新初始化API管理器
      const apiManager = APIManager.getInstance();
      await apiManager.initialize();

      return importData;
    },
    onSuccess: () => {
      // 清除所有缓存
      queryClient.clear();
    },
    throwOnError: false,
  });
}
