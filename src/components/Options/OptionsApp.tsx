import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  RefreshCw,
  Check,
  Server,
  Sparkles,
  Info,
} from 'lucide-react';

import { createProvider } from '@/providers';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getErrorStats, clearErrorStats, type ErrorStats } from '@/utils/error-stats';

interface TestResult {
  success: boolean;
  message: string;
}

const TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

const PROVIDERS: Array<{
  type: ProviderType;
  name: string;
  description: string;
  requiresApiKey: boolean;
  helpUrl: string;
  modelPlaceholder: string;
}> = [
  {
    type: 'openai-compatible',
    name: 'OpenAI-compatible',
    description: '兼容 OpenAI Chat Completions 的视觉模型端点。',
    requiresApiKey: true,
    helpUrl: 'https://platform.openai.com/api-keys',
    modelPlaceholder: '例如: gpt-4o, qwen-vl-max, custom-vlm',
  },
  {
    type: 'ollama',
    name: 'Ollama',
    description: '本地模型，适合隐私优先或离线使用。',
    requiresApiKey: false,
    helpUrl: 'https://ollama.com/download',
    modelPlaceholder: '例如: llava, minicpm-v',
  },
  {
    type: 'lm-studio',
    name: 'LM Studio',
    description: '本地 OpenAI 兼容服务器，适合隐私优先或离线使用。',
    requiresApiKey: false,
    helpUrl: 'https://lmstudio.ai/download',
    modelPlaceholder: '在 LM Studio 中加载模型后自动检测',
  },
];

const API_PRESETS: Array<{
  name: string;
  baseUrl: string;
  model: string;
  description: string;
}> = [
  {
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    description: '标准 OpenAI 视觉模型，响应速度快。',
  },
  {
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-VL-8B-Instruct',
    description: '国内高性价比大模型托管平台，支持 Qwen VL 系列，注册赠送免费额度。',
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    description: '国外大模型聚合平台，支持 Gemini 等多种多模态模型。',
  },
];

const ERROR_STATS_STORAGE_KEY = 'manga-translator-error-stats';

