/**
 * 内存优化管理器
 * 监控和优化内存使用，防止内存泄漏
 */

import React from 'react';
import { performanceMetricsCollector } from './performance-metrics';

/**
 * 内存使用统计
 */
interface MemoryStats {
  used: number;
  total: number;
  percentage: number;
  timestamp: number;
}

/**
 * 内存监控配置
 */
interface MemoryMonitorConfig {
  checkInterval: number; // 检查间隔（毫秒）
  warningThreshold: number; // 警告阈值（百分比）
  criticalThreshold: number; // 危险阈值（百分比）
  maxHistorySize: number; // 历史记录最大数量
  enableAutoCleanup: boolean; // 启用自动清理
}

/**
 * 内存优化器类
 */
class MemoryOptimizer {
  private config: MemoryMonitorConfig;
  private memoryHistory: MemoryStats[] = [];
  private monitoringInterval?: number;
  private weakRefs: Set<any> = new Set();
  private cleanupCallbacks: Set<() => void> = new Set();

  constructor(config: Partial<MemoryMonitorConfig> = {}) {
    this.config = {
      checkInterval: 30000, // 30秒
      warningThreshold: 70, // 70%
      criticalThreshold: 85, // 85%
      maxHistorySize: 100,
      enableAutoCleanup: true,
      ...config,
    };
  }

  /**
   * 开始内存监控
   */
  startMonitoring(): void {
    if (this.monitoringInterval) {
      return;
    }

    this.monitoringInterval = window.setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.checkInterval);

