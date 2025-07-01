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
 * 检查值是否为对象
 * @param {*} item 要检查的值
 * @returns {boolean} 是否为对象
 */
const isObject = (item) => {
  return (item && typeof item === 'object' && !Array.isArray(item));
};

/**
 * 深度合并两个对象
 * @param {Object} target 目标对象
 * @param {Object} source 源对象
 * @returns {Object} 合并后的对象
 */
const mergeDeep = (target, source) => {
  const output = { ...target };
  
  if (!isObject(target) || !isObject(source)) {
    return source || target; // 如果任一不是对象, 直接返回源或目标
  }
  
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (isObject(source[key]) && key in target && isObject(target[key])) {
        // 如果源和目标都有这个key, 并且都是对象, 则递归合并
        output[key] = mergeDeep(target[key], source[key]);
      } else {
        // 否则, 直接用源的值覆盖
        output[key] = source[key];
      }
    }
  }
  
  return output;
};

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
  
  // 处理旧版API配置结构迁移
  const processedConfig = migrateOldConfig(userConfig);
  
  // 使用深度合并函数合并配置
  return mergeDeep(DEFAULT_CONFIG, processedConfig);
};

/**
 * 处理旧版配置结构迁移
 * @param {Object} userConfig 用户配置
 * @returns {Object} 处理后的配置
 */
const migrateOldConfig = (userConfig) => {
  const result = { ...userConfig };
  
  // 处理旧版API配置结构
  if (userConfig.apiKey && !userConfig.providerConfig) {
    // 检测是否使用Qwen模型
    const usingQwen = 
      (userConfig.customModel && userConfig.customModel.toLowerCase().includes('qwen')) || 
      (userConfig.apiBaseUrl && userConfig.apiBaseUrl.includes('siliconflow.cn')) ||
      (userConfig.useCustomModel && userConfig.useCustomApiUrl);
    
    result.providerType = usingQwen ? 'qwen' : 'openai';
    
    // 创建提供者配置
    if (!result.providerConfig) {
      result.providerConfig = {};
    }
    
    if (usingQwen) {
      if (!result.providerConfig.qwen) {
        result.providerConfig.qwen = {};
      }
      
      result.providerConfig.qwen.apiKey = userConfig.apiKey;
      
      if (userConfig.apiBaseUrl) {
        result.providerConfig.qwen.apiBaseUrl = userConfig.apiBaseUrl;
      }
      
      if (userConfig.customModel) {
        result.providerConfig.qwen.model = userConfig.customModel;
      }
      
      if (userConfig.temperature !== undefined) {
        result.providerConfig.qwen.temperature = userConfig.temperature;
      }
    } else {
      if (!result.providerConfig.openai) {
        result.providerConfig.openai = {};
      }
      
      result.providerConfig.openai.apiKey = userConfig.apiKey;
      
      if (userConfig.apiBaseUrl) {
        result.providerConfig.openai.apiBaseUrl = userConfig.apiBaseUrl;
      }
      
      if (userConfig.model) {
        result.providerConfig.openai.chatModel = userConfig.model;
      }
      
      if (userConfig.temperature !== undefined) {
        result.providerConfig.openai.temperature = userConfig.temperature;
      }
    }
  }
  
  return result;
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
 * 验证配置的有效性
 * @param {Object} config 要验证的配置
 * @returns {Object} 验证结果 { valid: boolean, errors: Array }
 */
const validateConfig = (config) => {
  const errors = [];
  
  // 验证providerType
  if (config.providerType && 
      !['openai', 'deepseek', 'claude', 'qwen'].includes(config.providerType)) {
    errors.push(`无效的提供者类型: ${config.providerType}`);
  }
  
  // 验证API密钥格式（如果提供）
  if (config.providerConfig) {
    for (const provider in config.providerConfig) {
      const providerConfig = config.providerConfig[provider];
      
      if (providerConfig.apiKey) {
        // 验证OpenAI API密钥格式
        if (provider === 'openai' && 
            !providerConfig.apiKey.startsWith('sk-')) {
          errors.push('OpenAI API密钥格式无效，应以"sk-"开头');
        }
        
        // 验证Claude API密钥格式
        if (provider === 'claude' && 
            !providerConfig.apiKey.startsWith('sk-ant-')) {
          errors.push('Claude API密钥格式无效，应以"sk-ant-"开头');
        }
      }
    }
  }
  
  // 验证OCR设置
  if (config.ocrSettings) {
    if (config.ocrSettings.preferredMethod && 
        !['auto', 'tesseract', 'cloud'].includes(config.ocrSettings.preferredMethod)) {
      errors.push(`无效的OCR方法: ${config.ocrSettings.preferredMethod}`);
    }
  }
  
  // 验证目标语言
  if (config.targetLanguage && typeof config.targetLanguage !== 'string') {
    errors.push('目标语言必须是字符串');
  }
  
  // 验证模式
  if (config.mode && !['auto', 'manual'].includes(config.mode)) {
    errors.push(`无效的翻译模式: ${config.mode}`);
  }
  
  // 验证样式级别
  if (config.styleLevel !== undefined && 
      (typeof config.styleLevel !== 'number' || 
       config.styleLevel < 0 || 
       config.styleLevel > 100)) {
    errors.push('样式级别必须是0-100之间的数字');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
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
 * @returns {Promise<{success: boolean, message: string}>} 操作结果
 */
export const setConfig = async (newConfig) => {
  try {
    // 验证配置
    if (Object.keys(newConfig).length > 0) {
      const validation = validateConfig(newConfig);
      
      if (!validation.valid) {
        console.warn('配置验证失败:', validation.errors);
        return {
          success: false,
          message: `配置验证失败: ${validation.errors.join(', ')}`
        };
      }
    }
    
    // 保存到存储
    await chrome.storage.sync.set(newConfig);
    
    return {
      success: true,
      message: '配置已保存'
    };
  } catch (error) {
    console.error('保存配置失败:', error);
    return {
      success: false,
      message: `保存配置失败: ${error.message}`
    };
  }
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