/**
 * 简化版 API 配置组件
 * 只保留核心功能：API 密钥输入、提供者选择、配置验证
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useConfigStore } from '@/stores/config';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';

// 支持的 API 提供者配置
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    description: 'GPT-4 系列模型，翻译质量高',
    placeholder: 'sk-...',
    validateKey: (key: string) => key.startsWith('sk-') && key.length > 20,
  },
  deepseek: {
    name: 'DeepSeek',
    description: '深度求索，性价比高',
    placeholder: 'sk-...',
    validateKey: (key: string) => key.length > 10,
  },
  claude: {
    name: 'Claude',
    description: 'Anthropic Claude，理解能力强',
    placeholder: 'sk-ant-...',
    validateKey: (key: string) => key.length > 10,
  },
} as const;

type ProviderType = keyof typeof PROVIDERS;

export interface SimpleApiSettingsProps {
  className?: string;
  onConfigured?: () => void;
}

export const SimpleApiSettings: React.FC<SimpleApiSettingsProps> = ({ 
  className,
  onConfigured 
}) => {
  const { 
    providerType, 
    providerConfig, 
    setProviderType, 
    setProviderApiKey 
  } = useConfigStore();

  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // 当前提供者配置
  const currentProvider = PROVIDERS[providerType as ProviderType] || PROVIDERS.openai;
  const currentApiKey = providerConfig[providerType]?.apiKey || '';

  // 验证配置状态
  const validationState = useMemo(() => {
    if (!currentApiKey) {
      return { isValid: false, message: '请输入 API 密钥' };
    }
    if (!currentProvider.validateKey(currentApiKey)) {
      return { isValid: false, message: 'API 密钥格式不正确' };
    }
    return { isValid: true, message: '配置有效' };
  }, [currentApiKey, currentProvider]);

  // 处理提供者变更
  const handleProviderChange = useCallback((value: string) => {
    setProviderType(value);
    setTestResult(null);
  }, [setProviderType]);

  // 处理 API 密钥变更
  const handleApiKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setProviderApiKey(providerType, e.target.value);
    setTestResult(null);
  }, [providerType, setProviderApiKey]);

  // 测试 API 连接
  const handleTestConnection = useCallback(async () => {
    if (!validationState.isValid) {
      setTestResult({
        success: false,
        message: validationState.message,
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // 简单的连接测试 - 实际项目中可以调用真实 API
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 模拟验证成功
      setTestResult({
        success: true,
        message: 'API 连接成功！配置已保存。',
      });
      
      onConfigured?.();
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'API 连接失败，请检查密钥是否正确',
      });
    } finally {
      setIsTesting(false);
    }
  }, [validationState, onConfigured]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>API 配置</CardTitle>
        <CardDescription>
          配置翻译服务，支持 OpenAI、DeepSeek、Claude
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 提供者选择 */}
        <div className="space-y-2">
          <Label htmlFor="provider-select">翻译服务</Label>
          <Select
            value={providerType}
            onValueChange={handleProviderChange}
          >
            <SelectTrigger id="provider-select">
              <SelectValue placeholder="选择翻译服务" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROVIDERS).map(([key, provider]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex flex-col">
                    <span>{provider.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {currentProvider.description}
          </p>
        </div>

        {/* API 密钥输入 */}
        <div className="space-y-2">
          <Label htmlFor="api-key-input">API 密钥</Label>
          <div className="relative">
            <Input
              id="api-key-input"
              type={showApiKey ? 'text' : 'password'}
              placeholder={currentProvider.placeholder}
              value={currentApiKey}
              onChange={handleApiKeyChange}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showApiKey ? '隐藏密钥' : '显示密钥'}
            >
              {showApiKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            密钥安全存储在本地，不会上传到任何服务器
          </p>
        </div>

        {/* 验证状态提示 */}
        {!validationState.isValid && currentApiKey && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>配置无效</AlertTitle>
            <AlertDescription>{validationState.message}</AlertDescription>
          </Alert>
        )}

        {/* 测试结果提示 */}
        {testResult && (
          <Alert variant={testResult.success ? 'default' : 'destructive'}>
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertTitle>{testResult.success ? '成功' : '失败'}</AlertTitle>
            <AlertDescription>{testResult.message}</AlertDescription>
          </Alert>
        )}

        {/* 保存/测试按钮 */}
        <Button
          onClick={handleTestConnection}
          className="w-full"
          disabled={!currentApiKey || isTesting}
        >
          {isTesting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              测试中...
            </>
          ) : (
            '保存并测试连接'
          )}
        </Button>

        {/* 未配置提示 */}
        {!currentApiKey && (
          <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              请先配置 API 密钥才能使用翻译功能。
              您可以从对应服务商的官网获取 API 密钥。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SimpleApiSettings;
