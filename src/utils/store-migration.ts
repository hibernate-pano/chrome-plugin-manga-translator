import { useConfigStore } from '@/stores/config';
import { useTranslationStore } from '@/stores/translation';
import { useCacheStore } from '@/stores/cache';

/**
 * 从旧的Chrome Storage迁移数据到新的Zustand stores
 */
export class StoreMigration {
  private static instance: StoreMigration;
  private migrationCompleted = false;

  static getInstance(): StoreMigration {
    if (!StoreMigration.instance) {
      StoreMigration.instance = new StoreMigration();
    }
    return StoreMigration.instance;
  }

  /**
   * 执行完整的数据迁移
   */
  async migrate(): Promise<void> {
    if (this.migrationCompleted) {
      console.log('数据迁移已完成，跳过');
      return;
    }

    console.log('开始数据迁移...');

    try {
      // 并行执行所有迁移任务
      await Promise.all([
        this.migrateConfig(),
        this.migrateTranslationState(),
        this.migrateCache(),
      ]);

      this.migrationCompleted = true;
      console.log('数据迁移完成');
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
      // 从Chrome Storage获取旧配置
      const result = await chrome.storage.sync.get(null) as any;

      if (Object.keys(result).length === 0) {
        console.log('没有找到旧配置数据');
        return;
      }

      const configStore = useConfigStore.getState();

      // 迁移API提供者配置
      if (result['providerType']) {
        configStore.setProviderType(result['providerType']);
      }

      if (result['providerConfig']) {
        Object.entries(result['providerConfig']).forEach(([provider, config]) => {
          configStore.updateProviderConfig(provider, config as any);
        });
      }

      // 迁移OCR设置
      if (result['ocrSettings']) {
        configStore.updateOCRSettings(result['ocrSettings']);
      }

      // 迁移样式配置
      if (result['styleLevel'] !== undefined) {
        configStore.setStyleLevel(result['styleLevel']);
      }
      if (result['fontFamily']) {
        configStore.setFontFamily(result['fontFamily']);
      }
      if (result['fontSize']) {
        configStore.setFontSize(result['fontSize']);
      }
      if (result['fontColor']) {
        configStore.setFontColor(result['fontColor']);
      }
      if (result['backgroundColor']) {
        configStore.setBackgroundColor(result['backgroundColor']);
      }

      // 迁移快捷键
      if (result['shortcuts']) {
        configStore.updateShortcuts(result['shortcuts']);
      }

      // 迁移高级设置
      if (result['advancedSettings']) {
        configStore.updateAdvancedSettings(result['advancedSettings']);
      }

      console.log('配置数据迁移完成');
    } catch (error) {
      console.error('配置数据迁移失败:', error);
    }
  }