    console.log('内存监控已启动');
  }

  /**
   * 停止内存监控
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      console.log('内存监控已停止');
    }
  }

  /**
   * 检查内存使用情况
   */
  private checkMemoryUsage(): void {
    if (!('memory' in performance)) {
      return;
    }

    const memory = (performance as any).memory;
    const stats: MemoryStats = {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100,
      timestamp: Date.now(),
    };

    this.memoryHistory.push(stats);

    // 限制历史记录大小
    if (this.memoryHistory.length > this.config.maxHistorySize) {
      this.memoryHistory = this.memoryHistory.slice(-this.config.maxHistorySize);
    }

    // 记录性能指标
    performanceMetricsCollector.recordMetric({
      name: 'memory_usage',
      value: stats.percentage,
      unit: 'percent',
      category: 'ui',
      metadata: {
        component: 'memory_optimizer',
        action: 'monitor',
        used: stats.used,
        total: stats.total,
      },
    });

    // 检查是否需要清理
    this.checkThresholds(stats);
  }

  /**
   * 检查阈值并执行相应操作
   */
  private checkThresholds(stats: MemoryStats): void {
    if (stats.percentage >= this.config.criticalThreshold) {
      console.warn(`内存使用率达到危险水平: ${stats.percentage.toFixed(1)}%`);
      this.performCriticalCleanup();
    } else if (stats.percentage >= this.config.warningThreshold) {
      console.warn(`内存使用率较高: ${stats.percentage.toFixed(1)}%`);
      if (this.config.enableAutoCleanup) {
        this.performRoutineCleanup();
      }
    }
  }

  /**
   * 执行常规清理
   */
  public performRoutineCleanup(): void {
    console.log('执行常规内存清理...');

    // 清理弱引用
    this.cleanupWeakRefs();

    // 执行注册的清理回调
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('清理回调执行失败:', error);
      }
    });

    // 建议垃圾回收（如果可用）
    if ('gc' in window && typeof (window as any).gc === 'function') {
      (window as any).gc();
    }
  }

  /**
   * 执行紧急清理
   */
  private performCriticalCleanup(): void {
    console.log('执行紧急内存清理...');

    // 执行常规清理
    this.performRoutineCleanup();

    // 清理内存历史记录
    this.memoryHistory = this.memoryHistory.slice(-10);

    // 通知应用进行深度清理
    window.dispatchEvent(new CustomEvent('memory-critical', {
      detail: { memoryUsage: this.getLatestStats() }
    }));
  }

  /**
   * 清理弱引用
   */
  private cleanupWeakRefs(): void {
    const toDelete: WeakRef<any>[] = [];

    this.weakRefs.forEach(ref => {
      if (ref.deref() === undefined) {
        toDelete.push(ref);
      }
    });

    toDelete.forEach(ref => {
      this.weakRefs.delete(ref);
    });

    if (toDelete.length > 0) {
      console.log(`清理了 ${toDelete.length} 个无效弱引用`);
    }
  }

  /**
   * 注册对象的弱引用
   */
  registerWeakRef<T extends object>(obj: T): any {
    const ref = new (globalThis as any).WeakRef(obj);
    this.weakRefs.add(ref);
    return ref;
  }

  /**
   * 注册清理回调
   */
  registerCleanupCallback(callback: () => void): () => void {
    this.cleanupCallbacks.add(callback);

    // 返回取消注册的函数
    return () => {
      this.cleanupCallbacks.delete(callback);
    };
  }

  /**
   * 获取最新的内存统计
   */
  getLatestStats(): MemoryStats | null {
    return this.memoryHistory.length > 0
      ? this.memoryHistory[this.memoryHistory.length - 1]
      : null;
  }

  /**
   * 获取内存历史记录
   */
  getMemoryHistory(): MemoryStats[] {
    return [...this.memoryHistory];
  }

  /**
   * 获取内存趋势分析
   */
  getMemoryTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable';
    averageUsage: number;
    peakUsage: number;
    recentChange: number;
  } {
    if (this.memoryHistory.length < 2) {
      return {
        trend: 'stable',
        averageUsage: 0,
        peakUsage: 0,
        recentChange: 0,
      };
    }

    const recent = this.memoryHistory.slice(-10);
    const averageUsage = recent.reduce((sum, stat) => sum + stat.percentage, 0) / recent.length;
    const peakUsage = Math.max(...recent.map(stat => stat.percentage));

    const firstRecent = recent[0];
    const lastRecent = recent[recent.length - 1];
    const recentChange = lastRecent.percentage - firstRecent.percentage;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (Math.abs(recentChange) > 5) {
      trend = recentChange > 0 ? 'increasing' : 'decreasing';
    }

    return {
      trend,
      averageUsage,
      peakUsage,
      recentChange,
    };
  }

  /**
   * 强制执行垃圾回收（如果可用）
   */
  forceGarbageCollection(): boolean {
    if ('gc' in window && typeof (window as any).gc === 'function') {
      (window as any).gc();
      console.log('强制执行垃圾回收');
      return true;
    }
    return false;
  }

  /**
   * 获取内存优化建议
   */
  getOptimizationRecommendations(): string[] {
    const recommendations: string[] = [];
    const trend = this.getMemoryTrend();

    if (trend.averageUsage > 60) {
      recommendations.push('内存使用率较高，建议清理不必要的缓存');
    }

    if (trend.trend === 'increasing') {
      recommendations.push('内存使用呈上升趋势，检查是否存在内存泄漏');
    }

    if (trend.peakUsage > 80) {
      recommendations.push('内存峰值过高，考虑优化大对象的使用');
    }

    if (this.weakRefs.size > 1000) {
      recommendations.push('弱引用数量较多，建议定期清理');
    }

    if (recommendations.length === 0) {
      recommendations.push('内存使用正常，无需特别优化');
    }

    return recommendations;
  }

  /**
   * 销毁优化器
   */
  destroy(): void {
    this.stopMonitoring();
    this.memoryHistory = [];
    this.weakRefs.clear();
    this.cleanupCallbacks.clear();
  }
}

// 导出单例实例
export const memoryOptimizer = new MemoryOptimizer();

/**
 * React Hook for memory monitoring
 */
export function useMemoryMonitoring() {
  const [memoryStats, setMemoryStats] = React.useState<MemoryStats | null>(null);

  React.useEffect(() => {
    const updateStats = () => {
      setMemoryStats(memoryOptimizer.getLatestStats());
    };

    // 立即更新一次
    updateStats();

    // 定期更新
    const interval = setInterval(updateStats, 5000);

    return () => clearInterval(interval);
  }, []);

  return {
    memoryStats,
    memoryHistory: memoryOptimizer.getMemoryHistory(),
    memoryTrend: memoryOptimizer.getMemoryTrend(),
    recommendations: memoryOptimizer.getOptimizationRecommendations(),
    forceCleanup: () => memoryOptimizer.performRoutineCleanup(),
  };
}