function ErrorStatsCard() {
  const [stats, setStats] = useState<ErrorStats>({});

  useEffect(() => {
    void getErrorStats().then(setStats);

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') return;
      if (changes[ERROR_STATS_STORAGE_KEY]) {
        void getErrorStats().then(setStats);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const entries = Object.entries(stats).sort(
    ([, a], [, b]) => (b ?? 0) - (a ?? 0)
  );

  if (entries.length === 0) return null;

  return (
    <Card className='mt-6'>
      <CardHeader>
        <CardTitle>诊断</CardTitle>
        <CardDescription>本地累计的翻译失败次数（按错误码）</CardDescription>
      </CardHeader>
      <CardContent>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b'>
              <th className='py-2 text-left'>错误码</th>
              <th className='py-2 text-right'>次数</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([code, count]) => (
              <tr key={code} className='border-b last:border-0'>
                <td className='py-2 font-mono'>{code}</td>
                <td className='py-2 text-right'>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <CardFooter>
        <Button
          variant='outline'
          onClick={() => {
            void clearErrorStats().then(() => setStats({}));
          }}
        >
          清零
        </Button>
      </CardFooter>
    </Card>
  );
}

const OptionsApp: React.FC = () => {
  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  const targetLanguage = useAppConfigStore(state => state.targetLanguage);
  const enabled = useAppConfigStore(state => state.enabled);
  const autoContinueEnabled = useAppConfigStore(state => state.autoContinueEnabled);
  const cacheEnabled = useAppConfigStore(state => state.cacheEnabled);
  const translationStylePreset = useAppConfigStore(
    state => state.translationStylePreset
  );
  const overlayStyle = useAppConfigStore(state => state.overlayStyle);
  const verticalText = useAppConfigStore(state => state.overlayStyle.verticalText);
  const setProvider = useAppConfigStore(state => state.setProvider);
  const updateProviderSettings = useAppConfigStore(
    state => state.updateProviderSettings
  );
  const setTargetLanguage = useAppConfigStore(state => state.setTargetLanguage);
  const setEnabled = useAppConfigStore(state => state.setEnabled);
  const setAutoContinueEnabled = useAppConfigStore(
    state => state.setAutoContinueEnabled
  );
  const setCacheEnabled = useAppConfigStore(state => state.setCacheEnabled);
  const setTranslationStylePreset = useAppConfigStore(
    state => state.setTranslationStylePreset
  );
  const setOverlayStyle = useAppConfigStore(state => state.setOverlayStyle);
  const setVerticalText = useAppConfigStore(state => state.setVerticalText);

  const [showApiKey, setShowApiKey] = useState<Record<ProviderType, boolean>>({
    'openai-compatible': false,
    ollama: false,
    'lm-studio': false,
  });
  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(null);
  const [testResults, setTestResults] = useState<
    Record<ProviderType, TestResult | null>
  >({
    'openai-compatible': null,
    ollama: null,
    'lm-studio': null,
  });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [overlayStyleExpanded, setOverlayStyleExpanded] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderType | null>(null);
  const [privacyBannerDismissed, setPrivacyBannerDismissed] = useState(false);
  const [providerHealth, setProviderHealth] = useState<Record<ProviderType, 'unknown' | 'healthy' | 'unhealthy'>>({
    'openai-compatible': 'unknown',
    ollama: 'unknown',
    'lm-studio': 'unknown',
  });
  const healthCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeProviderMeta = useMemo(
    () => PROVIDERS.find(item => item.type === provider) ?? PROVIDERS[0],
    [provider]
  );

  // Health check polling every 30 seconds
  const performHealthCheck = useCallback(async () => {
    for (const providerType of ['openai-compatible', 'ollama', 'lm-studio'] as ProviderType[]) {
      try {
        const settings = providers[providerType];
        const instance = await createProvider(providerType, settings);
        const result = await instance.validateConfig();
        setProviderHealth(current => ({
          ...current,
          [providerType]: result.valid ? 'healthy' : 'unhealthy',
        }));
      } catch {
        setProviderHealth(current => ({
          ...current,
          [providerType]: 'unhealthy',
        }));
      }
    }
  }, [providers]);

  useEffect(() => {
    // Initial health check
    void performHealthCheck();
    // Poll every 30 seconds
    healthCheckTimerRef.current = setInterval(() => {
      void performHealthCheck();
    }, 30000);
    return () => {
      if (healthCheckTimerRef.current) {
        clearInterval(healthCheckTimerRef.current);
      }
    };
  }, [performHealthCheck]);

  // 隐私告知 banner：读取是否已被用户关闭
  useEffect(() => {
    void chrome.storage.local
      .get(['manga-translator-privacy-banner-dismissed'])
      .then(result => {
        if (result['manga-translator-privacy-banner-dismissed'] === true) {
          setPrivacyBannerDismissed(true);
        }
      })
      .catch(() => undefined);
  }, []);

  const dismissPrivacyBanner = useCallback(() => {
    setPrivacyBannerDismissed(true);
    void chrome.storage.local
      .set({ 'manga-translator-privacy-banner-dismissed': true })
      .catch(() => undefined);
  }, []);

  // Provider switch confirmation handler
  const handleProviderSwitch = useCallback((providerType: ProviderType) => {
    if (pendingProvider) {
      // Already pending - confirm switch
      setProvider(providerType);
      setPendingProvider(null);
    } else {
      // Start pending confirmation
      setPendingProvider(providerType);
      setTimeout(() => {
        setPendingProvider(current => {
          if (current === providerType) {
            return null;
          }
          return current;
        });
      }, 3000);
    }
  }, [pendingProvider, setProvider]);

  const fetchOllamaModels = useCallback(async () => {
    const url = providers.ollama.baseUrl;
    if (!url) return;
    setLoadingOllamaModels(true);
    try {
      const providerInstance = await createProvider('ollama', { baseUrl: url });
      if ('getAvailableVisionModels' in providerInstance) {
        const models = await (
          providerInstance as { getAvailableVisionModels: () => Promise<string[]> }
        ).getAvailableVisionModels();
        setOllamaModels(models);
      }
    } catch {
      setOllamaModels([]);
    } finally {
      setLoadingOllamaModels(false);
    }
  }, [providers.ollama.baseUrl]);

  useEffect(() => {
    if (provider === 'ollama') {
      void fetchOllamaModels();
    }
  }, [fetchOllamaModels, provider]);

  const testProvider = useCallback(
    async (providerType: ProviderType) => {
      setTestingProvider(providerType);
      try {
        const settings = providers[providerType];
        const instance = await createProvider(providerType, settings);
        const result = await instance.validateConfig();
        setTestResults(current => ({
          ...current,
          [providerType]: {
            success: result.valid,
            message: result.message,
          },
        }));
      } catch (error) {
        setTestResults(current => ({
          ...current,
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

  const renderProviderCard = (providerType: ProviderType) => {
    const meta = PROVIDERS.find(item => item.type === providerType);
    if (!meta) {
      return null;
    }
    const settings = providers[providerType];
    const result = testResults[providerType];
    const isPending = pendingProvider === providerType;
    const health = providerHealth[providerType];

    return (
      <div
        key={providerType}
        role='button'
        tabIndex={0}
        onClick={() => handleProviderSwitch(providerType)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleProviderSwitch(providerType);
          }
        }}
        className={`rounded-xl border p-4 ${
          provider === providerType
            ? 'border-cyan-500/40 bg-cyan-500/10'
            : 'border-white/10 bg-white/[0.03]'
        } ${isPending ? 'ring-2 ring-yellow-500/50' : ''}`}
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <div className='flex items-center gap-2'>
              {provider === providerType ? (
                <Check className='h-4 w-4 text-cyan-300' />
              ) : (
                <Circle className='h-4 w-4 text-slate-500' />
              )}
              {providerType === 'ollama' ? (
                <Server className='h-4 w-4 text-slate-300' />
              ) : (
                <Sparkles className='h-4 w-4 text-cyan-300' />
              )}
              <div className='text-left text-sm font-semibold'>
                {meta.name}
              </div>
            </div>
            <p className='mt-1 text-sm text-slate-400'>{meta.description}</p>
          </div>
          <div className='flex items-center gap-2'>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${
                provider === providerType
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                  : 'border-white/10 text-slate-400'
              }`}
            >
              {provider === providerType ? '当前使用中' : isPending ? '确认切换？' : '点击切换'}
            </span>
            {health !== 'unknown' && (
              <span
                className={`h-2 w-2 rounded-full ${
                  health === 'healthy'
                    ? 'bg-emerald-400'
                    : 'bg-amber-400'
                }`}
                title={health === 'healthy' ? '连接正常' : '连接异常'}
              />
            )}
            <a
              href={meta.helpUrl}
              target='_blank'
              rel='noreferrer'
              onClick={event => event.stopPropagation()}
              className='inline-flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200'
            >
              文档
              <ExternalLink className='h-3 w-3' />
            </a>
          </div>
        </div>

        <div className='mt-4 grid gap-3'>
          {meta.requiresApiKey && (
            <label className='block'>
              <div className='mb-1 text-xs text-slate-400'>API Key</div>
              <div className='relative'>
                <input
                  type={showApiKey[providerType] ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={e =>
                    updateProviderSettings(providerType, { apiKey: e.target.value })
                  }
                  className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 pr-10 text-sm outline-none'
                />
                <button
                  type='button'
                  onClick={event => {
                    event.stopPropagation();
                    setShowApiKey(current => ({
                      ...current,
                      [providerType]: !current[providerType],
                    }));
                  }}
                  className='absolute right-3 top-2.5 text-slate-500'
                >
                  {showApiKey[providerType] ? (
                    <EyeOff className='h-4 w-4' />
                  ) : (
                    <Eye className='h-4 w-4' />
                  )}
                </button>
              </div>
            </label>
          )}

          <label className='block'>
            <div className='mb-1 text-xs text-slate-400'>Base URL</div>
            <input
              type='text'
              value={settings.baseUrl}
              onChange={e =>
                updateProviderSettings(providerType, { baseUrl: e.target.value })
              }
              className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none'
            />
          </label>

          <label className='block'>
            <div className='mb-1 text-xs text-slate-400'>Model</div>
            <input
              type='text'
              placeholder={meta.modelPlaceholder}
              value={settings.model}
              onChange={e =>
                updateProviderSettings(providerType, { model: e.target.value })
              }
              className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none'
            />
          </label>

          {providerType === 'openai-compatible' && (
            <div className='rounded-lg border border-white/5 bg-slate-950/40 p-3'>
              <div className='mb-2 text-xs font-medium text-slate-300'>服务商快捷预设</div>
              <div className='flex flex-wrap gap-2'>
                {API_PRESETS.map(preset => {
                  const isActive =
                    settings.baseUrl === preset.baseUrl &&
                    settings.model === preset.model;
                  return (
                    <button
                      key={preset.name}
                      type='button'
                      onClick={event => {
                        event.stopPropagation();
                        updateProviderSettings('openai-compatible', {
                          baseUrl: preset.baseUrl,
                          model: preset.model,
                        });
                      }}
                      className={cn(
                        'rounded border px-2 py-1 text-xs transition',
                        isActive
                          ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200 ring-2 ring-cyan-500/50'
                          : 'border-cyan-500/20 bg-cyan-500/5 text-cyan-200 hover:bg-cyan-500/20 hover:border-cyan-500/40'
                      )}
                      title={preset.description}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {providerType === 'ollama' && (
            <div className='rounded-lg border border-white/10 bg-slate-950/70 p-3 text-xs text-slate-400'>
              <div className='flex items-center justify-between'>
                <span>本地可见模型</span>
                <button
                  type='button'
                  onClick={() => void fetchOllamaModels()}
                  className='inline-flex items-center gap-1 text-slate-300 transition hover:text-white'
                >
                  <RefreshCw className='h-3 w-3' />
                  刷新
                </button>
              </div>
              <div className='mt-2'>
                {loadingOllamaModels
                  ? '加载中...'
                  : ollamaModels.length > 0
                    ? ollamaModels.join(', ')
                    : '未检测到视觉模型'}
              </div>
            </div>
          )}

          {result && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                result.success
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              }`}
            >
              <div className='flex items-start gap-2'>
                {result.success ? (
                  <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
                ) : (
                  <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
                )}
                <span>{result.message}</span>
              </div>
            </div>
          )}

          <button
            type='button'
            onClick={event => {
              event.stopPropagation();
              void testProvider(providerType);
            }}
            disabled={testingProvider === providerType}
            className='inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm transition hover:bg-white/[0.07] disabled:opacity-40'
          >
            {testingProvider === providerType ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <RefreshCw className='h-4 w-4' />
            )}
            测试配置
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className='min-h-screen bg-slate-950 px-6 py-8 text-slate-100'>
      <div className='mx-auto max-w-5xl space-y-6'>
        <div className='flex items-start justify-between'>
          <div>
            <h1 className='text-2xl font-semibold'>Manga Translator Settings</h1>
            <p className='mt-2 text-sm text-slate-400'>
              三条直连路径：OpenAI-compatible、Ollama 与 LM Studio。
            </p>
          </div>
          <div className='flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5'>
            {provider === 'ollama' ? (
              <Server className='h-4 w-4 text-slate-300' />
            ) : (
              <Sparkles className='h-4 w-4 text-cyan-300' />
            )}
            <span className='text-sm font-medium text-cyan-100'>
              {activeProviderMeta?.name ?? 'OpenAI-compatible'}
            </span>
          </div>
        </div>

        {/* 隐私告知 banner：说明 API key 与图片数据流向，可关闭 */}
        {!privacyBannerDismissed && (
          <div className='flex items-start gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4'>
            <Info className='mt-0.5 h-5 w-5 shrink-0 text-cyan-400' />
            <div className='flex-1'>
              <h3 className='text-sm font-semibold text-cyan-100'>
                数据流向说明
              </h3>
              <p className='mt-1 text-sm text-slate-300'>
                你的 API Key 与配置仅保存在本机{' '}
                <code className='rounded bg-slate-800 px-1 py-0.5 text-xs'>
                  chrome.storage.local
                </code>
                ，不随 Google 账户跨设备同步，也不会上传给本扩展作者。
                翻译时漫画图片会直接发送到你配置的 Vision LLM 服务
                （OpenAI / Ollama / LM Studio）。
              </p>
            </div>
            <button
              type='button'
              onClick={dismissPrivacyBanner}
              aria-label='关闭告知'
              className='shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-white'
            >
              <ChevronDown className='h-4 w-4' />
            </button>
          </div>
        )}

        {/* First-time usage guide - only show when no provider is configured */}
        {!(
          providers['openai-compatible'].apiKey ||
          providers['openai-compatible'].baseUrl ||
          providers.ollama.baseUrl
        ) && (
          <div className='rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4'>
            <div className='flex items-start gap-3'>
              <Info className='mt-0.5 h-5 w-5 shrink-0 text-cyan-400' />
              <div className='flex-1'>
                <h3 className='text-sm font-semibold text-cyan-100'>开始使用</h3>
                <p className='mt-1 text-sm text-slate-400'>
                  选择一个 Provider 并配置测试后即可开始翻译。
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={() => {
                      void updateProviderSettings('openai-compatible', {
                        baseUrl: 'https://api.openai.com/v1',
                        model: 'gpt-4o-mini',
                      });
                      void setProvider('openai-compatible');
                    }}
                    className='inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20'
                  >
                    <Sparkles className='h-4 w-4' />
                    使用 OpenAI-compatible
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      void updateProviderSettings('ollama', {
                        baseUrl: 'http://localhost:11434',
                        model: '',
                      });
                      void setProvider('ollama');
                    }}
                    className='inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20'
                  >
                    <Server className='h-4 w-4' />
                    使用 Ollama
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className='grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]'>
          <div className='space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4'>
            <div className='text-sm font-semibold'>基础行为</div>

            <label className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
                <div>
                  <div className='text-sm font-medium'>启用扩展</div>
                  <div className='text-xs text-slate-400'>允许页面进入自动翻译体系</div>
                </div>
              <input
                type='checkbox'
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                className='h-4 w-4'
              />
            </label>

            <label className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
              <div>
                <div className='text-sm font-medium'>自动续翻</div>
                <div className='text-xs text-slate-400'>页面内后续图片出现时自动继续翻译</div>
              </div>
              <input
                type='checkbox'
                checked={autoContinueEnabled}
                onChange={e => setAutoContinueEnabled(e.target.checked)}
                className='h-4 w-4'
              />
            </label>

            <label className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
              <div>
                <div className='text-sm font-medium'>缓存结果</div>
                <div className='text-xs text-slate-400'>减少重复图片的重复请求</div>
              </div>
              <input
                type='checkbox'
                checked={cacheEnabled}
                onChange={e => setCacheEnabled(e.target.checked)}
                className='h-4 w-4'
              />
            </label>

            <label className='block'>
              <div className='mb-2 text-sm font-medium'>目标语言</div>
              <select
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
                className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none'
              >
                {TARGET_LANGUAGES.map(item => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className='block'>
              <div className='mb-2 text-sm font-medium'>翻译风格</div>
              <select
                value={translationStylePreset}
                onChange={e =>
                  setTranslationStylePreset(
                    e.target.value as 'faithful' | 'natural-zh' | 'concise-bubble'
                  )
                }
                className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none'
              >
                <option value='natural-zh'>自然中文</option>
                <option value='faithful'>尽量忠实</option>
                <option value='concise-bubble'>气泡精简</option>
              </select>
            </label>

            {/* 覆盖层样式折叠面板 */}
            <div className='rounded-lg border border-white/10 bg-slate-950/70 overflow-hidden'>
              <button
                type='button'
                onClick={() => setOverlayStyleExpanded(!overlayStyleExpanded)}
                className='flex w-full items-center justify-between px-3 py-3 text-left transition hover:bg-white/[0.02]'
              >
                <div>
                  <div className='text-sm font-medium'>覆盖层样式</div>
                  <div className='text-xs text-slate-400'>
                    背景色、文字颜色、字号等
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                    overlayStyleExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <div
                className={`transition-all duration-200 ease-out ${
                  overlayStyleExpanded
                    ? 'max-h-[500px] opacity-100'
                    : 'max-h-0 opacity-0'
                }`}
              >
                <div className='space-y-3 border-t border-white/10 px-3 py-3'>
                  <label className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
                    <div>
                      <div className='text-sm font-medium'>竖排文字</div>
                      <div className='text-xs text-slate-400'>日文漫画竖向排版时启用</div>
                    </div>
                    <input
                      type='checkbox'
                      checked={verticalText}
                      onChange={e => setVerticalText(e.target.checked)}
                      className='h-4 w-4'
                    />
                  </label>

                  <label className='block'>
                    <div className='mb-1.5 text-xs text-slate-400'>背景色</div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='color'
                        value={overlayStyle.backgroundColor.startsWith('rgba')
                          ? '#f0f0eb'
                          : overlayStyle.backgroundColor}
                        onChange={e => setOverlayStyle({ backgroundColor: e.target.value })}
                        className='h-8 w-12 cursor-pointer rounded border border-white/10 bg-transparent'
                      />
                      <input
                        type='text'
                        value={overlayStyle.backgroundColor}
                        onChange={e => setOverlayStyle({ backgroundColor: e.target.value })}
                        className='flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm outline-none'
                      />
                    </div>
                  </label>

                  <label className='block'>
                    <div className='mb-1.5 text-xs text-slate-400'>文字颜色</div>
                    <div className='flex items-center gap-2'>
                      <input
                        type='color'
                        value={overlayStyle.textColor}
                        onChange={e => setOverlayStyle({ textColor: e.target.value })}
                        className='h-8 w-12 cursor-pointer rounded border border-white/10 bg-transparent'
                      />
                      <input
                        type='text'
                        value={overlayStyle.textColor}
                        onChange={e => setOverlayStyle({ textColor: e.target.value })}
                        className='flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm outline-none'
                      />
                    </div>
                  </label>

                  <label className='block'>
                    <div className='mb-3 text-xs text-slate-400'>字号范围</div>
                    <div className='flex items-center gap-4'>
                      <span className='w-8 text-xs text-slate-400'>{overlayStyle.minFontSize}</span>
                      <Slider
                        min={8}
                        max={48}
                        step={1}
                        value={[overlayStyle.minFontSize, overlayStyle.maxFontSize]}
                        onValueChange={([min, max]) => setOverlayStyle({ minFontSize: min, maxFontSize: max })}
                        className='flex-1'
                      />
                      <span className='w-8 text-right text-xs text-slate-400'>{overlayStyle.maxFontSize}</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className='space-y-4'>
            {PROVIDERS.map(item => renderProviderCard(item.type))}
          </div>
        </div>

        <ErrorStatsCard />
      </div>
    </div>
  );
};

export default OptionsApp;
