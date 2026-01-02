/**
 * Options 页面 - 漫画翻译助手 v2
 * 
 * 功能：
 * - API 密钥配置（Requirements 6.1, 6.2）
 * - Ollama 地址配置（Requirements 5.2）
 * - 连接测试功能（Requirements 6.4）
 * - 目标语言设置
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Zap,
  Cloud,
  Server,
  Globe,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';
import { createProvider, OllamaProvider } from '@/providers';

// ==================== Types ====================

interface TestResult {
  success: boolean;
  message: string;
}

// ==================== Provider Configuration ====================

const PROVIDER_CONFIG: Record<ProviderType, {
  name: string;
  icon: React.ReactNode;
  description: string;
  placeholder: string;
  helpUrl: string;
  requiresApiKey: boolean;
  modelPlaceholder: string;
}> = {
  openai: {
    name: 'OpenAI GPT-4V',
    icon: <Zap className="w-4 h-4" />,
    description: '高质量翻译，支持 GPT-4 Vision',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: gpt-4o, gpt-4-turbo',
  },
  claude: {
    name: 'Claude Vision',
    icon: <Cloud className="w-4 h-4" />,
    description: 'Anthropic Claude，理解能力强',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: claude-3-5-sonnet-20241022',
  },
  deepseek: {
    name: 'DeepSeek VL',
    icon: <Cloud className="w-4 h-4" />,
    description: '性价比高，中文优化',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: deepseek-chat',
  },
  ollama: {
    name: 'Ollama',
    icon: <Server className="w-4 h-4" />,
    description: '本地部署，隐私友好，免费',
    placeholder: 'http://localhost:11434',
    helpUrl: 'https://ollama.ai/download',
    requiresApiKey: false,
    modelPlaceholder: '例如: llava, bakllava',
  },
};

const TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

// ==================== Component ====================

const OptionsApp: React.FC = () => {
  // Config store
  const {
    provider,
    providers,
    targetLanguage,
    setProvider,
    updateProviderSettings,
    setTargetLanguage,
  } = useAppConfigStore();

  // Local state
  const [showApiKey, setShowApiKey] = useState<Record<ProviderType, boolean>>({
    openai: false,
    claude: false,
    deepseek: false,
    ollama: false,
  });
  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(null);
  const [testResults, setTestResults] = useState<Record<ProviderType, TestResult | null>>({
    openai: null,
    claude: null,
    deepseek: null,
    ollama: null,
  });
  
  // Ollama models state
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(null);

  // Current provider config
  const currentProviderConfig = PROVIDER_CONFIG[provider];

  // Fetch Ollama models when base URL changes or on mount
  const fetchOllamaModels = useCallback(async (baseUrl?: string) => {
    const url = baseUrl || providers.ollama.baseUrl;
    if (!url) return;
    
    setLoadingOllamaModels(true);
    setOllamaModelsError(null);
    
    try {
      const ollamaProvider = new OllamaProvider();
      await ollamaProvider.initialize({ baseUrl: url });
      const models = await ollamaProvider.getAvailableVisionModels();
      
      if (models.length > 0) {
        setOllamaModels(models);
        setOllamaModelsError(null);
      } else {
        setOllamaModels([]);
        setOllamaModelsError('未找到视觉模型，请先运行: ollama pull llava');
      }
    } catch (error) {
      setOllamaModels([]);
      setOllamaModelsError('无法连接到 Ollama 服务');
    } finally {
      setLoadingOllamaModels(false);
    }
  }, [providers.ollama.baseUrl]);

  // Fetch Ollama models on mount and when switching to Ollama tab
  useEffect(() => {
    if (provider === 'ollama' && providers.ollama.baseUrl) {
      fetchOllamaModels();
    }
  }, [provider, fetchOllamaModels, providers.ollama.baseUrl]);

  // ==================== Handlers ====================

  const handleProviderChange = useCallback((value: string) => {
    setProvider(value as ProviderType);
  }, [setProvider]);

  const handleApiKeyChange = useCallback((providerType: ProviderType, value: string) => {
    updateProviderSettings(providerType, { apiKey: value });
    setTestResults(prev => ({ ...prev, [providerType]: null }));
  }, [updateProviderSettings]);

  const handleBaseUrlChange = useCallback((providerType: ProviderType, value: string) => {
    updateProviderSettings(providerType, { baseUrl: value });
    setTestResults(prev => ({ ...prev, [providerType]: null }));
    
    // Refresh Ollama models when base URL changes (debounced)
    if (providerType === 'ollama' && value) {
      setTimeout(() => {
        fetchOllamaModels(value);
      }, 500);
    }
  }, [updateProviderSettings, fetchOllamaModels]);

  const handleModelChange = useCallback((providerType: ProviderType, value: string) => {
    updateProviderSettings(providerType, { model: value });
    setTestResults(prev => ({ ...prev, [providerType]: null }));
  }, [updateProviderSettings]);

  const toggleShowApiKey = useCallback((providerType: ProviderType) => {
    setShowApiKey(prev => ({ ...prev, [providerType]: !prev[providerType] }));
  }, []);

  const handleTestConnection = useCallback(async (providerType: ProviderType) => {
    setTestingProvider(providerType);
    setTestResults(prev => ({ ...prev, [providerType]: null }));

    try {
      const settings = providers[providerType];
      
      // createProvider is async and takes config as second parameter
      const providerInstance = await createProvider(providerType, {
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
      });

      const result = await providerInstance.validateConfig();
      
      setTestResults(prev => ({
        ...prev,
        [providerType]: {
          success: result.valid,
          message: result.message,
        },
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [providerType]: {
          success: false,
          message: error instanceof Error ? error.message : '连接测试失败',
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  }, [providers]);

  // ==================== Validation ====================

  const isProviderValid = useMemo(() => {
    const settings = providers[provider];
    if (provider === 'ollama') {
      return !!settings.baseUrl;
    }
    return !!settings.apiKey && settings.apiKey.length > 10;
  }, [provider, providers]);

  // ==================== Render Provider Settings ====================

  const renderProviderSettings = (providerType: ProviderType) => {
    const config = PROVIDER_CONFIG[providerType];
    const settings = providers[providerType];
    const testResult = testResults[providerType];
    const isTesting = testingProvider === providerType;

    return (
      <div className="space-y-4">
        {/* API Key (for cloud providers) */}
        {config.requiresApiKey && (
          <div className="space-y-2">
            <Label htmlFor={`${providerType}-api-key`}>API 密钥</Label>
            <div className="relative">
              <Input
                id={`${providerType}-api-key`}
                type={showApiKey[providerType] ? 'text' : 'password'}
                placeholder={config.placeholder}
                value={settings.apiKey}
                onChange={(e) => handleApiKeyChange(providerType, e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey(providerType)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showApiKey[providerType] ? '隐藏密钥' : '显示密钥'}
              >
                {showApiKey[providerType] ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <a
                href={config.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                获取 API 密钥 <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        )}

        {/* Base URL */}
        <div className="space-y-2">
          <Label htmlFor={`${providerType}-base-url`}>
            {providerType === 'ollama' ? '服务地址' : 'API 地址（可选）'}
          </Label>
          <Input
            id={`${providerType}-base-url`}
            type="text"
            placeholder={config.placeholder}
            value={settings.baseUrl}
            onChange={(e) => handleBaseUrlChange(providerType, e.target.value)}
          />
          {providerType === 'ollama' && (
            <p className="text-xs text-muted-foreground">
              默认地址: http://localhost:11434
            </p>
          )}
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${providerType}-model`}>模型</Label>
            {providerType === 'ollama' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchOllamaModels()}
                disabled={loadingOllamaModels}
                className="h-6 px-2"
              >
                <RefreshCw className={`h-3 w-3 ${loadingOllamaModels ? 'animate-spin' : ''}`} />
              </Button>
            )}
          </div>
          
          {providerType === 'ollama' ? (
            // Ollama: Dynamic model selection from local service
            <>
              {ollamaModels.length > 0 ? (
                <Select
                  value={settings.model}
                  onValueChange={(value) => handleModelChange(providerType, value)}
                >
                  <SelectTrigger id={`${providerType}-model`}>
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {ollamaModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`${providerType}-model`}
                  type="text"
                  placeholder="llava"
                  value={settings.model}
                  onChange={(e) => handleModelChange(providerType, e.target.value)}
                />
              )}
              {loadingOllamaModels && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在获取模型列表...
                </p>
              )}
              {ollamaModelsError && !loadingOllamaModels && (
                <p className="text-xs text-amber-600">
                  {ollamaModelsError}
                </p>
              )}
              {ollamaModels.length > 0 && !loadingOllamaModels && (
                <p className="text-xs text-muted-foreground">
                  已从本地 Ollama 服务获取 {ollamaModels.length} 个视觉模型
                </p>
              )}
              {ollamaModels.length === 0 && !loadingOllamaModels && !ollamaModelsError && (
                <p className="text-xs text-muted-foreground">
                  推荐视觉模型: llava, bakllava, llava-llama3
                </p>
              )}
            </>
          ) : (
            // Other providers: Text input
            <Input
              id={`${providerType}-model`}
              type="text"
              placeholder={config.modelPlaceholder}
              value={settings.model}
              onChange={(e) => handleModelChange(providerType, e.target.value)}
            />
          )}
        </div>

        {/* Test Result */}
        {testResult && (
          <Alert variant={testResult.success ? 'default' : 'destructive'}>
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertTitle>{testResult.success ? '连接成功' : '连接失败'}</AlertTitle>
            <AlertDescription>{testResult.message}</AlertDescription>
          </Alert>
        )}

        {/* Test Button */}
        <Button
          onClick={() => handleTestConnection(providerType)}
          disabled={isTesting || (config.requiresApiKey && !settings.apiKey)}
          className="w-full"
        >
          {isTesting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              测试中...
            </>
          ) : (
            '测试连接'
          )}
        </Button>
      </div>
    );
  };

  // ==================== Main Render ====================

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">漫画翻译助手</h1>
              <p className="text-sm text-muted-foreground">设置</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 max-w-2xl space-y-6">
        {/* Provider Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {currentProviderConfig.icon}
              AI 服务配置
            </CardTitle>
            <CardDescription>
              选择并配置翻译服务提供者
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Provider Tabs */}
            <Tabs value={provider} onValueChange={handleProviderChange}>
              <TabsList className="grid w-full grid-cols-4">
                {(Object.keys(PROVIDER_CONFIG) as ProviderType[]).map((key) => (
                  <TabsTrigger key={key} value={key} className="text-xs">
                    {PROVIDER_CONFIG[key].name.split(' ')[0]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {(Object.keys(PROVIDER_CONFIG) as ProviderType[]).map((key) => (
                <TabsContent key={key} value={key} className="mt-4">
                  <div className="mb-4 p-3 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground">
                      {PROVIDER_CONFIG[key].description}
                    </p>
                  </div>
                  {renderProviderSettings(key)}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {/* Language Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              翻译设置
            </CardTitle>
            <CardDescription>
              配置翻译目标语言
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target-language">目标语言</Label>
              <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                <SelectTrigger id="target-language">
                  <SelectValue placeholder="选择目标语言" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                漫画中的文字将被翻译成此语言
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Ollama Help */}
        {provider === 'ollama' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                Ollama 安装指南
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <p className="font-medium">1. 安装 Ollama</p>
                <p className="text-muted-foreground pl-4">
                  访问{' '}
                  <a
                    href="https://ollama.ai/download"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    ollama.ai/download
                  </a>{' '}
                  下载并安装
                </p>
              </div>
              <div className="space-y-2 text-sm">
                <p className="font-medium">2. 下载视觉模型</p>
                <code className="block bg-muted p-2 rounded text-xs">
                  ollama pull llava
                </code>
              </div>
              <div className="space-y-2 text-sm">
                <p className="font-medium">3. 启动服务</p>
                <p className="text-muted-foreground pl-4">
                  Ollama 安装后会自动启动服务
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status */}
        {!isProviderValid && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>配置不完整</AlertTitle>
            <AlertDescription>
              {provider === 'ollama'
                ? '请配置 Ollama 服务地址'
                : '请配置 API 密钥才能使用翻译功能'}
            </AlertDescription>
          </Alert>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t mt-8">
        <div className="container mx-auto px-4 py-4">
          <p className="text-center text-sm text-muted-foreground">
            漫画翻译助手 v2 - 极简、可靠、高效
          </p>
        </div>
      </footer>
    </div>
  );
};

export default OptionsApp;
