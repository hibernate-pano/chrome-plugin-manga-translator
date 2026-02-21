/**
 * Popup 组件 - 漫画翻译助手 v3
 *
 * 重设计：操作驱动型 UI
 * - 主操作按钮：翻译当前页面 / 翻译中状态 / 完成状态
 * - 次级操作：点击选图翻译（hover-select 模式）
 * - 底部：清除覆盖层 + API Key 警告
 * - Provider/Model 信息展示
 * - framer-motion 动画过渡
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '@/components/ui/progress';
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
} from 'lucide-react';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';

// ==================== Types ====================

type ContentState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'translating'; current: number; total: number }
  | { status: 'complete'; count: number }
  | { status: 'hover-select' }
  | { status: 'error'; message: string };

type PopupToContentMsg =
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'ENTER_HOVER_SELECT' }
  | { type: 'EXIT_HOVER_SELECT' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' };

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
  });
  const [isLoading, setIsLoading] = useState(true);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store selectors
  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  const isProviderConfigured = useAppConfigStore(
    state => state.isProviderConfigured
  );

  const currentProviderSettings = providers[provider];
  const isConfigured = isProviderConfigured();
  const providerInfo = PROVIDER_INFO[provider];
  const modelName = currentProviderSettings?.model || '默认模型';

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

        // Auto-reset complete state after 2s
        if (msg.state.status === 'complete') {
          if (completeTimerRef.current) {
            clearTimeout(completeTimerRef.current);
          }
          completeTimerRef.current = setTimeout(() => {
            setContentState({ status: 'idle' });
          }, 2000);
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
      setContentState({ status: 'idle' });
      return;
    }
    setContentState({ status: 'scanning' });
    await sendToContent({ type: 'TRANSLATE_PAGE' });
  }, [contentState.status]);

  const handleHoverSelect = useCallback(async () => {
    if (contentState.status === 'hover-select') {
      await sendToContent({ type: 'EXIT_HOVER_SELECT' });
      setContentState({ status: 'idle' });
      return;
    }
    setContentState({ status: 'hover-select' });
    await sendToContent({ type: 'ENTER_HOVER_SELECT' });
    // Close popup so user can interact with page
    window.close();
  }, [contentState.status]);

  const handleClearAll = useCallback(async () => {
    await sendToContent({ type: 'CLEAR_ALL' });
    setContentState({ status: 'idle' });
  }, []);

  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  // ==================== Derived State ====================

  const isTranslating =
    contentState.status === 'translating' ||
    contentState.status === 'scanning';

  const progress =
    contentState.status === 'translating' && contentState.total > 0
      ? (contentState.current / contentState.total) * 100
      : 0;

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
                className={`flex items-center gap-1 bg-gradient-to-r ${providerInfo.color} rounded px-1.5 py-0.5`}
              >
                <span className="text-white">{providerInfo.icon}</span>
                <span className="text-white text-[10px] font-medium leading-none">
                  {providerInfo.name}
                </span>
              </div>
              <span className="text-white/60 text-[10px] leading-none">
                {modelName}
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

      {/* ---- API Key Warning Banner ---- */}
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
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-amber-500/15 border-b border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer text-left"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-xs text-amber-300">
                请先配置 API Key 才能使用翻译功能
              </span>
              <span className="ml-auto text-xs text-amber-400 font-medium shrink-0">
                去设置 →
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Main Action Area ---- */}
      <div className="flex-1 flex flex-col justify-center gap-4 px-5 py-6">
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
                  已翻译 {contentState.count} 张图片
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
                        : `${contentState.current} / ${contentState.total} 已翻译`}
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
                  contentState.total > 0 && (
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

        {/* Error State */}
        <AnimatePresence>
          {contentState.status === 'error' && (
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
                  {contentState.message}
                </p>
              </div>
              <button
                onClick={() => setContentState({ status: 'idle' })}
                className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3 text-slate-500" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---- Footer ---- */}
      <div className="shrink-0 border-t border-white/5 px-5 py-3.5 flex items-center justify-between">
        <button
          onClick={handleClearAll}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          清除覆盖层
        </button>

        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
          <span className="text-xs text-slate-600">漫画翻译 v2</span>
        </div>
      </div>
    </div>
  );
};

export default PopupApp;
