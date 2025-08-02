/**
 * 应用初始化工具
 * 负责协调所有初始化任务，包括数据迁移、store初始化等
 */

import { initializeDataMigration } from './data-migration';
import { useConfigStore } from '@/stores/config';
import { useTranslationStore } from '@/stores/translation';
import { useCacheStore } from '@/stores/cache';

// 初始化状态
export interface InitializationStatus {
  completed: boolean;
  steps: {
    migration: boolean;
    stores: boolean;
    listeners: boolean;
  };
  error?: string;
}

/**
 * 应用初始化管理器
 */
export class AppInitialization {
  private static instance: AppInitialization;
  private initialized = false;
  private status: InitializationStatus = {
    completed: false,
    steps: {
      migration: false,
      stores: false,
      listeners: false,
    },
  };

  static getInstance(): AppInitialization {
    if (!AppInitialization.instance) {
      AppInitialization.instance = new AppInitialization();
    }
    return AppInitialization.instance;
  }

  /**
   * 执行完整的应用初始化
   */
  async initialize(): Promise<InitializationStatus> {
    if (this.initialized) {
      return this.status;
    }

    console.log('开始应用初始化...');

    try {
      // 步骤1: 数据迁移
      await this.performDataMigration();
      this.status.steps.migration = true;

      // 步骤2: 初始化stores
      await this.initializeStores();
      this.status.steps.stores = true;

      // 步骤3: 设置事件监听器
      await this.setupEventListeners();
      this.status.steps.listeners = true;

      // 标记初始化完成
      this.status.completed = true;
      this.initialized = true;

      console.log('✅ 应用初始化完成');
      return this.status;

    } catch (error) {
      console.error('❌ 应用初始化失败:', error);
      this.status.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 获取初始化状态
   */
  getStatus(): InitializationStatus {
    return { ...this.status };
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 执行数据迁移
   */
  private async performDataMigration(): Promise<void> {
    console.log('🔄 执行数据迁移...');
    await initializeDataMigration();
    console.log('✅ 数据迁移完成');
  }

  /**
   * 初始化stores
   */
  private async initializeStores(): Promise<void> {
    console.log('🔄 初始化状态管理...');

    try {
      // 触发stores的初始化（通过访问状态来触发持久化中间件的加载）
      const configStore = useConfigStore.getState();
      const translationStore = useTranslationStore.getState();
      const cacheStore = useCacheStore.getState();

      // 验证stores是否正确加载
      if (!configStore || !translationStore || !cacheStore) {
        throw new Error('Store初始化失败');
      }

      // 清理过期缓存
      cacheStore.cleanExpiredCache();

      console.log('✅ 状态管理初始化完成');
    } catch (error) {
      console.error('状态管理初始化失败:', error);
      throw error;
    }
  }

  /**
   * 设置事件监听器
   */
  private async setupEventListeners(): Promise<void> {
    console.log('🔄 设置事件监听器...');

    try {
      // Chrome存储变化监听器
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(this.handleStorageChange);
      }

      // 扩展安装/更新监听器
      if (chrome.runtime && chrome.runtime.onInstalled) {
        chrome.runtime.onInstalled.addListener(this.handleExtensionInstalled);
      }

      // 标签页更新监听器（如果在background script中）
      if (chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
      }

      console.log('✅ 事件监听器设置完成');
    } catch (error) {
      console.error('事件监听器设置失败:', error);
      throw error;
    }
  }

  /**
   * 处理Chrome存储变化
   */
  private handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    console.log('存储变化:', { changes, areaName });

    // 如果是配置相关的变化，可以在这里处理
    if (areaName === 'sync') {
      // 处理同步存储变化
      this.handleSyncStorageChange(changes);
    } else if (areaName === 'local') {
      // 处理本地存储变化
      this.handleLocalStorageChange(changes);
    }
  };

  /**
   * 处理同步存储变化
   */
  private handleSyncStorageChange(changes: { [key: string]: chrome.storage.StorageChange }) {
    // 检查是否有配置相关的变化
    const configKeys = ['manga-translator-config'];
    const hasConfigChange = configKeys.some(key => key in changes);

    if (hasConfigChange) {
      console.log('检测到配置变化，可能需要更新UI');
      // 这里可以发送消息给content script或popup更新UI
    }
  }

  /**
   * 处理本地存储变化
   */
  private handleLocalStorageChange(changes: { [key: string]: chrome.storage.StorageChange }) {
    // 检查是否有翻译状态或缓存变化
    const translationKeys = ['manga-translator-translation', 'manga-translator-cache'];
    const hasTranslationChange = translationKeys.some(key => key in changes);

    if (hasTranslationChange) {
      console.log('检测到翻译状态变化');
      // 这里可以处理翻译状态同步
    }
  }

  /**
   * 处理扩展安装/更新
   */
  private handleExtensionInstalled = (details: chrome.runtime.InstalledDetails) => {
    console.log('扩展安装/更新:', details);

    if (details.reason === 'install') {
      console.log('首次安装扩展');
      // 可以在这里执行首次安装的初始化逻辑
    } else if (details.reason === 'update') {
      console.log('扩展更新:', details.previousVersion, '->', chrome.runtime.getManifest().version);
      // 可以在这里执行版本更新的逻辑
    }
  };

  /**
   * 处理标签页更新
   */
  private handleTabUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    // 只在页面完全加载后处理
    if (changeInfo.status === 'complete' && tab.url) {
      console.log('标签页加载完成:', tab.url);
      // 这里可以检查是否需要在该页面注入content script
    }
  };

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    console.log('🔄 清理应用资源...');

    try {
      // 移除事件监听器
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.removeListener(this.handleStorageChange);
      }

      if (chrome.runtime && chrome.runtime.onInstalled) {
        chrome.runtime.onInstalled.removeListener(this.handleExtensionInstalled);
      }

      if (chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
      }

      // 重置状态
      this.initialized = false;
      this.status = {
        completed: false,
        steps: {
          migration: false,
          stores: false,
          listeners: false,
        },
      };

      console.log('✅ 资源清理完成');
    } catch (error) {
      console.error('资源清理失败:', error);
    }
  }
}

/**
 * 初始化应用
 */
export async function initializeApp(): Promise<InitializationStatus> {
  const appInit = AppInitialization.getInstance();
  return await appInit.initialize();
}

/**
 * 获取应用初始化状态
 */
export function getAppInitializationStatus(): InitializationStatus {
  const appInit = AppInitialization.getInstance();
  return appInit.getStatus();
}

/**
 * 检查应用是否已初始化
 */
export function isAppInitialized(): boolean {
  const appInit = AppInitialization.getInstance();
  return appInit.isInitialized();
}

// 导出单例实例
export const appInitialization = AppInitialization.getInstance();
