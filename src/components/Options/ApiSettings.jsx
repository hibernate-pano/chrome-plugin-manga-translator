import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfigStore } from '@/stores/config';
import { Info } from 'lucide-react';

// API提供商信息
const providerInfo = {
  openai: {
    name: 'OpenAI',
    description: '使用OpenAI的GPT模型进行翻译',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-3.5-turbo',
    models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o'],
    needsApiKey: true
  },
  claude: {
    name: 'Claude',
    description: '使用Anthropic的Claude模型进行翻译',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-haiku-20240307',
    models: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229', 'claude-3-opus-20240229'],
    needsApiKey: true
  },
  deepseek: {
    name: 'DeepSeek',
    description: '使用深度求索的DeepSeek模型进行翻译',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-coder-v2:latest'],
    needsApiKey: true
  },
  qwen: {
    name: 'Qwen',
    description: '使用阿里通义千问模型进行翻译',
    baseUrl: 'https://dashscope.aliyuncs.com',
    defaultModel: 'qwen-turbo',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    needsApiKey: true
  }
};

const ApiSettings = () => {
  const {
    providerType,
    providerConfig,
    updateProviderConfig,
    setProviderType
  } = useConfigStore();

  // 获取当前提供商的配置
  const currentConfig = providerConfig[providerType] || {};
  const currentProviderInfo = providerInfo[providerType] || providerInfo.openai;

  // 处理提供商变更
  const handleProviderChange = (value) => {
    setProviderType(value);
  };

  // 处理API密钥变更
  const handleApiKeyChange = (value) => {
    updateProviderConfig(providerType, { apiKey: value });
  };

  // 处理模型变更
  const handleModelChange = (value) => {
    updateProviderConfig(providerType, { model: value });
  };

  // 处理基础URL变更
  const handleBaseUrlChange = (value) => {
    updateProviderConfig(providerType, { baseUrl: value });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API提供商</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="provider-type">选择翻译服务提供商</Label>
                <div title="选择您要使用的AI翻译服务提供商" className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
              </div>
              <Select value={providerType} onValueChange={handleProviderChange}>
                <SelectTrigger id="provider-type">
                  <SelectValue placeholder="选择翻译服务提供商" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(providerInfo).map(([key, info]) => (
                    <SelectItem key={key} value={key}>
                      {info.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{currentProviderInfo.name}设置</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {currentProviderInfo.needsApiKey && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="api-key">API密钥</Label>
                  <div title={`输入您的${currentProviderInfo.name} API密钥`} className="inline-block">
                    <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                  </div>
                </div>
                <Input
                  id="api-key"
                  type="password"
                  placeholder={`输入${currentProviderInfo.name} API密钥`}
                  value={currentConfig.apiKey || ''}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  API密钥将安全地存储在浏览器的本地存储中，不会被上传到任何服务器。
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="model">模型</Label>
                <div title={`选择要使用的${currentProviderInfo.name}模型`} className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
              </div>
              <Select
                value={currentConfig.model || currentProviderInfo.defaultModel}
                onValueChange={handleModelChange}
              >
                <SelectTrigger id="model">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {currentProviderInfo.models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="base-url">基础URL</Label>
                <div title={`修改${currentProviderInfo.name} API的基础URL`} className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
              </div>
              <Input
                id="base-url"
                type="text"
                placeholder="API基础URL"
                value={currentConfig.baseUrl || currentProviderInfo.baseUrl}
                onChange={(e) => handleBaseUrlChange(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API测试</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="test-text">测试文本</Label>
            </div>
            <Input
              id="test-text"
              type="text"
              placeholder="输入要测试的文本"
              defaultValue="こんにちは世界"
              className="w-full"
            />
            <div className="flex justify-end">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                onClick={() => {
                  // 这里可以添加API测试逻辑
                  alert('API测试功能正在开发中...');
                }}
              >
                测试API
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ApiSettings;