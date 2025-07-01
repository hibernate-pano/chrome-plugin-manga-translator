import React, { useState, useEffect } from 'react';
import ApiSettings from './ApiSettings';
import StyleSettings from './StyleSettings';
import KeyboardShortcuts from './KeyboardShortcuts';
import CacheManager from './CacheManager';
import AdvancedSettings from './AdvancedSettings';
import { printCurrentConfig, checkApiConfig } from '../../utils/debug';

const OptionsApp = () => {
  const [activeTab, setActiveTab] = useState('api');
  const [config, setConfig] = useState({
    // API提供者配置
    providerType: 'openai',
    providerConfig: {
      openai: {
        apiKey: '',
        apiBaseUrl: 'https://api.openai.com/v1',
        visionModel: 'gpt-4-vision-preview',
        chatModel: 'gpt-3.5-turbo',
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
      translateSelected: 'Alt+S',
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
      renderType: 'overlay'
    }
  });

  // 加载配置
  useEffect(() => {
    console.log('Options页面初始化，加载配置');

    // 定义加载配置的函数
    const loadConfig = () => {
      chrome.storage.sync.get(null, (result) => {
        if (result && Object.keys(result).length > 0) {
          console.log('Options页面加载到配置:', result);

          // 创建一个深拷贝的配置对象，避免引用问题
          const newConfig = {
            ...config,  // 保留默认值
          };

          // 更新提供者类型
          if (result.providerType) {
            newConfig.providerType = result.providerType;
          }

          // 更新提供者配置
          if (result.providerConfig) {
            newConfig.providerConfig = {
              ...config.providerConfig,
              ...result.providerConfig
            };
            
            // 确保每个提供者都有完整的配置
            for (const provider in config.providerConfig) {
              if (!newConfig.providerConfig[provider]) {
                newConfig.providerConfig[provider] = config.providerConfig[provider];
              } else {
                newConfig.providerConfig[provider] = {
                  ...config.providerConfig[provider],
                  ...newConfig.providerConfig[provider]
                };
              }
            }
          }

          // 兼容旧配置
          if (result.apiKey && !result.providerConfig?.openai?.apiKey) {
            if (!newConfig.providerConfig.openai) {
              newConfig.providerConfig.openai = {};
            }
            
            newConfig.providerConfig.openai.apiKey = result.apiKey;
            
            if (result.apiBaseUrl) {
              newConfig.providerConfig.openai.apiBaseUrl = result.apiBaseUrl;
            }
            
            if (result.model) {
              newConfig.providerConfig.openai.chatModel = result.model;
            }
            
            if (result.temperature !== undefined) {
              newConfig.providerConfig.openai.temperature = result.temperature;
            }
          }

          // 更新其他配置
          if (result.targetLanguage) newConfig.targetLanguage = result.targetLanguage;
          if (result.enabled !== undefined) newConfig.enabled = result.enabled;
          if (result.mode) newConfig.mode = result.mode;
          if (result.styleLevel !== undefined) newConfig.styleLevel = result.styleLevel;
          if (result.fontFamily) newConfig.fontFamily = result.fontFamily;
          if (result.fontSize) newConfig.fontSize = result.fontSize;
          if (result.fontColor) newConfig.fontColor = result.fontColor;
          if (result.backgroundColor) newConfig.backgroundColor = result.backgroundColor;

          // 确保嵌套对象正确合并
          if (result.advancedSettings) {
            newConfig.advancedSettings = {
              ...config.advancedSettings,
              ...result.advancedSettings
            };
          }

          if (result.shortcuts) {
            newConfig.shortcuts = {
              ...config.shortcuts,
              ...result.shortcuts
            };
          }

          console.log('Options页面设置合并后的配置:', newConfig);
          setConfig(newConfig);
        } else {
          console.log('Options页面没有找到配置，使用默认配置');
        }
      });
    };

    // 立即加载配置
    loadConfig();

    // 监听存储变化事件
    const handleStorageChange = (_changes, area) => {
      if (area === 'sync') {
        console.log('检测到存储变化，重新加载配置');
        loadConfig();
      }
    };

    // 添加存储变化监听器
    chrome.storage.onChanged.addListener(handleStorageChange);

    // 清理函数
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // 保存配置
  const saveConfig = (newConfig) => {
    console.log('保存配置部分:', newConfig);

    // 更新本地状态
    const updatedConfig = { ...config };

    // 处理顶级属性
    for (const key in newConfig) {
      if (typeof newConfig[key] !== 'object' || newConfig[key] === null) {
        updatedConfig[key] = newConfig[key];
      }
    }

    // 处理提供者配置
    if (newConfig.providerType) {
      updatedConfig.providerType = newConfig.providerType;
    }
    
    if (newConfig.providerConfig) {
      updatedConfig.providerConfig = {
        ...(updatedConfig.providerConfig || {}),
        ...newConfig.providerConfig
      };
    }

    // 处理嵌套对象 - advancedSettings
    if (newConfig.advancedSettings) {
      updatedConfig.advancedSettings = {
        ...(updatedConfig.advancedSettings || {}),
        ...newConfig.advancedSettings
      };
    }

    // 处理嵌套对象 - shortcuts
    if (newConfig.shortcuts) {
      updatedConfig.shortcuts = {
        ...(updatedConfig.shortcuts || {}),
        ...newConfig.shortcuts
      };
    }

    // 更新组件状态
    setConfig(updatedConfig);

    // 保存到存储
    chrome.storage.sync.set(newConfig, () => {
      console.log('已保存配置部分到存储');
      console.log('当前完整配置:', updatedConfig);

      // 验证保存是否成功
      chrome.storage.sync.get(null, (result) => {
        console.log('验证存储中的配置:', result);
      });
    });
  };

  // 清除缓存
  const clearCache = () => {
    chrome.storage.local.set({ translationCache: {} }, () => {
      alert('翻译缓存已清除');
    });
  };

  // 导出配置
  const exportConfig = () => {
    const configData = JSON.stringify(config, null, 2);
    const blob = new Blob([configData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'manga-translator-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 导入配置
  const importConfig = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedConfig = JSON.parse(e.target.result);
        saveConfig(importedConfig);
        alert('配置导入成功');
      } catch (error) {
        alert('配置导入失败: ' + error.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="options-page bg-gray-50 min-h-screen">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto py-4 px-4">
          <h1 className="text-2xl font-bold text-gray-900">漫画翻译助手 - 设置</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 px-4">
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('api')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${activeTab === 'api'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                API设置
              </button>
              <button
                onClick={() => setActiveTab('style')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${activeTab === 'style'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                样式设置
              </button>
              <button
                onClick={() => setActiveTab('shortcuts')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${activeTab === 'shortcuts'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                快捷键
              </button>
              <button
                onClick={() => setActiveTab('cache')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${activeTab === 'cache'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                缓存管理
              </button>
              <button
                onClick={() => setActiveTab('advanced')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${activeTab === 'advanced'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                高级设置
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'api' && (
              <ApiSettings
                config={{
                  providerType: config.providerType,
                  providerConfig: config.providerConfig
                }}
                onChange={saveConfig}
              />
            )}

            {activeTab === 'style' && (
              <StyleSettings
                config={{
                  styleLevel: config.styleLevel,
                  fontFamily: config.fontFamily,
                  fontSize: config.fontSize,
                  fontColor: config.fontColor,
                  backgroundColor: config.backgroundColor
                }}
                onChange={saveConfig}
              />
            )}

            {activeTab === 'shortcuts' && (
              <KeyboardShortcuts
                config={{ shortcuts: config.shortcuts }}
                onChange={(shortcuts) => saveConfig({ shortcuts })}
              />
            )}

            {activeTab === 'cache' && (
              <CacheManager
                onClearCache={clearCache}
                config={{ advancedSettings: config.advancedSettings }}
                onChange={(advancedSettings) => saveConfig({ advancedSettings })}
              />
            )}

            {activeTab === 'advanced' && (
              <AdvancedSettings
                config={{ advancedSettings: config.advancedSettings }}
                onChange={(advancedSettings) => saveConfig({ advancedSettings })}
              />
            )}
          </div>
        </div>

        <div className="mt-8 flex justify-between">
          <div>
            <button
              onClick={() => {
                printCurrentConfig().then(() => {
                  checkApiConfig().then(isValid => {
                    alert(isValid ? 'API配置有效，请查看控制台获取详细信息' : 'API配置无效，请检查API密钥和设置');
                  });
                });
              }}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition mr-2 text-sm"
            >
              检查配置
            </button>
            <button
              onClick={exportConfig}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition mr-2"
            >
              导出配置
            </button>
            <label className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition cursor-pointer">
              导入配置
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={importConfig}
              />
            </label>
          </div>

          <div>
            <button
              onClick={() => {
                // 直接保存当前完整配置
                console.log('保存并关闭，当前完整配置:', config);

                // 确保配置中包含所有必要的字段
                const completeConfig = { ...config };

                // 确保 advancedSettings 存在
                if (!completeConfig.advancedSettings) {
                  completeConfig.advancedSettings = {
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
                    renderType: 'overlay'
                  };
                }

                // 确保 shortcuts 存在
                if (!completeConfig.shortcuts) {
                  completeConfig.shortcuts = {
                    toggleTranslation: 'Alt+T',
                    translateSelected: 'Alt+S'
                  };
                }

                chrome.storage.sync.set(completeConfig, () => {
                  console.log('已保存完整配置到存储');

                  // 验证保存是否成功
                  chrome.storage.sync.get(null, (result) => {
                    console.log('验证存储中的配置:', result);

                    // 显示保存成功的消息
                    const saveStatus = document.createElement('div');
                    saveStatus.textContent = '配置已保存';
                    saveStatus.style.position = 'fixed';
                    saveStatus.style.bottom = '20px';
                    saveStatus.style.right = '20px';
                    saveStatus.style.padding = '10px 20px';
                    saveStatus.style.backgroundColor = 'rgba(0, 128, 0, 0.8)';
                    saveStatus.style.color = 'white';
                    saveStatus.style.borderRadius = '5px';
                    saveStatus.style.zIndex = '9999';
                    document.body.appendChild(saveStatus);

                    // 1秒后关闭窗口
                    setTimeout(() => {
                      window.close();
                    }, 1000);
                  });
                });
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
            >
              保存并关闭
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default OptionsApp;
