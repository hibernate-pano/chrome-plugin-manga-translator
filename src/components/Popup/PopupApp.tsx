import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react';

import { useAppConfigStore } from '@/stores/config-v2';
import type { ProviderType } from '@/providers/base';
import { getPageAvailability, type PageAvailability } from './popup-state';

type ContentState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'translating'; current: number; total: number }
  | { status: 'complete'; count: number }
  | { status: 'error'; message: string };

type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' };

const TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简中' },
  { value: 'zh-TW', label: '繁中' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

const PROVIDER_OPTIONS: Array<{ value: ProviderType; label: string }> = [
  { value: 'openai-compatible', label: '商用 LLM' },
  { value: 'ollama', label: 'Ollama' },
];

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

const PopupApp: React.FC = () => {
  const [contentState, setContentState] = useState<ContentState>({ status: 'idle' });
  const [isLoading, setIsLoading] = useState(true);
  const [pageAvailability, setPageAvailability] = useState<PageAvailability>({
    state: 'ready',
    message: '',
    canRefresh: false,
    canRetry: false,
  });
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  const targetLanguage = useAppConfigStore(state => state.targetLanguage);
  const enabled = useAppConfigStore(state => state.enabled);
  const isProviderConfigured = useAppConfigStore(state => state.isProviderConfigured);
  const setProvider = useAppConfigStore(state => state.setProvider);
  const setTargetLanguage = useAppConfigStore(state => state.setTargetLanguage);
  const setEnabled = useAppConfigStore(state => state.setEnabled);

  const providerLabel = provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible';
  const providerSettings = providers[provider];
  const isConfigured = isProviderConfigured(provider);
  const pathLabel =
    provider === 'ollama'
      ? `本地直连 / ${providerSettings.baseUrl || '未配置地址'}`
      : `API 直连 / ${providerSettings.baseUrl || '未配置端点'}`;

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
        getPageAvailability({ url: tab.url, contentScriptReachable: true })
      );
    } catch {
      setPageAvailability(
        getPageAvailability({ url: tab.url, contentScriptReachable: false })
      );
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshPageStatus();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshPageStatus]);

  useEffect(() => {
    const handleMessage = (msg: { type: string; state?: ContentState }) => {
      if (msg.type !== 'STATE_UPDATE' || !msg.state) return;
      setContentState(msg.state);
      if (msg.state.status === 'complete') {
        if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
        completeTimerRef.current = setTimeout(() => {
          setContentState({ status: 'idle' });
        }, 2000);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
    };
  }, []);

  const handleTranslate = useCallback(async () => {
    await sendToContent({ type: 'TRANSLATE_PAGE' });
  }, []);

  const handleReset = useCallback(async () => {
    await sendToContent({ type: 'CLEAR_ALL' });
    setContentState({ status: 'idle' });
  }, []);

  const handleResetAndRerun = useCallback(async () => {
    await sendToContent({ type: 'FORCE_RETRANSLATE_PAGE' });
  }, []);

  const handleCancel = useCallback(async () => {
    await sendToContent({ type: 'CANCEL_TRANSLATION' });
  }, []);

  const statusText = useMemo(() => {
    switch (contentState.status) {
      case 'scanning':
        return '扫描当前页面图片中';
      case 'translating':
        return `翻译中 ${contentState.current}/${contentState.total}`;
      case 'complete':
        return `已完成 ${contentState.count} 张图片`;
      case 'error':
        return contentState.message;
      default:
        return '准备就绪';
    }
  }, [contentState]);

  if (isLoading) {
    return (
      <div className='flex min-h-[420px] items-center justify-center bg-slate-950 text-slate-100'>
        <Loader2 className='h-5 w-5 animate-spin' />
      </div>
    );
  }

  return (
    <div className='min-h-[460px] w-[360px] bg-slate-950 text-slate-100'>
      <div className='border-b border-white/10 px-4 py-4'>
        <div className='flex items-center justify-between'>
          <div>
            <div className='text-sm font-semibold'>Manga Translator</div>
            <div className='mt-1 text-xs text-slate-400'>
              当前页翻译 / 自动续翻 / 强制重翻
            </div>
          </div>
          <button
            type='button'
            onClick={() => chrome.runtime.openOptionsPage()}
            className='rounded-md border border-white/10 p-2 text-slate-300 transition hover:border-white/20 hover:text-white'
          >
            <Settings className='h-4 w-4' />
          </button>
        </div>
      </div>

      <div className='space-y-4 px-4 py-4'>
        <label className='flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3'>
          <div>
            <div className='text-sm font-medium'>启用扩展</div>
            <div className='text-xs text-slate-400'>页面加载后允许自动续翻新出现的图片</div>
          </div>
          <input
            type='checkbox'
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className='h-4 w-4 rounded border-white/20 bg-slate-900'
          />
        </label>

        <div className='rounded-lg border border-white/10 bg-white/[0.03] p-3'>
          <div className='flex items-center justify-between text-sm'>
            <span className='font-medium'>当前后端</span>
            <span className='rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-300'>
              {providerLabel}
            </span>
          </div>
          <div className='mt-3 grid grid-cols-2 gap-2'>
            {PROVIDER_OPTIONS.map(option => {
              const active = provider === option.value;
              return (
                <button
                  key={option.value}
                  type='button'
                  onClick={() => setProvider(option.value)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    active
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                      : 'border-white/10 bg-slate-950 text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className='mt-2 text-xs text-slate-400'>{pathLabel}</div>
          <div className='mt-1 text-xs text-slate-500'>
            模型：{providerSettings.model || '未设置'}
          </div>
        </div>

        <label className='block'>
          <div className='mb-2 text-sm font-medium'>目标语言</div>
          <select
            value={targetLanguage}
            onChange={e => setTargetLanguage(e.target.value)}
            className='w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none'
          >
            {TARGET_LANGUAGES.map(item => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {pageAvailability.state !== 'ready' ? (
          <div className='rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100'>
            <div className='flex items-start gap-2'>
              <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
              <div>{pageAvailability.message}</div>
            </div>
          </div>
        ) : null}

        {!isConfigured ? (
          <div className='rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100'>
            请先在设置页完成 {providerLabel} 配置。
          </div>
        ) : null}

        <div className='rounded-lg border border-white/10 bg-white/[0.03] p-3'>
          <div className='flex items-center justify-between text-sm font-medium'>
            <span>当前状态</span>
            {contentState.status === 'complete' ? (
              <CheckCircle2 className='h-4 w-4 text-emerald-400' />
            ) : contentState.status === 'error' ? (
              <AlertTriangle className='h-4 w-4 text-amber-400' />
            ) : (
              <RefreshCw className='h-4 w-4 text-slate-500' />
            )}
          </div>
          <div className='mt-2 text-sm text-slate-200'>{statusText}</div>
        </div>

        <div className='space-y-2'>
          <button
            type='button'
            onClick={handleTranslate}
            disabled={!isConfigured || pageAvailability.state !== 'ready'}
            className='flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40'
          >
            {contentState.status === 'translating' || contentState.status === 'scanning' ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <RefreshCw className='h-4 w-4' />
            )}
            翻译当前页面
          </button>

          <div className='grid grid-cols-2 gap-2'>
            <button
              type='button'
              onClick={handleReset}
              className='flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.07]'
            >
              <Trash2 className='h-4 w-4' />
              彻底重置
            </button>
            <button
              type='button'
              onClick={handleResetAndRerun}
              disabled={!isConfigured || pageAvailability.state !== 'ready'}
              className='flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40'
            >
              <RefreshCw className='h-4 w-4' />
              强制重翻
            </button>
          </div>

          {(contentState.status === 'translating' || contentState.status === 'scanning') && (
            <button
              type='button'
              onClick={handleCancel}
              className='w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 transition hover:bg-rose-500/20'
            >
              取消当前翻译
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PopupApp;
