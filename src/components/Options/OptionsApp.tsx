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
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  RefreshCw,
  Check,
  Server,
  Sparkles,
  Info,
  X,
} from 'lucide-react';

import { createProvider } from '@/providers';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import { useAppConfigStore } from '@/stores/config-v2';
import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';
import {
  getDiagnosticsServiceLabel,
  getProviderLabel,
} from '@/utils/provider-label';
import type { ProviderType } from '@/providers/base';
import { evaluateBaseUrlSafety } from '@/shared/app-config';
import {
  PROVIDER_PRESETS,
  findMatchingPreset,
} from '@/shared/provider-presets';
import { TARGET_LANGUAGES } from '@/shared/target-languages';
import {
  buildDiagnosticsBundle,
  formatDiagnosticsBundle,
} from '@/shared/diagnostics';
import { ENV_CONFIG } from '@/shared/env-config';
import { ENV_CREDENTIALS } from '@/shared/env-credentials';
import {
  configuredBackends,
  describeBackendAvailability,
} from '@/shared/env-backends';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { OnboardingApp } from '@/components/Onboarding/OnboardingApp';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { describeAutoTranslateCost } from '@/components/Popup/popup-state';
import { describeFeeShort } from '@/shared/cost-wording';
import { TRANSLATION_STYLE_DESCRIPTIONS } from '@/utils/translation-style';

interface TestResult {
  success: boolean;
  message: string;
}

/**
 * The image resolutions the user can pick.
 *
 * `maxImageSize` decides the short edge of the image that is actually sent
 * to the vision model. It is the single biggest lever on both quality and
 * cost: a 1024px page and a 2048px page differ by roughly four times the
 * pixels, and the token bill follows.
 *
 * The values below are the ones that make a visible difference. Anything in
 * between is noise to a user choosing between "reads well" and "costs less".
 */
const IMAGE_SIZE_OPTIONS = [
  { value: 1024, label: '标准 · 1024（更快、更省）' },
  { value: 1536, label: '高清 · 1536（推荐）' },
  { value: 2048, label: '最高 · 2048（最准、最贵）' },
];

const IMAGE_SIZE_NOTES: Record<number, string> = {
  1024: '标准档：大多数漫画页都能读清，速度最快，费用最低。小字号或密集气泡可能认漏。',
  1536: '高清档：字越小、框越密越准确，是质量与费用之间比较稳的选择。',
  2048: '最高档：几乎不认漏字，但图片大很多，一次翻译的费用可能翻两三倍。长条条漫慎用。',
};

const IMAGE_SIZE_NOTES_DEFAULT = '分辨率越高越准，费用也越高。';

