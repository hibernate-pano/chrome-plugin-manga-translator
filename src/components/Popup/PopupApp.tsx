import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  Info,
  Languages,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { useAppConfigStore } from '@/stores/config-v2';
import { summarizeUsageForMonth, useUsageStore } from '@/stores/usage-store';
import type { ProviderType } from '@/providers/base';
import { parseTranslationError, type ErrorAction } from '@/utils/error-handler';
import { getProviderLabel } from '@/utils/provider-label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import {
  buildResultSummary,
  describeAutoTranslate,
  describeImageCount,
  getPageAvailability,
  getPrimaryActionState,
  isHostAutoTranslated,
  matchingAllowlistEntries,
  type PageAvailability,
} from './popup-state';

/**
 * The state the content script reports.
 *
 * This mirrors `ContentState` in `src/content/content.ts`. It used to be a
 * narrower local copy that dropped `failedCount`, `cachedCount`,
 * `skippedCount` and the error repair action — so a run that translated 8
 * images and failed 4 was reported as "已完成 12 张图片". A number that
 * hides failures is worse than no number at all.
 */
type ContentState = ContentStateBase &
  (
    | { status: 'idle' }
    | { status: 'scanning'; candidateCount?: number }
    | {
        status: 'translating';
        current: number;
        total: number;
        currentImageIndex?: number;
        phase?: 'translating' | 'rendering';
      }
    | {
        status: 'complete';
        count: number;
        failedCount?: number;
        cachedCount?: number;
        /** Images filtered out because of their size or their position. */
        skippedCount?: number;
        /** Images skipped because this page was already translated. */
        skippedDuplicateCount?: number;
        /** How many images on this page can be translated at all. */
        candidateCount?: number;
        /** Why the failed images failed — the first error, in plain language. */
        lastError?: string;
      }
    | {
        status: 'error';
        message: string;
        suggestion?: string;
        action?: ErrorAction;
      }
  );

/**
 * The parts of the content state that do not depend on what the run is
 * doing.
 */
interface ContentStateBase {
  /**
   * Whether the reading panel is on the page right now.
   *
   * The panel used to have exactly one way out — a keyboard shortcut nobody
   * was told about — so a reader whose panel covered the manga had no way
   * to get rid of it. The popup needs the real state to label the button
   * honestly.
   */
  readingPanelVisible?: boolean;
  /**
   * Whether this page is armed to translate new images on its own.
   *
   * The popup's own switches cannot answer this: the page also arms itself
   * when the user translated it by hand, and the "auto-continue" setting is
   * only one of the three conditions. The page reports what it is actually
   * doing, so the popup can say so.
   */
  autoContinueArmed?: boolean;
}

type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'COUNT_IMAGES' }
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_FAILED' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'TOGGLE_READING_PANEL' }
  | { type: 'DISARM_PAGE_AUTO_TRANSLATE' }
  | { type: 'CLEAR_ALL' };

const TARGET_LANGUAGES = [
  // Wording matches the Settings page. The popup used "简中 / 繁中" while
  // the settings page said "简体中文 / 繁体中文", and users reasonably read
  // two different labels for one setting as two different settings.
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

const PROVIDER_OPTIONS: Array<{ value: ProviderType; label: string }> = [
  { value: 'openai-compatible', label: '云端 API' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'lm-studio', label: 'LM Studio' },
];

/** Bare hostname of a tab URL, or null when it is not a normal web page. */
/**
 * The allowlist key for a page: hostname, plus the port when the URL names a
 * non-default one.
 *
 * Dropping the port here made port-scoped entries unreachable from this switch:
 * a dev reader on `localhost:8080` stored `localhost`, which under the matching
 * rules covers every port on the machine — the exact widening the allowlist is
 * supposed to avoid.
 */
function hostFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    const defaultPort = parsed.protocol === 'https:' ? '443' : '80';
    return parsed.port && parsed.port !== defaultPort
      ? `${hostname}:${parsed.port}`
      : hostname;
  } catch {
    return null;
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/**
 * The answers a content script can give back.
 *
 * `GET_STATE` returns the page's translation state; the scoped retry
 * returns how many images it is about to re-run, which is what the
 * confirmation dialog needs in order to be honest about the cost.
 */
interface ContentResponse {
  state?: ContentState;
  success?: boolean;
  count?: number;
  error?: string;
}

async function sendToContent(
  msg: PopupToContentMsg
): Promise<ContentResponse | null> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error('未找到当前标签页');
  }
  return chrome.tabs.sendMessage(tab.id, msg);
}

