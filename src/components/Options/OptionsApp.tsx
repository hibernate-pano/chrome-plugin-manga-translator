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
import { estimateMonthlyCost, type PriceEntry } from '@/stores/usage-cost';
import {
  getDiagnosticsServiceLabel,
  getProviderLabel,
} from '@/utils/provider-label';
import type { ProviderType } from '@/providers/base';
import { evaluateBaseUrlSafety } from '@/shared/app-config';
import { isLocalProvider } from '@/shared/local-providers';
import { describeCost } from './cost-summary';
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

/**
 * The price fields, as the user is typing them.
 *
 * The store holds the committed rate; this holds the text in the box. They
 * are two different things: a half-typed "1." is a string the user is
 * looking at, and no rate at all is the most the store can say about it.
 */
interface PriceDraft {
  /** 输入价格（每 1,000,000 token） */
  input: string;
  /** 输出价格（每 1,000,000 token） */
  output: string;
  /** 单位标签，例如「元」或「$」 */
  unit: string;
  /**
   * The rate this draft wrote to the store.
   *
   * It is what tells our own write apart from somebody else's: the store
   * hands back the very object we gave it, so the two can be compared by
   * identity and our keystrokes do not wipe the field the user is in.
   */
  written?: PriceEntry;
}

/**
 * The provider the user enters a rate for.
 *
 * Only the cloud one can have a rate: the local providers run on the
 * user's own machine, where there is nobody to bill.
 */
const PRICED_PROVIDER: ProviderType = 'openai-compatible';

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
    'linear-gradient(45deg, rgb(22 22 22 / 0.18) 25%, transparent 25%),' +
    'linear-gradient(-45deg, rgb(22 22 22 / 0.18) 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, rgb(22 22 22 / 0.18) 75%),' +
    'linear-gradient(-45deg, transparent 75%, rgb(22 22 22 / 0.18) 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
};

/*
 * 校正纸上的控件只有三种长相。
 *
 * 设置页原来是一摞圆角卡片，每一块都在说"我和别的不一样"；校正纸反过来：
 * 一条墨线分栏，输入框是 1px 方框（纸底、透明），动作是墨黑块或朱红。
 * 44px 是这一切的高度——输入框、按钮、颜色块同高，一行行的规则线才对得齐，
 * 也才过得了 WCAG 2.5.8 的点击目标要求。
 */
const FIELD_CLASS =
  'h-11 w-full border border-rule bg-transparent px-3 text-sm text-ink placeholder:text-ink-muted/70 focus-visible:border-vermilion aria-[invalid=true]:border-vermilion disabled:cursor-not-allowed disabled:opacity-40';

/** 次要动作：1px 墨线，透明底，悬停时整块反过来。 */
const GHOST_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 border border-ink bg-transparent px-4 text-sm text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';

/** 主动作：整块墨黑，悬停换朱红。 */
const PRIMARY_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 border border-ink bg-ink px-4 text-sm font-medium text-paper transition hover:border-vermilion hover:bg-vermilion disabled:cursor-not-allowed disabled:opacity-40';

/** 破坏性动作：朱红描边，悬停时整块填朱红。 */
const DANGER_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 border border-vermilion bg-transparent px-4 text-sm text-vermilion transition hover:bg-vermilion hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';

/** 分区抬头：11px 编号 + 衬线标题，下面压一条墨线。 */
const SECTION_HEADER =
  'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-ink pb-2';

/** 分区标题：衬线 23px。 */
const SECTION_TITLE =
  'scroll-mt-6 font-display text-[23px] leading-tight text-ink';

/** 分区编号：11px 等宽，和左栏同一套数字。 */
const SECTION_INDEX =
  'font-mono text-[11px] leading-none tracking-[0.08em] text-ink-muted';

/** 元信息标签：11px 等宽。 */
const META_LABEL = 'font-mono text-[11px] tracking-[0.08em] text-ink-muted';

/** 表单里的字段名：12px。 */
const FIELD_LABEL = 'mb-1 block text-xs leading-none text-ink-muted';

/** 说明批注：蓝图蓝只用于结构与解释，不用于动作。 */
const NOTE_NOTE = 'text-xs leading-relaxed text-ink-muted';

/** 会花钱的提醒：同一条批注，换成蓝图蓝。 */
const NOTE_WARNING = 'text-xs leading-relaxed text-blueprint';

const RAIL_GROUPS = [
  {
    id: 'providers',
    index: '01',
    label: '翻译后端',
    anchor: 'section-providers',
  },
  {
    id: 'reading',
    index: '02',
    label: '阅读与语言',
    anchor: 'section-basics',
  },
  {
    id: 'usage',
    index: '03',
    label: '花费与用量',
    anchor: 'section-usage',
  },
  {
    id: 'privacy',
    index: '04',
    label: '隐私与诊断',
    anchor: 'section-privacy',
  },
] as const;

type RailGroupId = (typeof RAIL_GROUPS)[number]['id'];

/**
 * 把「1.84 元」拆成数字与单位。
 *
 * 大号衬线数字是这一格的答案，单位只是它的附注，于是两者要各自拿到
 * 自己的字号。拆开只影响排版，读到的还是同一句话。
 */
function splitCostLabel(label: string): {
  amount: string;
  unit: string;
  /** 这个标签是不是一个数。不是数（「未设置单价」）就不该占 52px 的位置。 */
  numeric: boolean;
} {
  const match = /^([\d.,]+)\s+(.+)$/.exec(label);
  if (!match) {
    return {
      amount: label,
      unit: '',
      numeric: /^[\d.,]+$/.test(label),
    };
  }
  return { amount: match[1] ?? label, unit: match[2] ?? '', numeric: true };
}

/**
 * 一行开关。
 *
 * 四行开关长得一样：左边一句结论加一句代价，右边一个 24×44 的开关。
 * 抽出来不是为了少写几行，是为了让它们的高度和那几条 1px 规则线对齐。
 */
interface SettingSwitchRowProps {
  title: string;
  ariaLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
}

