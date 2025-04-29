import React, { useState, useEffect } from 'react';
import ApiSettings from './ApiSettings';
import StyleSettings from './StyleSettings';
import KeyboardShortcuts from './KeyboardShortcuts';
import CacheManager from './CacheManager';
import AdvancedSettings from './AdvancedSettings';

const OptionsApp = () => {
  const [activeTab, setActiveTab] = useState('api');
  const [config, setConfig] = useState({
    apiKey: '',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    targetLanguage: 'zh-CN',
    enabled: false,
    mode: 'manual',
    styleLevel: 50,
    fontFamily: '',
    fontSize: 'auto',
    fontColor: 'auto',
    backgroundColor: 'auto',
    shortcuts: {
      toggleTranslation: 'Alt+T',
      translateSelected: 'Alt+S',
    },
    advancedSettings: {
      useLocalOcr: false,
      cacheResults: true,
      maxCacheSize: 50,
      debugMode: false,
    }
  });

  // 加载配置
  useEffect(() => {
    chrome.storage.sync.get(null, (result) => {
      if (result) {
        setConfig(prev => ({
          ...prev,
          ...result,
          advancedSettings: {
            ...prev.advancedSettings,
            ...(result.advancedSettings || {})
          },
          shortcuts: {
            ...prev.shortcuts,
            ...(result.shortcuts || {})
          }
        }));
      }
    });
  }, []);

  // 保存配置
  const saveConfig = (newConfig) => {
    const updatedConfig = { ...config, ...newConfig };
    setConfig(updatedConfig);
    chrome.storage.sync.set(updatedConfig);
  };

  // 清除缓存
  const clearCache = () => {
    chrome.storage.local.remove(['translationCache'], () => {
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
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${
                  activeTab === 'api'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                API设置
              </button>
              <button
                onClick={() => setActiveTab('style')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${
                  activeTab === 'style'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                样式设置
              </button>
              <button
                onClick={() => setActiveTab('shortcuts')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${
                  activeTab === 'shortcuts'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                快捷键
              </button>
              <button
                onClick={() => setActiveTab('cache')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${
                  activeTab === 'cache'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                缓存管理
              </button>
              <button
                onClick={() => setActiveTab('advanced')}
                className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${
                  activeTab === 'advanced'
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
                config={config} 
                onChange={saveConfig} 
              />
            )}
            
            {activeTab === 'style' && (
              <StyleSettings 
                config={config} 
                onChange={saveConfig} 
              />
            )}
            
            {activeTab === 'shortcuts' && (
              <KeyboardShortcuts 
                shortcuts={config.shortcuts} 
                onChange={(shortcuts) => saveConfig({ shortcuts })} 
              />
            )}
            
            {activeTab === 'cache' && (
              <CacheManager 
                config={config} 
                onClearCache={clearCache} 
              />
            )}
            
            {activeTab === 'advanced' && (
              <AdvancedSettings 
                settings={config.advancedSettings} 
                onChange={(advancedSettings) => saveConfig({ advancedSettings })} 
              />
            )}
          </div>
        </div>

        <div className="mt-8 flex justify-between">
          <div>
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
              onClick={() => window.close()}
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
