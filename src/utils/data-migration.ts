/**
 * 数据迁移工具
 * 负责从v0.1格式迁移到v0.2格式，确保向后兼容性
 */

import { useConfigStore } from '@/stores/config';
import { useTranslationStore, type TranslationHistoryItem } from '@/stores/translation';
import { useCacheStore } from '@/stores/cache';

// 版本信息
export const DATA_VERSION = '0.2.0';
export const MIGRATION_KEY = 'manga-translator-migration-status';

// 迁移状态接口
export interface MigrationStatus {
  version: string;
  completed: boolean;
  timestamp: number;
  steps: {
    config: boolean;
    translation: boolean;
    cache: boolean;
    cleanup: boolean;
  };
}

// v0.1数据结构接口（用于类型检查）
interface V01Config {
  providerType?: string;
  providerConfig?: Record<string, any>;
  ocrSettings?: any;
  targetLanguage?: string;
  enabled?: boolean;
  mode?: string;
  styleLevel?: number;
  fontFamily?: string;
  fontSize?: string;
  fontColor?: string;
  backgroundColor?: string;
  shortcuts?: Record<string, string>;
  advancedSettings?: any;
}

interface V01TranslationState {
  enabled?: boolean;
  mode?: string;
  targetLanguage?: string;
  processing?: boolean;
  translatedImages?: Map<string, any> | Record<string, any>;
}

/**
 * 数据迁移管理器
 */
export class DataMigration {
  private static instance: DataMigration;

  static getInstance(): DataMigration {
    if (!DataMigration.instance) {
      DataMigration.instance = new DataMigration();
    }
    return DataMigration.instance;
  }

  /**
   * 检查是否需要迁移
   */
  async needsMigration(): Promise<boolean> {
    try {
      const status = await this.getMigrationStatus();

      // 如果已经完成迁移且版本匹配，则不需要迁移
      if (status.completed && status.version === DATA_VERSION) {
        return false;
      }

      // 检查是否存在v0.1格式的数据
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get(null),
        chrome.storage.local.get(null)
      ]);

