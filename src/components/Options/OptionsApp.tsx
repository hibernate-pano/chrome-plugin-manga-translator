import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  BarChart3,
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
import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';
import type { ProviderType } from '@/providers/base';
import { ENV_CONFIG } from '@/shared/env-config';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { OnboardingApp } from '@/components/Onboarding/OnboardingApp';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

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

// v1.1.1: provider presets removed — configuration is fully file-driven
// (.env via inject-env-config.mjs). The Options page no longer offers
// endpoint pickers; users edit .env and rebuild.

const OptionsApp: React.FC = () => {
  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  const targetLanguage = useAppConfigStore(state => state.targetLanguage);
  const enabled = useAppConfigStore(state => state.enabled);
  const autoContinueEnabled = useAppConfigStore(
    state => state.autoContinueEnabled
  );
  const cacheEnabled = useAppConfigStore(state => state.cacheEnabled);
  const translationStylePreset = useAppConfigStore(
    state => state.translationStylePreset
  );
  const overlayStyle = useAppConfigStore(state => state.overlayStyle);
  const verticalText = useAppConfigStore(
    state => state.overlayStyle.verticalText
  );
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
  const usageRecords = useUsageStore(state => state.records);
  const clearUsage = useUsageStore(state => state.clearAll);

  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(
    null
  );
  const [showApiKey, setShowApiKey] = useState<Record<ProviderType, boolean>>({
    'openai-compatible': false,
    ollama: false,
    'lm-studio': false,
  });
  const [testResults, setTestResults] = useState<
    Record<ProviderType, TestResult | null>
  >({
    'openai-compatible': null,
    ollama: null,
    'lm-studio': null,
  });
  const [overlayStyleExpanded, setOverlayStyleExpanded] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderType | null>(
    null
  );
  const [clearUsageDialogOpen, setClearUsageDialogOpen] = useState(false);
  const [privacyBannerDismissed, setPrivacyBannerDismissed] = useState(false);
  const [providerHealth, setProviderHealth] = useState<
    Record<ProviderType, 'unknown' | 'healthy' | 'unhealthy'>
  >({
    'openai-compatible': 'unknown',
    ollama: 'unknown',
    'lm-studio': 'unknown',
  });
  const healthCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const activeProviderMeta = useMemo(
    () => PROVIDERS.find(item => item.type === provider) ?? PROVIDERS[0],
    [provider]
  );

  const usageSummary = useMemo(
    () => summarizeUsageForMonth(usageRecords),
    [usageRecords]
  );

  // Health check polling every 30 seconds
  const performHealthCheck = useCallback(async () => {
    for (const providerType of [
      'openai-compatible',
      'ollama',
      'lm-studio',
    ] as ProviderType[]) {
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
  // 第一次点击弹出确认对话框；确认后才真正切换。
  // 之前是 3 秒隐式倒计时（黄色 ring），用户难以察觉，按视觉审计 §六.5 改为显式 dialog。
  const handleProviderSwitch = useCallback(
    (providerType: ProviderType) => {
      if (providerType === provider) {
        return; // 已是当前 provider，无需切换
      }
      setPendingProvider(providerType);
    },
    [provider]
  );

  const confirmProviderSwitch = useCallback(() => {
    if (pendingProvider) {
      void setProvider(pendingProvider);
      setPendingProvider(null);
    }
  }, [pendingProvider, setProvider]);

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
        }`}
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
              <div className='text-left text-sm font-semibold'>{meta.name}</div>
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
              {provider === providerType ? '当前使用中' : '点击切换'}
            </span>
            {health !== 'unknown' && (
              <span
                className={`h-2 w-2 rounded-full ${
                  health === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'
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

        <div
          className='mt-4 grid gap-3'
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          <label className='block'>
            <div className='mb-1 text-xs text-slate-400'>Base URL</div>
            <input
              type='text'
              value={settings.baseUrl}
              onChange={event =>
                updateProviderSettings(providerType, {
                  baseUrl: event.target.value,
                })
              }
              className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
            />
          </label>

          <label className='block'>
            <div className='mb-1 text-xs text-slate-400'>Model</div>
            <input
              type='text'
              value={settings.model}
              placeholder={meta.modelPlaceholder}
              onChange={event =>
                updateProviderSettings(providerType, {
                  model: event.target.value,
                })
              }
              className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
            />
          </label>

          {meta.requiresApiKey && (
            <label className='block'>
              <div className='mb-1 text-xs text-slate-400'>API Key</div>
              <div className='relative'>
                <input
                  type={showApiKey[providerType] ? 'text' : 'password'}
                  value={settings.apiKey}
                  placeholder='粘贴 API Key'
                  autoComplete='off'
                  onChange={event =>
                    updateProviderSettings(providerType, {
                      apiKey: event.target.value,
                    })
                  }
                  className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 pr-10 text-sm outline-none focus:border-cyan-500/60'
                />
                <button
                  type='button'
                  onClick={() =>
                    setShowApiKey(current => ({
                      ...current,
                      [providerType]: !current[providerType],
                    }))
                  }
                  className='absolute right-3 top-2.5 text-slate-500 transition hover:text-slate-300'
                  aria-label={
                    showApiKey[providerType] ? '隐藏 API Key' : '显示 API Key'
                  }
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

          {providerType === 'openai-compatible' &&
            ENV_CONFIG.opencode.apiKey && (
              <button
                type='button'
                onClick={() =>
                  updateProviderSettings('openai-compatible', {
                    apiKey: ENV_CONFIG.opencode.apiKey,
                    baseUrl: ENV_CONFIG.opencode.baseUrl,
                    model: ENV_CONFIG.opencode.model,
                  })
                }
                className='rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-200 transition hover:bg-cyan-500/10'
              >
                使用构建时 OpenCodeGo 备用配置
              </button>
            )}

          {!meta.requiresApiKey && (
            <div className='flex items-center gap-2 text-xs text-slate-500'>
              <CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-emerald-400' />
              <span>本地服务无需 API Key，可修改地址与模型。</span>
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
    <>
      <OnboardingApp />
      <div className='min-h-screen bg-slate-950 px-6 py-8 text-slate-100'>
        <div className='mx-auto max-w-5xl space-y-6'>
          <div className='flex items-start justify-between'>
            <div>
              <h1 className='text-2xl font-semibold'>
                Manga Translator Settings
              </h1>
              <p className='mt-2 text-sm text-slate-400'>
                可直接使用构建时预置的后端，也可以在这里填写自己的 API
                Key、地址与模型。
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
                  你在本页填写的 API Key 只保存在本机
                  <code className='mx-1 rounded bg-slate-800 px-1 py-0.5 text-xs'>
                    chrome.storage.local
                  </code>
                  ，不会同步到 Google 账户。个人构建也可以从
                  <code className='mx-1 rounded bg-slate-800 px-1 py-0.5 text-xs'>
                    .env
                  </code>
                  预置后端；公开构建不会包含任何私有 Key。
                  翻译时漫画图片会直接发送到你配置的 Vision LLM 服务。
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

          {/* First-time onboarding is handled by the OnboardingApp modal at the
            top of this component, shown when onboardingCompleted === false.
            The old inline "开始使用" quick-pick panel has been removed because
            it duplicated the onboarding step 2 and conflicted with it. */}

          <div className='grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]'>
            <div className='space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4'>
              <div className='text-sm font-semibold'>基础行为</div>

              <label className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
                <div>
                  <div className='text-sm font-medium'>启用扩展</div>
                  <div className='text-xs text-slate-400'>
                    允许页面进入自动翻译体系
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label='启用扩展'
                />
              </label>

              <label className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
                <div>
                  <div className='text-sm font-medium'>自动续翻</div>
                  <div className='text-xs text-slate-400'>
                    页面内后续图片出现时自动继续翻译
                  </div>
                </div>
                <Switch
                  checked={autoContinueEnabled}
                  onCheckedChange={setAutoContinueEnabled}
                  aria-label='自动续翻'
                />
              </label>

              <label className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
                <div>
                  <div className='text-sm font-medium'>缓存结果</div>
                  <div className='text-xs text-slate-400'>
                    减少重复图片的重复请求
                  </div>
                </div>
                <Switch
                  checked={cacheEnabled}
                  onCheckedChange={setCacheEnabled}
                  aria-label='缓存结果'
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
                      e.target.value as
                        | 'faithful'
                        | 'natural-zh'
                        | 'concise-bubble'
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
              <div className='overflow-hidden rounded-lg border border-white/10 bg-slate-950/70'>
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
                        <div className='text-xs text-slate-400'>
                          日文漫画竖向排版时启用
                        </div>
                      </div>
                      <Switch
                        checked={verticalText}
                        onCheckedChange={setVerticalText}
                        aria-label='竖排文字'
                      />
                    </label>

                    <label className='block'>
                      <div className='mb-1.5 text-xs text-slate-400'>
                        背景色
                      </div>
                      <div className='flex items-center gap-2'>
                        <input
                          type='color'
                          value={
                            overlayStyle.backgroundColor.startsWith('rgba')
                              ? '#f0f0eb'
                              : overlayStyle.backgroundColor
                          }
                          onChange={e =>
                            setOverlayStyle({ backgroundColor: e.target.value })
                          }
                          className='h-8 w-12 cursor-pointer rounded border border-white/10 bg-transparent'
                        />
                        <input
                          type='text'
                          value={overlayStyle.backgroundColor}
                          onChange={e =>
                            setOverlayStyle({ backgroundColor: e.target.value })
                          }
                          className='flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm outline-none'
                        />
                      </div>
                    </label>

                    <label className='block'>
                      <div className='mb-1.5 text-xs text-slate-400'>
                        文字颜色
                      </div>
                      <div className='flex items-center gap-2'>
                        <input
                          type='color'
                          value={overlayStyle.textColor}
                          onChange={e =>
                            setOverlayStyle({ textColor: e.target.value })
                          }
                          className='h-8 w-12 cursor-pointer rounded border border-white/10 bg-transparent'
                        />
                        <input
                          type='text'
                          value={overlayStyle.textColor}
                          onChange={e =>
                            setOverlayStyle({ textColor: e.target.value })
                          }
                          className='flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm outline-none'
                        />
                      </div>
                    </label>

                    <label className='block'>
                      <div className='mb-3 text-xs text-slate-400'>
                        字号范围
                      </div>
                      <div className='flex items-center gap-4'>
                        <span className='w-8 text-xs text-slate-400'>
                          {overlayStyle.minFontSize}
                        </span>
                        <Slider
                          min={8}
                          max={48}
                          step={1}
                          value={[
                            overlayStyle.minFontSize,
                            overlayStyle.maxFontSize,
                          ]}
                          onValueChange={([min, max]) =>
                            setOverlayStyle({
                              minFontSize: min,
                              maxFontSize: max,
                            })
                          }
                          className='flex-1'
                        />
                        <span className='w-8 text-right text-xs text-slate-400'>
                          {overlayStyle.maxFontSize}
                        </span>
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

          <div className='rounded-xl border border-white/10 bg-white/[0.03] p-4'>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-2'>
                <BarChart3 className='h-4 w-4 text-cyan-300' />
                <div>
                  <h2 className='text-sm font-semibold'>本月用量</h2>
                  <p className='text-xs text-slate-500'>
                    仅统计本机记录，缓存命中不消耗 Token
                  </p>
                </div>
              </div>
              <button
                type='button'
                onClick={() => setClearUsageDialogOpen(true)}
                disabled={usageRecords.length === 0}
                className='rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5 disabled:opacity-40'
              >
                清除统计
              </button>
            </div>

            <div className='mt-4 grid grid-cols-2 gap-3 md:grid-cols-4'>
              {[
                ['翻译记录', usageSummary.translations.toLocaleString()],
                ['API 调用', usageSummary.billableCalls.toLocaleString()],
                ['Token', usageSummary.tokens.toLocaleString()],
                ['缓存命中', `${usageSummary.cacheHitRate}%`],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className='rounded-lg border border-white/5 bg-slate-950/50 px-3 py-3'
                >
                  <div className='text-xs text-slate-500'>{label}</div>
                  <div className='mt-1 text-lg font-semibold text-slate-100'>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={pendingProvider !== null}
          title='切换翻译后端？'
          description={`将切换到「${
            PROVIDERS.find(p => p.type === pendingProvider)?.name ??
            pendingProvider
          }」。已有配置不会丢失，可随时切回。`}
          confirmLabel='切换'
          cancelLabel='取消'
          destructive={false}
          onConfirm={confirmProviderSwitch}
          onCancel={() => setPendingProvider(null)}
        />
        <ConfirmDialog
          open={clearUsageDialogOpen}
          title='清除用量统计？'
          description='这会删除本机保存的 Token 与调用记录，不会影响翻译缓存或 Provider 配置。'
          confirmLabel='清除'
          cancelLabel='取消'
          destructive
          onConfirm={() => {
            clearUsage();
            setClearUsageDialogOpen(false);
          }}
          onCancel={() => setClearUsageDialogOpen(false)}
        />
      </div>
    </>
  );
};

export default OptionsApp;
