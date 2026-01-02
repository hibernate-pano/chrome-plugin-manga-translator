/**
 * Popup 组件 - 漫画翻译助手 v2
 * 
 * 极简设计，核心功能突出：
 * - 翻译开关（Requirements 1.1, 1.2, 1.3）
 * - Provider 选择
 * - 状态显示（Requirements 8.4）
 * - 设置入口
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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

const PROVIDER_INFO: Record<ProviderType, { name: string; icon: React.ReactNode; description: string }> = {
  openai: {
    name: 'OpenAI GPT-4V',
    icon: <Zap className="w-4 h-4" />,
    description: '高质量，云端',
  },
  claude: {
    name: 'Claude Vision',
    icon: <Cloud className="w-4 h-4" />,
    description: '高质量，云端',
  },
  deepseek: {
    name: 'DeepSeek VL',
    icon: <Cloud className="w-4 h-4" />,
    description: '性价比高，云端',
  },
  ollama: {
    name: 'Ollama',
    icon: <Server className="w-4 h-4" />,
    description: '本地，隐私友好',
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
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get current content script state
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'getState' });
            if (response?.controllerState) {
              setStatus(prev => ({
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
          setStatus(prev => ({
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
          setStatus(prev => ({
            ...prev,
            isProcessing: false,
            processedCount: request.processedCount ?? prev.processedCount,
          }));
          break;

        case 'error':
          setStatus(prev => ({
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
          setStatus(prev => ({
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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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

  const handleToggle = useCallback(async (checked: boolean) => {
    if (!isConfigured && checked) {
      // Not configured, guide user to settings
      chrome.runtime.openOptionsPage();
      return;
    }

    setStatus(prev => ({ ...prev, error: undefined }));
    setEnabled(checked);

    if (checked) {
      setStatus(prev => ({
        ...prev,
        isProcessing: true,
        processedCount: 0,
      }));
    } else {
      setStatus(prev => ({
        ...prev,
        isProcessing: false,
      }));
    }

    await notifyContentScript(checked);
  }, [isConfigured, setEnabled, notifyContentScript]);

  const handleProviderChange = useCallback((value: string) => {
    setProvider(value as ProviderType);
  }, [setProvider]);

  const handleRetry = useCallback(async () => {
    setStatus(prev => ({
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

  // ==================== Status Display Helpers ====================

  const getStatusText = useCallback((): string => {
    if (!isConfigured) {
      return '请先配置 API';
    }
    if (status.error) {
      return status.error.message;
    }
    if (status.isProcessing) {
      if (status.totalCount > 0) {
        return `正在翻译... (${status.processedCount}/${status.totalCount})`;
      }
      return `正在翻译... (${status.processedCount} 张)`;
    }
    if (enabled && status.processedCount > 0) {
      return `已翻译 ${status.processedCount} 张图片`;
    }
    if (enabled) {
      return '翻译已开启';
    }
    return '翻译已关闭';
  }, [isConfigured, status, enabled]);

  const getStatusColor = useCallback((): string => {
    if (!isConfigured) return 'text-yellow-600';
    if (status.error) return 'text-red-600';
    if (status.isProcessing) return 'text-blue-600';
    if (enabled) return 'text-green-600';
    return 'text-muted-foreground';
  }, [isConfigured, status.error, status.isProcessing, enabled]);

  const getStatusIcon = useCallback(() => {
    if (!isConfigured) {
      return <AlertCircle className="w-4 h-4 text-yellow-600" />;
    }
    if (status.error) {
      return <AlertCircle className="w-4 h-4 text-red-600" />;
    }
    if (status.isProcessing) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-600" />;
    }
    if (enabled && status.processedCount > 0) {
      return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    }
    return null;
  }, [isConfigured, status, enabled]);

  // ==================== Render ====================

  if (isLoading) {
    return (
      <div className="w-80 h-56 flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="w-80 bg-background">
      <Card className="border-0 shadow-none">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-center text-lg font-semibold text-primary">
            漫画翻译助手
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 pb-4">
          {/* Status Display */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <span className={`text-sm ${getStatusColor()}`}>
                {getStatusText()}
              </span>
            </div>
            {status.error?.suggestion && (
              <span className="text-xs text-muted-foreground text-center">
                {status.error.suggestion}
              </span>
            )}
          </div>

          {/* Retry Button (on error) */}
          {status.error?.retryable && (
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

          {/* Main Toggle - Core Interaction */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <Label
              htmlFor="main-toggle"
              className="text-base font-medium cursor-pointer"
            >
              翻译开关
            </Label>
            <Switch
              id="main-toggle"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={status.isProcessing}
              className="scale-125"
            />
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">AI 服务</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  <div className="flex items-center gap-2">
                    {PROVIDER_INFO[provider].icon}
                    <span>{PROVIDER_INFO[provider].name}</span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_INFO) as ProviderType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      {PROVIDER_INFO[key].icon}
                      <div className="flex flex-col">
                        <span>{PROVIDER_INFO[key].name}</span>
                        <span className="text-xs text-muted-foreground">
                          {PROVIDER_INFO[key].description}
                        </span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Configuration Warning */}
          {!isConfigured && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>
                {provider === 'ollama'
                  ? '请配置 Ollama 服务地址'
                  : '请配置 API 密钥'}
              </span>
            </div>
          )}

          {/* Settings Button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={openSettings}
          >
            <Settings className="w-4 h-4 mr-2" />
            设置
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default PopupApp;
