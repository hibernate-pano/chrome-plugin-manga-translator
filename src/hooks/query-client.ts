import { QueryClient } from '@tanstack/react-query';

/**
 * React Query客户端配置
 * 针对Chrome扩展环境优化
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 缓存时间：5分钟
      staleTime: 5 * 60 * 1000,
      // 垃圾回收时间：10分钟
      gcTime: 10 * 60 * 1000,
      // 重试配置
      retry: (failureCount, error) => {
        // API错误不重试
        if (error instanceof Error && error.message.includes('API')) {
          return false;
        }
        // 网络错误最多重试3次
        return failureCount < 3;
      },
      // 重试延迟：指数退避
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // 后台重新获取
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // 网络状态变化时重新获取
      refetchOnMount: true,
    },
    mutations: {
      // 变更重试配置
      retry: 1,
      retryDelay: 1000,
    },
  },
});

/**
 * 查询键工厂
 * 统一管理所有查询键，避免重复和冲突
 */
export const queryKeys = {
  // 翻译相关
  translation: {
    all: ['translation'] as const,
    text: (text: string, targetLang: string) =>
      [...queryKeys.translation.all, 'text', text, targetLang] as const,
    batch: (texts: string[], targetLang: string) =>
      [...queryKeys.translation.all, 'batch', texts, targetLang] as const,
    history: () => [...queryKeys.translation.all, 'history'] as const,
  },

  // OCR相关
  ocr: {
    all: ['ocr'] as const,
    detect: (imageHash: string) =>
      [...queryKeys.ocr.all, 'detect', imageHash] as const,
    extract: (imageHash: string, area: any) =>
      [...queryKeys.ocr.all, 'extract', imageHash, area] as const,
  },

  // 配置相关
  config: {
    all: ['config'] as const,
    provider: (providerType: string) =>
      [...queryKeys.config.all, 'provider', providerType] as const,
    validation: (providerType: string, config: any) =>
      [...queryKeys.config.all, 'validation', providerType, config] as const,
  },

  // 缓存相关
  cache: {
    all: ['cache'] as const,
    stats: () => [...queryKeys.cache.all, 'stats'] as const,
    entries: (type?: string) =>
      [...queryKeys.cache.all, 'entries', type] as const,
    intelligent: () => [...queryKeys.cache.all, 'intelligent'] as const,
    offline: (type?: string) => [...queryKeys.cache.all, 'offline', type] as const,
    networkStatus: () => [...queryKeys.cache.all, 'networkStatus'] as const,
    performance: () => [...queryKeys.cache.all, 'performance'] as const,
    config: () => [...queryKeys.cache.all, 'config'] as const,
    health: () => [...queryKeys.cache.all, 'health'] as const,
  },

  // 性能监控相关
  performance: {
    all: ['performance'] as const,
    stats: (category?: string, timeRange?: { start: number; end: number }) =>
      [...queryKeys.performance.all, 'stats', category, timeRange] as const,
    recent: (count?: number, category?: string) =>
      [...queryKeys.performance.all, 'recent', count, category] as const,
    thresholds: () => [...queryKeys.performance.all, 'thresholds'] as const,
    alerts: () => [...queryKeys.performance.all, 'alerts'] as const,
  },
} as const;

/**
 * 查询选项预设
 */
export const queryOptions = {
  // 快速查询（用于UI响应）
  fast: {
    staleTime: 30 * 1000, // 30秒
    gcTime: 2 * 60 * 1000, // 2分钟
  },

  // 标准查询（默认）
  standard: {
    staleTime: 5 * 60 * 1000, // 5分钟
    gcTime: 10 * 60 * 1000, // 10分钟
  },

  // 长期缓存（用于配置等不常变化的数据）
  longTerm: {
    staleTime: 30 * 60 * 1000, // 30分钟
    gcTime: 60 * 60 * 1000, // 1小时
  },

  // 实时查询（用于需要实时更新的数据）
  realTime: {
    staleTime: 0,
    gcTime: 1 * 60 * 1000, // 1分钟
    refetchInterval: 5000, // 5秒轮询
  },
} as const;

/**
 * 错误处理工具
 */
export const queryErrorHandler = {
  /**
   * 标准错误处理
   */
  standard: (error: Error) => {
    console.error('Query error:', error);
    // 可以在这里添加错误上报逻辑
  },

  /**
   * 静默错误处理（不显示错误信息）
   */
  silent: (error: Error) => {
    console.debug('Query error (silent):', error);
  },

  /**
   * 用户友好的错误处理
   */
  userFriendly: (error: Error) => {
    console.error('Query error:', error);
    // 可以在这里显示用户友好的错误消息
    // 例如：toast.error('操作失败，请重试');
  },
};
