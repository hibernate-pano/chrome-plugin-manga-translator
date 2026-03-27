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

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
  BarChart3,
  BookOpen,
  Download,
  Upload,
  Trash2,
  Database,
} from 'lucide-react';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';
import { createProvider } from '@/providers';
import { useUsageStore } from '@/stores/usage-store';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import { useProductMetricsStore } from '@/stores/product-metrics';
import type { TranslationStylePreset } from '@/utils/translation-style';
import {
  getConfigurationNextStep,
  isExecutionModeConfigured,
} from '@/utils/product-readiness';
import {
  estimateProviderCost,
  getProviderStrategy,
} from '@/utils/provider-strategy';
import { Switch } from '@/components/ui/switch';

// ==================== Types ====================

interface TestResult {
  success: boolean;
  message: string;
}

interface ServerTestResult {
  success: boolean;
  message: string;
}

interface DemoTranslationResult {
  success: boolean;
  textAreas: number;
  pipeline?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

type QuickStartPresetId =
  | 'fast-cloud'
  | 'privacy-local'
  | 'server-compat';

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

const TRANSLATION_STYLE_PRESETS: Array<{
  value: TranslationStylePreset;
  label: string;
  description: string;
}> = [
  {
    value: 'natural-zh',
    label: '自然中文',
    description: '优先阅读流畅度，适合沉浸式看漫画',
  },
  {
    value: 'faithful',
    label: '忠实原文',
    description: '尽量贴近原句语气和信息，不主动润色',
  },
  {
    value: 'concise-bubble',
    label: '气泡精简',
    description: '优先短句和紧凑排版，适合气泡空间有限的页面',
  },
];

// ==================== Data Management Card ====================

const DataManagementCard: React.FC = () => {
  const usageSummary = useUsageStore(state => state.getSummary());
  const dailyStats = useUsageStore(state => state.getDailyStats(7));
  const clearUsage = useUsageStore(state => state.clearAll);
  const clearCache = useTranslationCacheStore(state => state.clear);
  const productReport = useProductMetricsStore(state => state.getReport());
  const cacheSize = useTranslationCacheStore(state => state.cache.size);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [importMessage, setImportMessage] = useState('');

  // ---- 配置导出 ----
  const handleExport = useCallback(() => {
    const config = useAppConfigStore.getState();
    const exportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      provider: config.provider,
      executionMode: config.executionMode,
      server: config.server,
      providers: config.providers,
      targetLanguage: config.targetLanguage,
      maxImageSize: config.maxImageSize,
      parallelLimit: config.parallelLimit,
      cacheEnabled: config.cacheEnabled,
      translationStylePreset: config.translationStylePreset,
      readingMode: config.readingMode,
      renderMode: config.renderMode,
      translationPipeline: config.translationPipeline,
      regionBatchSize: config.regionBatchSize,
      fallbackToFullImage: config.fallbackToFullImage,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manga-translator-config-${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ---- 配置导入 ----
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.version !== 2 || !data.providers) {
          throw new Error('配置文件格式不兼容');
        }
        // 合并配置（不覆盖密钥以外的系统配置）
        const store = useAppConfigStore.getState();
        if (data.provider) store.setProvider(data.provider);
        if (data.executionMode) {
          store.setExecutionMode(data.executionMode);
        }
        if (data.server) {
          store.updateServerConfig(data.server);
        }
        if (data.targetLanguage) store.setTargetLanguage(data.targetLanguage);
        if (data.translationStylePreset) {
          store.setTranslationStylePreset(data.translationStylePreset);
        }
        if (data.renderMode) {
          store.setRenderMode(data.renderMode);
        }
        if (data.translationPipeline) {
          store.setTranslationPipeline(data.translationPipeline);
        }
        if (typeof data.regionBatchSize === 'number') {
          store.setRegionBatchSize(data.regionBatchSize);
        }
        if (typeof data.fallbackToFullImage === 'boolean') {
          store.setFallbackToFullImage(data.fallbackToFullImage);
        }
        Object.entries(data.providers as Record<string, { apiKey?: string; model?: string; baseUrl?: string }>).forEach(([key, settings]) => {
          store.updateProviderSettings(key as ProviderType, settings);
        });
        setImportStatus('success');
        setImportMessage('配置导入成功！');
      } catch (err) {
        setImportStatus('error');
        setImportMessage(err instanceof Error ? err.message : '文件解析失败');
      } finally {
        // 清空文件输入
        if (importFileRef.current) importFileRef.current.value = '';
        setTimeout(() => setImportStatus('idle'), 3000);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleExportProductReport = useCallback(() => {
    const reportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      product: productReport,
      usage: {
        summary: usageSummary,
        dailyStats,
      },
    };
    const blob = new Blob([JSON.stringify(reportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manga-translator-product-report-${new Date()
      .toLocaleDateString('zh-CN')
      .replace(/\//g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [dailyStats, productReport, usageSummary]);

  return (
    <Card className="border-none shadow-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-slate-900 dark:text-slate-100">数据管理</CardTitle>
            <CardDescription className="text-slate-600 dark:text-slate-400">
              使用量统计、配置导出备份
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Token 使用量统计 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-violet-500" />
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">本月使用量</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Token 用量', value: usageSummary.monthlyTokens.toLocaleString() },
              { label: '估算费用', value: `$${usageSummary.monthlyCost.toFixed(4)}` },
              { label: '翻译次数', value: usageSummary.totalRecords.toString() },
              { label: '缓存命中率', value: `${Math.round(usageSummary.cacheHitRate * 100)}%` },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
                <p className="text-base font-bold text-slate-800 dark:text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          {/* 最近7天列表 */}
          {dailyStats.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">最近 7 天</p>
              {dailyStats.slice(0, 7).map(day => (
                <div key={day.date} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-slate-50 dark:bg-slate-700/30 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{day.date}</span>
                  <span className="text-slate-700 dark:text-slate-300">{day.translationCount} 次翻译</span>
                  <span className="text-violet-600 dark:text-violet-400">{day.totalTokens.toLocaleString()} tokens</span>
                  <span className="text-emerald-600 dark:text-emerald-400">${day.estimatedCost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-slate-100 dark:bg-slate-700" />

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            产品漏斗
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: 'Popup 打开',
                value: String(productReport.summary.popupOpened),
              },
              {
                label: '开始翻译',
                value: String(productReport.summary.translateStarted),
              },
              {
                label: '翻译成功率',
                value: `${Math.round(
                  productReport.summary.activationRate * 100
                )}%`,
              },
              {
                label: '验证成功率',
                value: `${Math.round(
                  productReport.summary.demoSuccessRate * 100
                )}%`,
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-center"
              >
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                  {label}
                </p>
                <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={handleExportProductReport}
            className="h-10 gap-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            导出产品报告
          </Button>
        </div>

        <div className="h-px bg-slate-100 dark:bg-slate-700" />

        {/* 配置导入/导出 */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">配置备份</h3>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={handleExport}
              className="h-10 gap-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              导出配置
            </Button>

            <div className="relative">
              <Button
                variant="outline"
                onClick={() => importFileRef.current?.click()}
                className="w-full h-10 gap-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                导入配置
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </div>
          </div>

          {importStatus !== 'idle' && (
            <div className={`flex items-center gap-2 p-2.5 rounded-lg text-sm ${importStatus === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              }`}>
              {importStatus === 'success'
                ? <CheckCircle2 className="w-4 h-4" />
                : <AlertCircle className="w-4 h-4" />
              }
              {importMessage}
            </div>
          )}
        </div>

        <div className="h-px bg-slate-100 dark:bg-slate-700" />

        {/* 清除数据 */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">清除数据</h3>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="ghost"
              onClick={() => { clearCache(); }}
              className="h-10 gap-2 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              清除缓存（{cacheSize} 条）
            </Button>
            <Button
              variant="ghost"
              onClick={() => { clearUsage(); }}
              className="h-10 gap-2 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              清除统计数据
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>
  );
};

// ==================== Component ====================

const OptionsApp: React.FC = () => {
  // Config store - 细粒度 selector 避免全量订阅
  const provider = useAppConfigStore((state) => state.provider);
  const executionMode = useAppConfigStore((state) => state.executionMode);
  const server = useAppConfigStore((state) => state.server);
  const providers = useAppConfigStore((state) => state.providers);
  const targetLanguage = useAppConfigStore((state) => state.targetLanguage);
  const translationStylePreset = useAppConfigStore(
    (state) => state.translationStylePreset,
  );
  const renderMode = useAppConfigStore((state) => state.renderMode);
  const translationPipeline = useAppConfigStore(
    (state) => state.translationPipeline,
  );
  const regionBatchSize = useAppConfigStore((state) => state.regionBatchSize);
  const fallbackToFullImage = useAppConfigStore(
    (state) => state.fallbackToFullImage,
  );
  const setProvider = useAppConfigStore((state) => state.setProvider);
  const setExecutionMode = useAppConfigStore((state) => state.setExecutionMode);
  const updateServerConfig = useAppConfigStore(
    (state) => state.updateServerConfig,
  );
  const updateProviderSettings = useAppConfigStore(
    (state) => state.updateProviderSettings,
  );
  const setTargetLanguage = useAppConfigStore(
    (state) => state.setTargetLanguage,
  );
  const setTranslationStylePreset = useAppConfigStore(
    (state) => state.setTranslationStylePreset,
  );
  const setRenderMode = useAppConfigStore((state) => state.setRenderMode);
  const setTranslationPipeline = useAppConfigStore(
    (state) => state.setTranslationPipeline,
  );
  const setRegionBatchSize = useAppConfigStore(
    (state) => state.setRegionBatchSize,
  );
  const setFallbackToFullImage = useAppConfigStore(
    (state) => state.setFallbackToFullImage,
  );
  const usageSummary = useUsageStore(state => state.getSummary());
  const productSummary = useProductMetricsStore(state => state.getSummary());
  const recommendedProfile = useProductMetricsStore(
    state => state.recommendedProfile
  );
  const trackProductEvent = useProductMetricsStore(state => state.track);

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
  const [testingServer, setTestingServer] = useState(false);
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
  const [serverTestResult, setServerTestResult] = useState<ServerTestResult | null>(
    null,
  );

  // Ollama models state
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(
    null,
  );
  const [demoImageDataUrl, setDemoImageDataUrl] = useState<string | null>(null);
  const [demoImageName, setDemoImageName] = useState('');
  const [demoResult, setDemoResult] = useState<DemoTranslationResult | null>(
    null,
  );
  const [isRunningDemo, setIsRunningDemo] = useState(false);
  const demoInputRef = useRef<HTMLInputElement>(null);
  const optionsOpenedRef = useRef(false);

  // Current provider config
  const currentProviderConfig = PROVIDER_CONFIG[provider];
  const providerStrategy = useMemo(
    () => getProviderStrategy(provider),
    [provider],
  );
  const modeReady = useMemo(
    () =>
      isExecutionModeConfigured(executionMode, server, provider, providers),
    [executionMode, provider, providers, server],
  );
  const nextStep = useMemo(
    () => getConfigurationNextStep(executionMode, server, provider, providers),
    [executionMode, provider, providers, server],
  );
  const activePreset = useMemo<QuickStartPresetId | null>(() => {
    if (executionMode === 'server' && server.enabled) {
      return 'server-compat';
    }
    if (executionMode === 'provider-direct' && provider === 'ollama') {
      return 'privacy-local';
    }
    if (executionMode === 'provider-direct' && provider === 'siliconflow') {
      return 'fast-cloud';
    }
    return null;
  }, [executionMode, provider, server.enabled]);
  const averageTokensPerImage = Math.max(
    usageSummary.avgTokensPerTranslation || 0,
    executionMode === 'server' ? 800 : 1200,
  );
  const estimatedTwentyImageCost = useMemo(() => {
    if (executionMode === 'server') {
      return 0;
    }
    return estimateProviderCost(provider, averageTokensPerImage, 20);
  }, [averageTokensPerImage, executionMode, provider]);
  const recommendedProfileMismatch =
    recommendedProfile &&
    (recommendedProfile.executionMode !== executionMode ||
      (recommendedProfile.provider !== 'unknown' &&
        recommendedProfile.provider !== provider));

  // Fetch Ollama models when base URL changes or on mount
  const fetchOllamaModels = useCallback(
    async (baseUrl?: string) => {
      const url = baseUrl || providers.ollama.baseUrl;
      if (!url) return;

      setLoadingOllamaModels(true);
      setOllamaModelsError(null);

      try {
        const ollamaProvider = await createProvider('ollama', { baseUrl: url });
        await ollamaProvider.initialize({ baseUrl: url });
        const models = await (
          ollamaProvider as unknown as {
            getAvailableVisionModels: () => Promise<string[]>;
          }
        ).getAvailableVisionModels();

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

  useEffect(() => {
    if (!optionsOpenedRef.current) {
      optionsOpenedRef.current = true;
      trackProductEvent('options_opened', {
        executionMode,
        provider,
      });
    }
  }, [executionMode, provider, trackProductEvent]);

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

  const handleTestServerConnection = useCallback(async () => {
    setTestingServer(true);
    setServerTestResult(null);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'testServerConnection',
        server,
      }) as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      setServerTestResult({
        success: !!response?.success,
        message:
          response?.message ||
          response?.error ||
          '服务端连接测试失败',
      });
    } catch (error) {
      setServerTestResult({
        success: false,
        message: error instanceof Error ? error.message : '服务端连接测试失败',
      });
    } finally {
      setTestingServer(false);
    }
  }, [server]);

  const handleApplyQuickStartPreset = useCallback(
    (presetId: QuickStartPresetId) => {
      setServerTestResult(null);
      trackProductEvent('quickstart_selected', {
        presetId,
        executionMode,
        provider,
      });

      switch (presetId) {
        case 'fast-cloud':
          updateServerConfig({ enabled: false });
          setExecutionMode('provider-direct');
          setProvider('siliconflow');
          setTargetLanguage('zh-CN');
          setTranslationStylePreset('natural-zh');
          setRenderMode('strong-overlay-compat');
          setTranslationPipeline('full-image-vlm');
          setRegionBatchSize(10);
          setFallbackToFullImage(true);
          updateProviderSettings('siliconflow', {
            baseUrl:
              providers.siliconflow.baseUrl ||
              'https://api.siliconflow.cn/v1',
            model:
              providers.siliconflow.model ||
              'Qwen/Qwen2.5-VL-32B-Instruct',
          });
          break;
        case 'privacy-local':
          updateServerConfig({ enabled: false });
          setExecutionMode('provider-direct');
          setProvider('ollama');
          setTargetLanguage('zh-CN');
          setTranslationStylePreset('natural-zh');
          setRenderMode('strong-overlay-compat');
          setTranslationPipeline('full-image-vlm');
          setRegionBatchSize(10);
          setFallbackToFullImage(true);
          updateProviderSettings('ollama', {
            baseUrl: providers.ollama.baseUrl || 'http://localhost:11434',
            model: providers.ollama.model || 'llava',
          });
          break;
        case 'server-compat':
          updateServerConfig({
            enabled: true,
            baseUrl: server.baseUrl || 'http://127.0.0.1:8000',
            timeoutMs: server.timeoutMs || 30000,
          });
          setExecutionMode('server');
          setTargetLanguage('zh-CN');
          setTranslationStylePreset('natural-zh');
          setRenderMode('strong-overlay-compat');
          setTranslationPipeline('full-image-vlm');
          setRegionBatchSize(10);
          setFallbackToFullImage(true);
          break;
      }
    },
    [
      providers.ollama.baseUrl,
      providers.ollama.model,
      providers.siliconflow.baseUrl,
      providers.siliconflow.model,
      server.baseUrl,
      server.timeoutMs,
      executionMode,
      provider,
      setExecutionMode,
      setFallbackToFullImage,
      setProvider,
      setRegionBatchSize,
      setRenderMode,
      setTargetLanguage,
      setTranslationPipeline,
      setTranslationStylePreset,
      trackProductEvent,
      updateProviderSettings,
      updateServerConfig,
    ],
  );

  const handleApplyRecommendedModel = useCallback(() => {
    if (executionMode === 'server') {
      return;
    }

    updateProviderSettings(provider, {
      model: providerStrategy.suggestedModel,
    });
  }, [
    executionMode,
    provider,
    providerStrategy.suggestedModel,
    updateProviderSettings,
  ]);

  const handleApplySuccessfulProfile = useCallback(() => {
    if (!recommendedProfile) {
      return;
    }

    setExecutionMode(recommendedProfile.executionMode);
    if (recommendedProfile.executionMode === 'server') {
      updateServerConfig({ enabled: true });
    } else {
      updateServerConfig({ enabled: false });
    }

    if (recommendedProfile.provider !== 'unknown') {
      setProvider(recommendedProfile.provider);
    }
  }, [
    recommendedProfile,
    setExecutionMode,
    setProvider,
    updateServerConfig,
  ]);

  const handleDemoFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = loadEvent => {
        const result = loadEvent.target?.result;
        if (typeof result !== 'string') {
          return;
        }
        setDemoImageDataUrl(result);
        setDemoImageName(file.name);
        setDemoResult(null);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const handleRunDemo = useCallback(async () => {
    if (!demoImageDataUrl) {
      return;
    }

    setIsRunningDemo(true);
    setDemoResult(null);
    trackProductEvent('demo_started', {
      executionMode,
      provider,
    });

    try {
      const [rawHeader, base64 = ''] = demoImageDataUrl.split(',', 2);
      const header = rawHeader || '';
      const mimeType = header.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
      const settings = providers[provider];

      const response = (await chrome.runtime.sendMessage({
        action: 'translateImage',
        imageBase64: base64,
        mimeType,
        imageKey: `demo-${Date.now()}`,
        targetLanguage,
        provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model || providerStrategy.suggestedModel,
        executionMode,
        server,
        renderMode,
        translationStylePreset,
        forceRefresh: true,
      })) as {
        success?: boolean;
        error?: string;
        textAreas?: Array<unknown>;
        pipeline?: string;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        } | null;
      };

      const result: DemoTranslationResult = {
        success: !!response?.success,
        textAreas: response?.textAreas?.length ?? 0,
        pipeline: response?.pipeline,
        error: response?.error,
        usage: response?.usage ?? null,
      };

      setDemoResult(result);
      trackProductEvent(result.success ? 'demo_succeeded' : 'demo_failed', {
        executionMode,
        provider,
        textAreas: result.textAreas,
      });
    } catch (error) {
      setDemoResult({
        success: false,
        textAreas: 0,
        error: error instanceof Error ? error.message : '内置验证失败',
      });
      trackProductEvent('demo_failed', {
        executionMode,
        provider,
      });
    } finally {
      setIsRunningDemo(false);
    }
  }, [
    demoImageDataUrl,
    executionMode,
    provider,
    providerStrategy.suggestedModel,
    providers,
    renderMode,
    server,
    targetLanguage,
    trackProductEvent,
    translationStylePreset,
  ]);

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
            className={`border-none ${testResult.success
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
                  className={`font-semibold ${testResult.success
                    ? 'text-emerald-900 dark:text-emerald-100'
                    : 'text-red-900 dark:text-red-100'
                    }`}
                >
                  {testResult.success ? '连接成功' : '连接失败'}
                </AlertTitle>
                <AlertDescription
                  className={`mt-1 ${testResult.success
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
        <Card className="border-none shadow-lg bg-white/85 dark:bg-slate-800/85 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-sky-500 to-indigo-500 rounded-lg">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  产品健康信号
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  先看用户是否真的走到成功，而不是只看功能有没有做完。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              {[
                {
                  label: 'Popup 打开',
                  value: String(productSummary.popupOpened),
                },
                {
                  label: '开始翻译',
                  value: String(productSummary.translateStarted),
                },
                {
                  label: '翻译成功率',
                  value: `${Math.round(productSummary.activationRate * 100)}%`,
                },
                {
                  label: '内置验证成功率',
                  value: `${Math.round(productSummary.demoSuccessRate * 100)}%`,
                },
              ].map(item => (
                <div
                  key={item.label}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3"
                >
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {item.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
            <Alert className="border-none bg-slate-50 dark:bg-slate-900/40">
              <AlertTitle className="text-slate-900 dark:text-slate-100">
                当前判断
              </AlertTitle>
              <AlertDescription className="mt-1 text-slate-700 dark:text-slate-300">
                {productSummary.firstSuccessAt
                  ? `已经拿到首个成功样本，时间：${new Date(
                      productSummary.firstSuccessAt
                    ).toLocaleString('zh-CN')}`
                  : '还没有记录到成功样本。优先用下面的内置验证面板，先跑通一张图。'}
              </AlertDescription>
            </Alert>

            {productSummary.recommendedProfile && (
              <Alert className="border-none bg-indigo-50 dark:bg-indigo-950/30">
                <AlertTitle className="text-slate-900 dark:text-slate-100">
                  建议先固定成功方案
                </AlertTitle>
                <AlertDescription className="mt-1 text-slate-700 dark:text-slate-300">
                  已记录到可用配置：{productSummary.recommendedProfile}。在新增更多智能切换之前，先把这个方案当作默认主力，避免把已经可用的路径改坏。
                </AlertDescription>
                {recommendedProfileMismatch && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleApplySuccessfulProfile}
                    className="mt-3 cursor-pointer"
                  >
                    切回成功方案
                  </Button>
                )}
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-lg bg-white/85 dark:bg-slate-800/85 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg">
                <Rocket className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  快速开始方案
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  先选一个适合你的方案，再补齐必要信息。不要让用户先面对一整页参数。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  id: 'fast-cloud' as const,
                  title: '极速上手',
                  description: '适合大多数用户，默认走云端视觉模型。',
                  accent: 'from-teal-500 to-cyan-500',
                },
                {
                  id: 'privacy-local' as const,
                  title: '隐私优先',
                  description: '适合本地模型用户，默认走 Ollama。',
                  accent: 'from-slate-500 to-slate-700',
                },
                {
                  id: 'server-compat' as const,
                  title: '高兼容服务端',
                  description: '适合已经部署 OCR-First 服务端的用户。',
                  accent: 'from-emerald-500 to-lime-500',
                },
              ].map((preset) => {
                const selected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyQuickStartPreset(preset.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      selected
                        ? 'border-teal-400 bg-teal-50 shadow-md dark:border-teal-500 dark:bg-teal-950/30'
                        : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/60 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-teal-700'
                    }`}
                  >
                    <div
                      className={`inline-flex rounded-lg bg-gradient-to-r px-2 py-1 text-xs font-semibold text-white ${preset.accent}`}
                    >
                      {selected ? '当前方案' : '应用方案'}
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {preset.title}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  当前执行模式
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {executionMode === 'server' ? '服务端 OCR-First' : '插件直连 Provider'}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  当前 Provider
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {PROVIDER_CONFIG[provider].name}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  当前就绪度
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                  {modeReady ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        已满足基础条件
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                      <span className="text-amber-700 dark:text-amber-400">
                        还差一步
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <Alert
              variant={modeReady ? 'default' : 'destructive'}
              className={`border-none ${
                modeReady
                  ? 'bg-emerald-50 dark:bg-emerald-900/20'
                  : 'bg-amber-50 dark:bg-amber-900/20'
              }`}
            >
              <AlertTitle className="text-slate-900 dark:text-slate-100">
                {modeReady ? '下一步就去测试或开翻' : '推荐下一步'}
              </AlertTitle>
              <AlertDescription className="mt-1 text-slate-700 dark:text-slate-300">
                {nextStep}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card className="border-none shadow-lg bg-white/85 dark:bg-slate-800/85 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  成本与质量策略
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  不是所有 Provider 都该默认给所有用户。这里给出更产品化的建议。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  推荐定位
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {providerStrategy.recommendation}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  速度 / 质量 / 成本
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {providerStrategy.speedLabel} / {providerStrategy.qualityLabel} /{' '}
                  {providerStrategy.costLabel}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  估算 20 张图成本
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {executionMode === 'server'
                    ? '取决于服务端实现'
                    : `$${estimatedTwentyImageCost.toFixed(4)}`}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    推荐模型
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {providerStrategy.suggestedModel}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {providerStrategy.tradeoff}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleApplyRecommendedModel}
                  disabled={executionMode === 'server'}
                  className="cursor-pointer"
                >
                  应用推荐模型
                </Button>
              </div>
            </div>

            <Alert className="border-none bg-amber-50 dark:bg-amber-900/20">
              <AlertTitle className="text-slate-900 dark:text-slate-100">
                回退建议
              </AlertTitle>
              <AlertDescription className="mt-1 text-slate-700 dark:text-slate-300">
                {providerStrategy.fallbackAdvice}
                {fallbackToFullImage
                  ? ' 当前已开启 full-image fallback。'
                  : ' 当前未开启 full-image fallback，复杂页面更容易直接失败。'}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card className="border-none shadow-lg bg-white/85 dark:bg-slate-800/85 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  内置验证面板
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  上传一张本地漫画图，直接验证当前配置，不依赖外部网站。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => demoInputRef.current?.click()}
                className="cursor-pointer"
              >
                <Upload className="mr-2 h-4 w-4" />
                选择测试图片
              </Button>
              <input
                ref={demoInputRef}
                type="file"
                accept="image/*"
                onChange={handleDemoFileChange}
                className="hidden"
              />
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {demoImageName || '建议使用一张有对白气泡的漫画截图。'}
              </div>
            </div>

            {demoImageDataUrl && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                <img
                  src={demoImageDataUrl}
                  alt="Demo preview"
                  className="max-h-72 w-full object-contain bg-slate-100 dark:bg-slate-900"
                />
              </div>
            )}

            <div className="flex flex-col gap-3 md:flex-row">
              <Button
                type="button"
                onClick={handleRunDemo}
                disabled={!demoImageDataUrl || !modeReady || isRunningDemo}
                className="cursor-pointer"
              >
                {isRunningDemo ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在验证...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    运行内置验证
                  </>
                )}
              </Button>
              {!modeReady && (
                <div className="flex items-center text-xs text-amber-600 dark:text-amber-400">
                  当前配置未完成，先按上面的推荐下一步补齐。
                </div>
              )}
            </div>

            {demoResult && (
              <Alert
                variant={demoResult.success ? 'default' : 'destructive'}
                className={`border-none ${
                  demoResult.success
                    ? 'bg-emerald-50 dark:bg-emerald-900/20'
                    : 'bg-red-50 dark:bg-red-900/20'
                }`}
              >
                <AlertTitle className="text-slate-900 dark:text-slate-100">
                  {demoResult.success ? '验证成功' : '验证失败'}
                </AlertTitle>
                <AlertDescription className="mt-2 space-y-1 text-slate-700 dark:text-slate-300">
                  <div>识别并返回 {demoResult.textAreas} 个文本区域。</div>
                  {demoResult.pipeline && <div>Pipeline: {demoResult.pipeline}</div>}
                  {demoResult.usage && (
                    <div>
                      Token: {demoResult.usage.totalTokens}（prompt{' '}
                      {demoResult.usage.promptTokens} / completion{' '}
                      {demoResult.usage.completionTokens}）
                    </div>
                  )}
                  {demoResult.error && <div>{demoResult.error}</div>}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Provider Configuration */}
        <Card className="border-none shadow-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-lg">
                <Server className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  服务端 OCR-First 模式
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  配置你的自托管服务端，优先使用 OCR + 文本翻译 + 区域回退
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  启用服务端模式
                </Label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  开启后优先走自托管 OCR 服务；关闭时继续使用当前视觉模型 provider
                </p>
              </div>
              <Switch
                checked={server.enabled}
                onCheckedChange={(checked) => {
                  updateServerConfig({ enabled: checked });
                  setExecutionMode(checked ? 'server' : 'provider-direct');
                }}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                执行模式
              </Label>
              <Select
                value={executionMode}
                onValueChange={(value) =>
                  setExecutionMode(value as 'server' | 'provider-direct')
                }
              >
                <SelectTrigger className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-600 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="server" className="cursor-pointer">
                    服务端 OCR-First
                  </SelectItem>
                  <SelectItem value="provider-direct" className="cursor-pointer">
                    插件直连视觉模型
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                服务端地址
              </Label>
              <Input
                value={server.baseUrl}
                placeholder="http://127.0.0.1:8000"
                onChange={(e) =>
                  updateServerConfig({ baseUrl: e.target.value.trim() })
                }
                className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 focus:border-teal-400 dark:focus:border-teal-600"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                服务端 Token
              </Label>
              <Input
                value={server.authToken}
                type="password"
                placeholder="Bearer Token（可选）"
                onChange={(e) =>
                  updateServerConfig({ authToken: e.target.value })
                }
                className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 focus:border-teal-400 dark:focus:border-teal-600"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                超时时间（毫秒）
              </Label>
              <Input
                value={String(server.timeoutMs)}
                type="number"
                min={1000}
                step={1000}
                onChange={(e) =>
                  updateServerConfig({
                    timeoutMs: Math.max(1000, Number(e.target.value) || 30000),
                  })
                }
                className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 focus:border-teal-400 dark:focus:border-teal-600"
              />
            </div>

            {serverTestResult && (
              <Alert
                variant={serverTestResult.success ? 'default' : 'destructive'}
                className={`border-none ${serverTestResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-900/20'
                  : 'bg-red-50 dark:bg-red-900/20'
                  }`}
              >
                <AlertTitle>
                  {serverTestResult.success ? '服务端可用' : '服务端不可用'}
                </AlertTitle>
                <AlertDescription>{serverTestResult.message}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleTestServerConnection}
              disabled={testingServer || !server.baseUrl}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer"
            >
              {testingServer ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  测试服务端...
                </>
              ) : (
                <>
                  <Server className="mr-2 h-4 w-4" />
                  测试服务端连接
                </>
              )}
            </Button>
          </CardContent>
        </Card>

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
                  兼容模式 Provider 配置
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  当服务端模式关闭时，插件直接调用视觉模型
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
                      className={`relative text-xs sm:text-sm py-2.5 px-2 transition-all duration-200 cursor-pointer ${isActive
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

        <Card className="border-none shadow-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-lg">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-slate-900 dark:text-slate-100">
                  渲染与兼容 Pipeline
                </CardTitle>
                <CardDescription className="text-slate-600 dark:text-slate-400">
                  直接渲染仍然是默认体验；本地 hybrid 仅作为兼容模式保留
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                渲染模式
              </Label>
              <Select value={renderMode} onValueChange={(value) => setRenderMode(value as 'anchors-only' | 'strong-overlay-compat')}>
                <SelectTrigger className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-600 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strong-overlay-compat" className="cursor-pointer">
                    直接渲染到漫画中
                  </SelectItem>
                  <SelectItem value="anchors-only" className="cursor-pointer">
                    右侧阅读层 + 图上编号锚点
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                翻译 Pipeline
              </Label>
              <Select
                value={translationPipeline}
                onValueChange={(value) =>
                  setTranslationPipeline(
                    value as 'hybrid-regions' | 'full-image-vlm',
                  )
                }
              >
                <SelectTrigger className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-600 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full-image-vlm" className="cursor-pointer">
                    整图 VLM + 覆盖渲染
                  </SelectItem>
                  <SelectItem value="hybrid-regions" className="cursor-pointer">
                    本地检测分块 + VLM 批量翻译
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="region-batch-size"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                区域批大小
              </Label>
              <Input
                id="region-batch-size"
                type="number"
                min={1}
                max={20}
                value={regionBatchSize}
                onChange={(e) =>
                  setRegionBatchSize(
                    Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                  )
                }
                className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                单张图片按批次翻译文本块，默认 10。
              </p>
            </div>

            <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-50/80 dark:bg-slate-900/40">
              <div>
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  整图回退
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  区域批量翻译失败时，自动退回整图 VLM。
                </div>
              </div>
              <input
                type="checkbox"
                checked={fallbackToFullImage}
                onChange={(e) => setFallbackToFullImage(e.target.checked)}
                className="h-4 w-4 accent-teal-600 cursor-pointer"
              />
            </label>
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

            <div className="space-y-2">
              <Label
                htmlFor="translation-style"
                className="text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                翻译风格
              </Label>
              <Select
                value={translationStylePreset}
                onValueChange={(value) =>
                  setTranslationStylePreset(value as TranslationStylePreset)
                }
              >
                <SelectTrigger
                  id="translation-style"
                  className="h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-600 cursor-pointer"
                >
                  <SelectValue placeholder="选择翻译风格" />
                </SelectTrigger>
                <SelectContent>
                  {TRANSLATION_STYLE_PRESETS.map((preset) => (
                    <SelectItem
                      key={preset.value}
                      value={preset.value}
                      className="cursor-pointer"
                    >
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {
                  TRANSLATION_STYLE_PRESETS.find(
                    preset => preset.value === translationStylePreset,
                  )?.description
                }
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
        {/* ==================== Data Management Card ==================== */}
        <DataManagementCard />

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
