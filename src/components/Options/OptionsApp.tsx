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
import { useTranslationCacheStore } from '@/stores/cache-v2';
import { useAppConfigStore } from '@/stores/config-v2';
import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';
import { getProviderLabel } from '@/utils/provider-label';
import type { ProviderType } from '@/providers/base';
import { evaluateBaseUrlSafety } from '@/shared/app-config';
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

/**
 * 连接状态多久探一次。
 *
 * 60 秒一轮对设置页来说太密：这是一个常驻标签页，每分钟发一次网络请求
 * 只是为了刷新一个 2px 的圆点。5 分钟足够看出后端挂了。
 */
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 覆盖层背景色默认是带透明度的 rgba(...)，而 <input type="color"> 只能表达
 * 不透明颜色。取色器只负责改 RGB，透明度留给旁边的文本框单独编辑 —— 这样
 * 预览（真的按 rgba 渲染）才和实际生效的颜色一致，而不是拿一个假的颜色块
 * 让用户跟它较劲。
 */
interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): ParsedColor | null {
  const trimmed = value.trim();

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1] ?? '';
    const full = hex.length === 3 ? hex.replace(/./g, c => c + c) : hex;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgbMatch =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      trimmed
    );
  if (!rgbMatch) {
    return null;
  }
  return {
    r: Number(rgbMatch[1] ?? 0),
    g: Number(rgbMatch[2] ?? 0),
    b: Number(rgbMatch[3] ?? 0),
    a: rgbMatch[4] === undefined ? 1 : Number(rgbMatch[4]),
  };
}

