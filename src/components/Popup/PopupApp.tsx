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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  RefreshCw,
  Globe,
} from 'lucide-react';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';
import { getPageAvailability, type PageAvailability } from './popup-state';

// ==================== Types ====================

type ContentState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'translating'; current: number; total: number }
  | { status: 'complete'; count: number }
  | { status: 'hover-select' }
  | { status: 'error'; message: string };

type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'ENTER_HOVER_SELECT' }
  | { type: 'EXIT_HOVER_SELECT' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' };

const TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简中' },
  { value: 'zh-TW', label: '繁中' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

// ==================== Provider Display Info ====================

const PROVIDER_INFO: Record<
  ProviderType,
  { name: string; icon: React.ReactNode; color: string }
> = {
  siliconflow: {
    name: '硅基流动',
    icon: <Zap className='h-3.5 w-3.5' />,
    color: 'from-teal-500 to-cyan-500',
  },
  dashscope: {
    name: '阿里云百炼',
    icon: <Cloud className='h-3.5 w-3.5' />,
    color: 'from-blue-500 to-indigo-500',
  },
  openai: {
    name: 'OpenAI',
    icon: <Sparkles className='h-3.5 w-3.5' />,
    color: 'from-emerald-500 to-teal-500',
  },
  claude: {
    name: 'Claude',
    icon: <Cloud className='h-3.5 w-3.5' />,
    color: 'from-purple-500 to-pink-500',
  },
  deepseek: {
    name: 'DeepSeek',
    icon: <Cloud className='h-3.5 w-3.5' />,
    color: 'from-violet-500 to-purple-500',
  },
  ollama: {
    name: 'Ollama',
    icon: <Server className='h-3.5 w-3.5' />,
    color: 'from-slate-500 to-gray-500',
  },
};

// ==================== Utils ====================

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab ?? null;
}

async function sendToContent(
  msg: PopupToContentMsg
): Promise<{ state?: ContentState } | null> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('未找到当前标签页');
  }

  return chrome.tabs.sendMessage(tab.id, msg);
}

// ==================== Component ====================

