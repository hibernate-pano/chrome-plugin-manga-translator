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
          // API提供者配置
          providerType: 'openai', // 默认使用OpenAI
          providerConfig: {
            openai: {
              apiKey: '',
              apiBaseUrl: 'https://api.openai.com/v1',
              visionModel: 'gpt-4-vision-preview',
              chatModel: 'gpt-3.5-turbo',
              temperature: 0.3,
              maxTokens: 1000
            },
            deepseek: {
              apiKey: '',
              apiBaseUrl: 'https://api.deepseek.com/v1',
              visionModel: 'deepseek-vl',
              chatModel: 'deepseek-chat',
              temperature: 0.3,
              maxTokens: 1000
            },
            claude: {
              apiKey: '',
              apiBaseUrl: 'https://api.anthropic.com',
              model: 'claude-3-opus-20240229',
              temperature: 0.3,
              maxTokens: 1000
            }
          },
          
          // 常规配置
          targetLanguage: 'zh-CN',
          enabled: false,
          mode: 'manual',
          styleLevel: 50,
          
          // 样式配置
          fontFamily: '',
          fontSize: 'auto',
          fontColor: 'auto',
          backgroundColor: 'auto',
          
          // 快捷键配置
          shortcuts: {
            toggleTranslation: 'Alt+T',
            translateSelected: 'Alt+S'
          },
          
          // 高级设置
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
            customCorsProxy: '',
            renderType: 'overlay' // 'overlay'或'canvas'
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

        // 处理提供者类型
        if (result.providerType) {
          mergedConfig.providerType = result.providerType;
        }

        // 合并提供者配置
        if (result.providerConfig) {
          mergedConfig.providerConfig = {
            ...defaultConfig.providerConfig,
            ...result.providerConfig
          };
          
          // 确保每个提供者都有完整的配置
          for (const provider in defaultConfig.providerConfig) {
            if (!mergedConfig.providerConfig[provider]) {
              mergedConfig.providerConfig[provider] = defaultConfig.providerConfig[provider];
            } else {
              mergedConfig.providerConfig[provider] = {
                ...defaultConfig.providerConfig[provider],
                ...mergedConfig.providerConfig[provider]
              };
            }
          }
        }

        // 兼容旧配置
        if (result.apiKey && !result.providerConfig?.openai?.apiKey) {
          // 将旧的API配置转移到新的提供者配置中
          if (!mergedConfig.providerConfig.openai) {
            mergedConfig.providerConfig.openai = {};
          }
          
          mergedConfig.providerConfig.openai.apiKey = result.apiKey;
          
          if (result.apiBaseUrl) {
            mergedConfig.providerConfig.openai.apiBaseUrl = result.apiBaseUrl;
          }
          
          if (result.model) {
            mergedConfig.providerConfig.openai.chatModel = result.model;
          }
          
          if (result.temperature !== undefined) {
            mergedConfig.providerConfig.openai.temperature = result.temperature;
          }
        }

        // 合并其他配置
        if (result.targetLanguage) mergedConfig.targetLanguage = result.targetLanguage;
        if (result.enabled !== undefined) mergedConfig.enabled = result.enabled;
        if (result.mode) mergedConfig.mode = result.mode;
        if (result.styleLevel !== undefined) mergedConfig.styleLevel = result.styleLevel;
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
          if (result[key] === undefined && 
              key !== 'providerConfig' && 
              key !== 'apiKey' && 
              key !== 'model' && 
              key !== 'apiBaseUrl') {
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

        // 检查提供者配置
        if (!result.providerConfig || !result.providerType) {
          updates.providerType = defaultConfig.providerType;
          updates.providerConfig = defaultConfig.providerConfig;
          needsUpdate = true;
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
 * 获取当前激活的API提供者配置
 * @returns {Promise<Object>} - 返回提供者配置对象
 */
export async function getActiveProviderConfig() {
  const config = await getConfig();
  const providerType = config.providerType;
  const providerConfig = config.providerConfig[providerType] || {};
  
  return {
    type: providerType,
    config: providerConfig
  };
}

/**
 * 保存API提供者配置
 * @param {string} providerType - 提供者类型
 * @param {Object} providerConfig - 提供者配置
 * @returns {Promise<void>}
 */
export async function saveProviderConfig(providerType, providerConfig) {
  const config = await getConfig();
  
  // 更新提供者类型
  config.providerType = providerType;
  
  // 更新提供者配置
  if (!config.providerConfig) {
    config.providerConfig = {};
  }
  
  config.providerConfig[providerType] = {
    ...config.providerConfig[providerType],
    ...providerConfig
  };
  
  return saveConfig({
    providerType,
    providerConfig: config.providerConfig
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

          // 添加新缓存条目
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
 * 清除翻译缓存
 * @returns {Promise<void>}
 */
export async function clearTranslationCache() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ translationCache: {} }, () => {
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