const SettingSwitchRow: React.FC<SettingSwitchRowProps> = ({
  title,
  ariaLabel,
  checked,
  onCheckedChange,
  children,
}) => (
  <label className='flex min-h-[44px] items-start justify-between gap-6 py-4'>
    <span className='min-w-0'>
      <span className='block text-sm font-medium text-ink'>{title}</span>
      <span className='mt-1 block text-xs leading-relaxed text-ink-muted'>
        {children}
      </span>
    </span>
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={ariaLabel}
      className='mt-1 shrink-0'
    />
  </label>
);

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
  const prices = useUsageStore(state => state.prices);
  const setPrice = useUsageStore(state => state.setPrice);
  const clearPrice = useUsageStore(state => state.clearPrice);

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
   * What this month's calls cost, at the rates the user entered.
   *
   * The estimate is `null` when there is nothing to price — no cloud call
   * the user has a rate for — and the panel then asks for the rates
   * instead of reporting a smaller number that looks complete.
   */
  const costEstimate = useMemo(
    () => estimateMonthlyCost(usageRecords, prices),
    [usageRecords, prices]
  );

  /**
   * What the cost panel says about that estimate.
   */
  const cost = useMemo(
    () =>
      describeCost(
        costEstimate,
        type => PROVIDERS.find(item => item.type === type)?.name ?? type
      ),
    [costEstimate]
  );

  /**
   * The price fields, as the user is typing them.
   */
  const [priceDraft, setPriceDraft] = useState<PriceDraft>(() => {
    const price = prices[PRICED_PROVIDER];
    return {
      input: price ? String(price.inputPerMillion) : '',
      output: price ? String(price.outputPerMillion) : '',
      unit: price?.unit ?? '',
      written: price,
    };
  });

  /**
   * The price block and the field the "set a price" button points at.
   */
  const priceSectionRef = useRef<HTMLDivElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  /**
   * Follow the store when the price changes somewhere else.
   *
   * Only a change this draft did not make replaces the text: the field the
   * user is typing in must not be rewritten under their fingers by the
   * echo of their own keystroke.
   */
  useEffect(() => {
    const price = prices[PRICED_PROVIDER];
    setPriceDraft(current => {
      if (current.written === price) {
        return current;
      }
      return {
        input: price ? String(price.inputPerMillion) : '',
        output: price ? String(price.outputPerMillion) : '',
        unit: price?.unit ?? '',
        written: price,
      };
    });
  }, [prices]);

  /**
   * Write what the user typed into the store.
   *
   * An empty field is not a rate of zero: it is the absence of a rate, and
   * the provider drops out of the estimate. A number that is still being
   * typed ("-", "1e") is not stored either — there is nothing to store yet.
   *
   * Both fields are required together. A rate is a pair, and one half of it
   * cannot price a call: the estimate would either price the missing side at
   * zero or ignore the typed half, and both are numbers the user did not say.
   */
  const handlePriceChange = useCallback(
    (patch: Partial<PriceDraft>) => {
      const next = { ...priceDraft, ...patch };
      setPriceDraft(current => ({ ...current, ...patch }));

      if (next.input.trim() === '' || next.output.trim() === '') {
        clearPrice(PRICED_PROVIDER);
        setPriceDraft(current => ({ ...current, written: undefined }));
        return;
      }

      const input = Number(next.input);
      const output = Number(next.output);
      if (
        !Number.isFinite(input) ||
        !Number.isFinite(output) ||
        input < 0 ||
        output < 0
      ) {
        // The draft is not a rate yet, so there is no rate: keeping the
        // previous one would price this month at a number the user has
        // already typed over.
        clearPrice(PRICED_PROVIDER);
        setPriceDraft(current => ({ ...current, written: undefined }));
        return;
      }

      const entry: PriceEntry = {
        inputPerMillion: input,
        outputPerMillion: output,
        unit: next.unit,
      };
      setPrice(PRICED_PROVIDER, entry);
      setPriceDraft(current => ({ ...current, written: entry }));
    },
    [clearPrice, priceDraft, setPrice]
  );

  /**
   * Take the user to the price fields.
   *
   * "未设置单价" is only half an answer: the other half is where to fix it.
   */
  const focusPrices = useCallback(() => {
    priceSectionRef.current?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
    priceInputRef.current?.focus();
  }, []);

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

  /**
   * 左栏现在指到哪一块。
   *
   * 左栏是目录，目录得知道读者读到哪了。这里只用 IntersectionObserver
   * 读位置，从不接管滚动：每一项仍然是真的 <a href="#…">，跳转由浏览器
   * 自己做，键盘、右键"在新标签页打开"、屏读的链接列表全都不受影响。
   */
  const [currentGroup, setCurrentGroup] = useState<RailGroupId>('providers');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const targets = RAIL_GROUPS.map(group => ({
      id: group.id,
      element: document.getElementById(group.anchor),
    })).filter(
      (target): target is { id: RailGroupId; element: HTMLElement } =>
        target.element !== null
    );
    if (targets.length === 0) {
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.find(entry => entry.isIntersecting);
        const match = visible
          ? targets.find(target => target.element === visible.target)
          : undefined;
        if (match) {
          setCurrentGroup(match.id);
        }
      },
      // 只在页面中段那条窄带里判定"当前"：一进页面就是第一块，
      // 滚到底也还停在最后一块，不会两边乱跳。
      { rootMargin: '-40% 0px -55% 0px' }
    );
    targets.forEach(target => observer.observe(target.element));
    return () => observer.disconnect();
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
          className='flex min-h-[44px] w-full items-center justify-between gap-4 border-b border-rule-soft px-1 py-2 text-left text-ink-muted transition hover:bg-ink/[0.04] hover:text-ink'
        >
          <span className='flex min-w-0 items-center gap-2'>
            {providerType === 'ollama' ? (
              <Server aria-hidden='true' className='h-4 w-4 shrink-0' />
            ) : (
              <Sparkles aria-hidden='true' className='h-4 w-4 shrink-0' />
            )}
            <span className='truncate text-sm font-medium text-ink'>
              {meta.name}
            </span>
            <span className='truncate font-mono text-[11px]'>{configured}</span>
          </span>
          {/*
            The right-hand badges must not wrap their own text. Chinese
            breaks between any two characters, so a badge that is one
            character too narrow stops being a label and becomes a column
            of single characters ("当 前 使 用 中"). The row is nowrap; the
            row as a whole may still drop to its own line when the card
            gets narrow.
          */}
          <span className='flex shrink-0 items-center gap-3 whitespace-nowrap'>
            {/*
              A coloured dot on its own is not a label: `title` is never read
              out by a screen reader and never seen by a touch user. The word
              is what actually carries the meaning.
            */}
            {health !== 'unknown' && (
              <span
                className={`inline-flex items-center gap-1 text-xs ${
                  health === 'healthy' ? 'text-ink' : 'text-vermilion'
                }`}
              >
                <span
                  aria-hidden='true'
                  className={`h-2 w-2 ${
                    health === 'healthy' ? 'bg-ink' : 'bg-vermilion'
                  }`}
                />
                {health === 'healthy' ? '连接正常' : '连接异常'}
              </span>
            )}
            <span className='text-xs'>切换到此</span>
          </span>
        </button>
      );
    }

    return (
      <div key={providerType} className='border-b border-ink pb-6'>
        <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-2'>
          <div className='min-w-[12rem] flex-1'>
            <div className='flex items-center gap-2'>
              <Check aria-hidden='true' className='h-4 w-4 text-vermilion' />
              {providerType === 'ollama' ? (
                <Server aria-hidden='true' className='h-4 w-4 text-ink-muted' />
              ) : (
                <Sparkles
                  aria-hidden='true'
                  className='h-4 w-4 text-ink-muted'
                />
              )}
              <h3 className='font-display text-[19px] leading-tight text-ink'>
                {meta.name}
              </h3>
            </div>
            <p className='mt-1 text-sm text-ink-muted'>{meta.description}</p>
          </div>
          {/*
            The badges stay on one line each and the row wraps as a whole.
            A badge that breaks between characters reads as a broken layout,
            not as a label.
          */}
          <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
            <span
              className={`whitespace-nowrap border px-2 py-0.5 font-mono text-[11px] ${
                provider === providerType
                  ? 'border-vermilion text-vermilion'
                  : 'border-rule text-ink-muted'
              }`}
            >
              {provider === providerType ? '当前使用中' : '点击切换'}
            </span>
            {health !== 'unknown' && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs ${
                  health === 'healthy' ? 'text-ink' : 'text-vermilion'
                }`}
              >
                <span
                  aria-hidden='true'
                  className={`h-2 w-2 ${
                    health === 'healthy' ? 'bg-ink' : 'bg-vermilion'
                  }`}
                />
                {health === 'healthy' ? '连接正常' : '连接异常'}
              </span>
            )}
            <a
              href={meta.helpUrl}
              target='_blank'
              rel='noreferrer'
              className='inline-flex min-h-[24px] shrink-0 items-center gap-1 whitespace-nowrap border-b border-rule text-xs text-ink-muted transition hover:border-ink hover:text-ink'
            >
              文档
              <ExternalLink aria-hidden='true' className='h-3 w-3' />
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
          <div className='mt-4 border-l-2 border-vermilion pl-3 text-xs leading-relaxed text-vermilion'>
            {!result && providerHealthReason ? (
              <p>{providerHealthReason}</p>
            ) : null}
            <p>
              自动探测已暂停，避免反复向连不上的地址发请求。改好配置后点「测试配置」重试。
            </p>
          </div>
        )}

        <div className='mt-5 space-y-4'>
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
              <div className={`${META_LABEL} mb-2`}>
                快速选择服务商（点一下填好地址与模型，Key 仍需自己填）
              </div>
              {/*
                一张表，不是五张卡片：一条墨线围住，1px 规则线分行，
                正在用的那家由朱红色的对勾标出。地址与模型各占一栏，
                眼睛可以竖着扫下来比较。
              */}
              <div className='border border-ink'>
                {PROVIDER_PRESETS.map(preset => {
                  const selected =
                    findMatchingPreset({
                      baseUrl: settings.baseUrl,
                      model: settings.model,
                    })?.id === preset.id;
                  return (
                    <div
                      key={preset.id}
                      className='flex items-stretch border-b border-rule-soft last:border-b-0'
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
                        className={`flex min-h-[44px] min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition hover:bg-ink/[0.05] ${
                          selected ? 'bg-ink/[0.04]' : ''
                        }`}
                      >
                        {/*
                          对勾只出现在命中的那一行。没命中的行留同样宽的
                          空位，名字才不会左右跳动。
                        */}
                        <span
                          aria-hidden='true'
                          className={`w-4 shrink-0 text-sm ${
                            selected ? 'text-vermilion' : 'text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                        <span className='w-24 max-w-24 shrink-0 truncate text-sm text-ink sm:w-28'>
                          {preset.label}
                        </span>
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate font-mono text-[11px] text-ink-muted'>
                            {preset.baseUrl}
                          </span>
                          <span className='mt-0.5 block truncate text-xs text-ink-muted'>
                            {preset.note}
                          </span>
                        </span>
                        <span className='hidden w-44 shrink-0 truncate text-right font-mono text-[11px] text-ink-muted lg:block'>
                          {preset.model}
                        </span>
                      </button>
                      {/*
                        预设填好了地址和模型，剩下的那一步——拿 Key——用户
                        还是得自己去那个服务的主页。链接直接指到取 Key 的
                        页面，而不是只给一个服务商名字让人自己搜。
                      */}
                      <a
                        href={preset.keyUrl}
                        target='_blank'
                        rel='noreferrer'
                        className='flex min-h-[44px] shrink-0 items-center gap-1 border-l border-rule-soft px-1.5 font-mono text-[11px] text-blueprint underline underline-offset-4 transition hover:bg-ink hover:text-paper md:px-2'
                      >
                        获取 API Key
                        <ExternalLink aria-hidden='true' className='h-3 w-3' />
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor={`provider-${providerType}-base-url`}
              className={FIELD_LABEL}
            >
              接口地址（Base URL）
            </label>
            {/*
             * The border is the only thing that says "this is a control".
             * `border-rule` is the control boundary and it measures 3.06:1
             * against the paper, which is the contrast WCAG 1.4.11 asks for.
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
              className={`${FIELD_CLASS} font-mono`}
            />
            {baseUrlSafety === 'insecure' ? (
              // The API key is sent to this address as a Bearer header. Over
              // plaintext HTTP to a machine that is not the user's own, anyone
              // on the path can read it — so say so instead of quietly letting
              // the field look configured.
              <div className={`mt-1 ${NOTE_WARNING}`}>
                该地址使用明文 HTTP，API Key
                会随请求一起被路径上的任何一方读取。 除非是自建本地网关，请改用
                https。
              </div>
            ) : null}
            {baseUrlSafety === 'invalid' ? (
              <div className='mt-1 text-xs leading-relaxed text-vermilion'>
                无法解析该地址，请使用 http(s):// 开头的 URL。
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor={`provider-${providerType}-model`}
              className={FIELD_LABEL}
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
              className={`${FIELD_CLASS} font-mono`}
            />
          </div>

          {meta.requiresApiKey && (
            <div>
              <label
                htmlFor={`provider-${providerType}-api-key`}
                className={FIELD_LABEL}
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
                  className={`${FIELD_CLASS} pr-11 font-mono`}
                />
                <button
                  type='button'
                  onClick={() =>
                    setShowApiKey(current => ({
                      ...current,
                      [providerType]: !current[providerType],
                    }))
                  }
                  // 16×16 的图标不是点击目标（WCAG 2.5.8 AA）。
                  // 给按钮加内边距把可点区域撑到 44×44，再用 right/top
                  // 把图标放回原来的位置 —— 看得见的图标一点没动。
                  className='absolute right-0 top-1/2 -translate-y-1/2 p-3.5 text-ink-muted transition hover:text-vermilion'
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
                className={GHOST_BUTTON}
              >
                使用构建时 OpenCodeGo 备用配置
              </button>
            )}

          {!meta.requiresApiKey && (
            <div className='flex items-center gap-2 text-xs text-ink-muted'>
              <CheckCircle2
                aria-hidden='true'
                className='h-3.5 w-3.5 shrink-0'
              />
              <span>本地服务无需 API Key，可修改地址与模型。</span>
            </div>
          )}

          {result && (
            <div
              className={`flex items-start gap-2 border-l-2 pl-3 text-sm ${
                result.success
                  ? 'border-ink text-ink'
                  : 'border-vermilion text-vermilion'
              }`}
            >
              {result.success ? (
                <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
              ) : (
                <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
              )}
              <span>{result.message}</span>
            </div>
          )}

          <div className='flex flex-wrap items-center gap-4'>
            <button
              type='button'
              onClick={event => {
                event.stopPropagation();
                void testProvider(providerType);
              }}
              disabled={testingProvider === providerType}
              className={PRIMARY_BUTTON}
            >
              {testingProvider === providerType ? (
                <Loader2 aria-hidden='true' className='h-4 w-4 animate-spin' />
              ) : (
                <RefreshCw aria-hidden='true' className='h-4 w-4' />
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
            <p className={`min-w-0 flex-1 ${NOTE_NOTE}`}>
              测试配置会向服务商发一次请求；网关不提供 /models
              时会真的生成一个词，可能产生极少量费用。
            </p>
          </div>
        </div>
      </div>
    );
  };

  /**
   * 左栏那一行：编号用衬线，标签用正文字号。
   *
   * 当前那一块靠左侧的朱红竖线标出——朱红只给"当前"，不给装饰。
   */
  const renderRailItem = (group: (typeof RAIL_GROUPS)[number]) => {
    const isCurrent = currentGroup === group.id;
    return (
      <li key={group.id} className='flex-1 md:flex-none'>
        <a
          href={`#${group.anchor}`}
          aria-current={isCurrent ? 'location' : undefined}
          className={`flex min-h-[44px] items-center gap-3 border-b border-l-2 border-rule-soft pl-4 pr-4 text-sm transition md:h-14 ${
            isCurrent
              ? 'border-l-vermilion bg-ink/[0.05] text-ink'
              : 'border-l-transparent text-ink-muted hover:border-l-ink hover:bg-ink/[0.03] hover:text-ink'
          }`}
        >
          <span
            aria-hidden='true'
            className={`w-7 shrink-0 font-display text-[19px] tabular-nums leading-none ${
              isCurrent ? 'text-vermilion' : 'text-ink-muted'
            }`}
          >
            {group.index}
          </span>
          <span className='whitespace-nowrap'>{group.label}</span>
        </a>
      </li>
    );
  };

  /**
   * 两个分区之间那条更重的横线。
   *
   * 左栏把它们分成四块；正文里这四块各起一行，编号和左栏对得上。
   */
  const renderGroupRule = (index: string, label: string) => (
    <div className='mt-12 border-t-2 border-ink pt-2'>
      <span className={META_LABEL}>
        {index} ／ {label}
      </span>
    </div>
  );

  const costFigure = splitCostLabel(cost.label);

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
      {/*
        校正纸：整页只有一层滚动。

        左栏 sticky（不是 fixed，也不自带 overflow），正文是同一份文档流
        的右半——页面没有第二个滚动容器，浏览器自己的锚点跳转、Ctrl+F、
        屏读的阅读位置都只对着一个滚动轴。
      */}
      <div className='min-h-screen bg-paper text-ink'>
        <div className='mx-auto flex w-full max-w-[1120px] flex-col md:flex-row'>
          <nav
            aria-label='设置分区'
            className='shrink-0 border-b border-ink bg-paper md:sticky md:top-0 md:h-screen md:w-[220px] md:self-start md:border-b-0 md:border-r md:border-rule'
          >
            <div className='flex h-full flex-col'>
              <div className='flex items-baseline justify-between gap-2 px-5 pb-3 pt-6'>
                <span className='font-display text-[26px] leading-none tracking-[0.12em] text-ink'>
                  设置
                </span>
                <span className='font-mono text-[11px] tracking-[0.08em] text-ink-muted'>
                  校正紙
                </span>
              </div>
              <ol className='flex flex-wrap border-t border-rule md:block md:border-t-0'>
                {RAIL_GROUPS.map(renderRailItem)}
              </ol>
              <div className='mt-auto border-t border-rule-soft px-5 py-4 font-mono text-[11px] leading-relaxed tracking-[0.04em] text-ink-muted'>
                设置只保存在本机
              </div>
            </div>
          </nav>

          <div className='min-w-0 flex-1 px-5 pb-20 pt-6 sm:px-8 lg:px-10'>
            <header className='flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-ink pb-5'>
              <div className='min-w-0'>
                <h1 className='font-display text-[30px] leading-tight text-ink'>
                  漫画翻译助手 · 设置
                </h1>
                <p className='mt-2 text-sm text-ink-muted'>
                  {describeBackendAvailability(configuredBackends().length)}
                </p>
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <button
                  type='button'
                  onClick={() => setReopenOnboarding(true)}
                  className={`${GHOST_BUTTON} whitespace-nowrap`}
                >
                  重新查看引导
                </button>
                <div className='flex h-11 items-center gap-2 whitespace-nowrap border border-ink px-3'>
                  {provider === 'ollama' ? (
                    <Server aria-hidden='true' className='h-4 w-4 text-ink' />
                  ) : (
                    <Sparkles
                      aria-hidden='true'
                      className='h-4 w-4 text-vermilion'
                    />
                  )}
                  <span className='text-sm font-medium text-ink'>
                    {activeProviderLabel}
                  </span>
                </div>
              </div>
            </header>

            <div>
              {/* 01 翻译后端 ------------------------------------------------- */}
              <section aria-labelledby='section-providers' className='pt-8'>
                <div className={SECTION_HEADER}>
                  <div className='flex items-baseline gap-3'>
                    <span aria-hidden='true' className={SECTION_INDEX}>
                      01
                    </span>
                    <h2 id='section-providers' className={SECTION_TITLE}>
                      翻译后端
                    </h2>
                  </div>
                </div>
                <div className='mt-5'>
                  {PROVIDERS.map(item => renderProviderCard(item.type))}
                </div>
              </section>

              {renderGroupRule('02', '阅读与语言')}

              <section aria-labelledby='section-basics' className='mt-6'>
                <div className={SECTION_HEADER}>
                  <div className='flex items-baseline gap-3'>
                    <span aria-hidden='true' className={SECTION_INDEX}>
                      02.1
                    </span>
                    <h2 id='section-basics' className={SECTION_TITLE}>
                      基础行为
                    </h2>
                  </div>
                </div>

                <div className='mt-2 divide-y divide-rule-soft'>
                  <SettingSwitchRow
                    title='启用扩展'
                    ariaLabel='启用扩展'
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  >
                    关闭后不会请求任何模型，弹窗里的「翻译」也会停用
                  </SettingSwitchRow>

                  <SettingSwitchRow
                    title='自动续翻'
                    ariaLabel='自动续翻'
                    checked={autoContinueEnabled}
                    onCheckedChange={setAutoContinueEnabled}
                  >
                    页面内后续图片出现时自动继续翻译（
                    {describeFeeShort(provider)}）。
                    默认开启：一条条漫往下滚就是几十页，关掉它就不会再自动翻后面加载出来的图——但已加载的图在点「翻译当前页面」时仍会整页翻完。
                  </SettingSwitchRow>

                  <div className='py-4'>
                    <h3 className='text-sm font-medium text-ink'>
                      自动翻译站点
                    </h3>
                    <div className={`mt-1 ${NOTE_NOTE}`}>
                      只有列表中的站点会在打开页面时自动翻译。其他站点需要你手动点一下按钮。
                      但只要这一页开始翻译了，本页后续加载出来的图片会自动接着翻
                      （见上方「自动续翻」），同样{describeFeeShort(provider)}。
                    </div>
                    {autoTranslateHosts.length === 0 ? (
                      <div className='mt-3 border border-rule-soft px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-muted'>
                        列表为空，不会自动翻译任何站点。可在此添加，或在弹窗中一键添加当前站点。
                      </div>
                    ) : (
                      <ul className='mt-3 border-y border-rule-soft'>
                        {autoTranslateHosts.map(host => (
                          <li
                            key={host}
                            className='flex min-h-[44px] items-center justify-between gap-3 border-b border-rule-soft py-1 last:border-b-0'
                          >
                            <span className='truncate font-mono text-xs text-ink'>
                              {host}
                            </span>
                            <button
                              type='button'
                              onClick={() => removeAutoTranslateHost(host)}
                              aria-label={`移除 ${host}`}
                              className='inline-flex h-11 shrink-0 items-center px-2 text-xs text-ink-muted underline underline-offset-4 transition hover:text-vermilion'
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
                    <div className='mt-4 border-l-2 border-blueprint pl-3'>
                      <div className='text-xs font-medium text-blueprint'>
                        名单里的站点会自己花钱
                      </div>
                      <div className={`mt-1 ${NOTE_WARNING}`}>
                        {describeAutoTranslateCost(provider)}
                        ——名单里的站点，每次打开它的
                        任何页面都会自动翻译整页图片。通配符 *.example.com
                        会匹配
                        该域名下的所有子域名（a.example.com、b.example.com
                        都算）， 等于一次授权、一整片站点。
                      </div>
                    </div>
                    <form
                      className='mt-4 flex gap-2'
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
                        className={`${FIELD_CLASS} min-w-0 flex-1 font-mono`}
                      />
                      <button
                        type='submit'
                        className={`${GHOST_BUTTON} shrink-0`}
                      >
                        添加
                      </button>
                    </form>
                    {autoHostError ? (
                      <div className='mt-2 text-xs text-vermilion'>
                        {autoHostError}
                      </div>
                    ) : null}
                    <div className={`mt-2 ${META_LABEL} leading-relaxed`}>
                      按主机名匹配；带端口的条目（如
                      localhost:8080）只匹配该端口。 manga.example.com 不会匹配
                      notmanga.example.com。
                    </div>
                  </div>

                  {/*
                    右键菜单是第二个入口，以前界面上一个字都没有：用户右键看到
                    "翻译当前页面"，不知道它和弹窗里的按钮是不是一回事，也
                    不知道它同样要花钱。
                  */}
                  <p className={`${NOTE_NOTE} py-4`}>
                    在漫画页上右键也有两个入口：「翻译当前页面」和「翻译这张图片」。
                    它们和弹窗里的按钮一样会调用模型，
                    {describeFeeShort(provider)}。
                  </p>

                  <SettingSwitchRow
                    title='缓存结果'
                    ariaLabel='缓存结果'
                    checked={cacheEnabled}
                    onCheckedChange={setCacheEnabled}
                  >
                    减少重复图片的重复请求。关掉之后，同一页每次打开都会重新
                    调用模型服务（{describeFeeShort(provider)}）。
                  </SettingSwitchRow>
                </div>
              </section>

              <section
                aria-labelledby='section-target-language'
                className='mt-10'
              >
                <div className={SECTION_HEADER}>
                  <div className='flex items-baseline gap-3'>
                    <span aria-hidden='true' className={SECTION_INDEX}>
                      02.2
                    </span>
                    <h2 id='section-target-language' className={SECTION_TITLE}>
                      目标语言
                    </h2>
                  </div>
                </div>
                <label htmlFor='target-language' className='sr-only'>
                  目标语言
                </label>
                <select
                  id='target-language'
                  value={targetLanguage}
                  onChange={e => setTargetLanguage(e.target.value)}
                  className={`${FIELD_CLASS} mt-4`}
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
                <p className={`mt-3 ${NOTE_WARNING}`}>
                  改目标语言会让已经缓存的译文失效——同一张图会被重新请求一次 （
                  {describeFeeShort(provider)}
                  ）。想省钱就翻之前先定好语言。
                </p>
              </section>

              <section aria-labelledby='section-quality' className='mt-10'>
                <div className={SECTION_HEADER}>
                  <div className='flex items-baseline gap-3'>
                    <span aria-hidden='true' className={SECTION_INDEX}>
                      02.3
                    </span>
                    <h2 id='section-quality' className={SECTION_TITLE}>
                      画质与并发
                    </h2>
                  </div>
                </div>
                <p className={`mt-2 ${NOTE_NOTE}`}>
                  这两项直接决定一次翻译的费用与耗时。分辨率越高，识别越准，
                  但送出的图片也越大、Token 越多。
                </p>

                <div className='mt-4 space-y-4'>
                  <div>
                    <label htmlFor='max-image-size' className={FIELD_LABEL}>
                      图片分辨率上限（短边像素）
                    </label>
                    <select
                      id='max-image-size'
                      value={String(maxImageSize)}
                      onChange={e => setMaxImageSize(Number(e.target.value))}
                      className={FIELD_CLASS}
                    >
                      {IMAGE_SIZE_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className={`mt-2 ${NOTE_NOTE}`}>
                      {IMAGE_SIZE_NOTES[maxImageSize] ??
                        IMAGE_SIZE_NOTES_DEFAULT}
                    </p>
                    <p className={`mt-2 ${NOTE_WARNING}`}>
                      改分辨率会让已经缓存的译文失效——下次再翻同一张图会重新请求
                      一次（{describeFeeShort(provider)}
                      ）。想省钱就翻之前先定好分辨率。
                    </p>
                  </div>

                  <div>
                    <label htmlFor='parallel-limit' className={FIELD_LABEL}>
                      同时翻译的图片数
                    </label>
                    <select
                      id='parallel-limit'
                      value={String(parallelLimit)}
                      onChange={e => setParallelLimit(Number(e.target.value))}
                      className={FIELD_CLASS}
                    >
                      {PARALLEL_LIMIT_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className={`mt-2 ${NOTE_NOTE}`}>
                      并发越高，整章翻完越快；并发越高也越容易触发服务商的限流。
                      网速或接口不稳时调低更稳。
                    </p>
                  </div>
                </div>
              </section>

              <section
                aria-labelledby='section-translation-style'
                className='mt-10'
              >
                <div className={SECTION_HEADER}>
                  <div className='flex items-baseline gap-3'>
                    <span aria-hidden='true' className={SECTION_INDEX}>
                      02.4
                    </span>
                    <h2
                      id='section-translation-style'
                      className={SECTION_TITLE}
                    >
                      翻译风格
                    </h2>
                  </div>
                </div>
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
                  className={`${FIELD_CLASS} mt-4`}
                >
                  <option value='natural-zh'>自然中文</option>
                  <option value='faithful'>尽量忠实</option>
                  <option value='concise-bubble'>气泡精简</option>
                  {/* The prompt for this preset already exists and is tuned
                      for Japanese learners — it was simply never offered in
                      the UI, so the capability was unreachable. */}
                  <option value='preserve-original'>
                    保留原味（日语学习）
                  </option>
                </select>
                {/*
                  这一项以前是整个设置页里唯一没有一句解释的下拉框：四个选项，
                  一个字都不说它会造成什么区别。而它恰恰是最影响输出的一项。
                */}
                <p className={`mt-3 ${NOTE_NOTE}`}>
                  {TRANSLATION_STYLE_DESCRIPTIONS[translationStylePreset]}
                </p>
                <p className={`mt-2 ${NOTE_WARNING}`}>
                  改翻译风格会让已经缓存的译文失效——同一张图会被重新请求一次 （
                  {describeFeeShort(provider)}
                  ）。
                </p>
              </section>

              {/* 覆盖层样式折叠面板 */}
              <section
                aria-labelledby='section-overlay-style'
                className='mt-10'
              >
                <h2 id='section-overlay-style' className={SECTION_HEADER}>
                  <button
                    type='button'
                    aria-expanded={overlayStyleExpanded}
                    aria-controls='overlay-style-panel'
                    onClick={() =>
                      setOverlayStyleExpanded(!overlayStyleExpanded)
                    }
                    className='flex min-h-[44px] w-full items-baseline justify-between gap-3 text-left transition hover:text-vermilion'
                  >
                    <span className='flex items-baseline gap-3'>
                      <span aria-hidden='true' className={SECTION_INDEX}>
                        02.5
                      </span>
                      <span className='font-display text-[23px] leading-tight text-ink'>
                        覆盖层样式
                      </span>
                    </span>
                    {/* 副标题只是重复面板里的内容，不要混进按钮（和标题）的
                        可访问名称里，否则读屏会念成"覆盖层样式背景色、文字颜色、
                        字号等"。 */}
                    <span
                      aria-hidden='true'
                      className='hidden text-xs text-ink-muted sm:block'
                    >
                      背景色、文字颜色、字号等
                    </span>
                    <ChevronDown
                      aria-hidden='true'
                      className={`h-4 w-4 shrink-0 self-center text-ink-muted transition-transform duration-200 ${
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
                    <div className='mt-2 divide-y divide-rule-soft border-t border-rule-soft'>
                      <SettingSwitchRow
                        title='竖排文字'
                        ariaLabel='竖排文字'
                        checked={verticalText}
                        onCheckedChange={setVerticalText}
                      >
                        日文漫画竖向排版时启用
                      </SettingSwitchRow>

                      <div className='py-4'>
                        <label
                          htmlFor='overlay-background-color'
                          className={FIELD_LABEL}
                        >
                          背景色
                        </label>
                        <div className='flex items-center gap-2'>
                          {/*
                            真实的颜色预览：直接按存储值渲染，透明度看得见。
                            原来的 <input type="color"> 只能显示不透明颜色，rgba
                            会被硬编码成 #f0f0eb 顶替，用户看到的是假颜色。
                          */}
                          <div className='relative h-11 w-14 shrink-0 overflow-hidden border border-rule'>
                            <span
                              aria-hidden='true'
                              className='absolute inset-0'
                              style={ALPHA_CHECKERBOARD}
                            />
                            <span
                              aria-hidden='true'
                              className='absolute inset-0'
                              style={{
                                background: overlayStyle.backgroundColor,
                              }}
                            />
                            <input
                              type='color'
                              aria-label='背景色选择器'
                              value={colorInputValue(
                                overlayStyle.backgroundColor
                              )}
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
                              setOverlayStyle({
                                backgroundColor: e.target.value,
                              })
                            }
                            className={`${FIELD_CLASS} min-w-0 flex-1 font-mono`}
                          />
                        </div>
                      </div>

                      <div className='py-4'>
                        <label
                          htmlFor='overlay-text-color'
                          className={FIELD_LABEL}
                        >
                          文字颜色
                        </label>
                        <div className='flex items-center gap-2'>
                          <div className='relative h-11 w-14 shrink-0 overflow-hidden border border-rule'>
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
                            className={`${FIELD_CLASS} min-w-0 flex-1 font-mono`}
                          />
                        </div>
                      </div>

                      <div className='py-4'>
                        <div className='mb-3 text-xs leading-none text-ink-muted'>
                          字号范围
                        </div>
                        <div className='flex min-h-[44px] items-center gap-4'>
                          <span
                            aria-hidden='true'
                            className='w-8 font-display text-[15px] tabular-nums text-ink-muted'
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
                            className='w-8 text-right font-display text-[15px] tabular-nums text-ink-muted'
                          >
                            {overlayStyle.maxFontSize}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              {renderGroupRule('03', '花费与用量')}

              <section aria-labelledby='section-usage' className='mt-6'>
                <div className={SECTION_HEADER}>
                  <div className='flex items-baseline gap-3'>
                    <BarChart3
                      aria-hidden='true'
                      className='h-4 w-4 self-center text-ink-muted'
                    />
                    <span aria-hidden='true' className={SECTION_INDEX}>
                      03.1
                    </span>
                    <h2 id='section-usage' className={SECTION_TITLE}>
                      本月用量
                    </h2>
                  </div>
                  <button
                    type='button'
                    onClick={() => setClearUsageDialogOpen(true)}
                    disabled={usageRecords.length === 0}
                    className={`${GHOST_BUTTON} shrink-0`}
                  >
                    清除统计
                  </button>
                </div>
                <p className={`mt-2 ${META_LABEL}`}>
                  仅统计本机记录，缓存命中不消耗 Token
                </p>

                {/*
                  四个数字一排，中间是竖线，不是四张卡片：这是同一张表上的
                  四栏，读者横向比较，而不是分别阅读四个盒子。
                */}
                <div className='mt-4 grid grid-cols-2 border-t border-ink sm:grid-cols-4'>
                  {[
                    ['翻译记录', usageSummary.translations.toLocaleString()],
                    ['API 调用', usageSummary.billableCalls.toLocaleString()],
                    ['Token', usageSummary.tokens.toLocaleString()],
                    ['缓存命中', `${usageSummary.cacheHitRate}%`],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className='border-b border-rule-soft px-3 py-3 sm:border-b-0 sm:border-l sm:first:border-l-0'
                    >
                      <div className='font-mono text-[11px] tracking-[0.08em] text-ink-muted'>
                        {label}
                      </div>
                      <div className='mt-1 font-display text-[28px] tabular-nums leading-none text-ink'>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                <p className={`mt-4 ${NOTE_NOTE}`}>
                  「翻译记录」是本月翻出来的次数，「API 调用」是其中真正发出去的
                  请求（缓存命中不计入）。本地服务商（Ollama / LM Studio）的调用
                  也会计进上面的数字，但不产生费用——只有云端服务商的请求才会计
                  到你的账单上，费用由服务商按 Token 决定。
                </p>

                {/*
                  The cost of the month, at the rates the user entered.
                */}
                <div className='mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-ink pt-4'>
                  <div className='min-w-0 flex-1'>
                    <div className={META_LABEL}>本月估算花费</div>
                    <p className={`mt-1 max-w-[42rem] ${NOTE_NOTE}`}>
                      {cost.note}
                    </p>
                    {cost.needsPrice ? (
                      <button
                        type='button'
                        onClick={focusPrices}
                        className={`${GHOST_BUTTON} mt-3`}
                      >
                        去设置单价
                      </button>
                    ) : null}
                  </div>
                  {/*
                    数字是这一格的答案，所以它用衬线、52px；单位只说明这个
                    数字花的是什么钱，退到 12px，和答案基线对齐。
                  */}
                  <div className='flex shrink-0 items-baseline gap-2'>
                    <span
                      className={`font-display tabular-nums leading-none text-ink ${
                        costFigure.numeric ? 'text-[52px]' : 'text-[26px]'
                      }`}
                    >
                      {costFigure.amount}
                    </span>
                    {costFigure.unit ? (
                      <span className='text-xs text-ink-muted'>
                        {costFigure.unit}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/*
                  The rates themselves.

                  The extension ships no price table, so the numbers here are
                  the user's own, typed from their provider's pricing page.
                */}
                <div
                  ref={priceSectionRef}
                  id='section-prices'
                  className='mt-6 scroll-mt-6 border-t border-rule-soft pt-4'
                >
                  <div className='flex flex-wrap items-baseline justify-between gap-2'>
                    <h3 className='font-display text-[19px] leading-tight text-ink'>
                      单价
                    </h3>
                    <span className={META_LABEL}>每 1,000,000 token</span>
                  </div>
                  <p className={`mt-1 ${NOTE_NOTE}`}>
                    计价方式：每 1,000,000
                    token。把你服务商价格页上的数字填进来， 下面的估算就按它算。
                  </p>

                  <div className='mt-4 divide-y divide-rule-soft border-t border-rule-soft'>
                    {PROVIDERS.map(item => {
                      const local = isLocalProvider(item.type);
                      const editable = item.type === PRICED_PROVIDER;
                      return (
                        <div key={item.type} className='py-3'>
                          <div className='flex flex-wrap items-end gap-3'>
                            <div className='w-40 shrink-0 pb-2'>
                              <div className='text-sm text-ink'>
                                {item.name}
                              </div>
                              {local ? (
                                <div className='mt-0.5 font-mono text-[11px] text-ink-muted'>
                                  本地运行，不产生费用
                                </div>
                              ) : null}
                            </div>
                            <label className='min-w-[8rem] flex-1'>
                              <span className={FIELD_LABEL}>输入价格</span>
                              <input
                                ref={editable ? priceInputRef : undefined}
                                type='number'
                                min={0}
                                step='any'
                                aria-label={`${item.name} 输入价格`}
                                value={editable ? priceDraft.input : ''}
                                readOnly={!editable}
                                disabled={!editable}
                                placeholder={local ? '—' : '例如 3'}
                                onChange={
                                  editable
                                    ? event =>
                                        handlePriceChange({
                                          input: event.target.value,
                                        })
                                    : undefined
                                }
                                className={`${FIELD_CLASS} font-display`}
                              />
                            </label>
                            <label className='min-w-[8rem] flex-1'>
                              <span className={FIELD_LABEL}>输出价格</span>
                              <input
                                type='number'
                                min={0}
                                step='any'
                                aria-label={`${item.name} 输出价格`}
                                value={editable ? priceDraft.output : ''}
                                readOnly={!editable}
                                disabled={!editable}
                                placeholder={local ? '—' : '例如 15'}
                                onChange={
                                  editable
                                    ? event =>
                                        handlePriceChange({
                                          output: event.target.value,
                                        })
                                    : undefined
                                }
                                className={`${FIELD_CLASS} font-display`}
                              />
                            </label>
                            <label className='w-24 shrink-0'>
                              <span className={FIELD_LABEL}>单位</span>
                              <input
                                type='text'
                                aria-label={`${item.name} 货币单位`}
                                value={editable ? priceDraft.unit : ''}
                                readOnly={!editable}
                                disabled={!editable}
                                placeholder={local ? '—' : '元'}
                                onChange={
                                  editable
                                    ? event =>
                                        handlePriceChange({
                                          unit: event.target.value,
                                        })
                                    : undefined
                                }
                                className={FIELD_CLASS}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/*
                    Two things have to be said together, or one of them is
                    missed: the number is an estimate of the user's own rates,
                    and the rates themselves are the provider's to decide.
                  */}
                  <p className={`mt-3 ${NOTE_NOTE}`}>
                    这是按你填的单价做的估算，不是服务商的账单。单价由服务商决定，
                    请以服务商页面的价格为准。
                  </p>
                </div>
              </section>

              {/*
                04 这一块整体挂在 #section-privacy 上，而不是挂在顶部那段
                说明上：说明是可以关掉的，关掉之后左栏那一条仍然要有落点。
              */}
              <div id='section-privacy' className='scroll-mt-6'>
                {renderGroupRule('04', '隐私与诊断')}

                {/* 隐私告知 banner：说明 API key 与图片数据流向，可关闭 */}
                {!privacyBannerDismissed && (
                  <section className='mt-6 flex items-start gap-3 border-l-2 border-blueprint py-3 pl-4 pr-1'>
                    <Info
                      aria-hidden='true'
                      className='mt-0.5 h-5 w-5 shrink-0 text-blueprint'
                    />
                    <div className='min-w-0 flex-1'>
                      <h2 className='text-sm font-medium text-ink'>
                        数据流向说明
                      </h2>
                      <p className='mt-1 text-sm leading-relaxed text-ink-muted'>
                        你在本页填写的 API Key 只保存在本机
                        <code className='mx-1 bg-ink/[0.06] px-1 font-mono text-xs'>
                          chrome.storage.local
                        </code>
                        ，不会同步到 Google 账户。个人构建也可以从
                        <code className='mx-1 bg-ink/[0.06] px-1 font-mono text-xs'>
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
                      className='flex h-11 w-11 shrink-0 items-center justify-center text-ink-muted transition hover:text-vermilion'
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

                {/* 关于与支持：版本号、更新日志入口、以及一份本地生成的诊断信息。
                  扩展不收集任何数据，所以用户报障时除了这段文本没有别的东西可
                   给 —— 这份诊断信息就是为那一刻准备的。 */}
                <section aria-labelledby='section-about' className='mt-10'>
                  <div className={SECTION_HEADER}>
                    <div className='flex items-baseline gap-3'>
                      <span aria-hidden='true' className={SECTION_INDEX}>
                        04.2
                      </span>
                      <h2 id='section-about' className={SECTION_TITLE}>
                        关于与支持
                      </h2>
                    </div>
                  </div>
                  <div className='mt-2 divide-y divide-rule-soft'>
                    <div className='flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-3'>
                      <span className={META_LABEL}>当前版本</span>
                      <span className='font-mono text-xs text-ink'>
                        {extensionVersion}
                      </span>
                    </div>
                    <div className='py-3'>
                      <a
                        href='https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases'
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex min-h-[44px] items-center gap-1.5 border-b border-rule font-mono text-[11px] text-blueprint transition hover:border-ink hover:text-ink'
                      >
                        查看更新日志
                        <ExternalLink aria-hidden='true' className='h-3 w-3' />
                      </a>
                    </div>

                    <div className='py-4'>
                      <div className='text-sm font-medium text-ink'>
                        复制诊断信息
                      </div>
                      <p className={`mt-1 ${NOTE_NOTE}`}>
                        扩展不会自动上传任何数据——这份诊断信息只在你点下面的按钮时
                        复制到剪贴板。遇到问题时，把它连同截图发到 Issues
                        即可更快定位。 它只包含你在下面能看到的设置与统计，不含
                        API Key、接口地址或 你浏览的页面。
                      </p>
                      <button
                        type='button'
                        onClick={handleCopyDiagnostics}
                        disabled={diagnosticsCopied === 'copied'}
                        className={`${GHOST_BUTTON} mt-3`}
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
                <section aria-labelledby='section-advanced' className='mt-10'>
                  <h2 id='section-advanced' className={SECTION_HEADER}>
                    <button
                      type='button'
                      aria-expanded={advancedExpanded}
                      aria-controls='advanced-panel'
                      onClick={() => setAdvancedExpanded(!advancedExpanded)}
                      className='flex min-h-[44px] w-full items-baseline justify-between gap-3 text-left transition hover:text-vermilion'
                    >
                      <span className='flex items-baseline gap-3'>
                        <span aria-hidden='true' className={SECTION_INDEX}>
                          04.3
                        </span>
                        <span className='font-display text-[23px] leading-tight text-ink'>
                          高级
                        </span>
                      </span>
                      <span
                        aria-hidden='true'
                        className='hidden text-xs text-ink-muted sm:block'
                      >
                        缓存维护，一般不用动
                      </span>
                      <ChevronDown
                        aria-hidden='true'
                        className={`h-4 w-4 shrink-0 self-center text-ink-muted transition-transform duration-200 ${
                          advancedExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </h2>

                  <div id='advanced-panel' hidden={!advancedExpanded}>
                    {advancedExpanded ? (
                      <div className='mt-2 divide-y divide-rule-soft border-t border-rule-soft'>
                        <div className='py-4'>
                          <div className='text-sm font-medium text-ink'>
                            翻译缓存
                          </div>
                          <p className={`mt-1 ${NOTE_NOTE}`}>
                            翻译成功的漫画会缓存在本机，重复打开同一页不会再次调用模型；
                            翻译失败的图片不写缓存，下次打开会再请求一次。
                            清空后，这些译文会被删除。
                          </p>
                          <p className={`mt-2 ${NOTE_WARNING}`}>
                            清空后再次翻译会重新调用你配置的模型服务，并按该服务的计费规则产生费用。
                          </p>
                          <button
                            type='button'
                            onClick={() => setClearCacheDialogOpen(true)}
                            className={`${DANGER_BUTTON} mt-3`}
                          >
                            清空翻译缓存
                          </button>
                          {cacheCleared ? (
                            <p className='mt-2 text-xs text-ink-muted'>
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
                        <div className='py-4'>
                          <div className='text-sm font-medium text-ink'>
                            数据流向说明
                          </div>
                          <p className={`mt-1 ${NOTE_NOTE}`}>
                            页面顶部那段说明：你的 API Key
                            只保存在本机，翻译时漫画图片会直接发送到你配置的
                            Vision LLM
                            服务。关掉它只是不再挡住页面，说明本身随时可以调出来。
                          </p>
                          <button
                            type='button'
                            onClick={restorePrivacyBanner}
                            className={`${GHOST_BUTTON} mt-3`}
                          >
                            重新显示数据流向说明
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
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