      // 如果存在旧格式数据，则需要迁移
      return this.hasV01Data(syncData, localData);
    } catch (error) {
      console.error('检查迁移需求失败:', error);
      return false;
    }
  }

  /**
   * 执行完整迁移
   */
  async migrate(): Promise<void> {
    console.log('开始数据迁移到v0.2...');

    const status = await this.getMigrationStatus();

    try {
      // 步骤1: 迁移配置数据
      if (!status.steps.config) {
        await this.migrateConfig();
        await this.updateMigrationStatus({ config: true });
        console.log('✓ 配置数据迁移完成');
      }

      // 步骤2: 迁移翻译状态和历史
      if (!status.steps.translation) {
        await this.migrateTranslation();
        await this.updateMigrationStatus({ translation: true });
        console.log('✓ 翻译数据迁移完成');
      }

      // 步骤3: 迁移缓存数据
      if (!status.steps.cache) {
        await this.migrateCache();
        await this.updateMigrationStatus({ cache: true });
        console.log('✓ 缓存数据迁移完成');
      }

      // 步骤4: 清理旧数据（可选）
      if (!status.steps.cleanup) {
        await this.cleanupOldData();
        await this.updateMigrationStatus({ cleanup: true });
        console.log('✓ 旧数据清理完成');
      }

      // 标记迁移完成
      await this.completeMigration();
      console.log('🎉 数据迁移完成！');

    } catch (error) {
      console.error('数据迁移失败:', error);
      throw error;
    }
  }

  /**
   * 迁移配置数据
   */
  private async migrateConfig(): Promise<void> {
    try {
      const syncData = await chrome.storage.sync.get(null);
      const v01Config = syncData as V01Config;

      if (!this.hasV01ConfigData(v01Config)) {
        console.log('没有找到v0.1配置数据');
        return;
      }

      const configStore = useConfigStore.getState();

      // 迁移基本配置
      if (v01Config.providerType) {
        configStore.setProviderType(v01Config.providerType);
      }

      // 迁移API提供者配置
      if (v01Config.providerConfig) {
        Object.entries(v01Config.providerConfig).forEach(([provider, config]) => {
          configStore.updateProviderConfig(provider, this.normalizeProviderConfig(config));
        });
      }

      // 迁移OCR设置
      if (v01Config.ocrSettings) {
        configStore.updateOCRSettings(this.normalizeOCRSettings(v01Config.ocrSettings));
      }

      // 迁移样式配置
      if (v01Config.styleLevel !== undefined) {
        configStore.setStyleLevel(v01Config.styleLevel);
      }
      if (v01Config.fontFamily) {
        configStore.setFontFamily(v01Config.fontFamily);
      }
      if (v01Config.fontSize) {
        configStore.setFontSize(v01Config.fontSize);
      }
      if (v01Config.fontColor) {
        configStore.setFontColor(v01Config.fontColor);
      }
      if (v01Config.backgroundColor) {
        configStore.setBackgroundColor(v01Config.backgroundColor);
      }

      // 迁移快捷键
      if (v01Config.shortcuts) {
        configStore.updateShortcuts(v01Config.shortcuts);
      }

      // 迁移高级设置
      if (v01Config.advancedSettings) {
        configStore.updateAdvancedSettings(this.normalizeAdvancedSettings(v01Config.advancedSettings));
      }

    } catch (error) {
      console.error('配置数据迁移失败:', error);
      throw error;
    }
  }

  /**
   * 迁移翻译数据
   */
  private async migrateTranslation(): Promise<void> {
    try {
      const localData = await chrome.storage.local.get([
        'translationState',
        'translationHistory',
        'translatedImages'
      ]);

      const translationStore = useTranslationStore.getState();

      // 迁移翻译状态
      if (localData.translationState) {
        const state = localData.translationState as V01TranslationState;

        if (state.enabled !== undefined) {
          translationStore.setEnabled(state.enabled);
        }
        if (state.mode && (state.mode === 'manual' || state.mode === 'auto')) {
          translationStore.setMode(state.mode);
        }
        if (state.targetLanguage) {
          translationStore.setTargetLanguage(state.targetLanguage);
        }
      }

      // 迁移翻译历史
      if (localData.translationHistory && Array.isArray(localData.translationHistory)) {
        localData.translationHistory.forEach((item: any) => {
          const normalizedItem = this.normalizeHistoryItem(item);
          if (normalizedItem) {
            translationStore.addToHistory(normalizedItem);
          }
        });
      }

      // 迁移已翻译图像映射
      if (localData.translatedImages) {
        const images = localData.translatedImages;

        if (images instanceof Map) {
          images.forEach((value: any, key: string) => {
            const normalizedItem = this.normalizeHistoryItem(value);
            if (normalizedItem) {
              translationStore.addTranslatedImage(key, {
                ...normalizedItem,
                id: key,
                timestamp: Date.now(),
              });
            }
          });
        } else if (typeof images === 'object') {
          Object.entries(images).forEach(([key, value]) => {
            const normalizedItem = this.normalizeHistoryItem(value);
            if (normalizedItem) {
              translationStore.addTranslatedImage(key, {
                ...normalizedItem,
                id: key,
                timestamp: Date.now(),
              });
            }
          });
        }
      }

    } catch (error) {
      console.error('翻译数据迁移失败:', error);
      throw error;
    }
  }

  /**
   * 迁移缓存数据
   */
  private async migrateCache(): Promise<void> {
    try {
      const localData = await chrome.storage.local.get([
        'translationCache',
        'imageCache',
        'ocrCache'
      ]);

      const cacheStore = useCacheStore.getState();

      // 迁移各种缓存
      const cacheTypes = [
        { key: 'translationCache', setter: cacheStore.setTranslationCache },
        { key: 'imageCache', setter: cacheStore.setImageCache },
        { key: 'ocrCache', setter: cacheStore.setOCRCache },
      ];

      cacheTypes.forEach(({ key, setter }) => {
        const cache = localData[key];
        if (cache && typeof cache === 'object') {
          Object.entries(cache).forEach(([cacheKey, value]: [string, any]) => {
            if (value && value.data) {
              // 计算剩余TTL
              const ttl = value.expiresAt ? Math.max(0, value.expiresAt - Date.now()) : undefined;
              // 如果没有TTL或者TTL大于0，则迁移数据
              if (!value.expiresAt || (ttl && ttl > 0)) {
                setter(cacheKey, value.data, ttl);
              }
            }
          });
        }
      });

    } catch (error) {
      console.error('缓存数据迁移失败:', error);
      throw error;
    }
  }

  /**
   * 清理旧数据
   */
  private async cleanupOldData(): Promise<void> {
    try {
      // 定义要清理的键
      const syncKeysToRemove = [
        'providerType', 'providerConfig', 'ocrSettings', 'targetLanguage',
        'enabled', 'mode', 'styleLevel', 'fontFamily', 'fontSize',
        'fontColor', 'backgroundColor', 'shortcuts', 'advancedSettings'
      ];

      const localKeysToRemove = [
        'translationState', 'translationHistory', 'translatedImages',
        'translationCache', 'imageCache', 'ocrCache'
      ];

      // 并行清理
      await Promise.all([
        chrome.storage.sync.remove(syncKeysToRemove),
        chrome.storage.local.remove(localKeysToRemove)
      ]);

    } catch (error) {
      console.error('旧数据清理失败:', error);
      // 清理失败不应该阻止迁移完成
    }
  }

  // 工具方法
  private hasV01Data(syncData: any, localData: any): boolean {
    return this.hasV01ConfigData(syncData) || this.hasV01TranslationData(localData);
  }

  private hasV01ConfigData(data: any): boolean {
    return !!(data.providerType || data.providerConfig || data.ocrSettings);
  }

  private hasV01TranslationData(data: any): boolean {
    return !!(data.translationState || data.translationHistory || data.translatedImages);
  }

  private normalizeProviderConfig(config: any): any {
    return {
      apiKey: config.apiKey || '',
      apiBaseUrl: config.apiBaseUrl || config.baseUrl || '',
      visionModel: config.visionModel || config.model || '',
      chatModel: config.chatModel || config.model || '',
      temperature: config.temperature || 0.3,
      maxTokens: config.maxTokens || 1000,
    };
  }

  private normalizeOCRSettings(settings: any): any {
    return {
      preferredMethod: settings.preferredMethod || 'auto',
      tesseract: {
        language: settings.tesseract?.language || 'jpn',
        preprocess: settings.tesseract?.preprocess !== false,
        workerCount: settings.tesseract?.workerCount || 1,
      },
    };
  }

  private normalizeAdvancedSettings(settings: any): any {
    return {
      useLocalOcr: settings.useLocalOcr || false,
      cacheResults: settings.cacheResults !== false,
      maxCacheSize: settings.maxCacheSize || 50,
      debugMode: settings.debugMode || false,
      apiTimeout: settings.apiTimeout || 30,
      maxConcurrentRequests: settings.maxConcurrentRequests || 3,
      imagePreprocessing: settings.imagePreprocessing || 'none',
      showOriginalText: settings.showOriginalText || false,
      translationPrompt: settings.translationPrompt || '',
      useCorsProxy: settings.useCorsProxy !== false,
      corsProxyType: settings.corsProxyType || 'corsproxy',
      customCorsProxy: settings.customCorsProxy || '',
      renderType: settings.renderType || 'overlay',
    };
  }

  private normalizeHistoryItem(item: any): Omit<TranslationHistoryItem, 'id' | 'timestamp'> | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    return {
      imageUrl: item.imageUrl || '',
      originalText: item.originalText || '',
      translatedText: item.translatedText || '',
      targetLanguage: item.targetLanguage || 'zh-CN',
      imageHash: item.imageHash,
    };
  }

  // 迁移状态管理
  private async getMigrationStatus(): Promise<MigrationStatus> {
    try {
      const result = await chrome.storage.local.get([MIGRATION_KEY]);
      return result[MIGRATION_KEY] || {
        version: '0.0.0',
        completed: false,
        timestamp: 0,
        steps: {
          config: false,
          translation: false,
          cache: false,
          cleanup: false,
        },
      };
    } catch (error) {
      console.error('获取迁移状态失败:', error);
      return {
        version: '0.0.0',
        completed: false,
        timestamp: 0,
        steps: {
          config: false,
          translation: false,
          cache: false,
          cleanup: false,
        },
      };
    }
  }

  private async updateMigrationStatus(stepUpdates: Partial<MigrationStatus['steps']>): Promise<void> {
    try {
      const status = await this.getMigrationStatus();
      const updatedStatus: MigrationStatus = {
        ...status,
        steps: { ...status.steps, ...stepUpdates },
        timestamp: Date.now(),
      };

      await chrome.storage.local.set({ [MIGRATION_KEY]: updatedStatus });
    } catch (error) {
      console.error('更新迁移状态失败:', error);
    }
  }

  private async completeMigration(): Promise<void> {
    try {
      const status: MigrationStatus = {
        version: DATA_VERSION,
        completed: true,
        timestamp: Date.now(),
        steps: {
          config: true,
          translation: true,
          cache: true,
          cleanup: true,
        },
      };

      await chrome.storage.local.set({ [MIGRATION_KEY]: status });
    } catch (error) {
      console.error('完成迁移状态更新失败:', error);
    }
  }
}

/**
 * 初始化数据迁移
 */
export async function initializeDataMigration(): Promise<void> {
  const migration = DataMigration.getInstance();

  if (await migration.needsMigration()) {
    console.log('检测到需要数据迁移，开始执行...');
    await migration.migrate();
  } else {
    console.log('数据已是最新版本，无需迁移');
  }
}

// 导出单例实例
export const dataMigration = DataMigration.getInstance();
