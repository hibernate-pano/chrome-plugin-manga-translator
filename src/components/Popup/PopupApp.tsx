/**
 * Popup 组件 - 漫画翻译助手 v3
 *
 * 重设计：操作驱动型 UI + Onboarding 引导
 * - 主操作按钮：翻译当前页面 / 翻译中状态 / 完成状态
 * - 次级操作：点击选图翻译（hover-select 模式）
 * - Onboarding：首次使用引导用户配置 API Key
 * - 底部：快捷键提示 + 清除覆盖层 + API Key 警告
 * - Provider/Model 信息展示
 * - framer-motion 动画过渡
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Settings,
  AlertTriangle,
  CheckCircle2,
  X,
  BookOpen,
  MousePointer,
  Trash2,
  Loader2,
  Zap,
  Cloud,
  Server,
  Sparkles,
  Keyboard,
  ChevronRight,
} from 'lucide-react';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';

// ==================== Types ====================

interface ContentState {
  status: 'idle' | 'scanning' | 'translating' | 'complete' | 'hover-select' | 'error';
  current?: number;
  total?: number;
  count?: number;
  message?: string;
  session: {
    sessionId: string | null;
    queuedCount: number;
    translatedCount: number;
    failedCount: number;
    skippedCount: number;
    cachedCount: number;
    lastError: string | null;
  };
}

type PopupToContentMsg =
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'ENTER_HOVER_SELECT' }
  | { type: 'EXIT_HOVER_SELECT' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' }
  | { type: 'RETRY_FAILED' };

function createEmptySession(): ContentState['session'] {
  return {
    sessionId: null,
    queuedCount: 0,
    translatedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    cachedCount: 0,
    lastError: null,
  };
}

// ==================== Provider Display Info ====================

const PROVIDER_INFO: Record<
  ProviderType,
  { name: string; icon: React.ReactNode; color: string }
> = {
  siliconflow: {
    name: '硅基流动',
    icon: <Zap className="w-3.5 h-3.5" />,
    color: 'from-teal-500 to-cyan-500',
  },
  dashscope: {
    name: '阿里云百炼',
    icon: <Cloud className="w-3.5 h-3.5" />,
    color: 'from-blue-500 to-indigo-500',
  },
  openai: {
    name: 'OpenAI',
    icon: <Sparkles className="w-3.5 h-3.5" />,
    color: 'from-emerald-500 to-teal-500',
  },
  claude: {
    name: 'Claude',
    icon: <Cloud className="w-3.5 h-3.5" />,
    color: 'from-purple-500 to-pink-500',
  },
  deepseek: {
    name: 'DeepSeek',
    icon: <Cloud className="w-3.5 h-3.5" />,
    color: 'from-violet-500 to-purple-500',
  },
  ollama: {
    name: 'Ollama',
    icon: <Server className="w-3.5 h-3.5" />,
    color: 'from-slate-500 to-gray-500',
  },
};

// ==================== 错误信息优化 ====================

/**
 * 将内部错误信息转换为用户友好的文案
 */
function friendlyError(message: string): { title: string; action?: string } {
  if (message.includes('API key') || message.includes('api_key') || message.includes('API Key')) {
    return { title: 'API Key 无效或未配置', action: '去设置' };
  }
  if (message.includes('401') || message.includes('Unauthorized')) {
    return { title: 'API Key 认证失败，请检查是否正确', action: '去设置' };
  }
  if (message.includes('429') || message.includes('rate limit') || message.includes('Rate limit')) {
    return { title: 'API 请求频率超限，请稍后重试' };
  }
  if (message.includes('timeout') || message.includes('Timeout')) {
    return { title: '请求超时，请检查网络连接后重试' };
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('CORS')) {
    return { title: '网络错误，请检查网络连接' };
  }
  if (message.includes('Background script') || message.includes('无响应')) {
    return { title: '插件通信失败，请刷新页面后重试' };
  }
  if (message.includes('没有找到') || message.includes('no images') || message.includes('No images')) {
    return { title: '未找到可翻译的漫画图片' };
  }
  // 超过 50 字截断
  return { title: message.length > 50 ? `${message.substring(0, 50)}...` : message };
}

