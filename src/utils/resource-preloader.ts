/**
 * 资源预加载管理器
 * 智能预加载关键资源，提升用户体验
 */

import React from 'react';
import { performanceMetricsCollector } from './performance-metrics';

/**
 * 预加载资源类型
 */
type PreloadResourceType = 'script' | 'style' | 'image' | 'font' | 'fetch';

/**
 * 预加载配置
 */
interface PreloadConfig {
  url: string;
  type: PreloadResourceType;
  priority: 'high' | 'medium' | 'low';
  crossOrigin?: 'anonymous' | 'use-credentials';
  integrity?: string;
  condition?: () => boolean; // 预加载条件
}

/**
 * 预加载状态
 */
interface PreloadStatus {
  url: string;
  status: 'pending' | 'loading' | 'loaded' | 'error';
  startTime: number;
  endTime?: number;
  error?: Error;
}

/**
 * 资源预加载器类
 */
class ResourcePreloader {
  private preloadQueue: PreloadConfig[] = [];
  private preloadStatus: Map<string, PreloadStatus> = new Map();
  private loadedResources: Set<string> = new Set();
  private maxConcurrent = 3; // 最大并发预加载数
  private currentLoading = 0;

  /**
   * 添加预加载资源
   */
  addResource(config: PreloadConfig): void {
    // 检查是否已经加载或正在加载
    if (this.loadedResources.has(config.url) || this.preloadStatus.has(config.url)) {
      return;
    }

    // 检查预加载条件
    if (config.condition && !config.condition()) {
      return;
    }

    this.preloadQueue.push(config);
    this.processQueue();
  }

  /**
   * 批量添加预加载资源
   */
  addResources(configs: PreloadConfig[]): void {
    configs.forEach(config => this.addResource(config));
  }

  /**
   * 处理预加载队列
   */
  private async processQueue(): Promise<void> {
    while (this.preloadQueue.length > 0 && this.currentLoading < this.maxConcurrent) {
      const config = this.preloadQueue.shift();
      if (!config) break;

      this.currentLoading++;
      this.preloadResource(config).finally(() => {
        this.currentLoading--;
        this.processQueue(); // 继续处理队列
      });
    }
  }

  /**
   * 预加载单个资源
   */
  private async preloadResource(config: PreloadConfig): Promise<void> {
    const status: PreloadStatus = {
      url: config.url,
      status: 'loading',
      startTime: performance.now(),
    };

    this.preloadStatus.set(config.url, status);

    try {
      switch (config.type) {
        case 'script':
          await this.preloadScript(config);
          break;
        case 'style':
          await this.preloadStyle(config);
          break;
        case 'image':
          await this.preloadImage(config);
          break;
        case 'font':
          await this.preloadFont(config);
          break;
        case 'fetch':
          await this.preloadFetch(config);
          break;
        default:
          throw new Error(`不支持的资源类型: ${config.type}`);
      }

      status.status = 'loaded';
      status.endTime = performance.now();
      this.loadedResources.add(config.url);

      // 记录性能指标
      performanceMetricsCollector.recordMetric({
        name: 'resource_preload_time',
        value: status.endTime - status.startTime,
        unit: 'ms',
        category: 'ui',
        metadata: {
          component: 'resource_preloader',
          action: 'preload',
          resourceType: config.type,
          url: config.url,
          priority: config.priority,
        },
      });

      console.log(`资源预加载完成: ${config.url} (${status.endTime - status.startTime}ms)`);
    } catch (error) {
      status.status = 'error';
      status.error = error as Error;
      status.endTime = performance.now();

      console.error(`资源预加载失败: ${config.url}`, error);

      // 记录错误指标
      performanceMetricsCollector.recordMetric({
        name: 'resource_preload_error',
        value: 1,
        unit: 'count',
        category: 'ui',
        metadata: {
          component: 'resource_preloader',
          action: 'preload_error',
          resourceType: config.type,
          url: config.url,
          error: (error as Error).message,
        },
      });
    }
  }

