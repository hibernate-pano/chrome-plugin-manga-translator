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
import { createProvider } from '@/providers';
import { OllamaProvider } from '@/providers/ollama';
import type { TestServerConnectionResponse } from '@/shared/runtime-contracts';

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
    icon: <Zap className='h-4 w-4' />,
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
    icon: <Cloud className='h-4 w-4' />,
    description: '阿里云官方，支持通义千问 VL 系列',
    placeholder: 'sk-...',
    helpUrl: 'https://dashscope.console.aliyun.com/apiKey',
    requiresApiKey: true,
    modelPlaceholder: '例如: qwen-vl-max, qwen-vl-plus',
    color: 'from-blue-500 to-indigo-500',
  },
  openai: {
    name: 'OpenAI GPT-4V',
    icon: <Sparkles className='h-4 w-4' />,
    description: '高质量翻译，支持 GPT-4 Vision',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: gpt-4o, gpt-4-turbo',
    color: 'from-emerald-500 to-teal-500',
  },
  claude: {
    name: 'Claude Vision',
    icon: <Cloud className='h-4 w-4' />,
    description: 'Anthropic Claude，理解能力强',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: claude-3-5-sonnet-20241022',
    color: 'from-purple-500 to-pink-500',
  },
  deepseek: {
    name: 'DeepSeek VL',
    icon: <Rocket className='h-4 w-4' />,
    description: '性价比高，中文优化',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    modelPlaceholder: '例如: deepseek-chat',
    color: 'from-violet-500 to-purple-500',
  },
  nvidia: {
    name: 'NVIDIA NIM',
    icon: <Sparkles className='h-4 w-4' />,
    description: 'NVIDIA 官方 API Catalog，兼容 OpenAI chat completions',
    placeholder: 'nvapi-...',
    helpUrl: 'https://build.nvidia.com',
    requiresApiKey: true,
    modelPlaceholder: '例如: nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
    color: 'from-green-500 to-emerald-500',
    badge: '兼容',
  },
  ollama: {
    name: 'Ollama',
    icon: <Server className='h-4 w-4' />,
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
  // Config store - 细粒度 selector 避免全量订阅
  const executionMode = useAppConfigStore(state => state.executionMode);
  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  const server = useAppConfigStore(state => state.server);
  const targetLanguage = useAppConfigStore(state => state.targetLanguage);
  const setExecutionMode = useAppConfigStore(state => state.setExecutionMode);
  const updateServerConfig = useAppConfigStore(state => state.updateServerConfig);
  const isServerConfigured = useAppConfigStore(state => state.isServerConfigured);
  const setProvider = useAppConfigStore(state => state.setProvider);
  const updateProviderSettings = useAppConfigStore(
    state => state.updateProviderSettings
  );
  const setTargetLanguage = useAppConfigStore(state => state.setTargetLanguage);

  // Local state
  const [showApiKey, setShowApiKey] = useState<Record<ProviderType, boolean>>({
    siliconflow: false,
    dashscope: false,
    openai: false,
    claude: false,
    deepseek: false,
    nvidia: false,
    ollama: false,
  });
  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(
    null
  );
  const [testResults, setTestResults] = useState<
    Record<ProviderType, TestResult | null>
  >({
    siliconflow: null,
    dashscope: null,
    openai: null,
    claude: null,
    deepseek: null,
    nvidia: null,
    ollama: null,
  });

  // Ollama models state
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(
    null
  );
  const [serverTestResult, setServerTestResult] = useState<TestResult | null>(
    null
  );
  const [testingServer, setTestingServer] = useState(false);

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
        const ollamaProvider = await createProvider('ollama', { baseUrl: url });
        if (!(ollamaProvider instanceof OllamaProvider)) {
          throw new Error('Unexpected provider type');
        }
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
    [providers.ollama.baseUrl]
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
    [setProvider]
  );

  const handleApiKeyChange = useCallback(
    (providerType: ProviderType, value: string) => {
      updateProviderSettings(providerType, { apiKey: value });
      setTestResults(prev => ({ ...prev, [providerType]: null }));
    },
    [updateProviderSettings]
  );

  const handleBaseUrlChange = useCallback(
    (providerType: ProviderType, value: string) => {
      updateProviderSettings(providerType, { baseUrl: value });
      setTestResults(prev => ({ ...prev, [providerType]: null }));

      // Refresh Ollama models when base URL changes (debounced)
      if (providerType === 'ollama' && value) {
        setTimeout(() => {
          fetchOllamaModels(value);
        }, 500);
      }
    },
    [updateProviderSettings, fetchOllamaModels]
  );

  const handleModelChange = useCallback(
    (providerType: ProviderType, value: string) => {
      updateProviderSettings(providerType, { model: value });
      setTestResults(prev => ({ ...prev, [providerType]: null }));
    },
    [updateProviderSettings]
  );

  const toggleShowApiKey = useCallback((providerType: ProviderType) => {
    setShowApiKey(prev => ({ ...prev, [providerType]: !prev[providerType] }));
  }, []);

  const handleServerFieldChange = useCallback(
    (
      key: 'baseUrl' | 'authToken' | 'timeoutMs',
      value: string | number
    ) => {
      updateServerConfig({ [key]: value });
      setServerTestResult(null);
    },
    [updateServerConfig]
  );

  const handleTestServerConnection = useCallback(async () => {
    setTestingServer(true);
    setServerTestResult(null);

    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'TEST_SERVER_CONNECTION',
      })) as TestServerConnectionResponse;

      setServerTestResult({
        success: result.success,
        message: result.message,
      });
    } catch (error) {
      setServerTestResult({
        success: false,
        message: error instanceof Error ? error.message : '服务端连接测试失败',
      });
    } finally {
      setTestingServer(false);
    }
  }, []);

  const handleTestConnection = useCallback(
    async (providerType: ProviderType) => {
      setTestingProvider(providerType);
      setTestResults(prev => ({ ...prev, [providerType]: null }));

      try {
        const settings = providers[providerType];

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
    },
    [providers]
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
      <div className='space-y-5'>
        {/* API Key (for cloud providers) */}
        {config.requiresApiKey && (
          <div className='space-y-2'>
            <Label
              htmlFor={`${providerType}-api-key`}
              className='text-sm font-medium text-slate-700 dark:text-slate-300'
            >
              API 密钥
            </Label>
            <div className='relative'>
              <Input
                id={`${providerType}-api-key`}
                type={showApiKey[providerType] ? 'text' : 'password'}
                placeholder={config.placeholder}
                value={settings.apiKey}
                onChange={e => handleApiKeyChange(providerType, e.target.value)}
                className='h-11 border-slate-200 bg-white pr-10 transition-all duration-200 focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-600'
              />
              <button
                type='button'
                onClick={() => toggleShowApiKey(providerType)}
                className='absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 transition-colors duration-200 hover:text-teal-600 dark:hover:text-teal-400'
                aria-label={showApiKey[providerType] ? '隐藏密钥' : '显示密钥'}
              >
                {showApiKey[providerType] ? (
                  <EyeOff className='h-4 w-4' />
                ) : (
                  <Eye className='h-4 w-4' />
                )}
              </button>
            </div>
            <p className='flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400'>
              <Shield className='h-3 w-3' />
              <a
                href={config.helpUrl}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex cursor-pointer items-center gap-1 text-teal-600 transition-colors duration-200 hover:underline dark:text-teal-400'
              >
                获取 API 密钥 <ExternalLink className='h-3 w-3' />
              </a>
            </p>
          </div>
        )}

        {/* Base URL */}
        <div className='space-y-2'>
          <Label
            htmlFor={`${providerType}-base-url`}
            className='text-sm font-medium text-slate-700 dark:text-slate-300'
          >
            {providerType === 'ollama' ? '服务地址' : 'API 地址（可选）'}
          </Label>
          <Input
            id={`${providerType}-base-url`}
            type='text'
            placeholder={config.placeholder}
            value={settings.baseUrl}
            onChange={e => handleBaseUrlChange(providerType, e.target.value)}
            className='h-11 border-slate-200 bg-white transition-all duration-200 focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-600'
          />
          {providerType === 'ollama' && (
            <p className='text-xs text-slate-500 dark:text-slate-400'>
              默认地址: http://localhost:11434
            </p>
          )}
        </div>

        {/* Model Selection */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label
              htmlFor={`${providerType}-model`}
              className='text-sm font-medium text-slate-700 dark:text-slate-300'
            >
              模型
            </Label>
            {providerType === 'ollama' && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => fetchOllamaModels()}
                disabled={loadingOllamaModels}
                className='h-7 cursor-pointer px-2 text-teal-600 transition-colors duration-200 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-900/20'
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
                  onValueChange={value =>
                    handleModelChange(providerType, value)
                  }
                >
                  <SelectTrigger
                    id={`${providerType}-model`}
                    className='h-11 cursor-pointer border-slate-200 bg-white transition-all duration-200 hover:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-teal-600'
                  >
                    <SelectValue placeholder='选择模型' />
                  </SelectTrigger>
                  <SelectContent>
                    {ollamaModels.map(model => (
                      <SelectItem
                        key={model}
                        value={model}
                        className='cursor-pointer'
                      >
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`${providerType}-model`}
                  type='text'
                  placeholder='llava'
                  value={settings.model}
                  onChange={e =>
                    handleModelChange(providerType, e.target.value)
                  }
                  className='h-11 border-slate-200 bg-white transition-all duration-200 focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-600'
                />
              )}
              {loadingOllamaModels && (
                <p className='flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400'>
                  <Loader2 className='h-3 w-3 animate-spin' />
                  正在获取模型列表...
                </p>
              )}
              {ollamaModelsError && !loadingOllamaModels && (
                <div className='rounded-md bg-amber-50 p-2 dark:bg-amber-900/20'>
                  <p className='text-xs text-amber-700 dark:text-amber-400'>
                    {ollamaModelsError}
                  </p>
                </div>
              )}
              {ollamaModels.length > 0 && !loadingOllamaModels && (
                <div className='rounded-md bg-emerald-50 p-2 dark:bg-emerald-900/20'>
                  <p className='flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400'>
                    <CheckCircle2 className='h-3 w-3' />
                    已从本地 Ollama 服务获取 {ollamaModels.length} 个视觉模型
                  </p>
                </div>
              )}
              {ollamaModels.length === 0 &&
                !loadingOllamaModels &&
                !ollamaModelsError && (
                  <p className='text-xs text-slate-500 dark:text-slate-400'>
                    推荐视觉模型: llava, bakllava, llava-llama3
                  </p>
                )}
            </>
          ) : (
            <Input
              id={`${providerType}-model`}
              type='text'
              placeholder={config.modelPlaceholder}
              value={settings.model}
              onChange={e => handleModelChange(providerType, e.target.value)}
              className='h-11 border-slate-200 bg-white transition-all duration-200 focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-600'
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
            <div className='flex items-start gap-3'>
              {testResult.success ? (
                <div className='rounded-lg bg-emerald-100 p-1.5 dark:bg-emerald-900/30'>
                  <CheckCircle2 className='h-4 w-4 text-emerald-600 dark:text-emerald-400' />
                </div>
              ) : (
                <div className='rounded-lg bg-red-100 p-1.5 dark:bg-red-900/30'>
                  <AlertCircle className='h-4 w-4 text-red-600 dark:text-red-400' />
                </div>
              )}
              <div className='flex-1'>
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
          className='h-11 w-full cursor-pointer bg-teal-600 text-white shadow-md transition-all duration-200 hover:bg-teal-700 hover:shadow-lg dark:bg-teal-600 dark:hover:bg-teal-700'
        >
          {isTesting ? (
            <>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              测试中...
            </>
          ) : (
            <>
              <Zap className='mr-2 h-4 w-4' />
              测试连接
            </>
          )}
        </Button>
      </div>
    );
  };

  // ==================== Main Render ====================

  return (
    <div className='min-h-screen bg-gradient-to-br from-teal-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-800 dark:to-teal-900'>
      {/* Header with gradient */}
      <header className='sticky top-0 z-20 border-b border-slate-200/50 bg-white/80 shadow-sm backdrop-blur-md dark:border-slate-700/50 dark:bg-slate-900/80'>
        <div className='container mx-auto px-4 py-4 sm:px-6'>
          <div className='flex items-center gap-3'>
            <div className='rounded-lg bg-gradient-to-br from-teal-600 to-cyan-600 p-2 dark:from-teal-700 dark:to-cyan-700'>
              <Languages className='h-5 w-5 text-white' />
            </div>
            <div>
              <h1 className='text-xl font-bold text-slate-900 dark:text-slate-100'>
                漫画翻译助手
              </h1>
              <p className='text-sm text-slate-600 dark:text-slate-400'>
                高级设置
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className='container mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6'>
        <Card className='border-none bg-white/80 shadow-lg backdrop-blur-sm dark:bg-slate-800/80'>
          <CardHeader className='pb-4'>
            <div className='mb-2 flex items-center gap-3'>
              <div className='rounded-lg bg-gradient-to-br from-indigo-600 to-cyan-600 p-2 dark:from-indigo-700 dark:to-cyan-700'>
                <Shield className='h-5 w-5 text-white' />
              </div>
              <div className='flex-1'>
                <CardTitle className='text-slate-900 dark:text-slate-100'>
                  运行路径
                </CardTitle>
                <CardDescription className='text-slate-600 dark:text-slate-400'>
                  插件直连是默认路径；本地服务是可选加速能力，需要显式切换。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <button
                type='button'
                onClick={() => setExecutionMode('provider-direct')}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  executionMode === 'provider-direct'
                    ? 'border-cyan-500 bg-cyan-50 dark:border-cyan-500 dark:bg-cyan-900/20'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'
                }`}
              >
                <div className='flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100'>
                  <Zap className='h-4 w-4' />
                  插件直连
                </div>
                <p className='mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400'>
                  默认路径。云端 Provider 和 Ollama 都走这条链路。
                </p>
              </button>

              <button
                type='button'
                onClick={() => setExecutionMode('server')}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  executionMode === 'server'
                    ? 'border-teal-500 bg-teal-50 dark:border-teal-500 dark:bg-teal-900/20'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'
                }`}
              >
                <div className='flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100'>
                  <Server className='h-4 w-4' />
                  本地加速服务
                </div>
                <p className='mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400'>
                  可选能力。仅在你显式选择时启用，不会自动接管插件直连。
                </p>
              </button>
            </div>

            <Alert className='border-none bg-slate-50 shadow-sm dark:bg-slate-900/40'>
              <div className='flex items-start gap-3'>
                <div className='rounded-lg bg-slate-100 p-1.5 dark:bg-slate-800'>
                  <Shield className='h-4 w-4 text-slate-600 dark:text-slate-300' />
                </div>
                <div className='flex-1'>
                  <AlertTitle className='font-semibold text-slate-900 dark:text-slate-100'>
                    当前路径：{executionMode === 'server' ? '本地加速服务' : '插件直连'}
                  </AlertTitle>
                  <AlertDescription className='mt-1 text-slate-700 dark:text-slate-300'>
                    {executionMode === 'server'
                      ? '如果本地服务不可用，扩展会显示明确状态，而不是静默改回直连。'
                      : '当前翻译不会自动改道到本地服务，即使本地服务已经配置。'}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          </CardContent>
        </Card>

        <Card className='border-none bg-white/80 shadow-lg backdrop-blur-sm dark:bg-slate-800/80'>
          <CardHeader className='pb-4'>
            <div className='mb-2 flex items-center gap-3'>
              <div className='rounded-lg bg-gradient-to-br from-teal-600 to-cyan-600 p-2 dark:from-teal-700 dark:to-cyan-700'>
                <Server className='h-5 w-5 text-white' />
              </div>
              <div className='flex-1'>
                <CardTitle className='text-slate-900 dark:text-slate-100'>
                  本地加速服务
                </CardTitle>
                <CardDescription className='text-slate-600 dark:text-slate-400'>
                  可选的 OCR / 批处理加速能力。默认不会接管插件直连。
                </CardDescription>
              </div>
              <Badge className='border-none bg-gradient-to-r from-slate-500 to-slate-700 text-white'>
                可选能力
              </Badge>
            </div>
          </CardHeader>
          <CardContent className='space-y-5'>
            <div className='rounded-lg border border-slate-200/50 bg-gradient-to-r from-slate-50 to-teal-50/50 p-4 dark:border-slate-700/50 dark:from-slate-800/50 dark:to-teal-900/20'>
              <p className='flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300'>
                <Sparkles className='mt-0.5 h-4 w-4 flex-shrink-0 text-teal-600 dark:text-teal-400' />
                <span>
                  只有当你显式切换到“本地加速服务”时，这里配置的地址才会参与实际翻译。
                </span>
              </p>
            </div>

            <div className='space-y-2'>
              <Label
                htmlFor='server-base-url'
                className='text-sm font-medium text-slate-700 dark:text-slate-300'
              >
                服务端地址
              </Label>
              <Input
                id='server-base-url'
                type='text'
                placeholder='http://127.0.0.1:8000'
                value={server.baseUrl}
                onChange={e =>
                  handleServerFieldChange('baseUrl', e.target.value)
                }
                className='h-11 border-slate-200 bg-white transition-all duration-200 focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-600'
              />
            </div>

            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label
                  htmlFor='server-auth-token'
                  className='text-sm font-medium text-slate-700 dark:text-slate-300'
                >
                  鉴权 Token（可选）
                </Label>
                <Input
                  id='server-auth-token'
                  type='password'
                  placeholder='与服务端 SERVER_AUTH_TOKEN 保持一致'
                  value={server.authToken}
                  onChange={e =>
                    handleServerFieldChange('authToken', e.target.value)
                  }
                  className='h-11 border-slate-200 bg-white transition-all duration-200 focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-600'
                />
              </div>

              <div className='space-y-2'>
                <Label
                  htmlFor='server-timeout'
                  className='text-sm font-medium text-slate-700 dark:text-slate-300'
                >
                  超时时间（毫秒）
                </Label>
                <Input
                  id='server-timeout'
                  type='number'
                  min='1000'
                  step='1000'
                  value={String(server.timeoutMs)}
                  onChange={e =>
                    handleServerFieldChange(
                      'timeoutMs',
                      Number(e.target.value) || 30000
                    )
                  }
                  className='h-11 border-slate-200 bg-white transition-all duration-200 focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-teal-600'
                />
              </div>
            </div>

            {serverTestResult && (
              <Alert
                variant={serverTestResult.success ? 'default' : 'destructive'}
                className={`border-none ${
                  serverTestResult.success
                    ? 'bg-emerald-50 dark:bg-emerald-900/20'
                    : 'bg-red-50 dark:bg-red-900/20'
                }`}
              >
                <div className='flex items-start gap-3'>
                  {serverTestResult.success ? (
                    <div className='rounded-lg bg-emerald-100 p-1.5 dark:bg-emerald-900/30'>
                      <CheckCircle2 className='h-4 w-4 text-emerald-600 dark:text-emerald-400' />
                    </div>
                  ) : (
                    <div className='rounded-lg bg-red-100 p-1.5 dark:bg-red-900/30'>
                      <AlertCircle className='h-4 w-4 text-red-600 dark:text-red-400' />
                    </div>
                  )}
                  <div className='flex-1'>
                    <AlertTitle
                      className={`font-semibold ${
                        serverTestResult.success
                          ? 'text-emerald-900 dark:text-emerald-100'
                          : 'text-red-900 dark:text-red-100'
                      }`}
                    >
                      {serverTestResult.success ? '服务端可用' : '服务端不可用'}
                    </AlertTitle>
                    <AlertDescription
                      className={`mt-1 ${
                        serverTestResult.success
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-red-700 dark:text-red-300'
                      }`}
                    >
                      {serverTestResult.message}
                    </AlertDescription>
                  </div>
                </div>
              </Alert>
            )}

            <div className='flex flex-wrap items-center gap-3'>
              <Button
                onClick={handleTestServerConnection}
                disabled={testingServer || !server.baseUrl.trim()}
                className='h-11 cursor-pointer bg-teal-600 text-white shadow-md transition-all duration-200 hover:bg-teal-700 hover:shadow-lg dark:bg-teal-600 dark:hover:bg-teal-700'
              >
                {testingServer ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    测试服务端中...
                  </>
                ) : (
                  <>
                    <Server className='mr-2 h-4 w-4' />
                    测试服务端连接
                  </>
                )}
              </Button>
              <div className='text-xs text-slate-500 dark:text-slate-400'>
                当前路径：{executionMode === 'server' ? '本地加速服务' : '插件直连'}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Provider Configuration */}
        <Card className='border-none bg-white/80 shadow-lg backdrop-blur-sm dark:bg-slate-800/80'>
          <CardHeader className='pb-4'>
            <div className='mb-2 flex items-center gap-3'>
              <div
                className={`bg-gradient-to-br p-2 ${currentProviderConfig.color} rounded-lg`}
              >
                <div className='text-white'>{currentProviderConfig.icon}</div>
              </div>
              <div className='flex-1'>
                <CardTitle className='text-slate-900 dark:text-slate-100'>
                  插件直连 Provider 配置
                </CardTitle>
                <CardDescription className='text-slate-600 dark:text-slate-400'>
                  默认路径。商用模型和 Ollama 都从这里配置。
                </CardDescription>
              </div>
              {currentProviderConfig.badge && (
                <Badge className='border-none bg-gradient-to-r from-teal-500 to-cyan-500 text-white'>
                  {currentProviderConfig.badge}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className='space-y-5'>
            {/* Provider Tabs */}
            <Tabs value={provider} onValueChange={handleProviderChange}>
              <TabsList className='grid h-auto w-full grid-cols-3 bg-slate-100 p-1 dark:bg-slate-700/50'>
                {(Object.keys(PROVIDER_CONFIG) as ProviderType[]).map(key => {
                  const isActive = provider === key;
                  return (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className={`relative cursor-pointer px-2 py-2.5 text-xs transition-all duration-200 sm:text-sm ${
                        isActive
                          ? 'bg-white shadow-md dark:bg-slate-800'
                          : 'hover:bg-white/50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className='flex items-center gap-1.5 sm:gap-2'>
                        <div
                          className={`bg-gradient-to-br p-1 ${PROVIDER_CONFIG[key].color} rounded`}
                        >
                          <div className='text-xs text-white'>
                            {PROVIDER_CONFIG[key].icon}
                          </div>
                        </div>
                        <span className='hidden sm:inline'>
                          {PROVIDER_CONFIG[key].name.split(' ')[0]}
                        </span>
                        <span className='sm:hidden'>
                          {(
                            PROVIDER_CONFIG[key].name.split(' ')[0] ||
                            PROVIDER_CONFIG[key].name
                          ).substring(0, 4)}
                        </span>
                      </div>
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {(Object.keys(PROVIDER_CONFIG) as ProviderType[]).map(key => (
                <TabsContent key={key} value={key} className='mt-5'>
                  <div className='mb-4 rounded-lg border border-slate-200/50 bg-gradient-to-r from-slate-50 to-teal-50/50 p-4 dark:border-slate-700/50 dark:from-slate-800/50 dark:to-teal-900/20'>
                    <p className='flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300'>
                      <Sparkles className='mt-0.5 h-4 w-4 flex-shrink-0 text-teal-600 dark:text-teal-400' />
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
        <Card className='border-none bg-white/80 shadow-lg backdrop-blur-sm dark:bg-slate-800/80'>
          <CardHeader className='pb-4'>
            <div className='mb-2 flex items-center gap-3'>
              <div className='rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 p-2'>
                <Globe className='h-5 w-5 text-white' />
              </div>
              <div className='flex-1'>
                <CardTitle className='text-slate-900 dark:text-slate-100'>
                  翻译设置
                </CardTitle>
                <CardDescription className='text-slate-600 dark:text-slate-400'>
                  配置翻译目标语言
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-2'>
              <Label
                htmlFor='target-language'
                className='text-sm font-medium text-slate-700 dark:text-slate-300'
              >
                目标语言
              </Label>
              <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                <SelectTrigger
                  id='target-language'
                  className='h-11 cursor-pointer border-slate-200 bg-white transition-all duration-200 hover:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-teal-600'
                >
                  <SelectValue placeholder='选择目标语言' />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_LANGUAGES.map(lang => (
                    <SelectItem
                      key={lang.value}
                      value={lang.value}
                      className='cursor-pointer'
                    >
                      <div className='flex items-center gap-2'>
                        <span className='text-lg'>{lang.flag}</span>
                        <span>{lang.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400'>
                <Languages className='h-3 w-3' />
                漫画中的文字将被翻译成此语言
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Ollama Help */}
        {provider === 'ollama' && (
          <Card className='border-none bg-gradient-to-br from-slate-50 to-blue-50 shadow-lg backdrop-blur-sm dark:from-slate-800/80 dark:to-blue-900/20'>
            <CardHeader className='pb-4'>
              <div className='mb-2 flex items-center gap-3'>
                <div className='rounded-lg bg-gradient-to-br from-slate-500 to-gray-600 p-2'>
                  <Server className='h-5 w-5 text-white' />
                </div>
                <CardTitle className='text-slate-900 dark:text-slate-100'>
                  Ollama 安装指南
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <div className='flex items-start gap-3'>
                  <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30'>
                    <span className='text-xs font-bold text-teal-600 dark:text-teal-400'>
                      1
                    </span>
                  </div>
                  <div className='flex-1'>
                    <p className='mb-1 font-medium text-slate-900 dark:text-slate-100'>
                      安装 Ollama
                    </p>
                    <p className='text-sm text-slate-600 dark:text-slate-400'>
                      访问{' '}
                      <a
                        href='https://ollama.ai/download'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='inline-flex cursor-pointer items-center gap-1 text-teal-600 transition-colors duration-200 hover:underline dark:text-teal-400'
                      >
                        ollama.ai/download
                        <ExternalLink className='h-3 w-3' />
                      </a>{' '}
                      下载并安装
                    </p>
                  </div>
                </div>
              </div>

              <div className='space-y-2'>
                <div className='flex items-start gap-3'>
                  <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30'>
                    <span className='text-xs font-bold text-teal-600 dark:text-teal-400'>
                      2
                    </span>
                  </div>
                  <div className='flex-1'>
                    <p className='mb-2 font-medium text-slate-900 dark:text-slate-100'>
                      下载视觉模型
                    </p>
                    <code className='block rounded-lg bg-slate-900 p-3 font-mono text-sm text-emerald-400 dark:bg-slate-950'>
                      ollama pull llava
                    </code>
                  </div>
                </div>
              </div>

              <div className='space-y-2'>
                <div className='flex items-start gap-3'>
                  <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30'>
                    <span className='text-xs font-bold text-teal-600 dark:text-teal-400'>
                      3
                    </span>
                  </div>
                  <div className='flex-1'>
                    <p className='mb-1 font-medium text-slate-900 dark:text-slate-100'>
                      启动服务
                    </p>
                    <p className='text-sm text-slate-600 dark:text-slate-400'>
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
            variant='destructive'
            className='border-none bg-amber-50 shadow-md dark:bg-amber-900/20'
          >
            <div className='flex items-start gap-3'>
              <div className='rounded-lg bg-amber-100 p-1.5 dark:bg-amber-900/30'>
                <AlertCircle className='h-4 w-4 text-amber-600 dark:text-amber-400' />
              </div>
              <div className='flex-1'>
                <AlertTitle className='font-semibold text-amber-900 dark:text-amber-100'>
                  配置不完整
                </AlertTitle>
                <AlertDescription className='mt-1 text-amber-700 dark:text-amber-300'>
                  {provider === 'ollama'
                    ? '请配置 Ollama 服务地址与视觉模型，以便本地直连可用'
                    : '请配置 API 密钥，以便插件直连可用'}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}

        {executionMode === 'server' && !isServerConfigured() && (
          <Alert className='border-none bg-amber-50 shadow-md dark:bg-amber-900/20'>
            <div className='flex items-start gap-3'>
              <div className='rounded-lg bg-amber-100 p-1.5 dark:bg-amber-900/30'>
                <AlertCircle className='h-4 w-4 text-amber-600 dark:text-amber-400' />
              </div>
              <div className='flex-1'>
                <AlertTitle className='font-semibold text-amber-900 dark:text-amber-100'>
                  本地加速服务尚未配置完成
                </AlertTitle>
                <AlertDescription className='mt-1 text-amber-700 dark:text-amber-300'>
                  请先填写并测试服务端地址，或者切回插件直连继续使用。
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}
      </main>

      {/* Footer */}
      <footer className='mt-12 border-t border-slate-200/50 bg-white/50 backdrop-blur-sm dark:border-slate-700/50 dark:bg-slate-900/50'>
        <div className='container mx-auto px-4 py-6'>
          <div className='flex flex-col items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-400 sm:flex-row'>
            <Badge
              variant='secondary'
              className='border-none bg-slate-100 px-3 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            >
              <Sparkles className='mr-1.5 h-3 w-3' />
              Powered by AI
            </Badge>
            <span className='text-slate-400 dark:text-slate-600'>•</span>
            <p>漫画翻译助手 v2 - 极简、可靠、高效</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default OptionsApp;
