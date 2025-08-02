import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-react';

interface ApiKeyInputProps {
  apiKey: string;
  onChange: (apiKey: string) => void;
  providerType: string;
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({ apiKey, onChange, providerType }) => {
  const [value, setValue] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
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
  const validateApiKey = (key: string) => {
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
        } else if (key.length < 40) {
          valid = false;
          message = 'Claude API密钥长度不足';
        } else {
          valid = true;
        }
        break;
        
      case 'deepseek':
        // DeepSeek密钥通常以sk-开头
        if (!key.startsWith('sk-')) {
          valid = false;
          message = 'DeepSeek API密钥应以"sk-"开头';
        } else if (key.length < 30) {
          valid = false;
          message = 'DeepSeek API密钥长度不足';
        } else {
          valid = true;
        }
        break;
        
      default:
        // 通用验证：至少20个字符
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

  // 获取提供者名称
  const getProviderName = () => {
    const names: Record<string, string> = {
      openai: 'OpenAI',
      claude: 'Claude',
      deepseek: 'DeepSeek',
      qwen: 'Qwen',
      anthropic: 'Anthropic',
      openrouter: 'OpenRouter'
    };
    return names[providerType] || providerType;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    validateApiKey(newValue);
  };

  const handleSave = () => {
    onChange(value);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  const toggleShowKey = () => {
    setShowKey(!showKey);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="api-key-input">
        {getProviderName()} 密钥
      </Label>
      <div className="flex space-x-2">
        <div className="flex-1 relative">
          <Input
            id="api-key-input"
            type={showKey ? "text" : "password"}
            value={value}
            onChange={handleChange}
            onBlur={handleSave}
            onKeyPress={handleKeyPress}
            placeholder={`输入您的${getProviderName()}密钥`}
            className={`pr-10 ${
              isValid === false 
                ? 'border-destructive focus-visible:ring-destructive' 
                : isValid === true 
                ? 'border-green-500 focus-visible:ring-green-500' 
                : ''
            }`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={toggleShowKey}
            title={showKey ? "隐藏密钥" : "显示密钥"}
          >
            {showKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      {isValid === false && errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
      {isValid === true && (
        <p className="text-sm text-green-600">✓ 密钥格式正确</p>
      )}
    </div>
  );
};

export default ApiKeyInput;
