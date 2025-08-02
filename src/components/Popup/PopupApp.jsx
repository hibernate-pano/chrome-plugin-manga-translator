import { useState, useEffect } from 'react';
import ApiKeyInput from './ApiKeyInput';
import LanguageSelector from './LanguageSelector';
import TranslationToggle from './TranslationToggle';
import ModeSelector from './ModeSelector';
import StyleSlider from './StyleSlider';
import FirstTimeGuide from './FirstTimeGuide';
import { printCurrentConfig, checkApiConfig } from '../../utils/debug';

const PopupApp = () => {
  const [config, setConfig] = useState({
    providerType: 'openai',
    providerConfig: {
      openai: {
        apiKey: '',
        apiBaseUrl: 'https://api.openai.com/v1',
      }
    },
    targetLanguage: 'zh-CN',
    enabled: false,
    mode: 'manual', // 'manual' or 'auto'
    styleLevel: 50, // 0-100
  });

  const [showFirstTimeGuide, setShowFirstTimeGuide] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // 加载配置
  useEffect(() => {
    setIsLoading(true);
    // 获取所有配置项
    chrome.storage.sync.get(null, (result) => {
      if (result) {
        // 创建一个新的配置对象，保留默认值
        const newConfig = { ...config };

        // 处理新的提供者配置结构
        if (result.providerType) {
          newConfig.providerType = result.providerType;
        }
        
        if (result.providerConfig) {
          newConfig.providerConfig = result.providerConfig;
        } else if (result.apiKey) {
          // 兼容旧配置
          // 检测是否使用Qwen模型
          const usingQwen = 
            (result.customModel && result.customModel.toLowerCase().includes('qwen')) || 
            (result.apiBaseUrl && result.apiBaseUrl.includes('siliconflow.cn')) ||
            (result.useCustomModel && result.useCustomApiUrl);
          
          newConfig.providerType = usingQwen ? 'qwen' : 'openai';
          
          if (usingQwen) {
            if (!newConfig.providerConfig.qwen) {
              newConfig.providerConfig.qwen = {};
            }
            
            newConfig.providerConfig.qwen.apiKey = result.apiKey;
            
            if (result.apiBaseUrl) {
              newConfig.providerConfig.qwen.apiBaseUrl = result.apiBaseUrl;
            }
            
            if (result.customModel) {
              newConfig.providerConfig.qwen.model = result.customModel;
            }
          } else {
            if (!newConfig.providerConfig.openai) {
              newConfig.providerConfig.openai = {};
            }
            
            newConfig.providerConfig.openai.apiKey = result.apiKey;
            
            if (result.apiBaseUrl) {
              newConfig.providerConfig.openai.apiBaseUrl = result.apiBaseUrl;
            }
          }
        }

        // 更新常规配置
        if (result.targetLanguage !== undefined) newConfig.targetLanguage = result.targetLanguage;
        if (result.enabled !== undefined) newConfig.enabled = result.enabled;
        if (result.mode !== undefined) newConfig.mode = result.mode;
        if (result.styleLevel !== undefined) newConfig.styleLevel = result.styleLevel;

        // 更新状态
        setConfig(newConfig);
        
        // 检查是否需要显示首次使用引导
        const activeProvider = newConfig.providerType || 'openai';
        const apiKey = newConfig.providerConfig?.[activeProvider]?.apiKey || '';
        setShowFirstTimeGuide(!apiKey);

        // 打印配置，用于调试
        console.log('Popup页面加载的配置:', result);
        console.log('Popup页面合并后的配置:', newConfig);
      }
      setIsLoading(false);
    });
  }, []);

  // 保存配置
  const saveConfig = (newConfig) => {
    // 更新本地状态
    const updatedConfig = { ...config };
    
    // 处理不同类型的配置更新
    if (newConfig.providerType) {
      updatedConfig.providerType = newConfig.providerType;
    }
    
    if (newConfig.providerConfig) {
      updatedConfig.providerConfig = {
        ...updatedConfig.providerConfig,
        ...newConfig.providerConfig
      };
    }
    
    // 处理特定提供者的API Key更新
    if (newConfig.apiKey !== undefined) {
      const activeProvider = updatedConfig.providerType || 'openai';
      if (!updatedConfig.providerConfig[activeProvider]) {
        updatedConfig.providerConfig[activeProvider] = {};
      }
      updatedConfig.providerConfig[activeProvider].apiKey = newConfig.apiKey;
      
      // 更新保存配置，确保保存的是新结构
      newConfig = {
        providerConfig: {
          [activeProvider]: {
            apiKey: newConfig.apiKey
          }
        }
      };
      
      // API Key设置后隐藏首次使用引导
      if (newConfig.apiKey) {
        setShowFirstTimeGuide(false);
      }
    }
    
    // 更新其他常规配置
    if (newConfig.targetLanguage !== undefined) updatedConfig.targetLanguage = newConfig.targetLanguage;
    if (newConfig.enabled !== undefined) updatedConfig.enabled = newConfig.enabled;
    if (newConfig.mode !== undefined) updatedConfig.mode = newConfig.mode;
    if (newConfig.styleLevel !== undefined) updatedConfig.styleLevel = newConfig.styleLevel;
    
    setConfig(updatedConfig);

    // 保存更改的部分
    chrome.storage.sync.set(newConfig, () => {
      console.log('保存的配置部分:', newConfig);

      // 通知内容脚本配置已更新
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'CONFIG_UPDATED',
            config: updatedConfig  // 发送完整的更新后配置
          });
        }
      });
    });
  };

  // 打开选项页面
  const openOptionsPage = () => {
    chrome.runtime.openOptionsPage();
  };

  // 获取当前激活的提供者的API Key
  const getActiveApiKey = () => {
    const activeProvider = config.providerType || 'openai';
    return config.providerConfig?.[activeProvider]?.apiKey || '';
  };

  if (isLoading) {
    return (
      <div className="p-4 flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-50 min-h-full">
      <h1 className="text-xl font-bold mb-4 text-center text-blue-600">漫画翻译助手</h1>

      {showFirstTimeGuide ? (
        <FirstTimeGuide onContinue={openOptionsPage} />
      ) : (
        <>
          <div className="mb-4">
            <ApiKeyInput
              apiKey={getActiveApiKey()}
              providerType={config.providerType}
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
        </>
      )}

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
