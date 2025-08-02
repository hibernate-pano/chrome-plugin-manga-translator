/**
 * 性能监控器
 * 监控API调用性能、缓存命中率、错误率等指标
 */
export interface PerformanceMetrics {
  // API调用指标
  apiCalls: {
    total: number;
    successful: number;
    failed: number;
    averageResponseTime: number;
    totalResponseTime: number;
  };
  
  // 缓存指标
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    totalSize: number;
  };
  
  // 错误指标
  errors: {
    total: number;
    byType: Record<string, number>;
    byProvider: Record<string, number>;
  };
  
  // 翻译指标
  translation: {
    totalTexts: number;
    totalCharacters: number;
    averageTextLength: number;
    batchRequests: number;
    singleRequests: number;
  };
  
  // OCR指标
  ocr: {
    totalImages: number;
    totalTextAreas: number;
    averageAreasPerImage: number;
    averageProcessingTime: number;
  };
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: PerformanceMetrics;
  private startTime: number;
  private activeRequests: Map<string, number> = new Map();

  private constructor() {
    this.startTime = Date.now();
    this.metrics = this.initializeMetrics();
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  private initializeMetrics(): PerformanceMetrics {
    return {
      apiCalls: {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
        totalResponseTime: 0,
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalSize: 0,
      },
      errors: {
        total: 0,
        byType: {},
        byProvider: {},
      },
      translation: {
        totalTexts: 0,
        totalCharacters: 0,
        averageTextLength: 0,
        batchRequests: 0,
        singleRequests: 0,
      },
      ocr: {
        totalImages: 0,
        totalTextAreas: 0,
        averageAreasPerImage: 0,
        averageProcessingTime: 0,
      },
    };
  }

  /**
   * 开始监控API请求
   */
  startAPIRequest(requestId: string, type: 'translation' | 'ocr'): void {
    this.activeRequests.set(requestId, Date.now());
    this.metrics.apiCalls.total++;
  }

  /**
   * 结束监控API请求（成功）
   */
  endAPIRequest(requestId: string, type: 'translation' | 'ocr', data?: any): void {
    const startTime = this.activeRequests.get(requestId);
    if (!startTime) return;

    const responseTime = Date.now() - startTime;
    this.activeRequests.delete(requestId);

    // 更新API调用指标
    this.metrics.apiCalls.successful++;
    this.metrics.apiCalls.totalResponseTime += responseTime;
    this.metrics.apiCalls.averageResponseTime = 
      this.metrics.apiCalls.totalResponseTime / this.metrics.apiCalls.successful;

    // 更新特定类型的指标
    if (type === 'translation' && data) {
      this.updateTranslationMetrics(data);
    } else if (type === 'ocr' && data) {
      this.updateOCRMetrics(data, responseTime);
    }
  }

  /**
   * 记录API请求失败
   */
  recordAPIFailure(requestId: string, error: Error, providerName?: string): void {
    const startTime = this.activeRequests.get(requestId);
    if (startTime) {
      const responseTime = Date.now() - startTime;
      this.metrics.apiCalls.totalResponseTime += responseTime;
      this.activeRequests.delete(requestId);
    }

    this.metrics.apiCalls.failed++;
    this.metrics.errors.total++;

    // 按错误类型分类
    const errorType = error.constructor.name;
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;

    // 按提供者分类
    if (providerName) {
      this.metrics.errors.byProvider[providerName] = 
        (this.metrics.errors.byProvider[providerName] || 0) + 1;
    }
  }

  /**
   * 记录缓存命中
   */
  recordCacheHit(): void {
    this.metrics.cache.hits++;
    this.updateCacheHitRate();
  }

  /**
   * 记录缓存未命中
   */
  recordCacheMiss(): void {
    this.metrics.cache.misses++;
    this.updateCacheHitRate();
  }

  /**
   * 更新缓存大小
   */
  updateCacheSize(size: number): void {
    this.metrics.cache.totalSize = size;
  }

  /**
   * 更新翻译指标
   */
  private updateTranslationMetrics(data: { texts: string[]; isBatch: boolean }): void {
    const { texts, isBatch } = data;
    
    this.metrics.translation.totalTexts += texts.length;
    
    const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
    this.metrics.translation.totalCharacters += totalChars;
    
    this.metrics.translation.averageTextLength = 
      this.metrics.translation.totalCharacters / this.metrics.translation.totalTexts;

    if (isBatch) {
      this.metrics.translation.batchRequests++;
    } else {
      this.metrics.translation.singleRequests++;
    }
  }

  /**
   * 更新OCR指标
   */
  private updateOCRMetrics(data: { textAreas: any[] }, processingTime: number): void {
    this.metrics.ocr.totalImages++;
    this.metrics.ocr.totalTextAreas += data.textAreas.length;
    this.metrics.ocr.averageAreasPerImage = 
      this.metrics.ocr.totalTextAreas / this.metrics.ocr.totalImages;

    // 更新平均处理时间
    const totalTime = this.metrics.ocr.averageProcessingTime * (this.metrics.ocr.totalImages - 1) + processingTime;
    this.metrics.ocr.averageProcessingTime = totalTime / this.metrics.ocr.totalImages;
  }

  /**
   * 更新缓存命中率
   */
  private updateCacheHitRate(): void {
    const total = this.metrics.cache.hits + this.metrics.cache.misses;
    this.metrics.cache.hitRate = total > 0 ? this.metrics.cache.hits / total : 0;
  }

  /**
   * 获取当前指标
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport(): {
    summary: any;
    details: PerformanceMetrics;
    recommendations: string[];
  } {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.metrics.apiCalls.total > 0 ? 
      this.metrics.apiCalls.failed / this.metrics.apiCalls.total : 0;

    const summary = {
      uptime: Math.floor(uptime / 1000), // 秒
      totalRequests: this.metrics.apiCalls.total,
      successRate: this.metrics.apiCalls.total > 0 ? 
        this.metrics.apiCalls.successful / this.metrics.apiCalls.total : 0,
      errorRate,
      cacheHitRate: this.metrics.cache.hitRate,
      averageResponseTime: this.metrics.apiCalls.averageResponseTime,
    };

    const recommendations = this.generateRecommendations();

    return {
      summary,
      details: this.getMetrics(),
      recommendations,
    };
  }

  /**
   * 生成性能优化建议
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    // 检查错误率
    const errorRate = this.metrics.apiCalls.total > 0 ? 
      this.metrics.apiCalls.failed / this.metrics.apiCalls.total : 0;
    
    if (errorRate > 0.1) {
      recommendations.push('错误率较高（>10%），建议检查API配置和网络连接');
    }

    // 检查缓存命中率
    if (this.metrics.cache.hitRate < 0.3) {
      recommendations.push('缓存命中率较低（<30%），建议增加缓存TTL或优化缓存策略');
    }

    // 检查响应时间
    if (this.metrics.apiCalls.averageResponseTime > 5000) {
      recommendations.push('平均响应时间较长（>5秒），建议优化网络或切换更快的API提供者');
    }

    // 检查批处理使用率
    const totalTranslationRequests = this.metrics.translation.batchRequests + 
      this.metrics.translation.singleRequests;
    
    if (totalTranslationRequests > 0) {
      const batchRate = this.metrics.translation.batchRequests / totalTranslationRequests;
      if (batchRate < 0.5) {
        recommendations.push('批处理使用率较低，建议启用批量翻译以提高效率');
      }
    }

    // 检查缓存大小
    if (this.metrics.cache.totalSize > 50 * 1024 * 1024) { // 50MB
      recommendations.push('缓存大小较大（>50MB），建议清理过期缓存');
    }

    if (recommendations.length === 0) {
      recommendations.push('性能表现良好，无需特别优化');
    }

    return recommendations;
  }

  /**
   * 重置指标
   */
  reset(): void {
    this.metrics = this.initializeMetrics();
    this.startTime = Date.now();
    this.activeRequests.clear();
  }

  /**
   * 导出指标数据
   */
  exportMetrics(): string {
    const report = this.getPerformanceReport();
    return JSON.stringify(report, null, 2);
  }
}

// 导出单例实例
export const performanceMonitor = PerformanceMonitor.getInstance();