  /**
   * 预加载脚本
   */
  private preloadScript(config: PreloadConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = config.url;

      if (config.crossOrigin) {
        link.crossOrigin = config.crossOrigin;
      }

      if (config.integrity) {
        link.integrity = config.integrity;
      }

      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`脚本预加载失败: ${config.url}`));

      document.head.appendChild(link);
    });
  }

  /**
   * 预加载样式
   */
  private preloadStyle(config: PreloadConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'style';
      link.href = config.url;

      if (config.crossOrigin) {
        link.crossOrigin = config.crossOrigin;
      }

      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`样式预加载失败: ${config.url}`));

      document.head.appendChild(link);
    });
  }

  /**
   * 预加载图片
   */
  private preloadImage(config: PreloadConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      if (config.crossOrigin) {
        img.crossOrigin = config.crossOrigin;
      }

      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`图片预加载失败: ${config.url}`));

      img.src = config.url;
    });
  }

  /**
   * 预加载字体
   */
  private preloadFont(config: PreloadConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'font';
      link.href = config.url;
      link.crossOrigin = 'anonymous'; // 字体通常需要CORS

      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`字体预加载失败: ${config.url}`));

      document.head.appendChild(link);
    });
  }

  /**
   * 预加载数据
   */
  private async preloadFetch(config: PreloadConfig): Promise<void> {
    try {
      const response = await fetch(config.url, {
        mode: config.crossOrigin ? 'cors' : 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 读取响应以确保完全加载
      await response.text();
    } catch (error) {
      throw new Error(`数据预加载失败: ${config.url} - ${(error as Error).message}`);
    }
  }

  /**
   * 获取预加载状态
   */
  getPreloadStatus(url: string): PreloadStatus | undefined {
    return this.preloadStatus.get(url);
  }

  /**
   * 获取所有预加载状态
   */
  getAllPreloadStatus(): PreloadStatus[] {
    return Array.from(this.preloadStatus.values());
  }

  /**
   * 检查资源是否已加载
   */
  isResourceLoaded(url: string): boolean {
    return this.loadedResources.has(url);
  }

  /**
   * 获取预加载统计
   */
  getPreloadStats(): {
    total: number;
    loaded: number;
    loading: number;
    error: number;
    averageLoadTime: number;
  } {
    const statuses = Array.from(this.preloadStatus.values());
    const loaded = statuses.filter(s => s.status === 'loaded');
    const loading = statuses.filter(s => s.status === 'loading');
    const error = statuses.filter(s => s.status === 'error');

    const averageLoadTime = loaded.length > 0
      ? loaded.reduce((sum, s) => sum + (s.endTime! - s.startTime), 0) / loaded.length
      : 0;

    return {
      total: statuses.length,
      loaded: loaded.length,
      loading: loading.length,
      error: error.length,
      averageLoadTime,
    };
  }

  /**
   * 清理预加载状态
   */
  cleanup(): void {
    this.preloadQueue = [];
    this.preloadStatus.clear();
    this.loadedResources.clear();
    this.currentLoading = 0;
  }

  /**
   * 设置最大并发数
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, max);
  }
}

// 导出单例实例
export const resourcePreloader = new ResourcePreloader();

/**
 * 预定义的预加载配置
 */
export const preloadConfigs = {
  // 关键UI组件
  criticalComponents: [
    {
      url: '/chunks/react-vendor.js',
      type: 'script' as const,
      priority: 'high' as const,
    },
    {
      url: '/chunks/ui-vendor.js',
      type: 'script' as const,
      priority: 'high' as const,
    },
  ],

  // 常用字体
  fonts: [
    {
      url: '/assets/fonts/inter.woff2',
      type: 'font' as const,
      priority: 'medium' as const,
    },
  ],

  // 常用图标
  icons: [
    {
      url: '/assets/icons/sprite.svg',
      type: 'image' as const,
      priority: 'low' as const,
    },
  ],
};

/**
 * 智能预加载策略
 */
export function initializeSmartPreloading(userPreferences: any): void {
  // 总是预加载关键组件
  resourcePreloader.addResources(preloadConfigs.criticalComponents);

  // 根据用户偏好预加载
  if (userPreferences.theme === 'dark') {
    resourcePreloader.addResource({
      url: '/assets/themes/dark.css',
      type: 'style',
      priority: 'medium',
    });
  }

  // 根据网络状况调整预加载策略
  if ('connection' in navigator) {
    const connection = (navigator as any).connection;
    if (connection.effectiveType === '4g') {
      // 高速网络，积极预加载
      resourcePreloader.addResources(preloadConfigs.fonts);
      resourcePreloader.addResources(preloadConfigs.icons);
      resourcePreloader.setMaxConcurrent(5);
    } else if (connection.effectiveType === '3g') {
      // 中速网络，适度预加载
      resourcePreloader.setMaxConcurrent(3);
    } else {
      // 低速网络，保守预加载
      resourcePreloader.setMaxConcurrent(1);
    }
  }
}

/**
 * React Hook for preload monitoring
 */
export function usePreloadMonitoring() {
  const [stats, setStats] = React.useState(resourcePreloader.getPreloadStats());

  React.useEffect(() => {
    const interval = setInterval(() => {
      setStats(resourcePreloader.getPreloadStats());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return stats;
}
