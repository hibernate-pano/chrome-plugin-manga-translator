/**
 * 全局类型定义 (v2)
 *
 * v2 核心类型统一从各模块 re-export，
 * 此文件保留通用 UI/工具类型。
 */

// ==================== Re-export from v2 modules ====================

export type { ProviderType } from '@/providers/base';
export type {
  VisionProvider,
  ProviderConfig as VisionProviderConfig,
  VisionResponse,
  ValidationResult,
  TextArea,
} from '@/providers/base';
export type {
  ImageReadingResult,
  ReadingEntry,
  ReadingPipeline,
  ReadingRegion,
} from '@/services/reading-result';

// ==================== UI 相关类型 ====================

export type Theme = 'light' | 'dark' | 'system';
export type Language = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR';
export type TranslationMode = 'manual' | 'auto';
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationConfig {
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// ==================== 工具类型 ====================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
