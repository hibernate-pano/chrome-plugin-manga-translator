import { unifiedCacheManager } from './unified-cache-manager';
import { useCacheStore } from '../stores/cache';

/**
 * 离线数据项接口
 */
export interface OfflineDataItem {
  id: string;
  type: 'translation' | 'ocr' | 'config';
  data: any;
  timestamp: number;
  priority: number;
  synced: boolean;
}

/**
 * 离线支持管理器
 * 处理网络断开时的数据缓存和同步
 */
export class OfflineManager {
  private static instance: OfflineManager;
  private isOnline: boolean = navigator.onLine;
  private offlineQueue: Map<string, OfflineDataItem> = new Map();
  private syncInProgress: boolean = false;
  private maxOfflineItems: number = 1000;
  private maxOfflineSize: number = 10 * 1024 * 1024; // 10MB

  private constructor() {
    this.initializeNetworkListeners();
    this.loadOfflineQueue();
  }

  static getInstance(): OfflineManager {
    if (!OfflineManager.instance) {
      OfflineManager.instance = new OfflineManager();
    }
    return OfflineManager.instance;
  }

  /**
   * 检查是否在线
   */
  isNetworkOnline(): boolean {
    return this.isOnline;
  }

  /**
   * 添加离线数据
   */
  async addOfflineData(
    id: string,
    type: 'translation' | 'ocr' | 'config',
    data: any,
    priority: number = 1
  ): Promise<void> {
    const item: OfflineDataItem = {
      id,
      type,
      data,
      timestamp: Date.now(),
      priority,
      synced: false,
    };

    // 检查离线队列大小限制
    if (this.offlineQueue.size >= this.maxOfflineItems) {
      this.cleanupOfflineQueue();
    }

    this.offlineQueue.set(id, item);
    await this.saveOfflineQueue();

    console.debug(`添加离线数据: ${id} (${type})`);
  }

  /**
   * 获取离线数据
   */
  getOfflineData(id: string): OfflineDataItem | null {
    return this.offlineQueue.get(id) || null;
  }

  /**
   * 获取所有离线数据
   */
  getAllOfflineData(type?: 'translation' | 'ocr' | 'config'): OfflineDataItem[] {
    const items = Array.from(this.offlineQueue.values());
    return type ? items.filter(item => item.type === type) : items;
  }

  /**
   * 同步离线数据
   */
  async syncOfflineData(): Promise<void> {
    if (!this.isOnline || this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;
    console.log('开始同步离线数据');

    try {
      const unsyncedItems = Array.from(this.offlineQueue.values())
        .filter(item => !item.synced)
        .sort((a, b) => b.priority - a.priority); // 按优先级排序

      for (const item of unsyncedItems) {
        try {
          await this.syncSingleItem(item);
          item.synced = true;
          console.debug(`同步成功: ${item.id}`);
        } catch (error) {
          console.error(`同步失败: ${item.id}`, error);
          // 继续同步其他项目
        }
      }

      // 清理已同步的项目
      this.cleanupSyncedItems();
      await this.saveOfflineQueue();

      console.log('离线数据同步完成');
    } catch (error) {
      console.error('离线数据同步失败:', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * 获取离线统计信息
   */
  getOfflineStats(): {
    totalItems: number;
    unsyncedItems: number;
    totalSize: number;
    itemsByType: Record<string, number>;
  } {
    const items = Array.from(this.offlineQueue.values());
    const unsyncedItems = items.filter(item => !item.synced);
    
    const itemsByType = items.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalSize = items.reduce((size, item) => {
      return size + JSON.stringify(item.data).length;
    }, 0);

    return {
      totalItems: items.length,
      unsyncedItems: unsyncedItems.length,
      totalSize,
      itemsByType,
    };
  }

  /**
   * 清理离线数据
   */
  async clearOfflineData(options: {
    olderThan?: number; // 清理早于指定时间的数据（毫秒）
    type?: 'translation' | 'ocr' | 'config';
    syncedOnly?: boolean; // 只清理已同步的数据
  } = {}): Promise<void> {
    const { olderThan, type, syncedOnly = false } = options;
    const cutoffTime = olderThan ? Date.now() - olderThan : 0;

    for (const [id, item] of this.offlineQueue.entries()) {
      let shouldDelete = false;

      if (syncedOnly && !item.synced) {
        continue;
      }

      if (type && item.type !== type) {
        continue;
      }

      if (olderThan && item.timestamp < cutoffTime) {
        shouldDelete = true;
      }

      if (!olderThan && !type) {
        shouldDelete = true; // 清理所有数据
      }

      if (shouldDelete) {
        this.offlineQueue.delete(id);
      }
    }

    await this.saveOfflineQueue();
    console.log('离线数据清理完成');
  }

  /**
   * 预加载关键数据到离线缓存
   */
  async preloadCriticalData(): Promise<void> {
    console.log('开始预加载关键数据');

    try {
      // 预加载常用翻译
      await this.preloadCommonTranslations();

      // 预加载用户配置
      await this.preloadUserConfig();

      // 预加载OCR模型数据（如果有）
      await this.preloadOCRData();

      console.log('关键数据预加载完成');
    } catch (error) {
      console.error('关键数据预加载失败:', error);
    }
  }

  /**
   * 初始化网络监听器
   */
  private initializeNetworkListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('网络已连接');
        this.isOnline = true;
        this.syncOfflineData();
      });

      window.addEventListener('offline', () => {
        console.log('网络已断开');
        this.isOnline = false;
      });
    }
  }