  /**
   * 迁移翻译状态数据
   */
  private async migrateTranslationState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        'translationState',
        'translationHistory',
        'translatedImages'
      ]) as any;

      const translationStore = useTranslationStore.getState();

      // 迁移基本翻译状态
      if (result['translationState']) {
        const state = result['translationState'];
        if (state.enabled !== undefined) {
          translationStore.setEnabled(state.enabled);
        }
        if (state.mode) {
          translationStore.setMode(state.mode);
        }
        if (state.targetLanguage) {
          translationStore.setTargetLanguage(state.targetLanguage);
        }
      }

      // 迁移翻译历史
      if (result['translationHistory'] && Array.isArray(result['translationHistory'])) {
        result['translationHistory'].forEach((item: any) => {
          translationStore.addToHistory({
            imageUrl: item.imageUrl || '',
            originalText: item.originalText || '',
            translatedText: item.translatedText || '',
            sourceLanguage: item.sourceLanguage || 'ja',
            targetLanguage: item.targetLanguage || 'zh-CN',
            provider: item.provider || 'openai',
            imageHash: item.imageHash,
          });
        });
      }

      // 迁移已翻译图像映射
      if (result['translatedImages']) {
        if (result['translatedImages'] instanceof Map) {
          // 如果是Map格式
          result['translatedImages'].forEach((value: any, key: string) => {
            translationStore.addTranslatedImage(key, value);
          });
        } else if (typeof result['translatedImages'] === 'object') {
          // 如果是普通对象格式
          Object.entries(result['translatedImages']).forEach(([key, value]) => {
            translationStore.addTranslatedImage(key, value as any);
          });
        }
      }

      console.log('翻译状态数据迁移完成');
    } catch (error) {
      console.error('翻译状态数据迁移失败:', error);
    }
  }

  /**
   * 迁移缓存数据
   */
  private async migrateCache(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        'translationCache',
        'imageCache',
        'ocrCache'
      ]) as any;

      const cacheStore = useCacheStore.getState();

      // 迁移翻译缓存
      if (result['translationCache']) {
        Object.entries(result['translationCache']).forEach(([key, value]: [string, any]) => {
          if (value && value.data) {
            // 保留原有的时间戳信息
            const ttl = value.expiresAt ? value.expiresAt - Date.now() : undefined;
            if (!ttl || ttl > 0) {
              cacheStore.setTranslationCache(key, value.data, ttl);
            }
          }
        });
      }

      // 迁移图像缓存
      if (result['imageCache']) {
        Object.entries(result['imageCache']).forEach(([key, value]: [string, any]) => {
          if (value && value.data) {
            const ttl = value.expiresAt ? value.expiresAt - Date.now() : undefined;
            if (!ttl || ttl > 0) {
              cacheStore.setImageCache(key, value.data, ttl);
            }
          }
        });
      }

      // 迁移OCR缓存
      if (result['ocrCache']) {
        Object.entries(result['ocrCache']).forEach(([key, value]: [string, any]) => {
          if (value && value.data) {
            const ttl = value.expiresAt ? value.expiresAt - Date.now() : undefined;
            if (!ttl || ttl > 0) {
              cacheStore.setOCRCache(key, value.data, ttl);
            }
          }
        });
      }

      console.log('缓存数据迁移完成');
    } catch (error) {
      console.error('缓存数据迁移失败:', error);
    }
  }

  /**
   * 清理旧的存储数据（可选，谨慎使用）
   */
  async cleanupOldData(): Promise<void> {
    try {
      // 清理旧的sync存储数据
      const syncKeys = [
        'providerType', 'providerConfig', 'ocrSettings', 'styleLevel',
        'fontFamily', 'fontSize', 'fontColor', 'backgroundColor',
        'shortcuts', 'advancedSettings'
      ];

      // 清理旧的local存储数据
      const localKeys = [
        'translationState', 'translationHistory', 'translatedImages',
        'translationCache', 'imageCache', 'ocrCache'
      ];

      await Promise.all([
        chrome.storage.sync.remove(syncKeys),
        chrome.storage.local.remove(localKeys)
      ]);

      console.log('旧数据清理完成');
    } catch (error) {
      console.error('旧数据清理失败:', error);
    }
  }

  /**
   * 检查是否需要迁移
   */
  async needsMigration(): Promise<boolean> {
    try {
      const [syncResult, localResult] = await Promise.all([
        chrome.storage.sync.get(null) as unknown as Promise<any>,
        chrome.storage.local.get(['translationState', 'translationHistory']) as unknown as Promise<any>
      ]);

      // 如果存在旧格式的数据，则需要迁移
      return Object.keys(syncResult).length > 0 || Object.keys(localResult).length > 0;
    } catch (error) {
      console.error('检查迁移需求失败:', error);
      return false;
    }
  }
}

/**
 * 初始化数据迁移
 */
export async function initializeStoreMigration(): Promise<void> {
  const migration = StoreMigration.getInstance();

  if (await migration.needsMigration()) {
    await migration.migrate();
  }
}

// 导出单例实例
export const storeMigration = StoreMigration.getInstance();
