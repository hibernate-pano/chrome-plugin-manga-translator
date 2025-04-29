import React, { useState, useEffect } from 'react';
import ApiKeyInput from './ApiKeyInput';
import LanguageSelector from './LanguageSelector';
import TranslationToggle from './TranslationToggle';
import ModeSelector from './ModeSelector';
import StyleSlider from './StyleSlider';

const PopupApp = () => {
  const [config, setConfig] = useState({
    apiKey: '',
    targetLanguage: 'zh-CN',
    enabled: false,
    mode: 'manual', // 'manual' or 'auto'
    styleLevel: 50, // 0-100
  });

  // 加载配置
  useEffect(() => {
    chrome.storage.sync.get(['apiKey', 'targetLanguage', 'enabled', 'mode', 'styleLevel'], (result) => {
      if (result) {
        setConfig({
          apiKey: result.apiKey || '',
          targetLanguage: result.targetLanguage || 'zh-CN',
          enabled: result.enabled || false,
          mode: result.mode || 'manual',
          styleLevel: result.styleLevel || 50,
        });
      }
    });
  }, []);

  // 保存配置
  const saveConfig = (newConfig) => {
    const updatedConfig = { ...config, ...newConfig };
    setConfig(updatedConfig);
    chrome.storage.sync.set(updatedConfig);
    
    // 通知内容脚本配置已更新
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          type: 'CONFIG_UPDATED', 
          config: updatedConfig 
        });
      }
    });
  };

  // 打开选项页面
  const openOptionsPage = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="p-4 bg-gray-50 min-h-full">
      <h1 className="text-xl font-bold mb-4 text-center text-blue-600">漫画翻译助手</h1>
      
      <div className="mb-4">
        <ApiKeyInput 
          apiKey={config.apiKey} 
          onChange={(apiKey) => saveConfig({ apiKey })} 
        />
      </div>
      
      <div className="mb-4">
        <TranslationToggle 
          enabled={config.enabled} 
          onChange={(enabled) => saveConfig({ enabled })} 
        />
      </div>
      
      <div className="mb-4">
        <LanguageSelector 
          language={config.targetLanguage} 
          onChange={(targetLanguage) => saveConfig({ targetLanguage })} 
        />
      </div>
      
      <div className="mb-4">
        <ModeSelector 
          mode={config.mode} 
          onChange={(mode) => saveConfig({ mode })} 
        />
      </div>
      
      <div className="mb-4">
        <StyleSlider 
          value={config.styleLevel} 
          onChange={(styleLevel) => saveConfig({ styleLevel })} 
        />
      </div>
      
      <div className="mt-6 text-center">
        <button 
          onClick={openOptionsPage}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
        >
          高级设置
        </button>
      </div>
    </div>
  );
};

export default PopupApp;