// ==================== Utils ====================

async function sendToContent(msg: PopupToContentMsg): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, msg);
    }
  } catch {
    // Content script may not be injected
  }
}

// ==================== Component ====================

const PopupApp: React.FC = () => {
  const [contentState, setContentState] = useState<ContentState>({
    status: 'idle',
    session: createEmptySession(),
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store selectors
  const provider = useAppConfigStore(state => state.provider);
  const executionMode = useAppConfigStore(state => state.executionMode);
  const server = useAppConfigStore(state => state.server);
  const providers = useAppConfigStore(state => state.providers);
  const enabled = useAppConfigStore(state => state.enabled);
  const setEnabled = useAppConfigStore(state => state.setEnabled);
  const isProviderConfigured = useAppConfigStore(
    state => state.isProviderConfigured
  );
  const isServerConfigured = useAppConfigStore(state => state.isServerConfigured);

  const currentProviderSettings = providers[provider];
  const isConfigured =
    executionMode === 'server' ? isServerConfigured() : isProviderConfigured();
  const providerInfo = PROVIDER_INFO[provider];
  const modelName = currentProviderSettings?.model || '默认模型';
  const headerModeLabel =
    executionMode === 'server'
      ? server.baseUrl || '服务端 OCR-First'
      : modelName;

  // ==================== Init ====================

  useEffect(() => {
    const init = async () => {
      try {
        // Wait for store to hydrate
        await new Promise(resolve => setTimeout(resolve, 80));

        // Try to get current state from content script
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id) {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, {
              type: 'GET_STATE',
            });
            if (response?.state) {
              setContentState(response.state);
            }
          } catch {
            // Content script not injected yet
          }
        }
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  // ==================== Message Listener ====================

  useEffect(() => {
    const handleMessage = (msg: { type: string; state?: ContentState }) => {
      if (msg.type === 'STATE_UPDATE' && msg.state) {
        setContentState(msg.state);

        // Auto-reset complete state after 2.5s
        if (msg.state.status === 'complete') {
          if (completeTimerRef.current) {
            clearTimeout(completeTimerRef.current);
          }
          completeTimerRef.current = setTimeout(() => {
            setContentState({
              status: 'idle',
              session: msg.state?.session ?? createEmptySession(),
            });
          }, 2500);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
      }
    };
  }, []);

  // ==================== Actions ====================

  const handleTranslatePage = useCallback(async () => {
    if (contentState.status === 'translating' || contentState.status === 'scanning') {
      await sendToContent({ type: 'CANCEL_TRANSLATION' });
      setContentState({ status: 'idle', session: contentState.session });
      return;
    }
    setContentState({ status: 'scanning', session: contentState.session });
    await sendToContent({ type: 'TRANSLATE_PAGE' });
  }, [contentState.session, contentState.status]);

  const handleHoverSelect = useCallback(async () => {
    if (contentState.status === 'hover-select') {
      await sendToContent({ type: 'EXIT_HOVER_SELECT' });
      setContentState({ status: 'idle', session: contentState.session });
      return;
    }
    setContentState({ status: 'hover-select', session: contentState.session });
    await sendToContent({ type: 'ENTER_HOVER_SELECT' });
    // Close popup so user can interact with page
    window.close();
  }, [contentState.session, contentState.status]);

  const handleClearAll = useCallback(async () => {
    await sendToContent({ type: 'CLEAR_ALL' });
    setContentState({ status: 'idle', session: createEmptySession() });
  }, []);

  const handleForceRetranslate = useCallback(async () => {
    setContentState({ status: 'scanning', session: createEmptySession() });
    await sendToContent({ type: 'FORCE_RETRANSLATE_PAGE' });
  }, []);

  const handleAutoTranslateToggle = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
    },
    [setEnabled]
  );

  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  // ==================== Derived State ====================

  const isTranslating =
    contentState.status === 'translating' ||
    contentState.status === 'scanning';

  const progress =
    contentState.status === 'translating' && (contentState.total ?? 0) > 0
      ? ((contentState.current ?? 0) / (contentState.total ?? 1)) * 100
      : 0;

  const errorInfo = contentState.status === 'error'
    ? friendlyError(contentState.message ?? 'Unknown error')
    : null;

  // ==================== Render ====================

  if (isLoading) {
    return (
      <div className="w-[360px] h-[480px] flex items-center justify-center bg-[#0f1117]">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
      </div>
    );
  }

  return (
    <div className="w-[360px] h-[480px] bg-[#0f1117] flex flex-col overflow-hidden">
      {/* ---- Header ---- */}
      <div className="relative flex items-center justify-between px-5 py-4 bg-gradient-to-r from-teal-600/90 to-cyan-600/90 shrink-0">
        {/* Subtle grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(255,255,255,0.3) 19px, rgba(255,255,255,0.3) 20px), repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.3) 19px, rgba(255,255,255,0.3) 20px)',
          }}
        />
        {/* Left: logo + title */}
        <div className="relative flex items-center gap-2.5">
          <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-none">
              漫画翻译
            </h1>
            <div className="flex items-center gap-1 mt-1">
              <div
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${executionMode === 'server'
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                  : `bg-gradient-to-r ${providerInfo.color}`
                  }`}
              >
                <span className="text-white">
                  {executionMode === 'server' ? (
                    <Server className="w-3.5 h-3.5" />
                  ) : (
                    providerInfo.icon
                  )}
                </span>
                <span className="text-white text-[10px] font-medium leading-none">
                  {executionMode === 'server' ? 'OCR 服务端' : providerInfo.name}
                </span>
              </div>
              <span className="text-white/60 text-[10px] leading-none">
                {headerModeLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Right: settings button */}
        <button
          onClick={openSettings}
          className="relative p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
          title="打开设置"
        >
          <Settings className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* ---- API Key Warning Banner (Onboarding) ---- */}
      <AnimatePresence>
        {!isConfigured && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden shrink-0"
          >
            <button
              onClick={openSettings}
              className="w-full flex items-center gap-2 px-4 py-3 bg-amber-500/15 border-b border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer text-left"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-amber-300 font-medium">
                  {executionMode === 'server' ? '需要配置服务端' : '需要配置 API Key'}
                </p>
                <p className="text-[11px] text-amber-400/70 mt-0.5">
                  {executionMode === 'server'
                    ? '点击前往设置，填写服务端地址并启用服务端模式'
                    : '点击此处前往设置，填写您的 API Key'}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-amber-400 shrink-0" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Main Action Area ---- */}
      <div className="flex-1 flex flex-col justify-center gap-4 px-5 py-6">
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-slate-100">自动翻译模式</div>
            <div className="mt-1 text-[11px] text-slate-400">
              页面后续懒加载的新漫画图片也会继续翻译
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleAutoTranslateToggle}
          />
        </div>

        {/* Primary Button: Translate Page */}
        <div className="relative">
          <AnimatePresence mode="wait">
            {contentState.status === 'complete' ? (
              /* Complete state */
              <motion.div
                key="complete"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="w-full h-14 flex items-center justify-center gap-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-300 font-medium">
                  {contentState.session.translatedCount > 0 ||
                  contentState.session.failedCount > 0
                    ? `成功 ${contentState.session.translatedCount}，失败 ${contentState.session.failedCount}`
                    : '未找到可翻译的图片'}
                </span>
              </motion.div>
            ) : isTranslating ? (
              /* Translating state */
              <motion.div
                key="translating"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="w-full rounded-xl bg-teal-600/10 border border-teal-500/20 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
                    <span className="text-teal-300 font-medium text-sm">
                      {contentState.status === 'scanning'
                        ? '正在扫描图片...'
                        : `${contentState.current ?? 0} / ${contentState.total ?? 0} 已处理`}
                    </span>
                  </div>
                  <button
                    onClick={handleTranslatePage}
                    className="text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-white/5"
                  >
                    取消
                  </button>
                </div>
                {contentState.status === 'translating' &&
                  (contentState.total ?? 0) > 0 && (
                    <Progress
                      value={progress}
                      className="h-1 rounded-none bg-teal-900/40"
                    />
                  )}
              </motion.div>
            ) : (
              /* Idle state: main button */
              <motion.div
                key="idle"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <button
                  onClick={handleTranslatePage}
                  disabled={!isConfigured}
                  className="w-full h-14 flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-teal-900/30 hover:shadow-teal-800/40 cursor-pointer"
                >
                  <BookOpen className="w-5 h-5 text-white" />
                  <span className="text-white font-semibold text-base">
                    翻译当前页面
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/5" />
          <span className="text-xs text-slate-600">或</span>
          <div className="flex-1 h-px bg-white/5" />
        </div>

        {/* Secondary Button: Hover Select */}
        <AnimatePresence mode="wait">
          {contentState.status === 'hover-select' ? (
            <motion.div
              key="hover-select-active"
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full h-12 flex items-center justify-center gap-2.5 rounded-xl bg-cyan-600/15 border border-cyan-500/40"
            >
              <MousePointer className="w-4 h-4 text-cyan-400" />
              <span className="text-cyan-300 text-sm font-medium">
                请点击要翻译的图片...
              </span>
              <button
                onClick={handleHoverSelect}
                className="ml-1 p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="hover-select-idle"
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <button
                onClick={handleHoverSelect}
                disabled={!isConfigured}
                className="w-full h-12 flex items-center justify-center gap-2.5 rounded-xl border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              >
                <MousePointer className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300 text-sm font-medium">
                  点击选图翻译
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error State — 用户友好的错误信息 */}
        <AnimatePresence>
          {contentState.status === 'error' && errorInfo && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-red-300 leading-relaxed">
                  {errorInfo.title}
                </p>
                {errorInfo.action && (
                  <button
                    onClick={openSettings}
                    className="mt-1.5 text-[11px] text-teal-400 hover:text-teal-300 underline underline-offset-2 cursor-pointer"
                  >
                    {errorInfo.action} →
                  </button>
                )}
              </div>
              <button
                onClick={() =>
                  setContentState({
                    status: 'idle',
                    session: contentState.session,
                  })
                }
                className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-slate-500" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {contentState.status === 'complete' &&
          contentState.session.failedCount > 0 && (
            <button
              onClick={() => sendToContent({ type: 'RETRY_FAILED' })}
              className="w-full h-10 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm font-medium hover:bg-amber-500/15 transition-colors cursor-pointer"
            >
              重试失败项
            </button>
          )}

        {!isTranslating && (
          <button
            onClick={handleForceRetranslate}
            disabled={!isConfigured}
            className="w-full h-10 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-sm font-medium hover:bg-cyan-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            强制重翻全部
          </button>
        )}
      </div>

      {/* ---- Footer ---- */}
      <div className="shrink-0 border-t border-white/5 px-5 py-3 flex items-center justify-between">
        <button
          onClick={handleClearAll}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          清除覆盖层
        </button>

        {/* 快捷键提示 */}
        <div className="relative">
          <button
            onClick={() => setShowShortcuts(s => !s)}
            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 transition-colors cursor-pointer"
            title="查看快捷键"
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>快捷键</span>
          </button>

          <AnimatePresence>
            {showShortcuts && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute bottom-full right-0 mb-2 w-48 rounded-lg bg-[#1a1f2e] border border-white/8 shadow-xl p-3 text-xs"
              >
                <p className="text-slate-400 font-medium mb-2">键盘快捷键</p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">翻译页面 / 停止</span>
                    <kbd className="px-1.5 py-0.5 bg-white/8 rounded text-slate-400 font-mono text-[10px]">Alt+T</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">选图翻译模式</span>
                    <kbd className="px-1.5 py-0.5 bg-white/8 rounded text-slate-400 font-mono text-[10px]">Alt+H</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">取消 / 退出</span>
                    <kbd className="px-1.5 py-0.5 bg-white/8 rounded text-slate-400 font-mono text-[10px]">Esc</kbd>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default PopupApp;
