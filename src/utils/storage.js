/**
 * 存储相关工具函数
 */
import { getConfig, setConfig } from './config-manager';
import { DEFAULT_CONFIG } from './default-config';

/**
 * 保存用户配置
 * @param {Object} config - 用户配置对象
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  return setConfig(config);
}

/**
 * 获取用户配置（为了向后兼容）
 * @returns {Promise<Object>} - 返回用户配置对象
 */
export { getConfig };

/**
 * 获取活跃的提供者配置
 * @returns {Promise<Object>} 活跃的提供者配置
 */
export async function getActiveProviderConfig() {
  const config = await getConfig();
  const providerType = config.providerType || 'openai';
  return config.providerConfig?.[providerType] || {};
}

/**
 * 保存提供者配置
 * @param {string} providerType 提供者类型
 * @param {Object} providerConfig 提供者配置
 * @returns {Promise<void>}
 */
export async function saveProviderConfig(providerType, providerConfig) {
  await setConfig({
    providerType,
    providerConfig: {
      [providerType]: providerConfig
    }
  });
}

/**
 * 为图像生成唯一哈希值
 * @param {string} imageData - 图像数据（Base64或URL）
 * @returns {string} - 哈希值
 */
export function generateImageHash(imageData) {
  // 简单的哈希函数，适用于缓存目的
  let hash = 0;
  
  // 如果是URL，只使用URL的最后部分
  if (imageData.startsWith('http')) {
    const urlParts = imageData.split('/');
    imageData = urlParts[urlParts.length - 1];
  }
  
  // 只使用前10000个字符，避免处理太大的数据
  const sample = imageData.substring(0, 10000);
  
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  
  return Math.abs(hash).toString(16);
}

/**
 * 缓存翻译结果
 * @param {string} imageHash - 图像哈希值
 * @param {Object} data - 翻译数据
 * @returns {Promise<void>}
 */
export async function cacheTranslation(imageHash, data) {
  const config = await getConfig();
  
  // 检查是否启用缓存
  if (!config.advancedSettings?.cacheResults) {
    return;
  }
  
  try {
    // 获取现有缓存
    const result = await chrome.storage.local.get('translationCache');
    let cache = result.translationCache || {};
    
    // 添加新条目
    cache[imageHash] = {
      data,
      timestamp: Date.now()
    };
    
    // 获取缓存大小限制
    const maxCacheSize = config.advancedSettings?.maxCacheSize || 50;
    
    // 如果缓存条目超过限制，删除最旧的条目
    const keys = Object.keys(cache);
    if (keys.length > maxCacheSize) {
      // 按时间戳排序
      keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
      
      // 删除最旧的条目直到满足大小限制
      const keysToRemove = keys.slice(0, keys.length - maxCacheSize);
      keysToRemove.forEach(key => {
        delete cache[key];
      });
    }
    
    // 保存更新后的缓存
    await chrome.storage.local.set({ translationCache: cache });
  } catch (error) {
    console.error('缓存翻译结果失败:', error);
  }
}

/**
 * 获取缓存的翻译结果
 * @param {string} imageHash - 图像哈希值
 * @returns {Promise<Object|null>} - 缓存的翻译数据，如果不存在则为null
 */
export async function getCachedTranslation(imageHash) {
  const config = await getConfig();
  
  // 检查是否启用缓存
  if (!config.advancedSettings?.cacheResults) {
    return null;
  }
  
  try {
    const result = await chrome.storage.local.get('translationCache');
    const cache = result.translationCache || {};
    
    if (cache[imageHash]) {
      return cache[imageHash].data;
    }
  } catch (error) {
    console.error('获取缓存翻译结果失败:', error);
  }
  
  return null;
}

/**
 * 清除翻译缓存
 * @returns {Promise<void>}
 */
export async function clearTranslationCache() {
  try {
    await chrome.storage.local.remove('translationCache');
    console.log('翻译缓存已清除');
  } catch (error) {
    console.error('清除翻译缓存失败:', error);
    throw error;
  }
}
