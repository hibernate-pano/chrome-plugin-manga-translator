/**
 * 配置管理器
 * 用于缓存和管理配置，确保一致性和资源的正确释放
 */
import { DEFAULT_CONFIG } from './default-config';
import { terminateOCRProviders } from '../content/detector';

// 配置缓存
let configCache = null;

// 初始化标志
let isInitialized = false;

// 观察者列表
const observers = [];

/**
 * 初始化配置管理器
 * @returns {Promise<Object>} 初始化后的配置
 */
export const initConfigManager = async () => {
  if (isInitialized) {
    return configCache;
  }
  
  try {
    // 从存储中获取配置
    const result = await chrome.storage.sync.get(null);
    
    // 合并默认配置和用户配置
    configCache = mergeWithDefaultConfig(result);
    
    // 监听存储变化
    chrome.storage.onChanged.addListener(handleStorageChange);
    
    // 设置初始化标志
    isInitialized = true;
    
    return configCache;
  } catch (error) {
    console.error('初始化配置管理器失败:', error);
    
    // 回退到默认配置
    configCache = { ...DEFAULT_CONFIG };
    return configCache;
  }
};

/**
 * 合并默认配置和用户配置
 * @param {Object} userConfig 用户配置
 * @returns {Object} 合并后的配置
 */
const mergeWithDefaultConfig = (userConfig) => {
  if (!userConfig || Object.keys(userConfig).length === 0) {
    return { ...DEFAULT_CONFIG };
  }
  
  const merged = { ...DEFAULT_CONFIG };
  
  // 处理旧版API配置结构
  if (userConfig.apiKey && !userConfig.providerConfig) {
    // 检测是否使用Qwen模型
    const usingQwen = 
      (userConfig.customModel && userConfig.customModel.toLowerCase().includes('qwen')) || 
      (userConfig.apiBaseUrl && userConfig.apiBaseUrl.includes('siliconflow.cn')) ||
      (userConfig.useCustomModel && userConfig.useCustomApiUrl);
    
    merged.providerType = usingQwen ? 'qwen' : 'openai';
    
    if (usingQwen) {
      merged.providerConfig.qwen.apiKey = userConfig.apiKey;
      
      if (userConfig.apiBaseUrl) {
        merged.providerConfig.qwen.apiBaseUrl = userConfig.apiBaseUrl;
      }
      
      if (userConfig.customModel) {
        merged.providerConfig.qwen.model = userConfig.customModel;
      }
      
      if (userConfig.temperature !== undefined) {
        merged.providerConfig.qwen.temperature = userConfig.temperature;
      }
    } else {
      merged.providerConfig.openai.apiKey = userConfig.apiKey;
      
      if (userConfig.apiBaseUrl) {
        merged.providerConfig.openai.apiBaseUrl = userConfig.apiBaseUrl;
      }
      
      if (userConfig.model) {
        merged.providerConfig.openai.chatModel = userConfig.model;
      }
      
      if (userConfig.temperature !== undefined) {
        merged.providerConfig.openai.temperature = userConfig.temperature;
      }
    }
  } else {
    // 处理新版配置结构
    if (userConfig.providerType) {
      merged.providerType = userConfig.providerType;
    }
    
    if (userConfig.providerConfig) {
      // 合并提供者配置
      Object.keys(userConfig.providerConfig).forEach(provider => {
        if (!merged.providerConfig[provider]) {
          merged.providerConfig[provider] = {};
        }
        
        merged.providerConfig[provider] = {
          ...merged.providerConfig[provider],
          ...userConfig.providerConfig[provider]
        };
      });
    }
  }
  
  // 合并其他配置项
  if (userConfig.targetLanguage !== undefined) merged.targetLanguage = userConfig.targetLanguage;
  if (userConfig.enabled !== undefined) merged.enabled = userConfig.enabled;
  if (userConfig.mode !== undefined) merged.mode = userConfig.mode;
  if (userConfig.styleLevel !== undefined) merged.styleLevel = userConfig.styleLevel;
  
  // 合并样式配置
  if (userConfig.fontFamily !== undefined) merged.fontFamily = userConfig.fontFamily;
  if (userConfig.fontSize !== undefined) merged.fontSize = userConfig.fontSize;
  if (userConfig.fontColor !== undefined) merged.fontColor = userConfig.fontColor;
  if (userConfig.backgroundColor !== undefined) merged.backgroundColor = userConfig.backgroundColor;
  
  // 合并OCR设置
  if (userConfig.ocrSettings) {
    merged.ocrSettings = {
      ...merged.ocrSettings,
      ...userConfig.ocrSettings
    };
  }
  
  // 合并快捷键配置
  if (userConfig.shortcuts) {
    merged.shortcuts = {
      ...merged.shortcuts,
      ...userConfig.shortcuts
    };
  }
  
  // 合并高级设置
  if (userConfig.advancedSettings) {
    merged.advancedSettings = {
      ...merged.advancedSettings,
      ...userConfig.advancedSettings
    };
  }
  
  return merged;
};

