import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Settings, AlertCircle, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import { useTranslationStore, TranslationError } from '@/stores/translation';
import { useConfigStore } from '@/stores/config';

/**
 * 简化版 Popup 组件
 * 
 * 核心功能：
 * - 翻译开关（Requirements 1.1, 1.2, 1.3）
 * - 状态显示
 * - 设置入口
 * 
 * 通信流程：
 * - Popup → Content Script: toggleTranslation 消息
 * - Content Script → Popup: processingUpdate, complete, error 消息
 */
const SimplePopupApp: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [lastError, setLastError] = useState<TranslationError | null>(null);

  // Zustand stores
  const { enabled, setEnabled, processing, setProcessing, setError, clearError } = useTranslationStore();
  const { providerType, providerConfig } = useConfigStore();

  // 检查 API 是否已配置
  const isConfigured = useCallback((): boolean => {
    const currentConfig = providerConfig[providerType];
    
    // Ollama 不需要 API 密钥，只需要服务地址
    if (providerType === 'ollama') {
      return !!(currentConfig?.apiBaseUrl && currentConfig.apiBaseUrl.length > 0);
    }
    
    // 其他提供者需要 API 密钥
    return !!(currentConfig?.apiKey && currentConfig.apiKey.length > 0);
  }, [providerConfig, providerType]);

  // 初始化
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsLoading(true);
        // 等待 store 从 Chrome Storage 加载
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 获取当前内容脚本状态
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            const response = await chrome.tabs.sendMessage(tabs[0].id, { action: 'getState' });
            if (response?.controllerState) {
              setProcessedCount(response.controllerState.processedCount || 0);
              if (response.controllerState.isProcessing) {
                setProcessing(true);
              }
            }
          }
        } catch {
          // 内容脚本可能未注入，静默处理
        }
      } catch {
        // 初始化错误静默处理
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [setProcessing]);

  // 监听内容脚本消息
  useEffect(() => {
    const handleMessage = (request: { 
      action: string; 
      count?: number;
      total?: number;
      message?: string;
      processedCount?: number;
      successCount?: number;
      errorCount?: number;
      error?: {
        code: string;
        title: string;
        message: string;
        suggestion: string;
        retryable: boolean;
      };
    }) => {
      switch (request.action) {
        case 'processingUpdate':
          if (request.count !== undefined) {
            setProcessedCount(request.count);
          }
          if (request.total !== undefined) {
            setTotalCount(request.total);
          }
          setProcessing(true);
          setLastError(null);
          clearError();
          break;
          
        case 'processingStart':
          setProcessing(true);
          setProcessedCount(0);
          if (request.total !== undefined) {
            setTotalCount(request.total);
          }
          setLastError(null);
          clearError();
          break;
          
        case 'complete':
          setProcessing(false);
          if (request.processedCount !== undefined) {
            setProcessedCount(request.processedCount);
          }
          break;
          
        case 'error':
          setProcessing(false);
          // 处理结构化错误信息
          if (request.error) {
            const errorInfo: TranslationError = {
              code: request.error.code,
              title: request.error.title,
              message: request.error.message,
              suggestion: request.error.suggestion,
              retryable: request.error.retryable,
              timestamp: Date.now(),
            };
            setLastError(errorInfo);
            setError(errorInfo);
          } else if (request.message) {
            // 兼容旧格式
            const errorInfo: TranslationError = {
              code: 'UNKNOWN_ERROR',
              title: '错误',
              message: request.message,
              suggestion: '请稍后重试',
              retryable: true,
              timestamp: Date.now(),
            };
            setLastError(errorInfo);
            setError(errorInfo);
          }
          break;
          
        case 'noImages':
          setProcessing(false);
          setProcessedCount(0);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [setProcessing, setError, clearError]);

  // 通知内容脚本状态变化
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
      // 内容脚本可能未注入，静默处理
    }
  }, []);

  // 打开设置页面
  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  // 切换翻译开关
  const handleToggle = useCallback(async (checked: boolean) => {
    if (!isConfigured() && checked) {
      // 未配置 API 时，引导用户去设置
      chrome.runtime.openOptionsPage();
      return;
    }
    
    setLastError(null);
    clearError();
    setEnabled(checked);
    
    if (checked) {
      setProcessing(true);
      setProcessedCount(0);
    } else {
      setProcessing(false);
    }
    
    await notifyContentScript(checked);
  }, [isConfigured, setEnabled, setProcessing, notifyContentScript, clearError]);

  // 重试翻译
  const handleRetry = useCallback(async () => {
    setLastError(null);
    clearError();
    setProcessing(true);
    setProcessedCount(0);
    await notifyContentScript(true);
  }, [notifyContentScript, setProcessing, clearError]);

  // 获取状态文本
  const getStatusText = useCallback((): string => {
    if (!isConfigured()) {
      return '请先配置 API 密钥';
    }
    if (lastError) {
      return lastError.message;
    }
    if (processing) {
      if (totalCount > 0) {
        return `正在翻译... (${processedCount}/${totalCount} 张)`;
      }
      return `正在翻译... (${processedCount} 张)`;
    }
    if (enabled && processedCount > 0) {
      return `翻译已开启 (已处理 ${processedCount} 张)`;
    }
    if (enabled) {
      return '翻译已开启';
    }
    return '翻译已关闭';
  }, [isConfigured, lastError, processing, totalCount, processedCount, enabled]);

  // 获取错误建议
  const getErrorSuggestion = useCallback((): string | null => {
    if (lastError?.suggestion) {
      return lastError.suggestion;
    }
    return null;
  }, [lastError]);

  // 获取状态颜色
  const getStatusColor = useCallback((): string => {
    if (!isConfigured()) {
      return 'text-yellow-600';
    }
    if (lastError) {
      return 'text-red-600';
    }
    if (processing) {
      return 'text-blue-600';
    }
    if (enabled) {
      return 'text-green-600';
    }
    return 'text-muted-foreground';
  }, [isConfigured, lastError, processing, enabled]);

  // 获取状态图标
  const getStatusIcon = useCallback(() => {
    if (!isConfigured()) {
      return <AlertCircle className="w-4 h-4 text-yellow-600" />;
    }
    if (lastError) {
      return <AlertCircle className="w-4 h-4 text-red-600" />;
    }
    if (processing) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-600" />;
    }
    if (enabled && processedCount > 0) {
      return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    }
    return null;
  }, [isConfigured, lastError, processing, enabled, processedCount]);

  // 加载状态
  if (isLoading) {
    return (
      <div className="w-72 h-48 flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="w-72 bg-background">
      <Card className="border-0 shadow-none">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-center text-lg font-semibold text-primary">
            漫画翻译助手
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 pb-4">
          {/* 状态显示 */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <span className={`text-sm ${getStatusColor()}`}>
                {getStatusText()}
              </span>
            </div>
            {/* 错误建议 */}
            {lastError && getErrorSuggestion() && (
              <span className="text-xs text-muted-foreground text-center">
                {getErrorSuggestion()}
              </span>
            )}
          </div>

          {/* 错误时显示重试按钮 */}
          {lastError && lastError.retryable && (
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

          {/* 翻译开关 - 核心交互 */}
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
              disabled={processing}
              className="scale-125"
            />
          </div>

          {/* 设置入口 */}
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

export default SimplePopupApp;
