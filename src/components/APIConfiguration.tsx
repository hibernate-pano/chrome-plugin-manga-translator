/**
 * API配置组件
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useConfigStore } from '@/stores/config';

export interface APIConfigurationProps {
  className?: string;
}

export const APIConfiguration: React.FC<APIConfigurationProps> = ({ className }) => {
  const store = useConfigStore();

  const handleProviderChange = (provider: string) => {
    store.setProviderType(provider);
  };

  const handleApiKeyChange = (apiKey: string) => {
    store.setProviderApiKey(store.providerType, apiKey);
  };

  const handleModelChange = (model: string) => {
    store.updateProviderConfig(store.providerType, {
      chatModel: model,
    });
  };

  const handleTestConnection = async () => {
    // 测试API连接
    console.log('测试API连接...');
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>API配置</CardTitle>
        <CardDescription>
          配置翻译服务提供商和API密钥
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="provider-select">翻译服务提供商</Label>
          <Select
            value={store.providerType || 'openai'}
            onValueChange={handleProviderChange}
          >
            <SelectTrigger id="provider-select">
              <SelectValue placeholder="选择提供商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="qwen">Qwen</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key-input">API密钥</Label>
          <Input
            id="api-key-input"
            type="password"
            placeholder="输入API密钥"
            value={store.providerConfig[store.providerType]?.apiKey || ''}
            onChange={(e) => handleApiKeyChange(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="model-select">模型</Label>
          <Select
            value={store.providerConfig[store.providerType]?.chatModel || ''}
            onValueChange={handleModelChange}
          >
            <SelectTrigger id="model-select">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gpt-4">GPT-4</SelectItem>
              <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
              <SelectItem value="deepseek-chat">DeepSeek Chat</SelectItem>
              <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
              <SelectItem value="qwen-turbo">Qwen Turbo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleTestConnection}
          className="w-full"
          disabled={!store.providerConfig[store.providerType]?.apiKey}
        >
          测试连接
        </Button>

        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
            提示
          </h4>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            API密钥将安全存储在本地，不会上传到任何服务器。
            请确保从官方渠道获取API密钥。
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default APIConfiguration;
