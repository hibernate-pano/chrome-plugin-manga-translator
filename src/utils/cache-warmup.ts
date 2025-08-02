import { unifiedCacheManager } from './unified-cache-manager';
// import { offlineManager } from './offline-manager';
import { APIManager } from '../api/api-manager';
// import { useCacheStore } from '../stores/cache';

/**
 * 预热配置接口
 */
export interface WarmupConfig {
  translation: {
    commonTexts: string[];
    targetLanguages: string[];
    priority: number;
  };
  ocr: {
    commonPatterns: string[];
    imageTypes: string[];
    priority: number;
  };
  user: {
    recentTexts: string[];
    frequentLanguages: string[];
    priority: number;
  };
}

/**
 * 预测模式
 */
export type PredictionMode = 'pattern' | 'frequency' | 'time' | 'user';

/**
 * 缓存预热和预测管理器
 */
export class CacheWarmupManager {
  private static instance: CacheWarmupManager;
  private apiManager: APIManager;
  private accessPatterns: Map<string, number[]> = new Map();
  private userBehaviorHistory: Array<{
    action: string;
    timestamp: number;
    context: any;
  }> = [];
  private warmupInProgress: boolean = false;

  private constructor() {
    this.apiManager = APIManager.getInstance();
    this.loadAccessPatterns();
    this.initializeBehaviorTracking();
  }

  static getInstance(): CacheWarmupManager {
    if (!CacheWarmupManager.instance) {
      CacheWarmupManager.instance = new CacheWarmupManager();
    }
    return CacheWarmupManager.instance;
  }

  /**
   * 执行智能缓存预热
   */
  async performIntelligentWarmup(config?: Partial<WarmupConfig>): Promise<void> {
    if (this.warmupInProgress) {
      console.log('缓存预热正在进行中，跳过此次请求');
      return;
    }

    this.warmupInProgress = true;
    console.log('开始智能缓存预热');

    try {
      const defaultConfig = await this.generateDefaultWarmupConfig();
      const finalConfig = { ...defaultConfig, ...config };

      // 并行执行不同类型的预热
      await Promise.all([
        this.warmupTranslationCache(finalConfig.translation),
        this.warmupOCRCache(finalConfig.ocr),
        this.warmupUserSpecificCache(finalConfig.user),
      ]);

      console.log('智能缓存预热完成');
    } catch (error) {
      console.error('智能缓存预热失败:', error);
    } finally {
      this.warmupInProgress = false;
    }
  }

  /**
   * 基于用户行为预测并预加载
   */
  async predictAndPreload(
    currentContext: {
      action: string;
      text?: string;
      language?: string;
      imageHash?: string;
    },
    mode: PredictionMode = 'pattern'
  ): Promise<void> {
    console.debug(`开始预测性预加载: ${currentContext.action} (${mode})`);

    try {
      const predictions = await this.generatePredictions(currentContext, mode);

      for (const prediction of predictions) {
        await this.preloadPredictedItem(prediction);
      }

      console.debug(`预测性预加载完成: ${predictions.length} 项`);
    } catch (error) {
      console.error('预测性预加载失败:', error);
    }
  }

  /**
   * 记录用户行为
   */
  recordUserBehavior(
    action: string,
    context: {
      text?: string;
      language?: string;
      imageHash?: string;
      result?: any;
    }
  ): void {
    const behaviorRecord = {
      action,
      timestamp: Date.now(),
      context,
    };

    this.userBehaviorHistory.push(behaviorRecord);

    // 保持历史记录在合理范围内
    if (this.userBehaviorHistory.length > 1000) {
      this.userBehaviorHistory = this.userBehaviorHistory.slice(-800);
    }

    // 更新访问模式
    this.updateAccessPatterns(action, context);

    // 保存到本地存储
    this.saveAccessPatterns();
  }

  /**
   * 获取预热统计信息
   */
  getWarmupStats(): {
    totalPatterns: number;
    recentBehaviors: number;
    warmupInProgress: boolean;
    lastWarmupTime?: number;
  } {
    return {
      totalPatterns: this.accessPatterns.size,
      recentBehaviors: this.userBehaviorHistory.length,
      warmupInProgress: this.warmupInProgress,
      lastWarmupTime: this.getLastWarmupTime(),
    };
  }

