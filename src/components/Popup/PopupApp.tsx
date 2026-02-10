/**
 * Popup 组件 - 漫画翻译助手 v2
 *
 * 专业设计，质感提升：
 * - 翻译开关（Requirements 1.1, 1.2, 1.3）
 * - Provider 选择
 * - 状态显示（Requirements 8.4）
 * - 设置入口
 * - 微交互动画、渐变背景、进度可视化
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Settings,
  AlertCircle,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Zap,
  Cloud,
  Server,
  Languages,
  Sparkles,
} from 'lucide-react';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';

// ==================== Types ====================

interface TranslationStatus {
  isProcessing: boolean;
  processedCount: number;
  totalCount: number;
  error?: {
    code: string;
    title: string;
    message: string;
    suggestion: string;
    retryable: boolean;
  };
}

// ==================== Provider Display Info ====================

const PROVIDER_INFO: Record<
  ProviderType,
  { name: string; icon: React.ReactNode; description: string; color: string }
> = {
  siliconflow: {
    name: '硅基流动',
    icon: <Zap className="w-4 h-4" />,
    description: '国内首选，性价比高',
    color: 'from-teal-500 to-cyan-500',
  },
  dashscope: {
    name: '阿里云百炼',
    icon: <Cloud className="w-4 h-4" />,
    description: '阿里云官方，稳定',
    color: 'from-blue-500 to-indigo-500',
  },
  openai: {
    name: 'OpenAI GPT-4V',
    icon: <Sparkles className="w-4 h-4" />,
    description: '高质量，云端',
    color: 'from-emerald-500 to-teal-500',
  },
  claude: {
    name: 'Claude Vision',
    icon: <Cloud className="w-4 h-4" />,
    description: '高质量，云端',
    color: 'from-purple-500 to-pink-500',
  },
  deepseek: {
    name: 'DeepSeek VL',
    icon: <Cloud className="w-4 h-4" />,
    description: '性价比高，云端',
    color: 'from-violet-500 to-purple-500',
  },
  ollama: {
    name: 'Ollama',
    icon: <Server className="w-4 h-4" />,
    description: '本地，隐私友好',
    color: 'from-slate-500 to-gray-500',
  },
};

// ==================== Component ====================

const PopupApp: React.FC = () => {
  // Local state
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<TranslationStatus>({
    isProcessing: false,
    processedCount: 0,
    totalCount: 0,
  });

  // Config store
  const {
    enabled,
    provider,
    setEnabled,
    setProvider,
    isProviderConfigured,
  } = useAppConfigStore();

  // Check if current provider is configured
  const isConfigured = isProviderConfigured();

  // ==================== Initialization ====================

  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsLoading(true);
        // Wait for store to hydrate from Chrome Storage
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Get current content script state
        try {
          const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (tabs[0]?.id) {
            const response = await chrome.tabs.sendMessage(tabs[0].id, {
              action: 'getState',
            });
            if (response?.controllerState) {
              setStatus((prev) => ({
                ...prev,
                processedCount: response.controllerState.processedCount || 0,
                isProcessing: response.controllerState.isProcessing || false,
              }));
            }
          }
        } catch {
          // Content script may not be injected, silently handle
        }
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // ==================== Message Listener ====================

  useEffect(() => {
    const handleMessage = (request: {
      action: string;
      count?: number;
      total?: number;
      message?: string;
      processedCount?: number;
      error?: TranslationStatus['error'];
    }) => {
      switch (request.action) {
        case 'processingUpdate':
          setStatus((prev) => ({
            ...prev,
            isProcessing: true,
            processedCount: request.count ?? prev.processedCount,
            totalCount: request.total ?? prev.totalCount,
            error: undefined,
          }));
          break;

        case 'processingStart':
          setStatus({
            isProcessing: true,
            processedCount: 0,
            totalCount: request.total ?? 0,
            error: undefined,
          });
          break;

        case 'complete':
          setStatus((prev) => ({
            ...prev,
            isProcessing: false,
            processedCount: request.processedCount ?? prev.processedCount,
          }));
          break;

        case 'error':
          setStatus((prev) => ({
            ...prev,
            isProcessing: false,
            error: request.error || {
              code: 'UNKNOWN_ERROR',
              title: '错误',
              message: request.message || '未知错误',
              suggestion: '请稍后重试',
              retryable: true,
            },
          }));
          break;

        case 'noImages':
          setStatus((prev) => ({
            ...prev,
            isProcessing: false,
            processedCount: 0,
          }));
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // ==================== Actions ====================

  const notifyContentScript = useCallback(async (newEnabled: boolean) => {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]?.id) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          action: 'toggleTranslation',
          enabled: newEnabled,
        });
      }
    } catch {
      // Content script may not be injected, silently handle
    }
  }, []);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (!isConfigured && checked) {
        // Not configured, guide user to settings
        chrome.runtime.openOptionsPage();
        return;
      }

      setStatus((prev) => ({ ...prev, error: undefined }));
      setEnabled(checked);

      if (checked) {
        setStatus((prev) => ({
          ...prev,
          isProcessing: true,
          processedCount: 0,
        }));
      } else {
        setStatus((prev) => ({
          ...prev,
          isProcessing: false,
        }));
      }

      await notifyContentScript(checked);
    },
    [isConfigured, setEnabled, notifyContentScript],
  );

  const handleProviderChange = useCallback(
    (value: string) => {
      setProvider(value as ProviderType);
    },
    [setProvider],
  );

  const handleRetry = useCallback(async () => {
    setStatus((prev) => ({
      ...prev,
      error: undefined,
      isProcessing: true,
      processedCount: 0,
    }));
    await notifyContentScript(true);
  }, [notifyContentScript]);

  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  // ==================== Progress Calculation ====================

  const progress = status.totalCount > 0
    ? (status.processedCount / status.totalCount) * 100
    : 0;

  // ==================== Render ====================

  if (isLoading) {
    return (
      <div className="w-[360px] h-[480px] flex flex-col items-center justify-center bg-gradient-to-br from-teal-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-800 dark:to-teal-900">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600 dark:text-teal-400" />
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          加载中...
        </p>
      </div>
    );
  }

  return (
    <div className="w-[360px] min-h-[480px] bg-gradient-to-br from-teal-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-800 dark:to-teal-900">
      {/* Header with gradient */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-teal-600 to-cyan-600 dark:from-teal-700 dark:to-cyan-700 opacity-90" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNjAgMTAgTSAxMCAwIEwgMTAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-30" />

        <CardHeader className="relative pb-6 pt-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="p-2 bg-white/20 dark:bg-white/10 rounded-lg backdrop-blur-sm">
              <Languages className="w-6 h-6 text-white" />
            </div>
          </div>
          <h1 className="text-center text-xl font-bold text-white tracking-tight">
            漫画翻译助手
          </h1>
          <p className="text-center text-sm text-white/80 mt-1">
            AI 驱动的智能翻译工具
          </p>
        </CardHeader>
      </div>

      <CardContent className="space-y-4 pt-6 pb-6 px-5">
        {/* Status Card */}
        <Card className="border-none shadow-md bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm transition-all duration-200 hover:shadow-lg">
          <CardContent className="pt-4 pb-4">
            {/* Status Display */}
            {!isConfigured ? (
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    需要配置
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {provider === 'ollama'
                      ? '请配置 Ollama 服务地址'
                      : '请先配置 API 密钥'}
                  </p>
                </div>
              </div>
            ) : status.error ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {status.error.title}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      {status.error.message}
                    </p>
                    {status.error.suggestion && (
                      <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                        💡 {status.error.suggestion}
                      </p>
                    )}
                  </div>
                </div>
                {status.error.retryable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleRetry}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    重试
                  </Button>
                )}
              </div>
            ) : status.isProcessing ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-teal-600 dark:text-teal-400" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        正在翻译...
                      </p>
                      {status.totalCount > 0 && (
                        <span className="text-sm font-mono text-slate-600 dark:text-slate-400">
                          {status.processedCount}/{status.totalCount}
                        </span>
                      )}
                    </div>
                    {status.totalCount === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        已处理 {status.processedCount} 张图片
                      </p>
                    )}
                  </div>
                </div>
                {status.totalCount > 0 && (
                  <Progress
                    value={progress}
                    className="h-2 bg-slate-200 dark:bg-slate-700"
                  />
                )}
              </div>
            ) : enabled && status.processedCount > 0 ? (
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    翻译完成
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    已翻译 {status.processedCount} 张图片
                  </p>
                </div>
              </div>
            ) : enabled ? (
              <div className="flex items-center gap-3">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    翻译已开启
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    等待图片检测...
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                  <Languages className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    翻译已关闭
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    开启开关以开始翻译
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Main Toggle */}
        <Card className="border-none shadow-md bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm transition-all duration-200 hover:shadow-lg">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg transition-colors duration-200 ${
                    enabled
                      ? 'bg-teal-100 dark:bg-teal-900/30'
                      : 'bg-slate-100 dark:bg-slate-700'
                  }`}
                >
                  <Zap
                    className={`w-5 h-5 transition-colors duration-200 ${
                      enabled
                        ? 'text-teal-600 dark:text-teal-400'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  />
                </div>
                <div>
                  <Label
                    htmlFor="main-toggle"
                    className="text-base font-semibold cursor-pointer text-slate-900 dark:text-slate-100"
                  >
                    翻译开关
                  </Label>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {enabled ? '点击关闭' : '点击开启'}
                  </p>
                </div>
              </div>
              <Switch
                id="main-toggle"
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={status.isProcessing}
                className="scale-110 data-[state=checked]:bg-teal-600"
              />
            </div>
          </CardContent>
        </Card>

        {/* Provider Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            AI 服务商
          </Label>
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger className="w-full h-12 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm transition-all duration-200 hover:border-teal-400 dark:hover:border-teal-600 cursor-pointer">
              <SelectValue>
                <div className="flex items-center gap-3">
                  <div
                    className={`p-1.5 bg-gradient-to-br ${PROVIDER_INFO[provider].color} rounded-md`}
                  >
                    <div className="text-white">
                      {PROVIDER_INFO[provider].icon}
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {PROVIDER_INFO[provider].name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {PROVIDER_INFO[provider].description}
                    </div>
                  </div>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_INFO) as ProviderType[]).map((key) => (
                <SelectItem
                  key={key}
                  value={key}
                  className="cursor-pointer py-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-1.5 bg-gradient-to-br ${PROVIDER_INFO[key].color} rounded-md`}
                    >
                      <div className="text-white">{PROVIDER_INFO[key].icon}</div>
                    </div>
                    <div>
                      <div className="font-medium">{PROVIDER_INFO[key].name}</div>
                      <div className="text-xs text-muted-foreground">
                        {PROVIDER_INFO[key].description}
                      </div>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Settings Button */}
        <Button
          variant="outline"
          className="w-full h-11 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-md cursor-pointer"
          onClick={openSettings}
        >
          <Settings className="w-4 h-4 mr-2" />
          <span className="font-medium">高级设置</span>
        </Button>

        {/* Footer Badge */}
        <div className="flex justify-center pt-2">
          <Badge
            variant="secondary"
            className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-none px-3 py-1"
          >
            <Sparkles className="w-3 h-3 mr-1.5" />
            Powered by AI
          </Badge>
        </div>
      </CardContent>
    </div>
  );
};

export default PopupApp;
