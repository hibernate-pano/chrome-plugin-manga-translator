/**
 * 存储相关工具函数
 */

/**
 * 保存用户配置
 * @param {Object} config - 用户配置对象
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.set(config, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 获取用户配置
 * @returns {Promise<Object>} - 返回用户配置对象
 */
export async function getConfig() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.get(null, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result || {});
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 生成图像的哈希值（用于缓存键）
 * @param {string} imageData - Base64编码的图像数据
 * @returns {string} - 返回哈希值
 */
export function generateImageHash(imageData) {
  // 简单的哈希函数，实际应用中可以使用更复杂的算法
  let hash = 0;
  const sample = imageData.substring(0, 10000); // 只使用前10000个字符以提高性能
  
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  
  return hash.toString(16);
}

/**
 * 缓存翻译结果
 * @param {string} imageHash - 图像哈希值
 * @param {Object} data - 缓存数据
 * @returns {Promise<void>}
 */
export async function cacheTranslation(imageHash, data) {
  return new Promise((resolve, reject) => {
    try {
      // 先获取现有缓存
      chrome.storage.local.get(['translationCache'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        const cache = result.translationCache || {};
        const config = {};
        
        // 获取最大缓存大小
        chrome.storage.sync.get(['advancedSettings'], (configResult) => {
          const maxCacheSize = configResult.advancedSettings?.maxCacheSize || 50;
          
          // 如果缓存已满，删除最旧的条目
          const keys = Object.keys(cache);
          if (keys.length >= maxCacheSize) {
            // 按时间戳排序
            keys.sort((a, b) => (cache[a].timestamp || 0) - (cache[b].timestamp || 0));
            
            // 删除最旧的条目，直到缓存大小低于限制
            while (keys.length >= maxCacheSize) {
              const oldestKey = keys.shift();
              delete cache[oldestKey];
            }
          }
          
          // 添加新条目
          cache[imageHash] = {
            ...data,
            timestamp: Date.now()
          };
          
          // 保存更新后的缓存
          chrome.storage.local.set({ translationCache: cache }, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 获取缓存的翻译结果
 * @param {string} imageHash - 图像哈希值
 * @returns {Promise<Object|null>} - 返回缓存数据或null
 */
export async function getCachedTranslation(imageHash) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(['translationCache'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        const cache = result.translationCache || {};
        resolve(cache[imageHash] || null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 清除所有翻译缓存
 * @returns {Promise<void>}
 */
export async function clearTranslationCache() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.remove(['translationCache'], () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
