/**
 * Options 页面 - 漫画翻译助手 v2
 *
 * 专业设计，质感提升：
 * - API 密钥配置（Requirements 6.1, 6.2）
 * - Ollama 地址配置（Requirements 5.2）
 * - 连接测试功能（Requirements 6.4）
 * - 目标语言设置
 * - 渐变背景、彩色标签页、微交互动画
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
  Languages,
  Sparkles,
  Shield,
  Rocket,
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

const PROVIDER_CONFIG: Record<
  ProviderType,
  {
    name: string;
    icon: React.ReactNode;
    description: string;
    placeholder: string;
    helpUrl: string;
    requiresApiKey: boolean;
    modelPlaceholder: string;
    color: string;
    badge?: string;
  }
> = {
  siliconflow: {
    name: '硅基流动',
    icon: <Zap className="w-4 h-4" />,
    description: '国内首选，支持 Qwen VL 系列视觉模型，性价比高',
    placeholder: 'sk-...',
    helpUrl: 'https://cloud.siliconflow.cn/account/ak',
    requiresApiKey: true,
    modelPlaceholder: '例如: Qwen/Qwen2.5-VL-32B-Instruct',
    color: 'from-teal-500 to-cyan-500',
    badge: '推荐',
  },
  dashscope: {
    name: '阿里云百炼',
    icon: <Cloud className="w-4 h-4" />,
    description: '阿里云官方，支持通义千问 VL 系列',
    placeholder: 'sk-...',
    helpUrl: 'https://dashscope.console.aliyun.com/apiKey',
    requiresApiKey: true,
    modelPlaceholder: '例如: qwen-vl-max, qwen-vl-plus',
    color: 'from-blue-500 to-indigo-500',
  },
  openai: {
    name: 'OpenAI GPT-4V',
    icon: <Sparkles className="w-4 h-4" />,
    description: '高质量翻译，支持 GPT-4 Vision',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: gpt-4o, gpt-4-turbo',
    color: 'from-emerald-500 to-teal-500',
  },
  claude: {
    name: 'Claude Vision',
    icon: <Cloud className="w-4 h-4" />,
    description: 'Anthropic Claude，理解能力强',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: claude-3-5-sonnet-20241022',
    color: 'from-purple-500 to-pink-500',
  },
  deepseek: {
    name: 'DeepSeek VL',
    icon: <Rocket className="w-4 h-4" />,
    description: '性价比高，中文优化',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: deepseek-chat',
    color: 'from-violet-500 to-purple-500',
  },
  ollama: {
    name: 'Ollama',
    icon: <Server className="w-4 h-4" />,
    description: '本地部署，隐私友好，免费',
    placeholder: 'http://localhost:11434',
    helpUrl: 'https://ollama.ai/download',
    requiresApiKey: false,
    modelPlaceholder: '例如: llava, bakllava',
    color: 'from-slate-500 to-gray-500',
    badge: '隐私',
  },
};

const TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  { value: 'zh-TW', label: '繁体中文', flag: '🇹🇼' },
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'ja', label: '日本語', flag: '🇯🇵' },
  { value: 'ko', label: '한국어', flag: '🇰🇷' },
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
    siliconflow: false,
    dashscope: false,
    openai: false,
    claude: false,
    deepseek: false,
    ollama: false,
  });
  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(
    null,
  );
  const [testResults, setTestResults] = useState<
    Record<ProviderType, TestResult | null>
  >({
    siliconflow: null,
    dashscope: null,
    openai: null,
    claude: null,
    deepseek: null,
    ollama: null,
  });

  // Ollama models state
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(
    null,
  );

  // Current provider config
  const currentProviderConfig = PROVIDER_CONFIG[provider];

  // Fetch Ollama models when base URL changes or on mount
  const fetchOllamaModels = useCallback(
    async (baseUrl?: string) => {
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
    },
    [providers.ollama.baseUrl],
  );

  // Fetch Ollama models on mount and when switching to Ollama tab
  useEffect(() => {
    if (provider === 'ollama' && providers.ollama.baseUrl) {
      fetchOllamaModels();
    }
  }, [provider, fetchOllamaModels, providers.ollama.baseUrl]);

  // ==================== Handlers ====================

  const handleProviderChange = useCallback(
    (value: string) => {
      setProvider(value as ProviderType);
    },
    [setProvider],
  );

  const handleApiKeyChange = useCallback(
    (providerType: ProviderType, value: string) => {
      updateProviderSettings(providerType, { apiKey: value });
      setTestResults((prev) => ({ ...prev, [providerType]: null }));
    },
    [updateProviderSettings],
  );

  const handleBaseUrlChange = useCallback(
    (providerType: ProviderType, value: string) => {
      updateProviderSettings(providerType, { baseUrl: value });
      setTestResults((prev) => ({ ...prev, [providerType]: null }));

      // Refresh Ollama models when base URL changes (debounced)
      if (providerType === 'ollama' && value) {
        setTimeout(() => {
          fetchOllamaModels(value);
        }, 500);
      }
    },
    [updateProviderSettings, fetchOllamaModels],
  );

  const handleModelChange = useCallback(
    (providerType: ProviderType, value: string) => {
      updateProviderSettings(providerType, { model: value });
      setTestResults((prev) => ({ ...prev, [providerType]: null }));
    },
    [updateProviderSettings],
  );

  const toggleShowApiKey = useCallback((providerType: ProviderType) => {
    setShowApiKey((prev) => ({ ...prev, [providerType]: !prev[providerType] }));
  }, []);

  const handleTestConnection = useCallback(
    async (providerType: ProviderType) => {
      setTestingProvider(providerType);
      setTestResults((prev) => ({ ...prev, [providerType]: null }));

      try {
        const settings = providers[providerType];

        const providerInstance = await createProvider(providerType, {
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
        });

        const result = await providerInstance.validateConfig();

        setTestResults((prev) => ({
          ...prev,
          [providerType]: {
            success: result.valid,
            message: result.message,
          },
        }));
      } catch (error) {
        setTestResults((prev) => ({
          ...prev,
          [providerType]: {
            success: false,
            message: error instanceof Error ? error.message : '连接测试失败',
          },
        }));
      } finally {
        setTestingProvider(null);
      }
    },
    [providers],
  );

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
      <div className="space-y-5">
        {/* API Key (for cloud providers) */}
        {config.requiresApiKey && (
          <div className="space-y-2">
            <Label
              htmlFor={`${providerType}-api-key`}
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              API 密钥
            </Label>
            <div className="relative">
              <Input
                id={`${providerType}-api-key`}
                type={showApiKey[providerType] ? 'text' : 'password'}
                placeholder={config.placeholder}
                value={settings.apiKey}
                onChange={(e) =>
                  handleApiKeyChange(providerType, e.target.value)
                }
                className="pr-10 h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 focus:border-teal-400 dark:focus:border-teal-600"
              />
              <button
                type="button"
                onClick={() => toggleShowApiKey(providerType)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors duration-200 cursor-pointer"
                aria-label={showApiKey[providerType] ? '隐藏密钥' : '显示密钥'}
              >
                {showApiKey[providerType] ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Shield className="w-3 h-3" />
              <a
                href={config.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1 transition-colors duration-200 cursor-pointer"
              >
                获取 API 密钥 <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        )}

        {/* Base URL */}
        <div className="space-y-2">
          <Label
            htmlFor={`${providerType}-base-url`}
            className="text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            {providerType === 'ollama' ? '服务地址' : 'API 地址（可选）'}
          </Label>
          <Input
            id={`${providerType}-base-url`}
            type="text"
            placeholder={config.placeholder}
            value={settings.baseUrl}
            onChange={(e) => handleBaseUrlChange(providerType, e.target.value)}
            className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 focus:border-teal-400 dark:focus:border-teal-600"
          />
          {providerType === 'ollama' && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              默认地址: http://localhost:11434
            </p>
          )}
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor={`${providerType}-model`}
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              模型
            </Label>
            {providerType === 'ollama' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchOllamaModels()}
                disabled={loadingOllamaModels}
                className="h-7 px-2 text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors duration-200 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loadingOllamaModels ? 'animate-spin' : ''}`}
                />
              </Button>
            )}
          </div>

          {providerType === 'ollama' ? (
            <>
              {ollamaModels.length > 0 ? (
                <Select
                  value={settings.model}
                  onValueChange={(value) => handleModelChange(providerType, value)}
                >
                  <SelectTrigger
                    id={`${providerType}-model`}
                    className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-600 cursor-pointer"
                  >
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {ollamaModels.map((model) => (
                      <SelectItem
                        key={model}
                        value={model}
                        className="cursor-pointer"
                      >
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
                  onChange={(e) =>
                    handleModelChange(providerType, e.target.value)
                  }
                  className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 focus:border-teal-400 dark:focus:border-teal-600"
                />
              )}
              {loadingOllamaModels && (
                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在获取模型列表...
                </p>
              )}
              {ollamaModelsError && !loadingOllamaModels && (
                <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-md">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {ollamaModelsError}
                  </p>
                </div>
              )}
              {ollamaModels.length > 0 && !loadingOllamaModels && (
                <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-md">
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3" />
                    已从本地 Ollama 服务获取 {ollamaModels.length} 个视觉模型
                  </p>
                </div>
              )}
              {ollamaModels.length === 0 &&
                !loadingOllamaModels &&
                !ollamaModelsError && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    推荐视觉模型: llava, bakllava, llava-llama3
                  </p>
                )}
            </>
          ) : (
            <Input
              id={`${providerType}-model`}
              type="text"
              placeholder={config.modelPlaceholder}
              value={settings.model}
              onChange={(e) => handleModelChange(providerType, e.target.value)}
              className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 focus:border-teal-400 dark:focus:border-teal-600"
            />
          )}
        </div>

        {/* Test Result */}
        {testResult && (
          <Alert
            variant={testResult.success ? 'default' : 'destructive'}
            className={`border-none ${
              testResult.success
                ? 'bg-emerald-50 dark:bg-emerald-900/20'
                : 'bg-red-50 dark:bg-red-900/20'
            }`}
          >
            <div className="flex items-start gap-3">
              {testResult.success ? (
                <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
              ) : (
                <div className="p-1.5 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
              )}
              <div className="flex-1">
                <AlertTitle
                  className={`font-semibold ${
                    testResult.success
                      ? 'text-emerald-900 dark:text-emerald-100'
                      : 'text-red-900 dark:text-red-100'
                  }`}
                >
                  {testResult.success ? '连接成功' : '连接失败'}
                </AlertTitle>
                <AlertDescription
                  className={`mt-1 ${
                    testResult.success
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-red-700 dark:text-red-300'
                  }`}
                >
                  {testResult.message}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}

        {/* Test Button */}
        <Button
          onClick={() => handleTestConnection(providerType)}
          disabled={isTesting || (config.requiresApiKey && !settings.apiKey)}
          className="w-full h-11 bg-teal-600 hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-700 text-white shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer"
        >
          {isTesting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              测试中...
            </>
          ) : (
            <>
              <Zap className="mr-2 h-4 w-4" />
              测试连接
            </>
          )}
        </Button>
      </div>
    );
  };

  // ==================== Main Render ====================

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-800 dark:to-teal-900">
      {/* Header with gradient */}
      <header className="sticky top-0 z-20 border-b border-slate-200/50 dark:border-slate-700/50 backdrop-blur-md bg-white/80 dark:bg-slate-900/80 shadow-sm">
        <div className="container mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-teal-600 to-cyan-600 dark:from-teal-700 dark:to-cyan-700 rounded-lg">
              <Languages className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                漫画翻译助手
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                高级设置
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl space-y-6">
        {/* Provider Configuration */}
        <Card className="border-none shadow-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div
                className={`p-2 bg-gradient-to-br ${currentProviderConfig.color} rounded-lg`}
              >
                <div className="text-white">{currentProviderConfig.icon}</div>
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  AI 服务配置
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  选择并配置翻译服务提供者
                </CardDescription>
              </div>
              {currentProviderConfig.badge && (
                <Badge className="bg-gradient-to-r from-teal-500 to-cyan-500 text-white border-none">
                  {currentProviderConfig.badge}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Provider Tabs */}
            <Tabs value={provider} onValueChange={handleProviderChange}>
              <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-slate-100 dark:bg-slate-700/50">
                {(Object.keys(PROVIDER_CONFIG) as ProviderType[]).map((key) => {
                  const isActive = provider === key;
                  return (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className={`relative text-xs sm:text-sm py-2.5 px-2 transition-all duration-200 cursor-pointer ${
                        isActive
                          ? 'bg-white dark:bg-slate-800 shadow-md'
                          : 'hover:bg-white/50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <div
                          className={`p-1 bg-gradient-to-br ${PROVIDER_CONFIG[key].color} rounded`}
                        >
                          <div className="text-white text-xs">
                            {PROVIDER_CONFIG[key].icon}
                          </div>
                        </div>
                        <span className="hidden sm:inline">
                          {PROVIDER_CONFIG[key].name.split(' ')[0]}
                        </span>
                        <span className="sm:hidden">
                          {(PROVIDER_CONFIG[key].name.split(' ')[0] || PROVIDER_CONFIG[key].name).substring(0, 4)}
                        </span>
                      </div>
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {(Object.keys(PROVIDER_CONFIG) as ProviderType[]).map((key) => (
                <TabsContent key={key} value={key} className="mt-5">
                  <div className="mb-4 p-4 rounded-lg bg-gradient-to-r from-slate-50 to-teal-50/50 dark:from-slate-800/50 dark:to-teal-900/20 border border-slate-200/50 dark:border-slate-700/50">
                    <p className="text-sm text-slate-700 dark:text-slate-300 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-teal-600 dark:text-teal-400" />
                      <span>{PROVIDER_CONFIG[key].description}</span>
                    </p>
                  </div>
                  {renderProviderSettings(key)}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {/* Language Settings */}
        <Card className="border-none shadow-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  翻译设置
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  配置翻译目标语言
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="target-language"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                目标语言
              </Label>
              <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                <SelectTrigger
                  id="target-language"
                  className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-600 cursor-pointer"
                >
                  <SelectValue placeholder="选择目标语言" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_LANGUAGES.map((lang) => (
                    <SelectItem
                      key={lang.value}
                      value={lang.value}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{lang.flag}</span>
                        <span>{lang.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Languages className="w-3 h-3" />
                漫画中的文字将被翻译成此语言
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Ollama Help */}
        {provider === 'ollama' && (
          <Card className="border-none shadow-lg bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-800/80 dark:to-blue-900/20 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-gradient-to-br from-slate-500 to-gray-600 rounded-lg">
                  <Server className="w-5 h-5 text-white" />
                </div>
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  Ollama 安装指南
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center">
                    <span className="text-xs font-bold text-teal-600 dark:text-teal-400">
                      1
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100 mb-1">
                      安装 Ollama
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      访问{' '}
                      <a
                        href="https://ollama.ai/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1 transition-colors duration-200 cursor-pointer"
                      >
                        ollama.ai/download
                        <ExternalLink className="w-3 h-3" />
                      </a>{' '}
                      下载并安装
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center">
                    <span className="text-xs font-bold text-teal-600 dark:text-teal-400">
                      2
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100 mb-2">
                      下载视觉模型
                    </p>
                    <code className="block bg-slate-900 dark:bg-slate-950 text-emerald-400 p-3 rounded-lg text-sm font-mono">
                      ollama pull llava
                    </code>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center">
                    <span className="text-xs font-bold text-teal-600 dark:text-teal-400">
                      3
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100 mb-1">
                      启动服务
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Ollama 安装后会自动启动服务
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Warning */}
        {!isProviderValid && (
          <Alert
            variant="destructive"
            className="border-none shadow-md bg-amber-50 dark:bg-amber-900/20"
          >
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1">
                <AlertTitle className="font-semibold text-amber-900 dark:text-amber-100">
                  配置不完整
                </AlertTitle>
                <AlertDescription className="mt-1 text-amber-700 dark:text-amber-300">
                  {provider === 'ollama'
                    ? '请配置 Ollama 服务地址'
                    : '请配置 API 密钥才能使用翻译功能'}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/50 dark:border-slate-700/50 mt-12 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-400">
            <Badge
              variant="secondary"
              className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-none px-3 py-1"
            >
              <Sparkles className="w-3 h-3 mr-1.5" />
              Powered by AI
            </Badge>
            <span className="text-slate-400 dark:text-slate-600">•</span>
            <p>漫画翻译助手 v2 - 极简、可靠、高效</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default OptionsApp;