const PopupApp: React.FC = () => {
  const [contentState, setContentState] = useState<ContentState>({
    status: 'idle',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [pageAvailability, setPageAvailability] = useState<PageAvailability>({
    state: 'ready',
    message: '',
    canRefresh: false,
    canRetry: false,
  });
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store selectors
  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  const targetLanguage = useAppConfigStore(state => state.targetLanguage);
  const enabled = useAppConfigStore(state => state.enabled);
  const isProviderConfigured = useAppConfigStore(
    state => state.isProviderConfigured
  );
  const setProvider = useAppConfigStore(state => state.setProvider);
  const setTargetLanguage = useAppConfigStore(state => state.setTargetLanguage);
  const setEnabled = useAppConfigStore(state => state.setEnabled);

  const currentProviderSettings = providers[provider];
  const isConfigured = isProviderConfigured();
  const providerInfo = PROVIDER_INFO[provider];
  const modelName = currentProviderSettings?.model || '默认模型';

  const refreshPageStatus = useCallback(async () => {
    const tab = await getActiveTab();

    if (!tab) {
      setPageAvailability({
        state: 'unsupported',
        message: '未找到当前标签页，请重新打开扩展后重试。',
        canRefresh: false,
        canRetry: true,
      });
      return;
    }

    try {
      const response = await sendToContent({ type: 'GET_STATE' });
      if (response?.state) {
        setContentState(response.state);
      }
      setPageAvailability(
        getPageAvailability({
          url: tab.url,
          contentScriptReachable: true,
        })
      );
    } catch {
      setPageAvailability(
        getPageAvailability({
          url: tab.url,
          contentScriptReachable: false,
        })
      );
    }
  }, []);

  // ==================== Init ====================

  useEffect(() => {
    const init = async () => {
      try {
        // Wait for store to hydrate
        await new Promise(resolve => setTimeout(resolve, 80));
        await refreshPageStatus();
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [refreshPageStatus]);

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
    if (
      contentState.status === 'translating' ||
      contentState.status === 'scanning'
    ) {
      try {
        await sendToContent({ type: 'CANCEL_TRANSLATION' });
        setContentState({ status: 'idle' });
      } catch (error) {
        setContentState({
          status: 'error',
          message:
            error instanceof Error ? error.message : '无法取消当前翻译任务',
        });
      }
      return;
    }

    if (pageAvailability.state !== 'ready') {
      setContentState({ status: 'error', message: pageAvailability.message });
      return;
    }

    setContentState({ status: 'scanning' });
    try {
      await sendToContent({ type: 'TRANSLATE_PAGE' });
    } catch (error) {
      setContentState({
        status: 'error',
        message:
          error instanceof Error ? error.message : '当前页面无法开始翻译',
      });
      await refreshPageStatus();
    }
  }, [contentState.status, pageAvailability, refreshPageStatus]);

  const handleHoverSelect = useCallback(async () => {
    if (contentState.status === 'hover-select') {
      try {
        await sendToContent({ type: 'EXIT_HOVER_SELECT' });
        setContentState({ status: 'idle' });
      } catch (error) {
        setContentState({
          status: 'error',
          message:
            error instanceof Error ? error.message : '无法退出选图翻译模式',
        });
      }
      return;
    }
    if (pageAvailability.state !== 'ready') {
      setContentState({ status: 'error', message: pageAvailability.message });
      return;
    }
    setContentState({ status: 'hover-select' });
    try {
      await sendToContent({ type: 'ENTER_HOVER_SELECT' });
      window.close();
    } catch (error) {
      setContentState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : '当前页面无法进入选图翻译模式',
      });
      await refreshPageStatus();
    }
  }, [contentState.status, pageAvailability, refreshPageStatus]);

  const handleClearAll = useCallback(async () => {
    try {
      await sendToContent({ type: 'CLEAR_ALL' });
      setContentState({ status: 'idle' });
    } catch (error) {
      setContentState({
        status: 'error',
        message:
          error instanceof Error ? error.message : '无法清除当前页面的覆盖层',
      });
      await refreshPageStatus();
    }
  }, [refreshPageStatus]);

  const openSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  const handleRefreshPage = useCallback(async () => {
    const tab = await getActiveTab();
    if (tab?.id) {
      await chrome.tabs.reload(tab.id);
      setPageAvailability({
        state: 'needs-refresh',
        message: '页面正在刷新，请等待页面加载完成后再重试。',
        canRefresh: false,
        canRetry: true,
      });
    }
  }, []);

  const handleAutoTranslateToggle = useCallback(
    async (checked: boolean) => {
      setEnabled(checked);

      if (pageAvailability.state !== 'ready' || !isConfigured) {
        return;
      }

      try {
        await sendToContent({
          type: checked ? 'TRANSLATE_PAGE' : 'CANCEL_TRANSLATION',
        });
        if (!checked) {
          setContentState({ status: 'idle' });
        }
      } catch {
        await refreshPageStatus();
      }
    },
    [isConfigured, pageAvailability.state, refreshPageStatus, setEnabled]
  );

  // ==================== Derived State ====================

  const isTranslating =
    contentState.status === 'translating' || contentState.status === 'scanning';
  const actionsDisabled = !isConfigured || pageAvailability.state !== 'ready';

  const progress =
    contentState.status === 'translating' && contentState.total > 0
      ? (contentState.current / contentState.total) * 100
      : 0;

  // ==================== Render ====================

  if (isLoading) {
    return (
      <div className='flex h-[480px] w-[360px] items-center justify-center bg-[#0f1117]'>
        <Loader2 className='h-6 w-6 animate-spin text-teal-400' />
      </div>
    );
  }

  return (
    <div className='flex h-[480px] w-[360px] flex-col overflow-hidden bg-[#0f1117]'>
      {/* ---- Header ---- */}
      <div className='relative flex shrink-0 items-center justify-between bg-gradient-to-r from-teal-600/90 to-cyan-600/90 px-5 py-4'>
        {/* Subtle grid pattern overlay */}
        <div
          className='absolute inset-0 opacity-10'
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(255,255,255,0.3) 19px, rgba(255,255,255,0.3) 20px), repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.3) 19px, rgba(255,255,255,0.3) 20px)',
          }}
        />
        {/* Left: logo + title */}
        <div className='relative flex items-center gap-2.5'>
          <div className='rounded-lg bg-white/20 p-1.5 backdrop-blur-sm'>
            <BookOpen className='h-5 w-5 text-white' />
          </div>
          <div>
            <h1 className='text-base font-bold leading-none text-white'>
              漫画翻译
            </h1>
            <div className='mt-1 flex items-center gap-1'>
              <div
                className={`flex items-center gap-1 bg-gradient-to-r ${providerInfo.color} rounded px-1.5 py-0.5`}
              >
                <span className='text-white'>{providerInfo.icon}</span>
                <span className='text-[10px] font-medium leading-none text-white'>
                  {providerInfo.name}
                </span>
              </div>
              <span className='text-[10px] leading-none text-white/60'>
                {modelName}
              </span>
            </div>
          </div>
        </div>

        {/* Right: settings button */}
        <button
          onClick={openSettings}
          className='relative cursor-pointer rounded-lg bg-white/10 p-2 transition-colors hover:bg-white/20'
          title='打开设置'
        >
          <Settings className='h-4 w-4 text-white' />
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
            className='shrink-0 overflow-hidden'
          >
            <button
              onClick={openSettings}
              className='flex w-full cursor-pointer items-center gap-2 border-b border-amber-500/20 bg-amber-500/15 px-4 py-2.5 text-left transition-colors hover:bg-amber-500/20'
            >
              <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-amber-400' />
              <span className='text-xs text-amber-300'>
                请先配置 API Key 才能使用翻译功能
              </span>
              <span className='ml-auto shrink-0 text-xs font-medium text-amber-400'>
                去设置 →
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pageAvailability.state !== 'ready' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='shrink-0 overflow-hidden border-b border-red-500/10'
          >
            <div className='bg-red-500/10 px-4 py-3'>
              <div className='flex items-start gap-2.5'>
                <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-red-300' />
                <div className='min-w-0 flex-1'>
                  <p className='text-xs leading-relaxed text-red-200'>
                    {pageAvailability.message}
                  </p>
                  <div className='mt-2 flex items-center gap-2'>
                    {pageAvailability.canRefresh && (
                      <button
                        onClick={handleRefreshPage}
                        className='inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-white/15'
                      >
                        <RefreshCw className='h-3 w-3' />
                        刷新页面
                      </button>
                    )}
                    {pageAvailability.canRetry && (
                      <button
                        onClick={refreshPageStatus}
                        className='inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 transition-colors hover:bg-white/10'
                      >
                        重试检测
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Main Action Area ---- */}
      <div className='flex flex-1 flex-col justify-center gap-4 px-5 py-6'>
        <div className='border-white/8 rounded-xl border bg-white/[0.03] px-3.5 py-3'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <div className='text-sm font-medium text-slate-200'>
                自动翻译新页面
              </div>
              <p className='mt-1 text-xs leading-relaxed text-slate-500'>
                开启后，刷新页面或切换章节时会自动开始翻译。
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={handleAutoTranslateToggle}
              aria-label='切换自动翻译模式'
            />
          </div>
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <div className='border-white/8 rounded-xl border bg-white/[0.03] px-3 py-2.5'>
            <div className='mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-500'>
              <Zap className='h-3 w-3' />
              Provider
            </div>
            <Select
              value={provider}
              onValueChange={value => setProvider(value as ProviderType)}
            >
              <SelectTrigger className='h-8 border-white/10 bg-white/[0.03] px-2.5 text-xs text-slate-200 hover:border-white/20'>
                <SelectValue placeholder='选择 Provider' />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_INFO) as ProviderType[]).map(key => (
                  <SelectItem key={key} value={key}>
                    {PROVIDER_INFO[key].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='border-white/8 rounded-xl border bg-white/[0.03] px-3 py-2.5'>
            <div className='mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-500'>
              <Globe className='h-3 w-3' />
              语言
            </div>
            <Select value={targetLanguage} onValueChange={setTargetLanguage}>
              <SelectTrigger className='h-8 border-white/10 bg-white/[0.03] px-2.5 text-xs text-slate-200 hover:border-white/20'>
                <SelectValue placeholder='选择语言' />
              </SelectTrigger>
              <SelectContent>
                {TARGET_LANGUAGES.map(language => (
                  <SelectItem key={language.value} value={language.value}>
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Primary Button: Translate Page */}
        <div className='relative'>
          <AnimatePresence mode='wait'>
            {contentState.status === 'complete' ? (
              /* Complete state */
              <motion.div
                key='complete'
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className='flex h-14 w-full items-center justify-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-600/20'
              >
                <CheckCircle2 className='h-5 w-5 text-emerald-400' />
                <span className='font-medium text-emerald-300'>
                  已翻译 {contentState.count} 张图片
                </span>
              </motion.div>
            ) : isTranslating ? (
              /* Translating state */
              <motion.div
                key='translating'
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className='w-full overflow-hidden rounded-xl border border-teal-500/20 bg-teal-600/10'
              >
                <div className='flex items-center justify-between px-4 py-3'>
                  <div className='flex items-center gap-2.5'>
                    <Loader2 className='h-4 w-4 animate-spin text-teal-400' />
                    <span className='text-sm font-medium text-teal-300'>
                      {contentState.status === 'scanning'
                        ? '正在扫描图片...'
                        : `${contentState.current} / ${contentState.total} 已翻译`}
                    </span>
                  </div>
                  <button
                    onClick={handleTranslatePage}
                    className='cursor-pointer rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200'
                  >
                    取消
                  </button>
                </div>
                {contentState.status === 'translating' &&
                  contentState.total > 0 && (
                    <Progress
                      value={progress}
                      className='h-1 rounded-none bg-teal-900/40'
                    />
                  )}
              </motion.div>
            ) : (
              /* Idle state: main button */
              <motion.div
                key='idle'
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <button
                  onClick={handleTranslatePage}
                  disabled={actionsDisabled}
                  className='flex h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 shadow-lg shadow-teal-900/30 transition-all duration-200 hover:from-teal-500 hover:to-cyan-500 hover:shadow-teal-800/40 disabled:cursor-not-allowed disabled:opacity-40'
                >
                  <BookOpen className='h-5 w-5 text-white' />
                  <span className='text-base font-semibold text-white'>
                    翻译当前页面
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Divider */}
        <div className='flex items-center gap-3'>
          <div className='h-px flex-1 bg-white/5' />
          <span className='text-xs text-slate-600'>或</span>
          <div className='h-px flex-1 bg-white/5' />
        </div>

        {/* Secondary Button: Hover Select */}
        <AnimatePresence mode='wait'>
          {contentState.status === 'hover-select' ? (
            <motion.div
              key='hover-select-active'
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className='flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-cyan-500/40 bg-cyan-600/15'
            >
              <MousePointer className='h-4 w-4 text-cyan-400' />
              <span className='text-sm font-medium text-cyan-300'>
                请点击要翻译的图片...
              </span>
              <button
                onClick={handleHoverSelect}
                className='ml-1 cursor-pointer rounded p-1 transition-colors hover:bg-white/10'
              >
                <X className='h-3.5 w-3.5 text-slate-400' />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key='hover-select-idle'
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <button
                onClick={handleHoverSelect}
                disabled={actionsDisabled}
                className='flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40'
              >
                <MousePointer className='h-4 w-4 text-slate-400' />
                <span className='text-sm font-medium text-slate-300'>
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
              className='flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 p-3'
            >
              <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-red-400' />
              <div className='min-w-0 flex-1'>
                <p className='text-xs leading-relaxed text-red-300'>
                  {contentState.message}
                </p>
              </div>
              <button
                onClick={() => setContentState({ status: 'idle' })}
                className='shrink-0 cursor-pointer rounded p-0.5 transition-colors hover:bg-white/10'
              >
                <X className='h-3 w-3 text-slate-500' />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---- Footer ---- */}
      <div className='flex shrink-0 items-center justify-between border-t border-white/5 px-5 py-3.5'>
        <button
          onClick={handleClearAll}
          disabled={pageAvailability.state !== 'ready'}
          className='flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40'
        >
          <Trash2 className='h-3.5 w-3.5' />
          清除覆盖层
        </button>

        <div className='flex items-center gap-1.5'>
          <div className='h-1.5 w-1.5 rounded-full bg-teal-500' />
          <span className='text-xs text-slate-600'>漫画翻译 v2</span>
        </div>
      </div>
    </div>
  );
};

export default PopupApp;