const PopupApp: React.FC = () => {
  const [contentState, setContentState] = useState<ContentState>({
    status: 'idle',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [currentHost, setCurrentHost] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [pageAvailability, setPageAvailability] = useState<PageAvailability>({
    state: 'ready',
    message: '',
    canRefresh: false,
    canRetry: false,
  });
  /**
   * How many images on this page can be translated.
   *
   * `null` means "not known yet". The count comes from a read-only scan, so
   * the user sees what pressing the button will cost *before* any request
   * is made — the popup used to show a number only after the money was gone.
   */
  const [pageImageCount, setPageImageCount] = useState<number | null>(null);
  /**
   * Whether the reading panel is on the page.
   *
   * `null` means "the page has not told us yet" — the content script only
   * knows the answer once it has created the panel.
   */
  const [readingPanelVisible, setReadingPanelVisible] = useState<
    boolean | null
  >(null);
  /**
   * Whether the page is armed to translate new images by itself.
   *
   * `null` means the page has not answered yet. The popup shows nothing in
   * that case: claiming "no auto-translation" before the page has spoken
   * would be the same kind of lie the panel button used to tell.
   */
  const [autoContinueArmed, setAutoContinueArmed] = useState<boolean | null>(
    null
  );
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
  const autoContinueEnabled = useAppConfigStore(
    state => state.autoContinueEnabled
  );
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

  const providerSettings = providers[provider];
  /**
   * The name of the service the user is actually pointed at.
   *
   * "OpenAI-compatible" names the protocol, not the service. The user who
   * configured a MiniMax endpoint sees that name on their bill, so that is
   * the name they need here.
   */
  const providerLabel = getProviderLabel({
    provider,
    baseUrl: providerSettings.baseUrl,
  });
  const isConfigured = isProviderConfigured(provider);
  /**
   * The name of the service behind the cloud slot.
   *
   * The header names the service the user is pointed at, while the picker
   * said "云端 API" next to it. Two names for one thing: the user could not
   * tell which button switched to the service their bill mentions.
   */
  const cloudProviderLabel = useMemo(
    () =>
      getProviderLabel({
        provider: 'openai-compatible',
        baseUrl: providers['openai-compatible']?.baseUrl ?? '',
      }),
    [providers]
  );
  const pathLabel =
    provider === 'ollama' || provider === 'lm-studio'
      ? `本地服务：${providerLabel} · ${providerSettings.baseUrl || '未配置地址'}`
      : `服务：${providerLabel} · ${providerSettings.baseUrl || '未配置端点'}`;

  /**
   * The single gate for the primary action.
   *
   * The master switch used to be absent from this decision: turning the
   * extension off still left the button live, so a billed API call could go
   * out while the UI claimed "关闭后不会请求任何模型". The switch now has to
   * be on for the action to be available, which is what "off" has to mean.
   */
  const primaryAction = useMemo(
    () =>
      getPrimaryActionState({
        enabled,
        providerConfigured: isConfigured,
        availability: pageAvailability,
        providerLabel,
      }),
    [enabled, isConfigured, pageAvailability, providerLabel]
  );

  /**
   * What pressing the button is about to cost.
   *
   * The popup used to show a number only *after* the money was gone. The
   * count comes from a read-only scan of the page, so it can be shown
   * before anything is requested.
   */
  const imageCountHint = useMemo(() => {
    if (
      contentState.status === 'translating' ||
      contentState.status === 'scanning'
    ) {
      return '';
    }
    if (!primaryAction.canTranslate) {
      return '';
    }
    return describeImageCount(pageImageCount);
  }, [contentState.status, primaryAction.canTranslate, pageImageCount]);

  /**
   * This month's spending, so the user can see what the service has cost.
   *
   * The data is already in `chrome.storage.local`; showing it costs no
   * network request and no money.
   */
  const usageRecords = useUsageStore(state => state.records);
  const usageSummary = useMemo(
    () => summarizeUsageForMonth(usageRecords),
    [usageRecords]
  );

  /**
   * Ask the page how many images can be translated here.
   *
   * The answer is a number the user can weigh before pressing the button.
   * A content script that does not know the question never answers, and
   * `chrome.tabs.sendMessage` then waits forever — so the request is capped.
   */
  const countTranslatableImages = useCallback(async (): Promise<
    number | null
  > => {
    try {
      const response = await Promise.race([
        sendToContent({ type: 'COUNT_IMAGES' }),
        new Promise<null>(resolve => {
          setTimeout(() => resolve(null), 1500);
        }),
      ]);
      const count = response?.count;
      return typeof count === 'number' ? count : null;
    } catch {
      return null;
    }
  }, []);

  const refreshPageStatus = useCallback(async () => {
    const tab = await getActiveTab();
    const host = hostFromUrl(tab?.url);
    setCurrentHost(host);
    setCurrentUrl(host ? (tab?.url ?? null) : null);
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
      if (typeof response?.state?.readingPanelVisible === 'boolean') {
        setReadingPanelVisible(response.state.readingPanelVisible);
      }
      if (typeof response?.state?.autoContinueArmed === 'boolean') {
        setAutoContinueArmed(response.state.autoContinueArmed);
      }
      setPageAvailability(
        getPageAvailability({ url: tab.url, contentScriptReachable: true })
      );
    } catch {
      setPageAvailability(
        getPageAvailability({ url: tab.url, contentScriptReachable: false })
      );
      return;
    }

    // How much is this page going to cost? The scan is read-only: no
    // request, no cache write, no state change.
    const count = await countTranslatableImages();
    setPageImageCount(count);
  }, [countTranslatableImages]);

  useEffect(() => {
    void (async () => {
      try {
        await refreshPageStatus();
      } finally {
        setIsLoading(false);
      }
    })();

    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      void chrome.tabs.get(activeInfo.tabId).then(tab => {
        if (tab.active && tab.windowId === chrome.windows.WINDOW_ID_CURRENT) {
          void refreshPageStatus();
        }
      });
    };

    const handleTabUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        void chrome.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab?.id === tabId) {
              void refreshPageStatus();
            }
          });
      }
    };

    // Store handlers in refs to ensure removeListener receives the same reference as addListener
    const activeListenerRef = { current: handleTabActivated };
    const updatedListenerRef = { current: handleTabUpdated };

    chrome.tabs.onActivated.addListener(activeListenerRef.current);
    chrome.tabs.onUpdated.addListener(updatedListenerRef.current);

    return () => {
      chrome.tabs.onActivated.removeListener(activeListenerRef.current);
      chrome.tabs.onUpdated.removeListener(updatedListenerRef.current);
    };
  }, [refreshPageStatus]);

  useEffect(() => {
    const handleMessage = (msg: { type: string; state?: ContentState }) => {
      if (msg.type === 'HUD_CANCELLED') {
        setContentState({ status: 'idle' });
        return;
      }
      if (msg.type !== 'STATE_UPDATE' || !msg.state) return;
      // The result stays on screen. It used to be wiped two seconds after a
      // run finished, which took the success and failure counts, the reason
      // for the failures and the retry button away before the user had
      // finished reading them.
      setContentState(msg.state);
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  /**
   * The last failure of a popup action, shown as a line of text.
   *
   * The four actions below used to let the rejection escape: the button
   * simply did nothing, and the user could not tell whether the request
   * never left the popup or the page had failed. A silent failure is the
   * worst possible outcome for an action that can cost money.
   */
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      const friendly = parseTranslationError(error);
      console.error('[Popup] 操作失败:', friendly.message);
      setActionError(friendly.message);
    }
  }, []);

  const handleTranslate = useCallback(async () => {
    await runAction(async () => {
      await sendToContent({ type: 'TRANSLATE_PAGE' });
    });
  }, [runAction]);

  /**
   * Reload the current tab.
   *
   * A page that was already open when the extension was installed or
   * reloaded has no content script in it, so the popup can only tell the
   * user to refresh. Telling them to refresh without offering the button
   * leaves them guessing which key to press.
   */
  const handleRefreshTab = useCallback(async () => {
    const tab = await getActiveTab();
    if (tab?.id) {
      await chrome.tabs.reload(tab.id);
    }
  }, []);

  const handleReset = useCallback(async () => {
    await runAction(async () => {
      await sendToContent({ type: 'CLEAR_ALL' });
      setContentState({ status: 'idle' });
    });
  }, [runAction]);

  /**
   * Show or hide the reading panel.
   *
   * The panel used to have exactly one way out — a keyboard shortcut that
   * no documentation mentioned — so a reader whose panel covered the
   * manga had nothing to click. This is that missing button.
   */
  const handleToggleReadingPanel = useCallback(async () => {
    await runAction(async () => {
      const response = await sendToContent({ type: 'TOGGLE_READING_PANEL' });
      if (!response?.success) {
        throw new Error('切换阅读面板失败，请刷新页面后重试');
      }
      // The content script reports the new state; until it does, the
      // button flips optimistically so the user sees an answer.
      setReadingPanelVisible(current => (current === null ? false : !current));
    });
  }, [runAction]);

  const handleResetAndRerun = useCallback(async () => {
    await runAction(async () => {
      await sendToContent({ type: 'FORCE_RETRANSLATE_PAGE' });
    });
  }, [runAction]);

  /**
   * 停下这一页的自动翻译。
   *
   * 两条路都要走：页面那边的"用户手动翻译过"由内容脚本清掉，站点白名单
   * 是站点级的设置，由弹窗自己改。少做一步，页面就还在自动翻译。
   */
  const handleStopAutoTranslate = useCallback(async () => {
    await runAction(async () => {
      await sendToContent({ type: 'DISARM_PAGE_AUTO_TRANSLATE' });
      if (currentHost) {
        for (const entry of matchingAllowlistEntries(
          currentUrl,
          autoTranslateHosts
        )) {
          removeAutoTranslateHost(entry);
        }
      }
      setAutoContinueArmed(false);
    });
  }, [
    autoTranslateHosts,
    currentHost,
    currentUrl,
    removeAutoTranslateHost,
    runAction,
  ]);

  /**
   * Re-run only the images that failed.
   *
   * The old button sent the force-retranslate message, which clears every
   * image on the page and re-requests all of them with the cache bypassed —
   * so a page with three failures was billed for every image on it. The
   * content script now has a scoped path that touches only the failed ones.
   */
  const handleRetryFailed = useCallback(async () => {
    await runAction(async () => {
      const response = await sendToContent({
        type: 'FORCE_RETRANSLATE_FAILED',
      });
      if (!response?.success) {
        throw new Error('重试失败，请刷新页面后重试');
      }
      if (!response.count) {
        setContentState({ status: 'idle' });
      }
    });
  }, [runAction]);

  // 危险操作二次确认：哪个动作正在等用户确认（null = 无）
  const [pendingDanger, setPendingDanger] = useState<
    'reset' | 'forceRetranslate' | 'retryFailed' | null
  >(null);

  const requestReset = useCallback(() => {
    setPendingDanger('reset');
  }, []);

  const requestResetAndRerun = useCallback(() => {
    setPendingDanger('forceRetranslate');
  }, []);

  const requestRetryFailed = useCallback(() => {
    setPendingDanger('retryFailed');
  }, []);

  const confirmDanger = useCallback(async () => {
    const action = pendingDanger;
    setPendingDanger(null);
    if (action === 'reset') {
      await handleReset();
    } else if (action === 'forceRetranslate') {
      await handleResetAndRerun();
    } else if (action === 'retryFailed') {
      await handleRetryFailed();
    }
  }, [pendingDanger, handleReset, handleResetAndRerun, handleRetryFailed]);

  const handleCancel = useCallback(async () => {
    await runAction(async () => {
      await sendToContent({ type: 'CANCEL_TRANSLATION' });
    });
  }, [runAction]);

  /**
   * Run the repair action the content script attached to an error.
   *
   * The HUD has offered these since v0.6.0 — "open settings" for an auth
   * failure, "copy `ollama serve`" for a local backend that is not running.
   * The popup dropped them, so a user who hit the same error in the popup
   * had no way forward except searching for the extension by name.
   */
  const handleErrorAction = useCallback(async (action: ErrorAction) => {
    if (action.type === 'open-settings') {
      await chrome.runtime.openOptionsPage();
      return;
    }
    if (action.type === 'copy-command' && action.command) {
      try {
        await navigator.clipboard.writeText(action.command);
      } catch {
        // Clipboard access can be refused; the command is still shown in the
        // popup so the user can copy it by hand.
      }
    }
  }, []);

  /**
   * The result of the last run, phrased for a human.
   *
   * See `buildResultSummary`: a run that translated nothing is not a
   * success, and the popup used to say it was.
   */
  const resultSummary = useMemo(() => {
    if (contentState.status !== 'complete') {
      return null;
    }
    return buildResultSummary({
      count: contentState.count,
      failedCount: contentState.failedCount,
      cachedCount: contentState.cachedCount,
      skippedCount: contentState.skippedCount,
      skippedDuplicateCount: contentState.skippedDuplicateCount,
    });
  }, [contentState]);

  /**
   * 这一页到底会不会自己开始翻译。
   *
   * 三个开关摆在眼前，但真正生效的是四个条件：主开关、自动续翻、站点
   * 白名单、还有"用户刚刚手动翻译过这一页"。弹窗只看前三个，就会漏掉
   * 最后那个——而那正是最容易扣费的情况。
   */
  const autoTranslateStatus = useMemo(() => {
    if (autoContinueArmed === null) {
      return null;
    }
    return describeAutoTranslate({
      armed: autoContinueArmed,
      hostAllowlisted: isHostAutoTranslated(currentUrl, autoTranslateHosts),
      autoContinueEnabled,
      masterEnabled: enabled,
    });
  }, [
    autoContinueArmed,
    autoContinueEnabled,
    autoTranslateHosts,
    currentUrl,
    enabled,
  ]);

  const statusText = useMemo(() => {
    switch (contentState.status) {
      case 'scanning':
        return contentState.candidateCount
          ? `扫描当前页面图片中（找到 ${contentState.candidateCount} 张）`
          : '扫描当前页面图片中';
      case 'translating':
        return `翻译中 ${contentState.current}/${contentState.total}`;
      case 'complete':
        return resultSummary?.title ?? '翻译完成';
      case 'error':
        return contentState.message;
      default:
        return '准备就绪';
    }
  }, [contentState, resultSummary]);

  /** "译为简体中文" — the target language named where the user acts. */
  const targetLanguageLabel = useMemo(() => {
    return (
      TARGET_LANGUAGES.find(item => item.value === targetLanguage)?.label ?? ''
    );
  }, [targetLanguage]);

  if (isLoading) {
    return (
      <div className='flex h-[220px] w-[360px] items-center justify-center bg-slate-950 text-slate-100'>
        <Loader2 className='h-5 w-5 animate-spin' />
      </div>
    );
  }

  return (
    <div className='max-h-[600px] w-[360px] overflow-y-auto bg-slate-950 text-slate-100'>
      {/* 头部：品牌 + 后端状态 + 设置入口 */}
      <div className='flex items-center justify-between border-b border-white/10 px-4 py-3'>
        <div className='flex items-center gap-2'>
          <Sparkles className='h-4 w-4 text-cyan-300' />
          <span className='text-sm font-semibold'>漫画翻译助手</span>
        </div>
        <div className='flex items-center gap-2'>
          <span className='rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-xs text-slate-300'>
            {providerLabel}
          </span>
          <button
            type='button'
            onClick={() => chrome.runtime.openOptionsPage()}
            aria-label='打开设置'
            className='rounded-md p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
          >
            <Settings className='h-4 w-4' />
          </button>
        </div>
      </div>

      {/* 主操作区：翻译当前页是用户 90% 的动作，必须最显眼 */}
      <div className='space-y-3 px-4 py-4'>
        <div className='rounded-xl border border-white/10 bg-white/[0.03] p-3'>
          <div className='flex items-center justify-between'>
            <div className='text-sm font-medium'>当前页面</div>
            {contentState.status === 'complete' ? (
              resultSummary?.tone === 'success' ? (
                <CheckCircle2 className='h-4 w-4 text-emerald-400' />
              ) : resultSummary?.tone === 'warning' ? (
                <AlertTriangle className='h-4 w-4 text-amber-400' />
              ) : (
                <Info className='h-4 w-4 text-slate-400' />
              )
            ) : contentState.status === 'error' ? (
              <AlertTriangle className='h-4 w-4 text-amber-400' />
            ) : null}
          </div>
          <div className='mt-1 text-xs text-slate-400'>
            {currentHost ? currentHost : '当前页面'}
            {targetLanguageLabel ? ` · 译为${targetLanguageLabel}` : ''}
          </div>

          {contentState.status === 'translating' ||
          contentState.status === 'scanning' ? (
            <>
              <div className='mt-3 text-sm text-cyan-100'>{statusText}</div>
              <button
                type='button'
                onClick={handleCancel}
                className='mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400'
              >
                <Loader2 className='h-4 w-4 animate-spin' />
                取消当前翻译
              </button>
            </>
          ) : (
            <>
              {/* 花钱之前先说清楚要花多少 */}
              {imageCountHint ? (
                <p className='mt-3 text-xs leading-relaxed text-slate-300'>
                  {imageCountHint}
                </p>
              ) : null}
              <button
                type='button'
                onClick={handleTranslate}
                disabled={!primaryAction.canTranslate}
                className='mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500'
              >
                <Languages className='h-4 w-4' />
                翻译当前页面
              </button>
              {primaryAction.message ? (
                <p className='mt-2 text-xs leading-relaxed text-amber-300'>
                  {primaryAction.message}
                </p>
              ) : null}
              {primaryAction.blocker === 'provider-unconfigured' ? (
                <button
                  type='button'
                  onClick={() => {
                    void chrome.runtime.openOptionsPage();
                  }}
                  className='mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
                >
                  <Settings className='h-3.5 w-3.5' />
                  去设置页填写 API Key
                </button>
              ) : null}
              {actionError ? (
                <p className='mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-xs leading-relaxed text-rose-100'>
                  操作失败：{actionError}
                </p>
              ) : null}
              {pageAvailability.state === 'needs-refresh' ? (
                <button
                  type='button'
                  onClick={() => {
                    void handleRefreshTab();
                  }}
                  className='mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
                >
                  <RefreshCw className='h-3.5 w-3.5' />
                  刷新页面
                </button>
              ) : null}
            </>
          )}

          {/* 翻译结果：用卡片承载，不要挤成一行 12px 的灰字。
              翻译完成是用户主动等待的那一刻，"有几张失败了"是那一刻最该
              被看见的信息。 */}
          {contentState.status === 'complete' && resultSummary ? (
            <div
              className={`mt-3 rounded-lg border p-2.5 ${
                resultSummary.tone === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : resultSummary.tone === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  resultSummary.tone === 'success'
                    ? 'text-emerald-100'
                    : resultSummary.tone === 'warning'
                      ? 'text-amber-100'
                      : 'text-slate-200'
                }`}
              >
                {resultSummary.title}
              </p>
              {resultSummary.details.map(detail => (
                <p
                  key={detail}
                  className='mt-1 text-xs leading-relaxed text-slate-300'
                >
                  {detail}
                </p>
              ))}
            </div>
          ) : null}

          {contentState.status === 'error' ? (
            <p className='mt-2 text-xs leading-relaxed text-amber-300'>
              {statusText}
            </p>
          ) : null}

          {/* 重试入口：只重跑失败的那几张，已成功的不会被二次计费 */}
          {contentState.status === 'complete' && contentState.failedCount ? (
            <button
              type='button'
              onClick={requestRetryFailed}
              className='mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'
            >
              <RefreshCw className='h-3.5 w-3.5' />
              重新翻译失败的 {contentState.failedCount} 张
            </button>
          ) : null}

          {/* 失败原因：没有它，用户只知道"失败了几张"，不知道该改什么 */}
          {contentState.status === 'complete' && contentState.lastError ? (
            <p className='mt-2 text-xs leading-relaxed text-amber-300/90'>
              失败原因：{contentState.lastError}
            </p>
          ) : null}

          {/* 错误详情与修复入口：用户撞错后必须有路可走 */}
          {contentState.status === 'error' ? (
            <div className='mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5'>
              {contentState.suggestion ? (
                <p className='text-xs leading-relaxed text-amber-100/90'>
                  {contentState.suggestion}
                </p>
              ) : null}
              {contentState.action ? (
                <button
                  type='button'
                  onClick={() => {
                    const action = contentState.action;
                    if (action) {
                      void handleErrorAction(action);
                    }
                  }}
                  className='mt-2 w-full rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-50 transition hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'
                >
                  {contentState.action.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 主开关：关闭即完全不请求模型 */}
        <label className='flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5'>
          <div>
            <div className='text-sm font-medium'>启用扩展</div>
            <div className='text-xs text-slate-400'>关闭后不会请求任何模型</div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label='启用扩展'
          />
        </label>

        {/* 阅读设置：折叠，让低频选项不与主操作争夺注意力 */}
        <details className='group rounded-lg border border-white/10 bg-white/[0.03]'>
          <summary className='flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium marker:hidden'>
            阅读设置
            <ChevronDown className='h-4 w-4 text-slate-400 transition-transform group-open:rotate-180' />
          </summary>
          <div className='space-y-3 border-t border-white/5 px-3 py-3'>
            <label className='flex items-center justify-between'>
              <div>
                <div className='text-sm font-medium'>自动翻译本站</div>
                <div className='text-xs text-slate-400'>
                  {currentHost
                    ? `${currentHost} 打开页面时自动翻译`
                    : '当前页面不支持自动翻译'}
                </div>
              </div>
              <Switch
                checked={isHostAutoTranslated(currentUrl, autoTranslateHosts)}
                disabled={!currentHost || !enabled}
                onCheckedChange={checked => {
                  if (!currentHost) return;
                  if (checked) {
                    addAutoTranslateHost(currentHost);
                    return;
                  }
                  // Remove whatever actually matched. A plain
                  // `includes(currentHost)` left a wildcard entry in place, so
                  // the switch snapped back on and the page kept translating
                  // itself with no way to stop it from here.
                  const matched = matchingAllowlistEntries(
                    currentUrl,
                    autoTranslateHosts
                  );
                  if (matched.length === 0) {
                    removeAutoTranslateHost(currentHost);
                    return;
                  }
                  for (const entry of matched) {
                    removeAutoTranslateHost(entry);
                  }
                }}
                aria-label='自动翻译本站'
              />
            </label>

            <label className='flex items-center justify-between'>
              <div>
                <div className='text-sm font-medium'>自动续翻</div>
                <div className='text-xs text-slate-400'>
                  本页新加载的图片继续翻译
                </div>
              </div>
              <Switch
                checked={autoContinueEnabled}
                disabled={!enabled}
                onCheckedChange={setAutoContinueEnabled}
                aria-label='自动续翻'
              />
            </label>

            <label className='block'>
              <div className='mb-1.5 text-xs text-slate-400'>目标语言</div>
              <select
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
                className='w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/60'
              >
                {TARGET_LANGUAGES.map(item => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            {autoTranslateHosts.length > 0 && (
              <div className='text-xs text-slate-500'>
                已开启自动翻译的站点：{autoTranslateHosts.length} 个
              </div>
            )}

            {/*
              这一页会不会自己开始翻译 —— 一句话说明白。
              三个开关各自看都合理，凑在一起却是第四种结果：用户刚手动
              翻译过这一页，两个开关都是关的，页面照样在自动翻译并扣费。
              弹窗以前只摆开关，不说结果。
            */}
            {autoTranslateStatus && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  autoTranslateStatus.tone === 'active'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    : autoTranslateStatus.tone === 'blocked'
                      ? 'border-amber-500/20 bg-amber-500/5 text-amber-200/80'
                      : 'border-white/5 bg-slate-950/60 text-slate-400'
                }`}
              >
                <div className='flex items-start gap-2'>
                  <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
                  <span className='flex-1'>{autoTranslateStatus.message}</span>
                </div>
                {autoTranslateStatus.action && (
                  <button
                    type='button'
                    onClick={() => {
                      if (
                        autoTranslateStatus.action?.kind === 'enable-continue'
                      ) {
                        setAutoContinueEnabled(true);
                        return;
                      }
                      void handleStopAutoTranslate();
                    }}
                    className='mt-2 rounded-md border border-amber-400/40 px-2 py-1 text-amber-100 transition-colors hover:bg-amber-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60'
                  >
                    {autoTranslateStatus.action.label}
                  </button>
                )}
              </div>
            )}

            <div className='flex items-start gap-2 rounded-lg border border-white/5 bg-slate-950/60 px-3 py-2 text-xs text-slate-400'>
              <Eye className='mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300' />
              <span>
                译文会直接覆盖在原图上。按住{' '}
                <kbd className='rounded border border-white/15 bg-slate-800 px-1 py-0.5 font-mono text-[10px] text-slate-200'>
                  Alt
                </kbd>{' '}
                可临时切回原文，方便核对或学习。
              </span>
            </div>
          </div>
        </details>

        {/* 后端选择：折叠 */}
        <details className='group rounded-lg border border-white/10 bg-white/[0.03]'>
          <summary className='flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium marker:hidden'>
            <span className='flex items-center gap-2'>
              {provider === 'ollama' ? (
                <Server className='h-4 w-4 text-slate-300' />
              ) : (
                <Sparkles className='h-4 w-4 text-cyan-300' />
              )}
              翻译后端
            </span>
            <ChevronDown className='h-4 w-4 text-slate-400 transition-transform group-open:rotate-180' />
          </summary>
          <div className='space-y-2.5 border-t border-white/5 px-3 py-3'>
            <div className='grid grid-cols-3 gap-2'>
              {PROVIDER_OPTIONS.map(option => {
                const active = provider === option.value;
                const label =
                  option.value === 'openai-compatible'
                    ? cloudProviderLabel
                    : option.label;
                return (
                  <button
                    key={option.value}
                    type='button'
                    aria-pressed={active}
                    onClick={() => {
                      if (provider === option.value) return;
                      // The store writes the choice to `chrome.storage.local`,
                      // and every other context picks it up through the
                      // store's own change listener. The popup used to also
                      // broadcast a `CONFIG_UPDATED` message, but nothing
                      // ever handled it — it was a message to nobody.
                      setProvider(option.value);
                    }}
                    className={`rounded-lg border px-2 py-1.5 text-xs transition ${
                      active
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                        : 'border-white/10 bg-slate-950 text-slate-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/*
              选中态不能只靠颜色区分：三个按钮长得几乎一样，只有边框和底色
              不同。色觉障碍的用户看不出来哪个在用，屏幕阅读器也读不到。
              这里补一句文字，并让 `aria-pressed` 说出状态。
            */}
            <p className='text-xs text-slate-300'>
              当前使用中：{providerLabel}
            </p>
            <div className='text-xs text-slate-400'>{pathLabel}</div>
            <div className='text-xs text-slate-400'>
              模型：{providerSettings.model || '未设置'}
            </div>
            {/*
              用户在这里看得到地址却改不了，会怀疑是自己配错了。给他一条
              去设置页的路，比让他自己猜好。
            */}
            <button
              type='button'
              onClick={() => {
                void chrome.runtime.openOptionsPage();
              }}
              className='text-xs text-cyan-300 underline-offset-2 transition hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
            >
              在设置页修改地址、模型或密钥
            </button>
          </div>
        </details>

        {/* 次要 / 危险操作。说明常驻显示：原来藏在 hover 提示里，
            触控板用户根本看不到按下会发生什么。 */}
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <button
              type='button'
              onClick={requestResetAndRerun}
              disabled={!primaryAction.canTranslate}
              className='flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-40'
            >
              <RefreshCw className='h-4 w-4' />
              强制重翻
            </button>
            <p className='mt-1 text-[11px] leading-snug text-slate-400'>
              忽略缓存，重新翻译所有图片
            </p>
          </div>
          <div>
            <button
              type='button'
              onClick={requestReset}
              className='flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-200/90 transition hover:border-rose-500/40 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400'
            >
              <Trash2 className='h-4 w-4' />
              清除本页译文
            </button>
            <p className='mt-1 text-[11px] leading-snug text-slate-400'>
              移除本页译文与阅读面板
            </p>
          </div>
        </div>

        {/* 阅读面板开关：以前只有快捷键能关它，用户看到面板挡住正文却
            找不到地方关。面板本身还没创建时（这一页还没翻译过）不显示，
            因为那时按下去只会得到一个空面板。 */}
        {readingPanelVisible !== null && (
          <button
            type='button'
            onClick={() => {
              void handleToggleReadingPanel();
            }}
            className='flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
          >
            <Eye className='h-4 w-4' />
            {readingPanelVisible ? '隐藏译文阅读面板' : '显示译文阅读面板'}
          </button>
        )}

        {/* 本月用量：让"要花钱的人"随时能看到账单，而不是只在这里点一下
            才知道花了多少。数据在本地，不产生任何请求。 */}
        <p className='text-center text-[11px] leading-snug text-slate-400'>
          本月 {usageSummary.billableCalls} 次 API 调用
          {usageSummary.tokens > 0
            ? ` · ${usageSummary.tokens.toLocaleString('zh-CN')} Token`
            : ''}
          {usageSummary.translations > 0
            ? ` · 缓存命中 ${usageSummary.cacheHitRate}%`
            : ''}
        </p>
      </div>

      <ConfirmDialog
        open={pendingDanger === 'reset'}
        title='清除本页译文？'
        description='将移除本页所有译文覆盖层与阅读面板内容，无法撤销。翻译缓存会保留，重新翻译时仍会命中缓存、不会产生新的 API 费用。'
        confirmLabel='清除'
        cancelLabel='取消'
        destructive={true}
        onConfirm={confirmDanger}
        onCancel={() => setPendingDanger(null)}
      />
      <ConfirmDialog
        open={pendingDanger === 'forceRetranslate'}
        title='强制重翻当前页？'
        description='忽略缓存，对所有图片重新调用 Vision LLM 翻译，会产生额外的 API 调用费用。'
        confirmLabel='重翻'
        cancelLabel='取消'
        destructive={true}
        onConfirm={confirmDanger}
        onCancel={() => setPendingDanger(null)}
      />
      <ConfirmDialog
        open={pendingDanger === 'retryFailed'}
        title='重试失败的图片？'
        description='只重新翻译失败的那几张图片，会再次调用 Vision LLM 产生费用；已经翻译成功的图片不会重来。'
        confirmLabel='重试'
        cancelLabel='取消'
        destructive={true}
        onConfirm={confirmDanger}
        onCancel={() => setPendingDanger(null)}
      />
    </div>
  );
};

export default PopupApp;