function toHex(color: ParsedColor): string {
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** 取色器只会给出不透明的十六进制，套回当前的透明度再写回配置。 */
function applyPickedColor(current: string, pickedHex: string): string {
  const picked = parseColor(pickedHex);
  if (!picked) {
    return current;
  }
  const alpha = parseColor(current)?.a ?? 1;
  if (alpha >= 1) {
    return toHex(picked);
  }
  return `rgba(${Math.round(picked.r)}, ${Math.round(picked.g)}, ${Math.round(
    picked.b
  )}, ${alpha})`;
}

/** <input type="color"> 只接受 #rrggbb，其它写法一律落到黑色。 */
function colorInputValue(value: string): string {
  const parsed = parseColor(value);
  return parsed ? toHex(parsed) : '#000000';
}

/** 棋盘格底板：半透明的颜色只有放在它上面才看得出 alpha。 */
const ALPHA_CHECKERBOARD = {
  backgroundImage:
    'linear-gradient(45deg, rgb(148 163 184 / 0.35) 25%, transparent 25%),' +
    'linear-gradient(-45deg, rgb(148 163 184 / 0.35) 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, rgb(148 163 184 / 0.35) 75%),' +
    'linear-gradient(-45deg, transparent 75%, rgb(148 163 184 / 0.35) 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
};

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
  const autoTranslateHosts = useAppConfigStore(
    state => state.autoTranslateHosts
  );
  const addAutoTranslateHost = useAppConfigStore(
    state => state.addAutoTranslateHost
  );
  const removeAutoTranslateHost = useAppConfigStore(
    state => state.removeAutoTranslateHost
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
  const [newAutoHost, setNewAutoHost] = useState('');
  const [autoHostError, setAutoHostError] = useState('');
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
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderType | null>(
    null
  );
  const [clearUsageDialogOpen, setClearUsageDialogOpen] = useState(false);
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [privacyBannerDismissed, setPrivacyBannerDismissed] = useState(false);
  // 只跟踪当前后端的连接状态：没有在用的后端就没有状态可言。
  const [providerHealth, setProviderHealth] = useState<
    'unknown' | 'healthy' | 'unhealthy'
  >('unknown');

  /**
   * The name of the service the user is actually pointed at.
   *
   * The badge used to read "OpenAI-compatible", which names the protocol
   * rather than the service. A user whose endpoint is MiniMax sees that name
   * on their bill, so that is what the badge has to say — otherwise the
   * settings page cannot answer the only question that matters here, which
   * is "which service is going to charge me".
   */
  const activeProviderLabel = useMemo(
    () =>
      getProviderLabel({
        provider,
        baseUrl: providers[provider]?.baseUrl ?? '',
      }),
    [provider, providers]
  );

  const usageSummary = useMemo(
    () => summarizeUsageForMonth(usageRecords),
    [usageRecords]
  );

  /**
   * providers 每敲一个键就会换一个新对象。用 ref 读最新值，探测才不会
   * 跟着输入一起触发 —— 否则在地址或密钥框里打字，每敲一个字就发一次
   * 网络请求。
   */
  const providersRef = useRef(providers);
  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  /**
   * 只探测当前正在用的那个后端。
   *
   * 原来每一轮把三个服务全查一遍：用户只会用一个，另外两个的探测是白跑
   * 的网络请求，还会让用户在自己根本没配的服务上看到"连接失败"。
   */
  const performHealthCheck = useCallback(async () => {
    const providerType = provider;
    try {
      const settings = providersRef.current[providerType];
      const instance = await createProvider(providerType, settings);
      const result = await instance.validateConfig();
      setProviderHealth(result.valid ? 'healthy' : 'unhealthy');
    } catch {
      // 轮询失败保持安静：这里只更新标题旁边那个小圆点，不弹错误提示。
      // 需要把错误说清楚的时候，用户可以手动点"测试配置"。
      setProviderHealth('unhealthy');
    }
  }, [provider]);

  // 切换后端后，上一个后端的状态不再代表当前后端。
  useEffect(() => {
    setProviderHealth('unknown');
  }, [provider]);

  useEffect(() => {
    // 初次检查 + 定时轮询。5 分钟一轮：60 秒一轮对三个后端来说是持续的
    // 网络流量，而现在只查一个，用户也察觉不到更慢的探测。
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      timer = setInterval(() => {
        void performHealthCheck();
      }, HEALTH_CHECK_INTERVAL_MS);
    };
    // A hidden tab does not need its backend probed. Pause the poll while
    // the page is in the background and resume when the user comes back.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
        void performHealthCheck();
      } else {
        stop();
      }
    };

    void performHealthCheck();
    if (document.visibilityState === 'visible') {
      start();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // performHealthCheck 只依赖 provider：切换后端时这个 effect 会重跑，
    // 于是新后端立刻被探一次。
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
        // Prefer a real endpoint probe. `validateConfig` can only inspect
        // strings for OpenAI-compatible providers, so the button used to
        // report "配置有效" for a wrong base URL or a revoked key; Ollama and
        // LM Studio already perform live checks inside validateConfig.
        const result = instance.testConnection
          ? await instance.testConnection()
          : await instance.validateConfig();
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

  /**
   * 清空翻译缓存。
   *
   * 缓存是"只进不出"的：用户改了目标语言或风格之后，旧译文还躺在缓存里，
   * "重新翻译"拿回来的还是旧译文。没有这个按钮，用户只能自己去扩展管理
   * 页面清掉整个扩展的数据。
   */
  const handleClearCache = useCallback(() => {
    useTranslationCacheStore.getState().clear();
    setClearCacheDialogOpen(false);
    setCacheCleared(true);
  }, []);

  const renderProviderCard = (providerType: ProviderType) => {
    const meta = PROVIDERS.find(item => item.type === providerType);
    if (!meta) {
      return null;
    }
    const settings = providers[providerType];
    const baseUrlSafety = evaluateBaseUrlSafety(settings.baseUrl);
    const result = testResults[providerType];
    const isActive = provider === providerType;
    // 只有正在用的后端才探测得到状态；没在用的后端没有状态可言，
    // 显示一个"连接失败"红点只会误导用户。
    const health = isActive ? providerHealth : 'unknown';

    // Only the active provider shows its full configuration. Three expanded
    // cards — each with a URL field, a model field, a key field and a test
    // button — made the page read as a wall of form controls, and the user
    // only ever edits the one they are actually using. The inactive ones
    // collapse to a single line that still shows what is configured.
    if (!isActive) {
      const configured = settings.model
        ? settings.model
        : settings.baseUrl
          ? settings.baseUrl
          : '未配置';
      return (
        <button
          key={providerType}
          type='button'
          onClick={() => handleProviderSwitch(providerType)}
          className='flex w-full items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
        >
          <span className='flex min-w-0 items-center gap-2'>
            {providerType === 'ollama' ? (
              <Server
                aria-hidden='true'
                className='h-4 w-4 shrink-0 text-slate-300'
              />
            ) : (
              <Sparkles
                aria-hidden='true'
                className='h-4 w-4 shrink-0 text-cyan-300'
              />
            )}
            <span className='truncate text-sm font-medium'>{meta.name}</span>
            <span className='truncate text-xs text-slate-400'>
              {configured}
            </span>
          </span>
          <span className='flex shrink-0 items-center gap-2'>
            {health !== 'unknown' && (
              <span
                className={`h-2 w-2 rounded-full ${
                  health === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
                title={health === 'healthy' ? '连接正常' : '连接异常'}
              />
            )}
            <span className='text-xs text-slate-400'>切换到此</span>
          </span>
        </button>
      );
    }

    return (
      <div
        key={providerType}
        className='rounded-xl border border-cyan-500/40 bg-cyan-500/[0.06] p-4'
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <div className='flex items-center gap-2'>
              <Check aria-hidden='true' className='h-4 w-4 text-cyan-300' />
              {providerType === 'ollama' ? (
                <Server aria-hidden='true' className='h-4 w-4 text-slate-300' />
              ) : (
                <Sparkles
                  aria-hidden='true'
                  className='h-4 w-4 text-cyan-300'
                />
              )}
              <h3 className='text-left text-sm font-semibold'>{meta.name}</h3>
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
              className='inline-flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200'
            >
              文档
              <ExternalLink className='h-3 w-3' />
            </a>
          </div>
        </div>

        <div className='mt-4 grid gap-3'>
          <div>
            <label
              htmlFor={`provider-${providerType}-base-url`}
              className='mb-1 block text-xs text-slate-400'
            >
              接口地址（Base URL）
            </label>
            <input
              id={`provider-${providerType}-base-url`}
              type='text'
              value={settings.baseUrl}
              onChange={event =>
                updateProviderSettings(providerType, {
                  baseUrl: event.target.value,
                })
              }
              aria-invalid={baseUrlSafety === 'invalid' ? true : undefined}
              className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
            />
            {baseUrlSafety === 'insecure' ? (
              // The API key is sent to this address as a Bearer header. Over
              // plaintext HTTP to a machine that is not the user's own, anyone
              // on the path can read it — so say so instead of quietly letting
              // the field look configured.
              <div className='mt-1 text-xs text-amber-300'>
                该地址使用明文 HTTP，API Key
                会随请求一起被路径上的任何一方读取。 除非是自建本地网关，请改用
                https。
              </div>
            ) : null}
            {baseUrlSafety === 'invalid' ? (
              <div className='mt-1 text-xs text-rose-300'>
                无法解析该地址，请使用 http(s):// 开头的 URL。
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor={`provider-${providerType}-model`}
              className='mb-1 block text-xs text-slate-400'
            >
              模型（Model）
            </label>
            <input
              id={`provider-${providerType}-model`}
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
          </div>

          {meta.requiresApiKey && (
            <div>
              <label
                htmlFor={`provider-${providerType}-api-key`}
                className='mb-1 block text-xs text-slate-400'
              >
                API Key（密钥）
              </label>
              <div className='relative'>
                <input
                  id={`provider-${providerType}-api-key`}
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
                  className='absolute right-3 top-2.5 text-slate-400 transition hover:text-slate-300'
                  aria-label={
                    showApiKey[providerType] ? '隐藏 API Key' : '显示 API Key'
                  }
                >
                  {showApiKey[providerType] ? (
                    <EyeOff aria-hidden='true' className='h-4 w-4' />
                  ) : (
                    <Eye aria-hidden='true' className='h-4 w-4' />
                  )}
                </button>
              </div>
            </div>
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
            <div className='flex items-center gap-2 text-xs text-slate-400'>
              <CheckCircle2
                aria-hidden='true'
                className='h-3.5 w-3.5 shrink-0 text-emerald-400'
              />
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
        {/*
          单列纵向分组。两栏网格把"设置"和"翻译后端"并排放，两列高度
          差一大截，右栏下面就是几百像素的空白；设置页本来也不需要并排
          比较，改成 max-w-2xl 的单列，内容从上到下一条线读下来。
        */}
        <div className='mx-auto max-w-2xl space-y-6'>
          <header className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <h1 className='text-2xl font-semibold'>漫画翻译助手 · 设置</h1>
              <p className='mt-2 text-sm text-slate-400'>
                可直接使用构建时预置的后端，也可以在这里填写自己的 API
                Key、地址与模型。
              </p>
            </div>
            <div className='flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5'>
              {provider === 'ollama' ? (
                <Server aria-hidden='true' className='h-4 w-4 text-slate-300' />
              ) : (
                <Sparkles
                  aria-hidden='true'
                  className='h-4 w-4 text-cyan-300'
                />
              )}
              <span className='text-sm font-medium text-cyan-100'>
                {activeProviderLabel}
              </span>
            </div>
          </header>

          {/* 隐私告知 banner：说明 API key 与图片数据流向，可关闭 */}
          {!privacyBannerDismissed && (
            <section className='flex items-start gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4'>
              <Info
                aria-hidden='true'
                className='mt-0.5 h-5 w-5 shrink-0 text-cyan-400'
              />
              <div className='flex-1'>
                <h2 className='text-sm font-semibold text-cyan-100'>
                  数据流向说明
                </h2>
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
                <ChevronDown aria-hidden='true' className='h-4 w-4' />
              </button>
            </section>
          )}

          {/* First-time onboarding is handled by the OnboardingApp modal at the
            top of this component, shown when onboardingCompleted === false.
            The old inline "开始使用" quick-pick panel has been removed because
            it duplicated the onboarding step 2 and conflicted with it. */}

          <section
            aria-labelledby='section-basics'
            className='rounded-xl border border-white/10 bg-white/[0.03] p-4'
          >
            <h2 id='section-basics' className='text-sm font-semibold'>
              基础行为
            </h2>

            <div className='mt-4 space-y-3'>
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

              <div className='rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
                <h3 className='text-sm font-medium'>自动翻译站点</h3>
                <div className='mt-1 text-xs text-slate-400'>
                  只有列表中的站点会在打开页面时自动翻译。其他站点需要你手动点一下按钮，
                  避免把不相关页面的图片发给模型并产生费用。
                </div>
                {autoTranslateHosts.length === 0 ? (
                  <div className='mt-3 rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-slate-400'>
                    列表为空，不会自动翻译任何站点。可在此添加，或在弹窗中一键添加当前站点。
                  </div>
                ) : (
                  <ul className='mt-3 space-y-2'>
                    {autoTranslateHosts.map(host => (
                      <li
                        key={host}
                        className='flex items-center justify-between rounded-lg border border-white/10 bg-slate-950 px-3 py-2'
                      >
                        <span className='font-mono text-xs text-slate-200'>
                          {host}
                        </span>
                        <button
                          type='button'
                          onClick={() => removeAutoTranslateHost(host)}
                          aria-label={`移除 ${host}`}
                          className='text-xs text-slate-400 transition hover:text-rose-300'
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className='mt-3 flex gap-2'
                  onSubmit={event => {
                    event.preventDefault();
                    if (!newAutoHost.trim()) return;
                    if (addAutoTranslateHost(newAutoHost)) {
                      setNewAutoHost('');
                      setAutoHostError('');
                    } else {
                      setAutoHostError(
                        '无法识别的主机名。请用 example.com 或 *.example.com；通配符需要完整域名（*.com 会被拒绝）。'
                      );
                    }
                  }}
                >
                  {/* 输入框原来只有 placeholder，读屏只会念出"编辑，纯文本"。
                      视觉标题已经是"自动翻译站点"，这里补一个同名标签，
                      名称和可见文字保持一致。 */}
                  <label htmlFor='auto-translate-host' className='sr-only'>
                    自动翻译站点
                  </label>
                  <input
                    id='auto-translate-host'
                    value={newAutoHost}
                    onChange={event => setNewAutoHost(event.target.value)}
                    placeholder='example.com 或 *.example.com'
                    autoComplete='off'
                    className='flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
                  />
                  <button
                    type='submit'
                    className='rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20'
                  >
                    添加
                  </button>
                </form>
                {autoHostError ? (
                  <div className='mt-2 text-xs text-rose-300'>
                    {autoHostError}
                  </div>
                ) : null}
                <div className='mt-2 text-xs text-slate-400'>
                  按主机名匹配；带端口的条目（如 localhost:8080）只匹配该端口。
                  manga.example.com 不会匹配 notmanga.example.com。
                </div>
              </div>

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
            </div>
          </section>

          <section
            aria-labelledby='section-target-language'
            className='rounded-xl border border-white/10 bg-white/[0.03] p-4'
          >
            <h2 id='section-target-language' className='text-sm font-semibold'>
              目标语言
            </h2>
            <label htmlFor='target-language' className='sr-only'>
              目标语言
            </label>
            <select
              id='target-language'
              value={targetLanguage}
              onChange={e => setTargetLanguage(e.target.value)}
              className='mt-3 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none'
            >
              {TARGET_LANGUAGES.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </section>

          <section
            aria-labelledby='section-translation-style'
            className='rounded-xl border border-white/10 bg-white/[0.03] p-4'
          >
            <h2
              id='section-translation-style'
              className='text-sm font-semibold'
            >
              翻译风格
            </h2>
            <label htmlFor='translation-style' className='sr-only'>
              翻译风格
            </label>
            <select
              id='translation-style'
              value={translationStylePreset}
              onChange={e =>
                setTranslationStylePreset(
                  e.target.value as
                    | 'faithful'
                    | 'natural-zh'
                    | 'concise-bubble'
                    | 'preserve-original'
                )
              }
              className='mt-3 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none'
            >
              <option value='natural-zh'>自然中文</option>
              <option value='faithful'>尽量忠实</option>
              <option value='concise-bubble'>气泡精简</option>
              {/* The prompt for this preset already exists and is tuned
                  for Japanese learners — it was simply never offered in
                  the UI, so the capability was unreachable. */}
              <option value='preserve-original'>保留原味（日语学习）</option>
            </select>
          </section>

          {/* 覆盖层样式折叠面板 */}
          <section
            aria-labelledby='section-overlay-style'
            className='rounded-xl border border-white/10 bg-white/[0.03] p-4'
          >
            <h2 id='section-overlay-style' className='text-sm font-semibold'>
              <button
                type='button'
                aria-expanded={overlayStyleExpanded}
                aria-controls='overlay-style-panel'
                onClick={() => setOverlayStyleExpanded(!overlayStyleExpanded)}
                className='flex w-full items-center justify-between gap-3 text-left transition hover:bg-white/[0.02]'
              >
                <span>
                  <span className='block text-sm font-medium'>覆盖层样式</span>
                  {/* 副标题只是重复面板里的内容，不要混进按钮（和标题）的
                      可访问名称里，否则读屏会念成"覆盖层样式背景色、文字颜色、
                      字号等"。 */}
                  <span
                    aria-hidden='true'
                    className='block text-xs text-slate-400'
                  >
                    背景色、文字颜色、字号等
                  </span>
                </span>
                <ChevronDown
                  aria-hidden='true'
                  className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
                    overlayStyleExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </h2>

            {/*
              折叠时整个面板不渲染。只用 max-h-0 + opacity-0 隐藏的话，里面
              的输入框照样能被 Tab 选中、也能被读屏念出来 —— 用户按 Tab 会
              走进一片看不见的地方。
            */}
            <div id='overlay-style-panel' hidden={!overlayStyleExpanded}>
              {overlayStyleExpanded ? (
                <div className='mt-3 space-y-3 border-t border-white/10 pt-3'>
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

                  <div>
                    <label
                      htmlFor='overlay-background-color'
                      className='mb-1.5 block text-xs text-slate-400'
                    >
                      背景色
                    </label>
                    <div className='flex items-center gap-2'>
                      {/*
                        真实的颜色预览：直接按存储值渲染，透明度看得见。
                        原来的 <input type="color"> 只能显示不透明颜色，rgba
                        会被硬编码成 #f0f0eb 顶替，用户看到的是假颜色。
                      */}
                      <div className='relative h-8 w-12 shrink-0 overflow-hidden rounded border border-white/10'>
                        <span
                          aria-hidden='true'
                          className='absolute inset-0'
                          style={ALPHA_CHECKERBOARD}
                        />
                        <span
                          aria-hidden='true'
                          className='absolute inset-0'
                          style={{ background: overlayStyle.backgroundColor }}
                        />
                        <input
                          type='color'
                          aria-label='背景色选择器'
                          value={colorInputValue(overlayStyle.backgroundColor)}
                          onChange={e =>
                            setOverlayStyle({
                              backgroundColor: applyPickedColor(
                                overlayStyle.backgroundColor,
                                e.target.value
                              ),
                            })
                          }
                          className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
                        />
                      </div>
                      <input
                        id='overlay-background-color'
                        type='text'
                        value={overlayStyle.backgroundColor}
                        onChange={e =>
                          setOverlayStyle({ backgroundColor: e.target.value })
                        }
                        className='flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm outline-none'
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor='overlay-text-color'
                      className='mb-1.5 block text-xs text-slate-400'
                    >
                      文字颜色
                    </label>
                    <div className='flex items-center gap-2'>
                      <div className='relative h-8 w-12 shrink-0 overflow-hidden rounded border border-white/10'>
                        <span
                          aria-hidden='true'
                          className='absolute inset-0'
                          style={ALPHA_CHECKERBOARD}
                        />
                        <span
                          aria-hidden='true'
                          className='absolute inset-0'
                          style={{ background: overlayStyle.textColor }}
                        />
                        <input
                          type='color'
                          aria-label='文字颜色选择器'
                          value={colorInputValue(overlayStyle.textColor)}
                          onChange={e =>
                            setOverlayStyle({
                              textColor: applyPickedColor(
                                overlayStyle.textColor,
                                e.target.value
                              ),
                            })
                          }
                          className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
                        />
                      </div>
                      <input
                        id='overlay-text-color'
                        type='text'
                        value={overlayStyle.textColor}
                        onChange={e =>
                          setOverlayStyle({ textColor: e.target.value })
                        }
                        className='flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm outline-none'
                      />
                    </div>
                  </div>

                  <div>
                    <div className='mb-3 text-xs text-slate-400'>字号范围</div>
                    <div className='flex items-center gap-4'>
                      <span
                        aria-hidden='true'
                        className='w-8 text-xs text-slate-400'
                      >
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
                        // Radix 默认给手柄的 aria-label 是英文的
                        // "Minimum" / "Maximum"，这里换成中文，并附上
                        // 读得出来的当前值。
                        thumbProps={[
                          {
                            'aria-label': '字号下限',
                            'aria-valuetext': `${overlayStyle.minFontSize} 号字`,
                          },
                          {
                            'aria-label': '字号上限',
                            'aria-valuetext': `${overlayStyle.maxFontSize} 号字`,
                          },
                        ]}
                      />
                      <span
                        aria-hidden='true'
                        className='w-8 text-right text-xs text-slate-400'
                      >
                        {overlayStyle.maxFontSize}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section
            aria-labelledby='section-providers'
            className='rounded-xl border border-white/10 bg-white/[0.03] p-4'
          >
            <h2 id='section-providers' className='text-sm font-semibold'>
              翻译后端
            </h2>
            <div className='mt-4 space-y-3'>
              {PROVIDERS.map(item => renderProviderCard(item.type))}
            </div>
          </section>

          <section
            aria-labelledby='section-usage'
            className='rounded-xl border border-white/10 bg-white/[0.03] p-4'
          >
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-2'>
                <BarChart3
                  aria-hidden='true'
                  className='h-4 w-4 text-cyan-300'
                />
                <div>
                  <h2 id='section-usage' className='text-sm font-semibold'>
                    本月用量
                  </h2>
                  <p className='text-xs text-slate-400'>
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
                  <div className='text-xs text-slate-400'>{label}</div>
                  <div className='mt-1 text-lg font-semibold text-slate-100'>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 高级：默认收起。放的是"平时别动"的操作。 */}
          <section
            aria-labelledby='section-advanced'
            className='rounded-xl border border-white/10 bg-white/[0.03] p-4'
          >
            <h2 id='section-advanced' className='text-sm font-semibold'>
              <button
                type='button'
                aria-expanded={advancedExpanded}
                aria-controls='advanced-panel'
                onClick={() => setAdvancedExpanded(!advancedExpanded)}
                className='flex w-full items-center justify-between gap-3 text-left transition hover:bg-white/[0.02]'
              >
                <span>
                  <span className='block text-sm font-medium'>高级</span>
                  <span
                    aria-hidden='true'
                    className='block text-xs text-slate-400'
                  >
                    缓存维护，一般不用动
                  </span>
                </span>
                <ChevronDown
                  aria-hidden='true'
                  className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
                    advancedExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </h2>

            <div id='advanced-panel' hidden={!advancedExpanded}>
              {advancedExpanded ? (
                <div className='mt-3 space-y-3 border-t border-white/10 pt-3'>
                  <div className='rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3'>
                    <div className='text-sm font-medium'>翻译缓存</div>
                    <p className='mt-1 text-xs text-slate-400'>
                      翻译过的漫画会缓存在本机，重复打开同一页不会再次调用模型。
                      清空后，这些译文会被删除。
                    </p>
                    <p className='mt-2 text-xs text-amber-300'>
                      清空后再次翻译会重新调用你配置的模型服务，并按该服务的计费规则产生费用。
                    </p>
                    <button
                      type='button'
                      onClick={() => setClearCacheDialogOpen(true)}
                      className='mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-500/20'
                    >
                      清空翻译缓存
                    </button>
                    {cacheCleared ? (
                      <p className='mt-2 text-xs text-emerald-300'>
                        翻译缓存已清空。
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
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
          open={clearCacheDialogOpen}
          title='清空翻译缓存？'
          description='本机缓存的所有译文都会被删除，无法恢复。之后再次翻译同一张漫画会重新调用你配置的模型服务，并按该服务的计费规则产生费用。'
          confirmLabel='清空缓存'
          cancelLabel='取消'
          destructive
          onConfirm={handleClearCache}
          onCancel={() => setClearCacheDialogOpen(false)}
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