  /**
   * 清理预热数据
   */
  async cleanupWarmupData(olderThan: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoffTime = Date.now() - olderThan;

    // 清理行为历史
    this.userBehaviorHistory = this.userBehaviorHistory.filter(
      record => record.timestamp > cutoffTime
    );

    // 清理访问模式
    for (const [key, timestamps] of this.accessPatterns.entries()) {
      const recentTimestamps = timestamps.filter(ts => ts > cutoffTime);
      if (recentTimestamps.length === 0) {
        this.accessPatterns.delete(key);
      } else {
        this.accessPatterns.set(key, recentTimestamps);
      }
    }

    await this.saveAccessPatterns();
    console.log('预热数据清理完成');
  }

  /**
   * 生成默认预热配置
   */
  private async generateDefaultWarmupConfig(): Promise<WarmupConfig> {
    // 基于用户历史行为生成配置
    const recentTexts = this.getRecentTexts();
    const frequentLanguages = this.getFrequentLanguages();

    return {
      translation: {
        commonTexts: [
          'Hello', 'Thank you', 'Yes', 'No', 'Please', 'Sorry',
          'こんにちは', 'ありがとう', 'はい', 'いいえ', 'お願いします', 'すみません',
          ...recentTexts.slice(0, 10),
        ],
        targetLanguages: ['zh', 'en', 'ja', ...frequentLanguages],
        priority: 3,
      },
      ocr: {
        commonPatterns: ['manga', 'text', 'dialogue', 'title'],
        imageTypes: ['png', 'jpg', 'webp'],
        priority: 2,
      },
      user: {
        recentTexts: recentTexts.slice(0, 20),
        frequentLanguages,
        priority: 5,
      },
    };
  }