const PARALLEL_LIMIT_OPTIONS = [
  { value: 1, label: '1 张 · 最稳' },
  { value: 3, label: '3 张 · 默认' },
  { value: 5, label: '5 张 · 更快' },
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
 *
 * 15 分钟是重新算过的。探测不再是"看一眼字符串"，而是真的打一次接口：
 * 网关不提供 /models 的时候，它还会真的生成一个词（一个 token 的费用）。
 * 圆点是环境信息，不是监控屏 —— 15 分钟足够看出后端挂了，而同样的
 * 时间窗口里，用户的账单最多被多戳一次。
 */
const HEALTH_CHECK_INTERVAL_MS = 15 * 60 * 1000;

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
  const maxImageSize = useAppConfigStore(state => state.maxImageSize);
  const setMaxImageSize = useAppConfigStore(state => state.setMaxImageSize);
  const parallelLimit = useAppConfigStore(state => state.parallelLimit);
  const setParallelLimit = useAppConfigStore(state => state.setParallelLimit);
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
  const [diagnosticsCopied, setDiagnosticsCopied] = useState<
    'idle' | 'copied' | 'failed'
  >('idle');
  const [pendingProvider, setPendingProvider] = useState<ProviderType | null>(
    null
  );
  const [clearUsageDialogOpen, setClearUsageDialogOpen] = useState(false);
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [privacyBannerDismissed, setPrivacyBannerDismissed] = useState(false);
  /**
   * Whether the wizard is being shown again on purpose.
   *
   * The wizard only appears on its own while `onboardingCompleted` is false,
   * so a user who dismissed it by accident could never read it again — and
   * the data-flow disclosure lives in it. `forceOpen` keeps the dialog up no
   * matter what the flag says, so this state has to be the thing that takes
   * it back down.
   */
  const [reopenOnboarding, setReopenOnboarding] = useState(false);
  // 只跟踪当前后端的连接状态：没有在用的后端就没有状态可言。
  const [providerHealth, setProviderHealth] = useState<
    'unknown' | 'healthy' | 'unhealthy'
  >('unknown');
  /**
   * 上一次探测失败的原因。
   *
   * 一个红点只说"有问题"，不说是谁的问题。把服务商返回的那句话记下来，
   * 用户才能自己判断是 Key 过期了还是地址写错了 —— 而这正是这个扩展
   * 一直避免让用户猜的那件事。
   */
  const [providerHealthReason, setProviderHealthReason] = useState<
    string | null
  >(null);
  /**
   * 自动探测是不是还开着。
   *
   * 探一次是要花钱的（网关不提供 /models 时会真的生成一个词），而一个
   * 已经坏掉的配置不会自己变好 —— 它要用户去改 Key 或地址。继续每
   * 15 分钟替用户确认一件他还没改的事，是替用户花钱。所以失败一次就把
   * 自动探测关掉，等用户点「测试配置」再打开。
   */
  const [autoHealthCheckPaused, setAutoHealthCheckPaused] = useState(false);
  /**
   * 手动点「测试配置」的结果要不要算作这一轮的探测。
   *
   * 手动测完如果立刻又让轮询探一次，用户点一下就变成两次请求 —— 一次
   * 是他点的，一次是他没点的。这个标记让紧接着的那一次自动探测让位给
   * 用户自己点的这一次。
   */
  const skipNextAutoProbeRef = useRef(false);

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

  /**
   * The same service, as the diagnostics bundle is allowed to name it.
   *
   * The badge above may say `llm.internal.corp` — that is useful, because it
   * tells the user which machine receives their images. The bundle may not:
   * it is pasted into public issue trackers, and an internal hostname
   * identifies the reporter's employer. An endpoint we do not recognise is
   * therefore described ("OpenAI 兼容（自建端点）") instead of named.
   */
  const diagnosticsServiceLabel = useMemo(
    () =>
      getDiagnosticsServiceLabel({
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
   * The version the user is actually running.
   *
   * It was read from the manifest rather than from `package.json`, because
   * the manifest is what Chrome installed — the two can disagree, and the
   * manifest is the one that matters when someone reports a bug.
   */
  const extensionVersion = useMemo(() => {
    try {
      return chrome?.runtime?.getManifest?.().version ?? '未知';
    } catch {
      return '未知';
    }
  }, []);

  /**
   * Copy a support bundle to the clipboard.
   *
   * The bundle is built locally and never sent anywhere; the user decides
   * whether to paste it into an issue.
   */
  const handleCopyDiagnostics = useCallback(async () => {
    const activeSettings = providers[provider];
    const bundle = buildDiagnosticsBundle({
      version: extensionVersion,
      provider,
      providerLabel: diagnosticsServiceLabel,
      model: activeSettings?.model ?? '',
      targetLanguage,
      translationStylePreset,
      hasApiKey: Boolean(activeSettings?.apiKey),
      maxImageSize,
      parallelLimit,
      cacheEnabled,
      usage: {
        translations: usageSummary.translations,
        billableCalls: usageSummary.billableCalls,
        tokens: usageSummary.tokens,
        cacheHitRate: usageSummary.cacheHitRate,
      },
    });
    const text = formatDiagnosticsBundle(bundle);
    try {
      await navigator.clipboard.writeText(text);
      setDiagnosticsCopied('copied');
    } catch {
      // Clipboard access can be refused; the user still needs the text.
      setDiagnosticsCopied('failed');
    }
  }, [
    cacheEnabled,
    extensionVersion,
    maxImageSize,
    parallelLimit,
    provider,
    diagnosticsServiceLabel,
    providers,
    targetLanguage,
    translationStylePreset,
    usageSummary,
  ]);

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
      // `validateConfig()` 对 OpenAI 兼容后端只能看字符串：Key 被吊销、
      // 地址写错、模型名不存在，它一律回答"配置有效"。那个绿点说的从来
      // 不是"连得上"，而是"这串字符长得像 Key"——而它长得像不像，和
      // 服务商认不认它，是两回事。
      //
      // 所以这里用真正探一次接口的 `testConnection()`（它内部先跑一遍
      // validateConfig，再去打 /models）。Ollama 没有这个方法，它的
      // validateConfig 本身就是一次真实的本地探测。
      const result = instance.testConnection
        ? await instance.testConnection({ allowBillableProbe: false })
        : await instance.validateConfig();
      setProviderHealth(result.valid ? 'healthy' : 'unhealthy');
      setProviderHealthReason(result.valid ? null : result.message);
      // 通了就继续轮询；不通就停下来，把下一次请求交给用户自己点。
      setAutoHealthCheckPaused(!result.valid);
    } catch (error) {
      // 轮询失败保持安静：这里只更新标题旁边那个小圆点，不弹错误提示。
      // 需要把错误说清楚的时候，用户可以手动点"测试配置"。
      setProviderHealth('unhealthy');
      setProviderHealthReason(
        error instanceof Error ? error.message : '连接失败'
      );
      setAutoHealthCheckPaused(true);
    }
  }, [provider]);

  // 切换后端后，上一个后端的状态不再代表当前后端。
  useEffect(() => {
    setProviderHealth('unknown');
    setProviderHealthReason(null);
    // 换了后端就重新允许自动探测：上一个后端坏掉，不代表新后端也坏。
    setAutoHealthCheckPaused(false);
  }, [provider]);

  useEffect(() => {
    // 自动探测已暂停：不再发任何请求，等用户点「测试配置」。
    if (autoHealthCheckPaused) {
      return;
    }
    // 初次检查 + 定时轮询。15 分钟一轮：探测现在是真的打接口，圆点是
    // 环境信息不是监控屏；而标签页切到后台时根本不探。
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

    // 紧接着的那一次自动探测让位给用户刚点的「测试配置」——用户点一下
    // 不该变成两次请求。
    if (skipNextAutoProbeRef.current) {
      skipNextAutoProbeRef.current = false;
    } else {
      void performHealthCheck();
    }
    if (document.visibilityState === 'visible') {
      start();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // performHealthCheck 只依赖 provider：切换后端时这个 effect 会重跑，
    // 于是新后端立刻被探一次。autoHealthCheckPaused 决定还探不探。
  }, [performHealthCheck, autoHealthCheckPaused]);

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

  /**
   * 把关掉的那段说明再调出来。
   *
   * 关掉是永久的：存储里那个标记一旦写下，用户就再也看不到这段说明了
   * —— 而这是整个产品里唯一明说"图片会直接发给你配置的服务商"的地方。
   * 一个能找回的关闭才是可以放心按的关闭。
   */
  const restorePrivacyBanner = useCallback(() => {
    setPrivacyBannerDismissed(false);
    void chrome.storage.local
      .remove('manga-translator-privacy-banner-dismissed')
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
        //
        // This one may spend a request: the user pressed the button, and the
        // line under it says a request is sent. The background poll does
        // not have that permission — see `performHealthCheck`.
        const result = instance.testConnection
          ? await instance.testConnection({ allowBillableProbe: true })
          : await instance.validateConfig();
        setTestResults(current => ({
          ...current,
          [providerType]: {
            success: result.valid,
            message: result.message,
          },
        }));
        if (providerType === provider) {
          // 手动探测比轮询新：圆点要跟着它走。
          setProviderHealth(result.valid ? 'healthy' : 'unhealthy');
          setProviderHealthReason(result.valid ? null : result.message);
          // 通了就重新打开自动探测（用户不用等下一轮），不通就继续关着。
          skipNextAutoProbeRef.current = result.valid;
          setAutoHealthCheckPaused(!result.valid);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '连接测试失败';
        setTestResults(current => ({
          ...current,
          [providerType]: {
            success: false,
            message,
          },
        }));
        if (providerType === provider) {
          setProviderHealth('unhealthy');
          setProviderHealthReason(message);
          setAutoHealthCheckPaused(true);
        }
      } finally {
        setTestingProvider(null);
      }
    },
    [providers, provider]
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
          className='flex w-full items-center justify-between gap-4 rounded-xl border border-white/20 bg-slate-950 px-4 py-3 text-left transition hover:border-white/30 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
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
          {/*
            The right-hand badges must not wrap their own text. Chinese
            breaks between any two characters, so a badge that is one
            character too narrow stops being a label and becomes a column
            of single characters ("当 前 使 用 中"). The row is nowrap; the
            row as a whole may still drop to its own line when the card
            gets narrow.
          */}
          <span className='flex shrink-0 items-center gap-2 whitespace-nowrap'>
            {/*
              A coloured dot on its own is not a label: `title` is never read
              out by a screen reader and never seen by a touch user. The word
              is what actually carries the meaning.
            */}
            {health !== 'unknown' && (
              <span
                className={`inline-flex items-center gap-1 text-xs ${
                  health === 'healthy' ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                <span
                  aria-hidden='true'
                  className={`h-2 w-2 rounded-full ${
                    health === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {health === 'healthy' ? '连接正常' : '连接异常'}
              </span>
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
        <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
          <div className='min-w-[12rem] flex-1'>
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
          {/*
            The badges stay on one line each and the row wraps as a whole.
            A badge that breaks between characters reads as a broken layout,
            not as a label.
          */}
          <div className='flex flex-wrap items-center gap-2'>
            <span
              className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${
                provider === providerType
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                  : 'border-white/20 text-slate-400'
              }`}
            >
              {provider === providerType ? '当前使用中' : '点击切换'}
            </span>
            {health !== 'unknown' && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs ${
                  health === 'healthy' ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                <span
                  aria-hidden='true'
                  className={`h-2 w-2 rounded-full ${
                    health === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {health === 'healthy' ? '连接正常' : '连接异常'}
              </span>
            )}
            <a
              href={meta.helpUrl}
              target='_blank'
              rel='noreferrer'
              className='inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-slate-400 transition hover:text-slate-200'
            >
              文档
              <ExternalLink className='h-3 w-3' />
            </a>
          </div>
        </div>

        {/*
          为什么连不上。

          一个红点只说"有问题"，不说是谁的问题。服务商返回的那句话
          （Key 被拒、地址不通、模型名不存在）才是用户能行动的东西，
          所以它得在圆点旁边，而不是藏在开发者控制台里。
        */}
        {health === 'unhealthy' && (
          <div className='mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs'>
            {!result && providerHealthReason ? (
              <p className='text-amber-200'>{providerHealthReason}</p>
            ) : null}
            <p className='text-amber-300'>
              自动探测已暂停，避免反复向连不上的地址发请求。改好配置后点「测试配置」重试。
            </p>
          </div>
        )}

        <div className='mt-4 grid gap-3'>
          {/*
            The presets. A new user's first obstacle is not the API key, it
            is that "base URL" and "model" are two things they have to know
            before the extension does anything at all — and a wrong model
            name fails at the first request with an error that says nothing
            useful. These fill in the endpoint and the model; the key is
            still the user's to paste.
          */}
          {providerType === 'openai-compatible' && (
            <div>
              <div className='mb-1.5 text-xs text-slate-400'>
                快速选择服务商（点一下填好地址与模型，Key 仍需自己填）
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                {PROVIDER_PRESETS.map(preset => {
                  const selected =
                    findMatchingPreset({
                      baseUrl: settings.baseUrl,
                      model: settings.model,
                    })?.id === preset.id;
                  return (
                    <div
                      key={preset.id}
                      className={`rounded-lg border transition ${
                        selected
                          ? 'border-cyan-500/50 bg-cyan-500/10'
                          : 'border-white/20 bg-slate-950 hover:bg-slate-900'
                      }`}
                    >
                      <button
                        type='button'
                        aria-pressed={selected}
                        onClick={() => {
                          updateProviderSettings('openai-compatible', {
                            baseUrl: preset.baseUrl,
                            model: preset.model,
                          });
                          setShowApiKey(current => ({
                            ...current,
                            'openai-compatible': false,
                          }));
                        }}
                        className='w-full rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
                      >
                        <div className='flex items-center justify-between gap-2'>
                          <span
                            className={`text-sm font-medium ${
                              selected ? 'text-cyan-100' : 'text-slate-200'
                            }`}
                          >
                            {preset.label}
                          </span>
                          {selected ? (
                            <Check
                              aria-hidden='true'
                              className='h-3.5 w-3.5 shrink-0 text-cyan-300'
                            />
                          ) : null}
                        </div>
                        <div className='mt-0.5 text-xs leading-snug text-slate-400'>
                          {preset.note}
                        </div>
                      </button>
                      {/*
                        预设填好了地址和模型，剩下的那一步——拿 Key——用户
                        还是得自己去那个服务的主页。链接直接指到取 Key 的
                        页面，而不是只给一个服务商名字让人自己搜。
                      */}
                      <div className='px-3 pb-2'>
                        <a
                          href={preset.keyUrl}
                          target='_blank'
                          rel='noreferrer'
                          className='inline-flex items-center gap-1 text-xs text-cyan-300 transition hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
                        >
                          获取 API Key
                          <ExternalLink className='h-3 w-3' />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor={`provider-${providerType}-base-url`}
              className='mb-1 block text-xs text-slate-400'
            >
              接口地址（Base URL）
            </label>
            {/*
             * The border is the only thing that says "this is a control".
             * `border-white/20` over this page's slate-950 is 1.7:1 — the
             * field you paste your API key into has no visible edge.
             * WCAG 1.4.11 wants 3:1, and slate-500 (4.2:1) is the lightest
             * shade that gets there. The popup's select was fixed for the
             * same reason; this page had ten controls that were not.
             */}
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
              className='w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
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
              className='w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
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
                  className='w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 pr-10 text-sm outline-none focus:border-cyan-500/60'
                />
                <button
                  type='button'
                  onClick={() =>
                    setShowApiKey(current => ({
                      ...current,
                      [providerType]: !current[providerType],
                    }))
                  }
                  // 16×16 的图标不是 24×24 的点击目标（WCAG 2.5.8 AA）。
                  // 给按钮加内边距把可点区域撑到 28×28，再用 right/top
                  // 把图标放回原来的位置 —— 看得见的图标一点没动。
                  className='absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 transition hover:text-slate-300'
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
            ENV_CREDENTIALS.opencode.apiKey && (
              <button
                type='button'
                onClick={() =>
                  updateProviderSettings('openai-compatible', {
                    apiKey: ENV_CREDENTIALS.opencode.apiKey,
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
            className='inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-sm transition hover:bg-slate-900 disabled:opacity-40'
          >
            {testingProvider === providerType ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <RefreshCw className='h-4 w-4' />
            )}
            测试配置
          </button>
          {/*
            The button is not free. It always sends a request to the
            provider, and for an OpenAI-compatible endpoint whose gateway
            does not expose `/models` it falls back to a real completion —
            one word, but a billed one. The rest of this product is careful
            to say what a click will cost; this button was the one place
            that did not.
          */}
          <p className='text-xs text-slate-400'>
            测试配置会向服务商发一次请求；网关不提供 /models
            时会真的生成一个词，可能产生极少量费用。
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      <OnboardingApp
        forceOpen={reopenOnboarding}
        onClose={() => {
          setReopenOnboarding(false);
          /*
           * 向导最后一步让读者"去下面的表单里填 API Key"，而「翻译后端」
           * 是设置页的第六个分组，中间隔着五组与技术有关的设置 —— 关掉
           * 弹窗后读者落在页面顶部，屏幕上没有任何东西指向他要找的那一栏。
           *
           * 只有"一个后端都还没配好"时才替他滚过去：只是想再读一遍引导
           * 的人，不该被夺走滚动位置。
           */
          if (!useAppConfigStore.getState().isProviderConfigured()) {
            requestAnimationFrame(() => {
              document
                .getElementById('section-providers')
                ?.scrollIntoView?.({ block: 'start' });
            });
          }
        }}
      />
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
                {describeBackendAvailability(configuredBackends().length)}
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <button
                type='button'
                onClick={() => setReopenOnboarding(true)}
                className='whitespace-nowrap rounded-full border border-white/20 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
              >
                重新查看引导
              </button>
              <div className='flex items-center gap-1.5 whitespace-nowrap rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5'>
                {provider === 'ollama' ? (
                  <Server
                    aria-hidden='true'
                    className='h-4 w-4 text-slate-300'
                  />
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
                {/*
                  一个向下的箭头是"折叠"，不是一个"关闭"。这段说明是整个
                  产品里唯一写着"图片会离开这台机器"的地方，叉号说的是
                  "我知道并且我先关掉"，箭头说的是"下面还有内容"。
                */}
                <X aria-hidden='true' className='h-4 w-4' />
              </button>
            </section>
          )}

          {/* First-time onboarding is handled by the OnboardingApp modal at the
            top of this component, shown when onboardingCompleted === false.
            The old inline "开始使用" quick-pick panel has been removed because
            it duplicated the onboarding step 2 and conflicted with it. */}

          <section
            aria-labelledby='section-basics'
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
          >
            <h2 id='section-basics' className='text-sm font-semibold'>
              基础行为
            </h2>

            <div className='mt-4 space-y-3'>
              <label className='flex items-center justify-between rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
                <div>
                  <div className='text-sm font-medium'>启用扩展</div>
                  <div className='text-xs text-slate-400'>
                    关闭后不会请求任何模型，弹窗里的「翻译」也会停用
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  aria-label='启用扩展'
                />
              </label>

              <label className='flex items-center justify-between rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
                <div>
                  <div className='text-sm font-medium'>自动续翻</div>
                  <div className='text-xs text-slate-400'>
                    页面内后续图片出现时自动继续翻译（
                    {describeFeeShort(provider)}）。默认开启：
                    一条条漫往下滚就是几十页，关掉它就不会再自动翻后面加载出来的图——但已加载的图在点「翻译当前页面」时仍会整页翻完。
                  </div>
                </div>
                <Switch
                  checked={autoContinueEnabled}
                  onCheckedChange={setAutoContinueEnabled}
                  aria-label='自动续翻'
                />
              </label>

              <div className='rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
                <h3 className='text-sm font-medium'>自动翻译站点</h3>
                <div className='mt-1 text-xs text-slate-400'>
                  只有列表中的站点会在打开页面时自动翻译。其他站点需要你手动点一下按钮。
                  但只要这一页开始翻译了，本页后续加载出来的图片会自动接着翻
                  （见上方「自动续翻」），同样{describeFeeShort(provider)}。
                </div>
                {autoTranslateHosts.length === 0 ? (
                  <div className='mt-3 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-slate-400'>
                    列表为空，不会自动翻译任何站点。可在此添加，或在弹窗中一键添加当前站点。
                  </div>
                ) : (
                  <ul className='mt-3 space-y-2'>
                    {autoTranslateHosts.map(host => (
                      <li
                        key={host}
                        className='flex items-center justify-between rounded-lg border border-white/20 bg-slate-950 px-3 py-2'
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
                {/*
                  这条提示以前只挂在"不在列表里"的那句话上，于是真正会自己
                  花钱的那一类——名单里的站点——反而没有警告。它常驻在列表
                  旁边：只要名单不是空的，它就在。
                */}
                <div className='mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100'>
                  <div className='font-medium'>名单里的站点会自己花钱</div>
                  <div className='mt-1'>
                    {describeAutoTranslateCost(provider)}
                    ——名单里的站点，每次打开它的
                    任何页面都会自动翻译整页图片。通配符 *.example.com 会匹配
                    该域名下的所有子域名（a.example.com、b.example.com 都算），
                    等于一次授权、一整片站点。
                  </div>
                </div>
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
                    className='flex-1 rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
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

              {/*
                右键菜单是第二个入口，以前界面上一个字都没有：用户右键看到
                "翻译当前页面"，不知道它和弹窗里的按钮是不是一回事，也
                不知道它同样要花钱。
              */}
              <p className='text-xs leading-relaxed text-slate-400'>
                在漫画页上右键也有两个入口：「翻译当前页面」和「翻译这张图片」。
                它们和弹窗里的按钮一样会调用模型，{describeFeeShort(provider)}。
              </p>

              <label className='flex items-center justify-between rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
                <div>
                  <div className='text-sm font-medium'>缓存结果</div>
                  <div className='text-xs text-slate-400'>
                    减少重复图片的重复请求。关掉之后，同一页每次打开都会重新
                    调用模型服务（{describeFeeShort(provider)}）。
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
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
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
              className='mt-3 w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm outline-none'
            >
              {TARGET_LANGUAGES.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            {/*
              改目标语言会让已经缓存的译文失效。
              缓存的键里带着目标语言（`translator.ts:buildCacheKey`），所以换
              语言之后，同一张图会被当成没翻过，重新请求一次。原来这一条只
              写在「图片分辨率上限」下面，而换目标语言恰恰是读者翻完第一章
              最想做的事 —— 一次悄无声息的全页重新计费。
            */}
            <p className='mt-3 text-xs leading-relaxed text-amber-300/80'>
              改目标语言会让已经缓存的译文失效——同一张图会被重新请求一次 （
              {describeFeeShort(provider)}
              ）。想省钱就翻之前先定好语言。
            </p>
          </section>

          <section
            aria-labelledby='section-quality'
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
          >
            <h2 id='section-quality' className='text-sm font-semibold'>
              画质与并发
            </h2>
            <p className='mt-1 text-xs leading-relaxed text-slate-400'>
              这两项直接决定一次翻译的费用与耗时。分辨率越高，识别越准，
              但送出的图片也越大、Token 越多。
            </p>

            <div className='mt-4 space-y-3'>
              <label className='block'>
                <span className='mb-1.5 block text-xs text-slate-400'>
                  图片分辨率上限（短边像素）
                </span>
                <select
                  value={String(maxImageSize)}
                  onChange={e => setMaxImageSize(Number(e.target.value))}
                  className='w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
                >
                  {IMAGE_SIZE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className='text-xs leading-relaxed text-slate-400'>
                {IMAGE_SIZE_NOTES[maxImageSize] ?? IMAGE_SIZE_NOTES_DEFAULT}
              </p>
              <p className='text-xs leading-relaxed text-amber-300/80'>
                改分辨率会让已经缓存的译文失效——下次再翻同一张图会重新请求
                一次（{describeFeeShort(provider)}
                ）。想省钱就翻之前先定好分辨率。
              </p>

              <label className='block'>
                <span className='mb-1.5 block text-xs text-slate-400'>
                  同时翻译的图片数
                </span>
                <select
                  value={String(parallelLimit)}
                  onChange={e => setParallelLimit(Number(e.target.value))}
                  className='w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500/60'
                >
                  {PARALLEL_LIMIT_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className='text-xs leading-relaxed text-slate-400'>
                并发越高，整章翻完越快；并发越高也越容易触发服务商的限流。
                网速或接口不稳时调低更稳。
              </p>
            </div>
          </section>

          <section
            aria-labelledby='section-translation-style'
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
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
              className='mt-3 w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm outline-none'
            >
              <option value='natural-zh'>自然中文</option>
              <option value='faithful'>尽量忠实</option>
              <option value='concise-bubble'>气泡精简</option>
              {/* The prompt for this preset already exists and is tuned
                  for Japanese learners — it was simply never offered in
                  the UI, so the capability was unreachable. */}
              <option value='preserve-original'>保留原味（日语学习）</option>
            </select>
            {/*
              这一项以前是整个设置页里唯一没有一句解释的下拉框：四个选项，
              一个字都不说它会造成什么区别。而它恰恰是最影响输出的一项。
            */}
            <p className='mt-3 text-xs leading-relaxed text-slate-400'>
              {TRANSLATION_STYLE_DESCRIPTIONS[translationStylePreset]}
            </p>
            <p className='mt-2 text-xs leading-relaxed text-amber-300/80'>
              改翻译风格会让已经缓存的译文失效——同一张图会被重新请求一次 （
              {describeFeeShort(provider)}
              ）。
            </p>
          </section>

          {/* 覆盖层样式折叠面板 */}
          <section
            aria-labelledby='section-overlay-style'
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
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
                <div className='mt-3 space-y-3 border-t border-white/15 pt-3'>
                  <label className='flex items-center justify-between rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
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
                      <div className='relative h-8 w-12 shrink-0 overflow-hidden rounded border border-white/20'>
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
                        className='flex-1 rounded-lg border border-slate-500 bg-slate-950 px-3 py-1.5 text-sm outline-none'
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
                      <div className='relative h-8 w-12 shrink-0 overflow-hidden rounded border border-white/20'>
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
                        className='flex-1 rounded-lg border border-slate-500 bg-slate-950 px-3 py-1.5 text-sm outline-none'
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
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
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
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
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
                className='rounded-lg border border-white/20 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-900 disabled:opacity-40'
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
                  className='rounded-lg border border-white/20 bg-slate-950 px-3 py-3'
                >
                  <div className='text-xs text-slate-400'>{label}</div>
                  <div className='mt-1 text-lg font-semibold text-slate-100'>
                    {value}
                  </div>
                </div>
              ))}
            </div>
            <p className='mt-3 text-xs leading-relaxed text-slate-400'>
              「翻译记录」是本月翻出来的次数，「API 调用」是其中真正发出去的
              请求（缓存命中不计入）。本地服务商（Ollama / LM Studio）的调用
              也会计进上面的数字，但不产生费用——只有云端服务商的请求才会计
              到你的账单上，具体价格由服务商按 Token 决定。
            </p>
          </section>

          {/* 关于与支持：版本号、更新日志入口、以及一份本地生成的诊断信息。
              扩展不收集任何数据，所以用户报障时除了这段文本没有别的东西可
               给 —— 这份诊断信息就是为那一刻准备的。 */}
          <section
            aria-labelledby='section-about'
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
          >
            <h2 id='section-about' className='text-sm font-semibold'>
              关于与支持
            </h2>
            <div className='mt-3 space-y-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-xs text-slate-400'>当前版本</span>
                <span className='font-mono text-xs text-slate-200'>
                  {extensionVersion}
                </span>
              </div>
              <a
                href='https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases'
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1.5 text-xs text-cyan-300 transition hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
              >
                查看更新日志
                <ExternalLink aria-hidden='true' className='h-3 w-3' />
              </a>

              <div className='rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
                <div className='text-sm font-medium'>复制诊断信息</div>
                <p className='mt-1 text-xs leading-relaxed text-slate-400'>
                  扩展不会自动上传任何数据——这份诊断信息只在你点下面的按钮时
                  复制到剪贴板。遇到问题时，把它连同截图发到 Issues
                  即可更快定位。 它只包含你在下面能看到的设置与统计，不含 API
                  Key、接口地址或 你浏览的页面。
                </p>
                <button
                  type='button'
                  onClick={handleCopyDiagnostics}
                  disabled={diagnosticsCopied === 'copied'}
                  className='mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-60'
                >
                  {diagnosticsCopied === 'copied' ? (
                    <Check aria-hidden='true' className='h-3.5 w-3.5' />
                  ) : (
                    <Copy aria-hidden='true' className='h-3.5 w-3.5' />
                  )}
                  {diagnosticsCopied === 'copied'
                    ? '已复制到剪贴板'
                    : diagnosticsCopied === 'failed'
                      ? '复制失败，请手动选择'
                      : '复制诊断信息'}
                </button>
              </div>
            </div>
          </section>

          {/* 高级：默认收起。放的是"平时别动"的操作。 */}
          <section
            aria-labelledby='section-advanced'
            className='rounded-xl border border-white/25 bg-white/[0.08] p-4'
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
                <div className='mt-3 space-y-3 border-t border-white/15 pt-3'>
                  <div className='rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
                    <div className='text-sm font-medium'>翻译缓存</div>
                    <p className='mt-1 text-xs text-slate-400'>
                      翻译成功的漫画会缓存在本机，重复打开同一页不会再次调用模型；
                      翻译失败的图片不写缓存，下次打开会再请求一次。
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

                  {/*
                    找回被关掉的数据流向说明。

                    顶部那段说明可以关，关掉是永久的 —— 存储里写下一个标记，
                    用户就再也看不到它了。可它是整个产品里唯一明说"图片会
                    直接发给你配置的服务商"的地方，所以这里留一个入口：
                    关掉不等于删除。
                  */}
                  <div className='rounded-lg border border-white/20 bg-slate-950 px-3 py-3'>
                    <div className='text-sm font-medium'>数据流向说明</div>
                    <p className='mt-1 text-xs text-slate-400'>
                      页面顶部那段说明：你的 API Key
                      只保存在本机，翻译时漫画图片会直接发送到你配置的 Vision
                      LLM 服务。关掉它只是不再挡住页面，说明本身随时可以调出来。
                    </p>
                    <button
                      type='button'
                      onClick={restorePrivacyBanner}
                      className='mt-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20'
                    >
                      重新显示数据流向说明
                    </button>
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
