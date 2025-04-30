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
          return;
        }

        // 默认配置
        const defaultConfig = {
          apiKey: 'sk-bpbqulqtsmbywglsemzqantxqhmilksogyeitgcpkbvwioix',
          targetLanguage: 'zh-CN',
          enabled: false,
          mode: 'manual',
          styleLevel: 50,
          model: 'gpt-3.5-turbo',
          customModel: 'Qwen/Qwen2.5-VL-32B-Instruct',
          useCustomModel: true,
          apiBaseUrl: 'https://api.siliconflow.cn/v1',
          useCustomApiUrl: true,
          temperature: 0.7,
          fontFamily: '',
          fontSize: 'auto',
          fontColor: 'auto',
          backgroundColor: 'auto',
          shortcuts: {
            toggleTranslation: 'Alt+T',
            translateSelected: 'Alt+S'
          },
          advancedSettings: {
            useLocalOcr: false,
            cacheResults: true,
            maxCacheSize: 50,
            debugMode: false,
            apiTimeout: 30,
            maxConcurrentRequests: 3,
            imagePreprocessing: 'none',
            showOriginalText: false,
            translationPrompt: '',
            useCorsProxy: true,
            corsProxyType: 'corsproxy',
            customCorsProxy: ''
          }
        };

        // 如果没有配置，设置默认配置
        if (!result || Object.keys(result).length === 0) {
          console.log('没有找到配置，使用默认配置');

          // 保存默认配置
          chrome.storage.sync.set(defaultConfig, () => {
            console.log('已设置默认配置');
          });

          resolve(defaultConfig);
          return;
        }

        // 合并默认配置和用户配置，确保所有必要的字段都存在
        const mergedConfig = { ...defaultConfig };

        // 只有当用户没有设置API密钥时，才使用默认的API密钥
        if (result.apiKey) {
          mergedConfig.apiKey = result.apiKey;

          // 如果用户设置了自己的API密钥，尊重用户的API设置
          if (result.useCustomApiUrl !== undefined) {
            mergedConfig.useCustomApiUrl = result.useCustomApiUrl;
          }

          if (result.apiBaseUrl) {
            mergedConfig.apiBaseUrl = result.apiBaseUrl;
          }

          if (result.useCustomModel !== undefined) {
            mergedConfig.useCustomModel = result.useCustomModel;
          }

          if (result.customModel) {
            mergedConfig.customModel = result.customModel;
          }

          if (result.model) {
            mergedConfig.model = result.model;
          }
        }

        // 合并其他配置
        if (result.targetLanguage) mergedConfig.targetLanguage = result.targetLanguage;
        if (result.enabled !== undefined) mergedConfig.enabled = result.enabled;
        if (result.mode) mergedConfig.mode = result.mode;
        if (result.styleLevel !== undefined) mergedConfig.styleLevel = result.styleLevel;
        if (result.temperature !== undefined) mergedConfig.temperature = result.temperature;
        if (result.fontFamily) mergedConfig.fontFamily = result.fontFamily;
        if (result.fontSize) mergedConfig.fontSize = result.fontSize;
        if (result.fontColor) mergedConfig.fontColor = result.fontColor;
        if (result.backgroundColor) mergedConfig.backgroundColor = result.backgroundColor;

        // 合并快捷键设置
        if (result.shortcuts) {
          mergedConfig.shortcuts = {
            ...mergedConfig.shortcuts,
            ...result.shortcuts
          };
        }

        // 合并高级设置
        if (result.advancedSettings) {
          mergedConfig.advancedSettings = {
            ...mergedConfig.advancedSettings,
            ...result.advancedSettings
          };
        }

        // 检查是否有缺失的配置项，如果有则更新
        const updates = {};
        let needsUpdate = false;

        // 检查所有顶级属性
        for (const key in defaultConfig) {
          if (result[key] === undefined && key !== 'apiKey' && key !== 'customModel' && key !== 'apiBaseUrl') {
            updates[key] = defaultConfig[key];
            needsUpdate = true;
          }
        }

        // 检查嵌套对象
        if (!result.shortcuts) {
          updates.shortcuts = defaultConfig.shortcuts;
          needsUpdate = true;
        }

        if (!result.advancedSettings) {
          updates.advancedSettings = defaultConfig.advancedSettings;
          needsUpdate = true;
        } else {
          // 检查高级设置中的各个属性
          const advancedUpdates = {};
          for (const key in defaultConfig.advancedSettings) {
            if (result.advancedSettings[key] === undefined) {
              advancedUpdates[key] = defaultConfig.advancedSettings[key];
            }
          }

          if (Object.keys(advancedUpdates).length > 0) {
            updates.advancedSettings = {
              ...result.advancedSettings,
              ...advancedUpdates
            };
            needsUpdate = true;
          }
        }

        // 如果有需要更新的配置，保存更新
        if (needsUpdate) {
          chrome.storage.sync.set(updates, () => {
            console.log('已更新缺失的配置项');
          });
        }

        resolve(mergedConfig);
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