  /**
   * 预热翻译缓存
   */
  private async warmupTranslationCache(config: WarmupConfig['translation']): Promise<void> {
    console.debug('开始预热翻译缓存');

    const promises: Promise<void>[] = [];

    for (const text of config.commonTexts) {
      for (const targetLang of config.targetLanguages) {
        promises.push(this.preloadTranslation(text, targetLang, config.priority));
      }
    }

    // 限制并发数量
    const batchSize = 5;
    for (let i = 0; i < promises.length; i += batchSize) {
      const batch = promises.slice(i, i + batchSize);
      await Promise.all(batch);

      // 添加小延迟避免API限制
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.debug('翻译缓存预热完成');
  }

  /**
   * 预热OCR缓存
   */
  private async warmupOCRCache(config: WarmupConfig['ocr']): Promise<void> {
    console.debug('开始预热OCR缓存');

    // 预加载OCR配置和常用模式
    for (const pattern of config.commonPatterns) {
      const cacheKey = `ocr:pattern:${pattern}`;
      await unifiedCacheManager.set(
        cacheKey,
        { pattern, config: 'optimized' },
        'ocr',
        { priority: config.priority }
      );
    }

    console.debug('OCR缓存预热完成');
  }

  /**
   * 预热用户特定缓存
   */
  private async warmupUserSpecificCache(config: WarmupConfig['user']): Promise<void> {
    console.debug('开始预热用户特定缓存');

    // 预加载用户最近使用的文本
    for (const text of config.recentTexts) {
      for (const lang of config.frequentLanguages) {
        await this.preloadTranslation(text, lang, config.priority);
      }
    }

    console.debug('用户特定缓存预热完成');
  }

  /**
   * 预加载翻译
   */
  private async preloadTranslation(text: string, targetLang: string, priority: number): Promise<void> {
    const cacheKey = `translation:${text}:${targetLang}`;

    try {
      // 检查是否已经缓存
      const cached = await unifiedCacheManager.get(cacheKey, 'translation');
      if (cached) {
        return;
      }

      // 调用API获取翻译
      const result = await this.apiManager.translateText([text], targetLang);
      const translatedText = Array.isArray(result) ? result[0] : result;

      // 缓存结果
      await unifiedCacheManager.set(
        cacheKey,
        {
          text,
          translatedText,
          targetLanguage: targetLang,
          sourceLanguage: 'auto',
        },
        'translation',
        { priority, enableOffline: true }
      );

      console.debug(`预加载翻译: ${text} -> ${translatedText}`);
    } catch (error) {
      console.debug(`预加载翻译失败: ${text}`, error);
    }
  }

  /**
   * 生成预测
   */
  private async generatePredictions(
    currentContext: any,
    mode: PredictionMode
  ): Promise<Array<{ type: string; key: string; data: any; priority: number }>> {
    const predictions: Array<{ type: string; key: string; data: any; priority: number }> = [];

    switch (mode) {
      case 'pattern':
        predictions.push(...this.generatePatternPredictions(currentContext));
        break;
      case 'frequency':
        predictions.push(...this.generateFrequencyPredictions(currentContext));
        break;
      case 'time':
        predictions.push(...this.generateTimePredictions(currentContext));
        break;
      case 'user':
        predictions.push(...this.generateUserPredictions(currentContext));
        break;
    }

    return predictions.slice(0, 10); // 限制预测数量
  }

  /**
   * 基于模式的预测
   */
  private generatePatternPredictions(context: any): Array<{ type: string; key: string; data: any; priority: number }> {
    const predictions: Array<{ type: string; key: string; data: any; priority: number }> = [];

    // 基于访问模式预测下一个可能的操作
    const pattern = this.accessPatterns.get(context.action);
    if (pattern && pattern.length >= 2) {
      // 简单的序列预测
      const lastAccess = pattern[pattern.length - 1]!;
      const timeDiff = Date.now() - lastAccess;

      if (timeDiff < 60000) { // 1分钟内
        predictions.push({
          type: 'translation',
          key: `predicted:${context.action}:next`,
          data: { predictedAction: context.action },
          priority: 2,
        });
      }
    }

    return predictions;
  }

  /**
   * 基于频率的预测
   */
  private generateFrequencyPredictions(_context: any): Array<{ type: string; key: string; data: any; priority: number }> {
    // 基于使用频率预测
    return [];
  }

  /**
   * 基于时间的预测
   */
  private generateTimePredictions(_context: any): Array<{ type: string; key: string; data: any; priority: number }> {
    // 基于时间模式预测
    return [];
  }

  /**
   * 基于用户行为的预测
   */
  private generateUserPredictions(_context: any): Array<{ type: string; key: string; data: any; priority: number }> {
    // 基于用户历史行为预测
    return [];
  }

  /**
   * 预加载预测项目
   */
  private async preloadPredictedItem(prediction: { type: string; key: string; data: any; priority: number }): Promise<void> {
    try {
      await unifiedCacheManager.set(
        prediction.key,
        prediction.data,
        prediction.type as any,
        { priority: prediction.priority }
      );
    } catch (error) {
      console.debug('预加载预测项目失败:', error);
    }
  }

  /**
   * 更新访问模式
   */
  private updateAccessPatterns(action: string, _context: any): void {
    const timestamps = this.accessPatterns.get(action) || [];
    timestamps.push(Date.now());

    // 保持最近100次访问记录
    if (timestamps.length > 100) {
      timestamps.splice(0, timestamps.length - 100);
    }

    this.accessPatterns.set(action, timestamps);
  }

  /**
   * 获取最近使用的文本
   */
  private getRecentTexts(): string[] {
    return this.userBehaviorHistory
      .filter(record => record.context.text)
      .map(record => record.context.text!)
      .slice(-50);
  }

  /**
   * 获取常用语言
   */
  private getFrequentLanguages(): string[] {
    const langCount = new Map<string, number>();

    this.userBehaviorHistory.forEach(record => {
      if (record.context.language) {
        const count = langCount.get(record.context.language) || 0;
        langCount.set(record.context.language, count + 1);
      }
    });

    return Array.from(langCount.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([lang]) => lang);
  }

  /**
   * 加载访问模式
   */
  private async loadAccessPatterns(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get('accessPatterns');
        if (result.accessPatterns) {
          const patterns = JSON.parse(result.accessPatterns);
          this.accessPatterns = new Map(patterns);
        }
      }
    } catch (error) {
      console.error('加载访问模式失败:', error);
    }
  }

  /**
   * 保存访问模式
   */
  private async saveAccessPatterns(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const patterns = Array.from(this.accessPatterns.entries());
        await chrome.storage.local.set({
          accessPatterns: JSON.stringify(patterns)
        });
      }
    } catch (error) {
      console.error('保存访问模式失败:', error);
    }
  }

  /**
   * 初始化行为跟踪
   */
  private initializeBehaviorTracking(): void {
    // 可以在这里添加自动行为跟踪逻辑
  }

  /**
   * 获取最后预热时间
   */
  private getLastWarmupTime(): number | undefined {
    // 从本地存储获取最后预热时间
    return undefined;
  }
}

// 导出单例实例
export const cacheWarmupManager = CacheWarmupManager.getInstance();