/**
 * 处理存储变化
 * @param {Object} changes 变化内容
 * @param {string} areaName 存储区域
 */
const handleStorageChange = async (changes, areaName) => {
  if (areaName !== 'sync' || !configCache) return;
  
  // 检查是否有OCR设置变化
  const hasOCRSettingsChange = changes.ocrSettings || 
                              (changes.advancedSettings && 
                               'useLocalOcr' in changes.advancedSettings.newValue);
  
  // 如果有OCR设置变化且之前启用了OCR，则释放资源
  if (hasOCRSettingsChange) {
    try {
      await terminateOCRProviders();
      console.log('OCR资源已释放，准备重新初始化');
    } catch (error) {
      console.error('释放OCR资源失败:', error);
    }
  }
  
  // 更新缓存的配置
  const result = await chrome.storage.sync.get(null);
  configCache = mergeWithDefaultConfig(result);
  
  // 通知所有观察者
  notifyObservers(configCache);
};

/**
 * 获取当前配置
 * @returns {Promise<Object>} 当前配置
 */
export const getConfig = async () => {
  if (!isInitialized) {
    return initConfigManager();
  }
  
  return configCache;
};

/**
 * 设置配置
 * @param {Object} newConfig 新配置
 * @returns {Promise<void>}
 */
export const setConfig = async (newConfig) => {
  // 保存到存储
  await chrome.storage.sync.set(newConfig);
  
  // 配置会通过存储变化事件更新缓存
};

/**
 * 添加配置变化观察者
 * @param {Function} callback 回调函数，接收配置作为参数
 * @returns {Function} 用于移除观察者的函数
 */
export const addConfigObserver = (callback) => {
  observers.push(callback);
  
  // 如果已有配置，立即通知
  if (configCache) {
    callback(configCache);
  }
  
  // 返回移除函数
  return () => removeConfigObserver(callback);
};

/**
 * 移除配置变化观察者
 * @param {Function} callback 要移除的回调函数
 */
export const removeConfigObserver = (callback) => {
  const index = observers.indexOf(callback);
  if (index !== -1) {
    observers.splice(index, 1);
  }
};

/**
 * 通知所有观察者
 * @param {Object} config 配置
 */
const notifyObservers = (config) => {
  observers.forEach(callback => {
    try {
      callback(config);
    } catch (error) {
      console.error('通知配置观察者失败:', error);
    }
  });
};

/**
 * 清理资源
 * 在插件禁用或浏览器关闭时调用
 */
export const cleanup = async () => {
  try {
    // 移除存储变化监听
    chrome.storage.onChanged.removeListener(handleStorageChange);
    
    // 释放OCR资源
    await terminateOCRProviders();
    
    // 清空观察者
    observers.length = 0;
    
    // 重置初始化标志
    isInitialized = false;
    
    // 清空缓存
    configCache = null;
    
    console.log('配置管理器资源已清理');
  } catch (error) {
    console.error('清理配置管理器资源失败:', error);
  }
}; 