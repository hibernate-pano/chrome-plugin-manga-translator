import React, { useState, useEffect } from 'react';
import ApiKeyInput from './ApiKeyInput';
import LanguageSelector from './LanguageSelector';
import TranslationToggle from './TranslationToggle';
import ModeSelector from './ModeSelector';
import StyleSlider from './StyleSlider';
import { printCurrentConfig, checkApiConfig } from '../../utils/debug';

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
    // 获取所有配置项
    chrome.storage.sync.get(null, (result) => {
      if (result) {
        // 更新配置，保留默认值
        setConfig(prevConfig => ({
          ...prevConfig,
          apiKey: result.apiKey || prevConfig.apiKey,
          targetLanguage: result.targetLanguage || prevConfig.targetLanguage,
          enabled: result.enabled !== undefined ? result.enabled : prevConfig.enabled,
          mode: result.mode || prevConfig.mode,
          styleLevel: result.styleLevel !== undefined ? result.styleLevel : prevConfig.styleLevel,
          // 添加新的配置项
          customModel: result.customModel || '',
          useCustomModel: result.useCustomModel || false,
          apiBaseUrl: result.apiBaseUrl || 'https://api.openai.com/v1',
          useCustomApiUrl: result.useCustomApiUrl || false,
        }));

        // 打印配置，用于调试
        console.log('加载的配置:', result);
      }
    });
  }, []);

  // 保存配置
  const saveConfig = (newConfig) => {
    const updatedConfig = { ...config, ...newConfig };
    setConfig(updatedConfig);

    // 获取当前所有配置，然后合并新配置
    chrome.storage.sync.get(null, (result) => {
      const fullConfig = { ...result, ...updatedConfig };

      // 保存完整配置
      chrome.storage.sync.set(fullConfig, () => {
        console.log('保存的配置:', fullConfig);

        // 通知内容脚本配置已更新
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'CONFIG_UPDATED',
              config: fullConfig
            });
          }
        });
      });
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

      <div className="mt-6 text-center flex justify-between">
        <button
          onClick={() => {
            printCurrentConfig().then(() => {
              checkApiConfig().then(isValid => {
                alert(isValid ? 'API配置有效，请查看控制台获取详细信息' : 'API配置无效，请检查API密钥和设置');
              });
            });
          }}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition text-sm"
        >
          检查配置
        </button>

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
