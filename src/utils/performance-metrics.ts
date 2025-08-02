/**
 * 性能指标收集和分析系统
 */

/**
 * 性能指标类型
 */
export interface PerformanceMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  category: 'api' | 'translation' | 'ui' | 'cache' | 'ocr';
  metadata?: Record<string, any>;
}

/**
 * API性能指标
 */
export interface APIPerformanceMetric extends PerformanceMetric {
  category: 'api';
  metadata: {
    provider: string;
    endpoint: string;
    method: string;
    statusCode?: number;
    requestSize?: number;
    responseSize?: number;
    retryCount?: number;
  };
}

/**
 * 翻译性能指标
 */
export interface TranslationPerformanceMetric extends PerformanceMetric {
  category: 'translation';
  metadata: {
    sourceLanguage: string;
    targetLanguage: string;
    textLength: number;
    provider: string;
    cacheHit: boolean;
    qualityScore?: number;
  };
}

/**
 * UI性能指标
 */
export interface UIPerformanceMetric extends PerformanceMetric {
  category: 'ui';
  metadata: {
    component: string;
    action: string;
    userAgent?: string;
  };
}

/**
 * 缓存性能指标
 */
export interface CachePerformanceMetric extends PerformanceMetric {
  category: 'cache';
  metadata: {
    cacheType: 'memory' | 'persistent' | 'offline';
    operation: 'get' | 'set' | 'delete' | 'cleanup';
    hitRate?: number;
    size?: number;
  };
}

/**
 * OCR性能指标
 */
export interface OCRPerformanceMetric extends PerformanceMetric {
  category: 'ocr';
  metadata: {
    imageSize: number;
    imageFormat: string;
    textLength: number;
    confidence?: number;
    provider: string;
  };
}

/**
 * 性能统计信息
 */
export interface PerformanceStats {
  category: string;
  count: number;
  average: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  trend: 'improving' | 'stable' | 'degrading';
  lastUpdated: number;
}

/**
 * 性能阈值配置
 */
export interface PerformanceThresholds {
  api: {
    responseTime: { warning: number; critical: number };
    errorRate: { warning: number; critical: number };
  };
  translation: {
    responseTime: { warning: number; critical: number };
    qualityScore: { warning: number; critical: number };
  };
  ui: {
    renderTime: { warning: number; critical: number };
    interactionDelay: { warning: number; critical: number };
  };
  cache: {
    hitRate: { warning: number; critical: number };
    responseTime: { warning: number; critical: number };
  };
  ocr: {
    responseTime: { warning: number; critical: number };
    confidence: { warning: number; critical: number };
  };
}

/**
 * 性能指标收集器
 */
export class PerformanceMetricsCollector {
  private static instance: PerformanceMetricsCollector;
  private metrics: PerformanceMetric[] = [];
  private maxMetrics: number = 10000;
  private listeners: Array<(metric: PerformanceMetric) => void> = [];

  private constructor() {
    this.loadMetricsFromStorage();
    this.setupPeriodicCleanup();
  }

  static getInstance(): PerformanceMetricsCollector {
    if (!PerformanceMetricsCollector.instance) {
      PerformanceMetricsCollector.instance = new PerformanceMetricsCollector();
    }
    return PerformanceMetricsCollector.instance;
  }