  /**
   * 加载离线队列
   */
  private async loadOfflineQueue(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get('offlineQueue');
        if (result.offlineQueue) {
          const items = JSON.parse(result.offlineQueue);
          this.offlineQueue = new Map(items);
          console.debug(`加载离线队列: ${this.offlineQueue.size} 项`);
        }
      }
    } catch (error) {
      console.error('加载离线队列失败:', error);
    }
  }

  /**
   * 保存离线队列
   */
  private async saveOfflineQueue(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const items = Array.from(this.offlineQueue.entries());
        await chrome.storage.local.set({
          offlineQueue: JSON.stringify(items)
        });
      }
    } catch (error) {
      console.error('保存离线队列失败:', error);
    }
  }

  /**
   * 同步单个项目
   */
  private async syncSingleItem(item: OfflineDataItem): Promise<void> {
    switch (item.type) {
      case 'translation':
        await this.syncTranslationItem(item);
        break;
      case 'ocr':
        await this.syncOCRItem(item);
        break;
      case 'config':
        await this.syncConfigItem(item);
        break;
    }
  }

  /**
   * 同步翻译项目
   */
  private async syncTranslationItem(item: OfflineDataItem): Promise<void> {
    await unifiedCacheManager.set(
      item.id,
      item.data,
      'translation',
      { enableOffline: false }
    );
  }

  /**
   * 同步OCR项目
   */
  private async syncOCRItem(item: OfflineDataItem): Promise<void> {
    await unifiedCacheManager.set(
      item.id,
      item.data,
      'ocr',
      { enableOffline: false }
    );
  }

  /**
   * 同步配置项目
   */
  private async syncConfigItem(item: OfflineDataItem): Promise<void> {
    await unifiedCacheManager.set(
      item.id,
      item.data,
      'config',
      { enableOffline: false }
    );
  }

  /**
   * 清理离线队列
   */
  private cleanupOfflineQueue(): void {
    // 按时间戳排序，删除最旧的项目
    const items = Array.from(this.offlineQueue.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);

    const itemsToRemove = items.slice(0, Math.floor(this.maxOfflineItems * 0.2));
    itemsToRemove.forEach(([id]) => {
      this.offlineQueue.delete(id);
    });

    console.debug(`清理离线队列: 删除 ${itemsToRemove.length} 项`);
  }

  /**
   * 清理已同步的项目
   */
  private cleanupSyncedItems(): void {
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24小时前
    
    for (const [id, item] of this.offlineQueue.entries()) {
      if (item.synced && item.timestamp < cutoffTime) {
        this.offlineQueue.delete(id);
      }
    }
  }

  /**
   * 预加载常用翻译
   */
  private async preloadCommonTranslations(): Promise<void> {
    const commonTexts = [
      'Hello', 'Thank you', 'Yes', 'No', 'Please', 'Sorry',
      'こんにちは', 'ありがとう', 'はい', 'いいえ', 'お願いします', 'すみません'
    ];

    for (const text of commonTexts) {
      const cacheKey = `translation:${text}:zh`;
      await this.addOfflineData(cacheKey, 'translation', {
        text,
        translatedText: text, // 这里应该是实际的翻译结果
        sourceLanguage: 'auto',
        targetLanguage: 'zh',
      }, 5); // 高优先级
    }
  }

  /**
   * 预加载用户配置
   */
  private async preloadUserConfig(): Promise<void> {
    // 预加载关键配置数据
    const configKeys = ['providerType', 'translationSettings', 'uiSettings'];
    
    for (const key of configKeys) {
      await this.addOfflineData(`config:${key}`, 'config', {
        key,
        // 这里应该从实际配置中获取数据
      }, 3);
    }
  }

  /**
   * 预加载OCR数据
   */
  private async preloadOCRData(): Promise<void> {
    // 预加载OCR相关的配置和模型信息
    await this.addOfflineData('ocr:settings', 'ocr', {
      preferredMethod: 'auto',
      language: 'jpn+eng',
    }, 2);
  }
}

// 导出单例实例
export const offlineManager = OfflineManager.getInstance();
