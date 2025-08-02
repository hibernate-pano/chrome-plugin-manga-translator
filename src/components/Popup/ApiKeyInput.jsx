import { useState, useEffect } from 'react';

const ApiKeyInput = ({ apiKey, onChange, providerType }) => {
  const [value, setValue] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [isValid, setIsValid] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // 当 apiKey 属性更新时，更新内部状态
  useEffect(() => {
    if (apiKey !== value) {
      setValue(apiKey);
    }
    
    // 基本验证：检查API密钥格式
    if (apiKey) {
      validateApiKey(apiKey);
    } else {
      setIsValid(null);
      setErrorMessage('');
    }
  }, [apiKey, providerType]);

  // 验证API密钥格式
  const validateApiKey = (key) => {
    if (!key || key.trim() === '') {
      setIsValid(null);
      setErrorMessage('');
      return;
    }
    
    // 根据不同提供者的密钥格式进行特定验证
    let valid = false;
    let message = '';
    
    switch (providerType) {
      case 'openai':
        // OpenAI密钥通常以sk-开头
        if (!key.startsWith('sk-')) {
          valid = false;
          message = 'OpenAI API密钥应以"sk-"开头';
        } else if (key.length < 30) {
          valid = false;
          message = 'OpenAI API密钥长度不足';
        } else {
          valid = true;
        }
        break;
        
      case 'claude':
        // Claude密钥通常以sk-ant-开头
        if (!key.startsWith('sk-ant-')) {
          valid = false;
          message = 'Claude API密钥应以"sk-ant-"开头';
        } else if (key.length < 30) {
          valid = false;
          message = 'Claude API密钥长度不足';
        } else {
          valid = true;
        }
        break;
        
      case 'deepseek':
        // DeepSeek密钥没有特定格式，但应该有足够长度
        if (key.length < 20) {
          valid = false;
          message = 'API密钥长度不足';
        } else {
          valid = true;
        }
        break;
        
      case 'qwen':
        // Qwen密钥没有特定格式，但应该有足够长度
        if (key.length < 20) {
          valid = false;
          message = 'API密钥长度不足';
        } else {
          valid = true;
        }
        break;
        
      default:
        // 通用验证：确保密钥有足够长度
        if (key.length < 20) {
          valid = false;
          message = 'API密钥长度不足';
        } else {
          valid = true;
        }
    }
    
    setIsValid(valid);
    setErrorMessage(message);
  };

  const handleChange = (e) => {
    const newValue = e.target.value;
    setValue(newValue);
    validateApiKey(newValue);
  };

  const handleSave = () => {
    if (value !== apiKey) {
      onChange(value);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  const toggleShowKey = () => {
    setShowKey(!showKey);
  };

  // 获取提供者显示名称
  const getProviderName = () => {
    const providers = {
      openai: 'OpenAI',
      claude: 'Anthropic Claude',
      deepseek: 'DeepSeek',
      qwen: 'Qwen',
    };
    
    return providers[providerType] || 'API';
  };

  return (
    <div className="mb-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {getProviderName()} 密钥
      </label>
      <div className="flex">
        <input
          type={showKey ? "text" : "password"}
          value={value}
          onChange={handleChange}
          onBlur={handleSave}
          onKeyPress={handleKeyPress}
          placeholder={`输入您的${getProviderName()}密钥`}
          className={`flex-1 px-3 py-2 border ${isValid === false ? 'border-red-300' : isValid === true ? 'border-green-300' : 'border-gray-300'} rounded-l text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
        <button
          onClick={toggleShowKey}
          className="px-3 py-2 bg-gray-200 rounded-r border border-gray-300 border-l-0"
          title={showKey ? "隐藏密钥" : "显示密钥"}
        >
          {showKey ? "👁️" : "👁️‍🗨️"}
        </button>
      </div>
      {isValid === false && (
        <p className="text-xs text-red-500 mt-1">
          {errorMessage || '密钥格式可能不正确，请检查'}
        </p>
      )}
      <p className="text-xs text-gray-500 mt-1">
        您的API密钥仅存储在本地，不会发送到任何第三方服务器
      </p>
    </div>
  );
};

export default ApiKeyInput;