  /**
   * 记录性能指标
   */
  recordMetric(metric: Omit<PerformanceMetric, 'id' | 'timestamp'>): void {
    const fullMetric: PerformanceMetric = {
      ...metric,
      id: this.generateMetricId(),
      timestamp: Date.now(),
    };

    this.metrics.push(fullMetric);

    // 限制内存中的指标数量
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics * 0.8);
    }

    // 通知监听器
    this.listeners.forEach(listener => listener(fullMetric));

    // 异步保存到存储
    this.saveMetricsToStorage();
  }

  /**
   * 记录API性能指标
   */
  recordAPIMetric(
    name: string,
    value: number,
    metadata: APIPerformanceMetric['metadata']
  ): void {
    this.recordMetric({
      name,
      value,
      unit: 'ms',
      category: 'api',
      metadata,
    });
  }

  /**
   * 记录翻译性能指标
   */
  recordTranslationMetric(
    name: string,
    value: number,
    metadata: TranslationPerformanceMetric['metadata']
  ): void {
    this.recordMetric({
      name,
      value,
      unit: 'ms',
      category: 'translation',
      metadata,
    });
  }

  /**
   * 记录UI性能指标
   */
  recordUIMetric(
    name: string,
    value: number,
    metadata: UIPerformanceMetric['metadata']
  ): void {
    this.recordMetric({
      name,
      value,
      unit: 'ms',
      category: 'ui',
      metadata,
    });
  }

  /**
   * 记录缓存性能指标
   */
  recordCacheMetric(
    name: string,
    value: number,
    metadata: CachePerformanceMetric['metadata']
  ): void {
    this.recordMetric({
      name,
      value,
      unit: 'ms',
      category: 'cache',
      metadata,
    });
  }

  /**
   * 记录OCR性能指标
   */
  recordOCRMetric(
    name: string,
    value: number,
    metadata: OCRPerformanceMetric['metadata']
  ): void {
    this.recordMetric({
      name,
      value,
      unit: 'ms',
      category: 'ocr',
      metadata,
    });
  }

  /**
   * 获取性能统计信息
   */
  getStats(
    category?: string,
    timeRange?: { start: number; end: number }
  ): Record<string, PerformanceStats> {
    let filteredMetrics = this.metrics;

    if (category) {
      filteredMetrics = filteredMetrics.filter(m => m.category === category);
    }

    if (timeRange) {
      filteredMetrics = filteredMetrics.filter(
        m => m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
      );
    }

    const statsByName: Record<string, PerformanceStats> = {};

    // 按指标名称分组
    const groupedMetrics = filteredMetrics.reduce((acc, metric) => {
      if (!acc[metric.name]) {
        acc[metric.name] = [];
      }
      acc[metric.name]!.push(metric);
      return acc;
    }, {} as Record<string, PerformanceMetric[]>);

    // 计算统计信息
    Object.entries(groupedMetrics).forEach(([name, metrics]) => {
      const values = metrics.map(m => m.value).sort((a, b) => a - b);
      const count = values.length;

      if (count === 0) return;

      const sum = values.reduce((a, b) => a + b, 0);
      const average = sum / count;
      const min = values[0];
      const max = values[count - 1];
      const p50 = this.percentile(values, 0.5);
      const p95 = this.percentile(values, 0.95);
      const p99 = this.percentile(values, 0.99);

      // 计算趋势
      const trend = this.calculateTrend(metrics);

      statsByName[name] = {
        category: metrics[0]!.category,
        count,
        average,
        min: min || 0,
        max: max || 0,
        p50,
        p95,
        p99,
        trend,
        lastUpdated: Math.max(...metrics.map(m => m.timestamp)),
      };
    });

    return statsByName;
  }

  /**
   * 获取最近的指标
   */
  getRecentMetrics(
    count: number = 100,
    category?: string
  ): PerformanceMetric[] {
    let filteredMetrics = this.metrics;

    if (category) {
      filteredMetrics = filteredMetrics.filter(m => m.category === category);
    }

    return filteredMetrics
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }

  /**
   * 添加指标监听器
   */
  addListener(listener: (metric: PerformanceMetric) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除指标监听器
   */
  removeListener(listener: (metric: PerformanceMetric) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 清理旧指标
   */
  cleanup(olderThan: number = 7 * 24 * 60 * 60 * 1000): void {
    const cutoffTime = Date.now() - olderThan;
    this.metrics = this.metrics.filter(m => m.timestamp > cutoffTime);
    this.saveMetricsToStorage();
  }

  /**
   * 导出指标数据
   */
  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      return this.exportToCSV();
    }
    return JSON.stringify(this.metrics, null, 2);
  }

  /**
   * 生成指标ID
   */
  private generateMetricId(): string {
    return `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 计算百分位数
   */
  private percentile(values: number[], p: number): number {
    const index = Math.ceil(values.length * p) - 1;
    return values[Math.max(0, index)] || 0;
  }

  /**
   * 计算趋势
   */
  private calculateTrend(metrics: PerformanceMetric[]): 'improving' | 'stable' | 'degrading' {
    if (metrics.length < 10) return 'stable';

    const sortedMetrics = metrics.sort((a, b) => a.timestamp - b.timestamp);
    const firstHalf = sortedMetrics.slice(0, Math.floor(sortedMetrics.length / 2));
    const secondHalf = sortedMetrics.slice(Math.floor(sortedMetrics.length / 2));

    const firstAvg = firstHalf.reduce((sum, m) => sum + m.value, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, m) => sum + m.value, 0) / secondHalf.length;

    const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;

    if (changePercent < -5) return 'improving';
    if (changePercent > 5) return 'degrading';
    return 'stable';
  }

  /**
   * 导出为CSV格式
   */
  private exportToCSV(): string {
    const headers = ['id', 'name', 'value', 'unit', 'timestamp', 'category', 'metadata'];
    const rows = this.metrics.map(metric => [
      metric.id,
      metric.name,
      metric.value.toString(),
      metric.unit,
      new Date(metric.timestamp).toISOString(),
      metric.category,
      JSON.stringify(metric.metadata || {}),
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * 从存储加载指标
   */
  private async loadMetricsFromStorage(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get('performanceMetrics');
        if (result['performanceMetrics']) {
          this.metrics = JSON.parse(result['performanceMetrics']);
        }
      }
    } catch (error) {
      console.error('加载性能指标失败:', error);
    }
  }

  /**
   * 保存指标到存储
   */
  private async saveMetricsToStorage(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        // 只保存最近的指标以节省存储空间
        const recentMetrics = this.metrics.slice(-5000);
        await chrome.storage.local.set({
          performanceMetrics: JSON.stringify(recentMetrics)
        });
      }
    } catch (error) {
      console.error('保存性能指标失败:', error);
    }
  }

  /**
   * 设置定期清理
   */
  private setupPeriodicCleanup(): void {
    // 每小时清理一次旧指标
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }
}

// 导出单例实例
export const performanceMetricsCollector = PerformanceMetricsCollector.getInstance();
