import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  Info,
  Keyboard,
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
  COMMAND_DESCRIPTIONS,
  COMMAND_IDS,
  COMMAND_SHORTCUTS,
} from '@/background/commands';
import {
  TARGET_LANGUAGES,
  getTargetLanguageLabel,
} from '@/shared/target-languages';
import {
  describeForceRetranslate,
  describeRetryFailedCost,
} from '@/shared/cost-wording';
import { isLocalProvider } from '@/shared/local-providers';
import {
  describeAutoTranslateCost,
  buildResultSummary,
  describeAutoTranslate,
  describeImageCount,
  getPageAvailability,
  getPrimaryActionState,
  isHostAutoTranslated,
  matchingAllowlistEntries,
  type PageAvailability,
} from './popup-state';
import { formatShortcutKeys, isMacPlatform } from './popup-shortcuts';
import type {
  ContentResponse,
  ContentState,
  PopupToContentMsg,
} from '@/shared/runtime-contracts';
import { formatEta } from '@/shared/eta';

/**
 * What the force-retranslate dialog says about a run that is still going.
 *
 * The button is disabled while the page is translating, but a run can start
 * in the gap between opening the dialog and confirming it — and the content
 * script *waits* for the running round to finish before it starts the second
 * one. The user has to know that both rounds are billed.
 */
const FORCE_RETRANSLATE_RUNNING_NOTE =
  '如果此刻还有翻译在进行，会先让它跑完（那一轮同样计费），然后才开始这一轮——等于付两次整页的钱。';

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
 * Ask the content script a question.
 *
 * The answers it can give back are defined in `@/shared/runtime-contracts`:
 * `GET_STATE` returns the page's translation state, `COUNT_IMAGES` returns
 * the price of the page (how many images are ready, how many are still on
 * their way, how many a full re-translate would bill for). The shape lives
 * there so the two ends cannot drift apart.
 */
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
   * How many images on this page have not loaded yet.
   *
   * A webtoon reader shows two or three pages and keeps forty more in the
   * wings. Those images are going to be translated — and billed — as soon as
   * they arrive, so the number belongs in front of the user *before* the
   * click, not after the bill.
   */
  const [pagePendingCount, setPagePendingCount] = useState<number | null>(null);
  /**
   * How many images one full re-translate would bill for.
   *
   * The images that were already translated count here: "ignore the cache and
   * do it again" translates every one of them a second time. Without this
   * number the confirmation dialog could only say "all images", which is the
   * one phrasing that never tells the user what they are about to pay for.
   */
  const [pageImageTotal, setPageImageTotal] = useState<number | null>(null);
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
  /**
   * Whether the page's follow-up budget ran out.
   *
   * It is a separate fact from `autoContinueArmed`: "not armed" and "armed
   * until the budget ran out" call for different things from the reader, and
   * the popup used to say the same sentence for both.
   */
  const [autoContinueBudgetExhausted, setAutoContinueBudgetExhausted] =
    useState<boolean>(false);
  const provider = useAppConfigStore(state => state.provider);
  const providers = useAppConfigStore(state => state.providers);
  const targetLanguage = useAppConfigStore(state => state.targetLanguage);
  const enabled = useAppConfigStore(state => state.enabled);
  const onboardingCompleted = useAppConfigStore(
    state => state.onboardingCompleted
  );
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
      return null;
    }
    if (!primaryAction.canTranslate) {
      return null;
    }
    /*
     * `total` counts the images that have been translated before as well:
     * "ignore the cache and do it again" asks the model for those too. The
     * difference between the two numbers is therefore the number of images
     * on this page that are already done.
     */
    const alreadyTranslated =
      pageImageTotal !== null && pageImageCount !== null
        ? Math.max(0, pageImageTotal - pageImageCount)
        : 0;
    return describeImageCount(
      pageImageCount,
      pagePendingCount,
      autoContinueEnabled,
      provider,
      alreadyTranslated
    );
  }, [
    contentState.status,
    primaryAction.canTranslate,
    pageImageCount,
    pageImageTotal,
    pagePendingCount,
    autoContinueEnabled,
    provider,
  ]);

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
   *
   * Three numbers come back, because "how many images are on this page" has
   * three honest answers: how many are ready now, how many are still on their
   * way, and how many a full re-translate would ask the model for.
   */
  const countTranslatableImages = useCallback(async (): Promise<{
    count: number | null;
    pending: number | null;
    total: number | null;
  }> => {
    try {
      const response = await Promise.race([
        sendToContent({ type: 'COUNT_IMAGES' }),
        new Promise<null>(resolve => {
          setTimeout(() => resolve(null), 1500);
        }),
      ]);
      return {
        count: typeof response?.count === 'number' ? response.count : null,
        pending:
          typeof response?.pending === 'number' ? response.pending : null,
        total: typeof response?.total === 'number' ? response.total : null,
      };
    } catch {
      return { count: null, pending: null, total: null };
    }
  }, []);

  const applyImageCount = useCallback(
    (counts: {
      count: number | null;
      pending: number | null;
      total: number | null;
    }) => {
      setPageImageCount(counts.count);
      setPagePendingCount(counts.pending);
      setPageImageTotal(counts.total);
    },
    []
  );

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
      /*
       * The page is the only one that knows whether the reading panel is
       * showing. An unknown answer means "this page has no panel": the
       * panel is only created by a translation run, so a page that never
       * translated has none — and offering a toggle for it would create an
       * empty panel over the artwork the moment the user pressed it.
       */
      setReadingPanelVisible(response?.state?.readingPanelVisible ?? null);
      if (typeof response?.state?.autoContinueArmed === 'boolean') {
        setAutoContinueArmed(response.state.autoContinueArmed);
      }
      setAutoContinueBudgetExhausted(
        response?.state?.autoContinueBudgetExhausted === true
      );
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
    applyImageCount(await countTranslatableImages());
  }, [applyImageCount, countTranslatableImages]);

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
      // The page is the only one that knows whether the reading panel is
      // showing. The popup used to flip its own label optimistically, so it
      // claimed "hide the panel" while the page showed nothing at all.
      // An unknown answer means "this page has no panel" — see
      // refreshPageStatus.
      setReadingPanelVisible(msg.state.readingPanelVisible ?? null);
      if (typeof msg.state.autoContinueArmed === 'boolean') {
        setAutoContinueArmed(msg.state.autoContinueArmed);
      }
      setAutoContinueBudgetExhausted(
        msg.state.autoContinueBudgetExhausted === true
      );
      // The price of the page changes while it is being translated: images
      // load, they get translated, they stop being "new". A number that was
      // read once — before the run — describes a page that no longer exists.
      if (msg.state.status === 'complete') {
        void countTranslatableImages().then(applyImageCount);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [applyImageCount, countTranslatableImages]);

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
      // The label is *not* flipped here. The content script knows whether the
      // panel is showing — and on a page that was never translated, the
      // first press creates the panel and shows it. An optimistic flip said
      // the opposite of what the page did.
      //
      // The page's own answer moves the label; the STATE_UPDATE that follows
      // says the same thing.
      if (typeof response?.readingPanelVisible === 'boolean') {
        setReadingPanelVisible(response.readingPanelVisible);
      }
    });
  }, [runAction]);

  const handleResetAndRerun = useCallback(async () => {
    await runAction(async () => {
      // The popup already asked the user in its own confirm dialog, which
      // names the image count and the price. The page asks too when nobody
      // has — the keyboard shortcut has no popup to confirm in.
      await sendToContent({ type: 'FORCE_RETRANSLATE_PAGE', confirmed: true });
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

  /**
   * 这一页现在有几张译文。
   *
   * 页面报上来的是"盖着译文的图片数"。它是 0 的时候「清除本页译文」是
   * 一个空动作：点下去会弹一个"无法撤销"的破坏性确认框，然后什么也没
   * 发生。没见过数字（undefined）时照旧可用 —— 我们只是还不知道，不是
   * 知道没有。
   */
  const overlayCount = contentState.overlayCount;

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
      retryTargetCount: contentState.retryTargetCount,
      cachedCount: contentState.cachedCount,
      skippedCount: contentState.skippedCount,
      skippedDuplicateCount: contentState.skippedDuplicateCount,
      pendingCount: contentState.pendingCount,
      // 跑完了但有几处没翻出来 —— 卡片要说，不能让「成功」盖住它。
      missingCount: contentState.missingCount,
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
      provider,
      armed: autoContinueArmed,
      budgetExhausted: autoContinueBudgetExhausted,
      hostAllowlisted: isHostAutoTranslated(currentUrl, autoTranslateHosts),
      autoContinueEnabled,
      masterEnabled: enabled,
    });
  }, [
    autoContinueArmed,
    autoContinueBudgetExhausted,
    autoContinueEnabled,
    autoTranslateHosts,
    currentUrl,
    enabled,
    provider,
  ]);

  const statusText = useMemo(() => {
    switch (contentState.status) {
      case 'scanning':
        return contentState.candidateCount
          ? `扫描当前页面图片中（找到 ${contentState.candidateCount} 张）`
          : '扫描当前页面图片中';
      case 'translating': {
        // 弹窗是用户查进度的地方，"还要多久"比"到第几张"更有用。
        const eta =
          typeof contentState.etaSeconds === 'number' &&
          contentState.etaSeconds > 0
            ? ` · 约 ${formatEta(contentState.etaSeconds)}`
            : '';
        return `翻译中 ${contentState.current}/${contentState.total}${eta}`;
      }
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
    return getTargetLanguageLabel(targetLanguage);
  }, [targetLanguage]);

  /**
   * Is the page translating right now?
   *
   * Two things depend on it, and both cost money: the "force retranslate"
   * button (which would queue a second, full-price round behind the running
   * one) and the confirmation dialog (which has to say that the current run
   * finishes first).
   */
  const isRunning =
    contentState.status === 'translating' || contentState.status === 'scanning';

  /**
   * What "force retranslate" is about to cost.
   *
   * The count is the number of images the page will ask the model for again
   * — including the ones that were translated successfully, because this
   * button ignores the cache. Without it the dialog could only say "all
   * images", which never tells a user what they are about to be charged.
   *
   * The images still loading are priced separately: they are not in the
   * page's count, but with auto-continue armed they will be translated and
   * billed the moment their bytes land. A dialog that quoted only the
   * loaded ones would be wrong in the user's favour by however many pages
   * the reader has not scrolled to yet.
   */
  const forceRetranslateDescription = useMemo(() => {
    const cost = describeForceRetranslate(
      pageImageTotal ?? pageImageCount,
      provider,
      pagePendingCount,
      // null = 页面状态还没回来。这时既不说"会自动翻译"，也不说"不会"。
      autoContinueArmed
    );
    return `${cost}${FORCE_RETRANSLATE_RUNNING_NOTE}`;
  }, [
    autoContinueArmed,
    pageImageCount,
    pageImageTotal,
    pagePendingCount,
    provider,
  ]);

  /**
   * How many images a "retry the failed ones" would really re-request.
   *
   * `failedCount` is the number of failures in the last run — but a run
   * that dies halfway leaves the images it never reached in the retry list
   * without raising that counter. The popup used to quote the counter, so
   * it said "1 failed" while the next click billed twenty images. The page
   * reports the size of the list the retry actually walks, and that is the
   * number the user gets to see before they agree to pay for it.
   *
   * The page reports it in every state, not only when a run finished: a
   * run that died on a fatal error still leaves its images in the retry
   * list, and that is exactly the moment the user needs the retry entry.
   */
  const retryTargetCount =
    contentState.retryTargetCount ??
    (contentState.status === 'complete' ? (contentState.failedCount ?? 0) : 0);

  /**
   * The four keyboard shortcuts, ready to be shown.
   *
   * The list comes from `@/background/commands` — the same source the
   * manifest is written from — so the popup can never advertise a shortcut
   * the extension does not have.
   */
  const shortcutHints = useMemo(() => {
    const isMac = isMacPlatform(navigator.userAgent);
    return COMMAND_IDS.map(id => {
      const shortcut = COMMAND_SHORTCUTS[id];
      return {
        id,
        description: COMMAND_DESCRIPTIONS[id],
        keys: formatShortcutKeys(
          isMac ? shortcut.mac : shortcut.default,
          isMac
        ),
      };
    });
  }, []);

  /**
   * "这一页正在花你的钱" —— 而且它必须看得见。
   *
   * 这块提示以前躲在折叠的 `<details>` 里，于是整个产品唯一一条扣费警告
   * 谁都看不见：用户手动翻译过一次之后，网页会继续自己翻译、继续扣费，
   * 而唯一的提示藏在一个需要用户自己注意到并点开的三角形后面。
   *
   * 现在它就在主按钮下面，在用户已经盯着看的那张卡片里。
   */
  const autoTranslateNotice = autoTranslateStatus ? (
    <div
      className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
        autoTranslateStatus.tone === 'active'
          ? 'border-amber-400 bg-amber-500 font-medium text-slate-950'
          : 'border-white/20 bg-slate-950 text-slate-400'
      }`}
    >
      <div className='flex items-start gap-2'>
        <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
        <span className='flex-1'>{autoTranslateStatus.message}</span>
      </div>
      {autoTranslateStatus.action ? (
        <button
          type='button'
          onClick={() => {
            /*
             * 两条路都是"停下来"：把这一页解除武装，或者把这个站从名单里
             * 去掉。以前这里还有一个「打开自动续翻」——它修不了名单站点照样
             * 自动翻译这件事，反而会多开一条扣费的来源。
             */
            void handleStopAutoTranslate();
          }}
          className={`mt-2 w-full rounded-md border px-2 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 ${
            autoTranslateStatus.tone === 'active'
              ? 'border-slate-950/40 bg-slate-950 text-amber-100 hover:bg-slate-900'
              : 'border-amber-400/40 text-amber-100 hover:bg-amber-400/10'
          }`}
        >
          {autoTranslateStatus.action.label}
        </button>
      ) : null}
    </div>
  ) : null;

  if (isLoading) {
    return (
      <div className='flex h-[220px] w-[360px] items-center justify-center bg-slate-950 text-slate-100'>
        <Loader2 className='h-5 w-5 animate-spin' />
      </div>
    );
  }

  return (
    <div className='max-h-[600px] w-[360px] overflow-y-auto bg-slate-950 text-slate-100'>
      {/*
        读屏用户和眼睛看到的应该是同一件事。

        弹窗里每一次状态变化以前都只是屏幕上一块文字换了内容：翻译开跑、
        翻译完成、几张失败，读屏软件一个字都不念。这个常驻的 status 区把
        两句话念出来 —— 开始和结果 —— 而不念中间的进度，那只是噪音。
      */}
      <div className='sr-only' role='status' aria-live='polite'>
        {isRunning
          ? '正在翻译当前页面'
          : contentState.status === 'complete'
            ? (resultSummary?.title ?? '翻译完成')
            : contentState.status === 'error'
              ? '翻译出错'
              : ''}
      </div>

      {/* 头部：品牌 + 后端状态 + 设置入口 */}
      <div className='flex items-center justify-between border-b border-white/15 px-4 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <Sparkles className='h-4 w-4 shrink-0 text-cyan-300' />
          <span className='truncate text-sm font-semibold'>漫画翻译助手</span>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {/*
            The provider name is a label, not a paragraph. "OpenAI-compatible"
            breaks at the hyphen, and a Chinese provider name breaks between
            any two characters — either way the badge stops being a badge.
          */}
          <span className='whitespace-nowrap rounded-full border border-white/25 bg-white/[0.05] px-2 py-0.5 text-xs text-slate-300'>
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

      {/*
        第一次打开弹窗的用户还没有配置任何东西。弹窗以前只给一个点不动的
        「翻译当前页面」按钮和一句「还没有配置 MiniMax」——用户得先自己
        猜出"要去设置页"。商店文案里写着"在弹窗中点「开始设置」"，所以
        这里给的就是那个按钮：一步就到设置页，而设置页会直接弹出引导。
      */}
      {/*
        跳过引导不等于配置好了。

        以前这条横幅只看 `onboardingCompleted`，而向导的三条退出路径
        （Esc / 右上角 × /「稍后再设置」）都会把它置为 true —— 用户按一下
        Esc，弹窗里唯一指路的那块就永久消失了，手里却什么都没有。判据改成
        "看完过引导**并且**后端配好了"，两个条件缺一不可。
      */}
      {(!onboardingCompleted || !isConfigured) && (
        <div className='border-b border-white/15 bg-cyan-500/[0.08] px-4 py-3'>
          <div className='text-sm font-medium text-cyan-100'>
            先完成一次设置
          </div>
          <p className='mt-1 text-xs leading-relaxed text-slate-300'>
            填一个 API Key（或改用本地模型）就能开始翻译。引导会说明图片会
            发到哪里、会花多少钱。
          </p>
          <button
            type='button'
            onClick={() => {
              void chrome.runtime.openOptionsPage();
            }}
            className='mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950'
          >
            <Settings className='h-4 w-4' />
            开始设置
          </button>
        </div>
      )}

      {/* 主操作区：翻译当前页是用户 90% 的动作，必须最显眼 */}
      <div className='space-y-3 px-4 py-4'>
        <div className='rounded-xl border border-white/25 bg-white/[0.08] p-3'>
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

          {isRunning ? (
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
                <div className='mt-3'>
                  <p className='text-xs leading-relaxed text-slate-300'>
                    {imageCountHint.headline}
                  </p>
                  {/*
                    「一张图可能变成多次请求」是另一类事实：headline 说的是
                    这一页有几张图，这一句说的是计费怎么算。分开写，读者
                    才会先看到「2 张、会花钱」，再看到这条注解。它没有被
                    藏起来 —— 只是不必和按钮抢注意力。
                  */}
                  {imageCountHint.caveat ? (
                    <p className='mt-1 text-[11px] leading-relaxed text-slate-400'>
                      {imageCountHint.caveat}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <button
                type='button'
                onClick={handleTranslate}
                disabled={!primaryAction.canTranslate}
                className='mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400'
              >
                <Languages className='h-4 w-4' />
                翻译当前页面
              </button>
            </>
          )}

          {/*
            扣费警告常驻在这里，就贴在主按钮下面。
            它以前在折叠的"阅读设置"里，等于没有。
          */}
          {autoTranslateNotice}

          {!isRunning ? (
            <>
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
            </>
          ) : null}

          {/*
            失败信息常驻在这里，不管页面正在不在跑。

            它以前被放在"没有任务在跑"的那一支里，于是运行中按下
            「取消当前翻译」如果失败（页面刚跳转、扩展刚重载），错误就
            掉进了一个不渲染的分支：用户以为已经停下来了，页面却还在
            翻，还在计费。一个看不见的失败，比没有这个按钮更糟。
          */}
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
                    : 'border-white/20 bg-slate-950'
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

          {/*
            重试入口：只重跑失败的那几张，已成功的不会被二次计费。

            它以前只在「完成」这一支里出现。于是一章翻到第 8 张时密钥
            过期、整轮夭折，弹窗只给一张错误卡片和「打开设置」—— 明明手里
            握着「还有 12 张要重试」这个数字，却不给人重试的入口，只能
            重新扫整页。修好密钥之后，读者要的正是"把那 12 张翻掉"。
          */}
          {retryTargetCount > 0 && !isRunning ? (
            <button
              type='button'
              onClick={requestRetryFailed}
              className='mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'
            >
              <RefreshCw className='h-3.5 w-3.5' />
              重新翻译失败的 {retryTargetCount} 张
            </button>
          ) : null}
        </div>

        {/* 主开关：关闭即完全不请求模型 */}
        <label className='flex items-center justify-between rounded-lg border border-white/25 bg-white/[0.05] px-3 py-2.5'>
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
        <details className='group rounded-lg border border-white/25 bg-white/[0.08]'>
          <summary className='flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium marker:hidden'>
            阅读设置
            <ChevronDown className='h-4 w-4 text-slate-400 transition-transform group-open:rotate-180' />
          </summary>
          <div className='space-y-3 border-t border-white/15 px-3 py-3'>
            <label className='flex items-center justify-between'>
              <div>
                <div className='text-sm font-medium'>自动翻译本站</div>
                <div className='text-xs text-slate-400'>
                  {currentHost
                    ? `${describeAutoTranslateCost(provider)}（本设置对 ${currentHost} 的所有页面生效）`
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
                /*
                 * The border is the only thing that says "this is a control".
                 * `border-white/20` over the popup's slate-950 is 1.7:1 — the
                 * select is invisible. WCAG 1.4.11 wants 3:1, and slate-500
                 * (4.2:1) is the lightest shade that gets there: slate-600
                 * tops out at 2.8:1 even against pure black.
                 */
                className='w-full rounded-lg border border-slate-500 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/60'
              >
                {TARGET_LANGUAGES.map(item => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            {autoTranslateHosts.length > 0 && (
              <div className='text-xs text-slate-400'>
                已开启自动翻译的站点：{autoTranslateHosts.length} 个
              </div>
            )}

            {/*
              这一页会不会自己开始翻译 —— 提示搬到了上面的"当前页面"卡片里，
              就贴在主按钮下面。折叠面板里的提示没有人看得见，而这一条是
              整个产品里唯一一条"你正在扣费"的警告。
            */}

            <div className='flex items-start gap-2 rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-xs text-slate-400'>
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
        <details className='group rounded-lg border border-white/25 bg-white/[0.08]'>
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
          <div className='space-y-2.5 border-t border-white/15 px-3 py-3'>
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
                    title={label}
                    className={`truncate rounded-lg border px-2 py-1.5 text-xs transition ${
                      active
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                        : 'border-white/20 bg-slate-950 text-slate-300 hover:bg-slate-900'
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
              disabled={!primaryAction.canTranslate || isRunning}
              className='flex w-full items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/[0.05] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-40'
            >
              <RefreshCw className='h-4 w-4' />
              忽略缓存重翻
            </button>
            <p className='mt-1 text-[11px] leading-snug text-slate-400'>
              {isRunning
                ? '翻译进行中，完成后可重翻'
                : '忽略缓存，重新请求本页已加载的图片'}
            </p>
          </div>
          <div>
            <button
              type='button'
              onClick={requestReset}
              disabled={overlayCount === 0}
              className='flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-200/90 transition hover:border-rose-500/40 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-40'
            >
              <Trash2 className='h-4 w-4' />
              清除本页译文
            </button>
            <p className='mt-1 text-[11px] leading-snug text-slate-400'>
              {overlayCount === 0
                ? '本页没有译文可清除'
                : `移除本页 ${overlayCount} 张译文与阅读面板`}
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
            className='flex w-full items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/[0.05] px-3 py-2 text-sm text-slate-200 transition hover:bg-white/[0.10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
          >
            <Eye className='h-4 w-4' />
            {readingPanelVisible ? '隐藏译文阅读面板' : '显示译文阅读面板'}
          </button>
        )}

        {/*
          快捷键：manifest 里注册了四个命令，界面上却没有一个字。
          用户装了扩展以后，只能自己去 chrome://extensions/shortcuts 里
          猜有没有这回事。这块常驻显示，不折叠——折叠起来就等于没有。
        */}
        <div className='rounded-lg border border-white/20 bg-slate-950 px-3 py-2.5'>
          <div className='flex items-center gap-2 text-sm font-medium'>
            <Keyboard className='h-4 w-4 text-cyan-300' />
            默认快捷键
          </div>
          {/*
            These are the defaults the extension ships with. Chrome lets the
            user rebind any of them at chrome://extensions/shortcuts, and
            after that the keys shown here are the ones that no longer work.
            Saying "默认" is the honest version of the same list.
          */}
          <p className='mt-1 text-xs text-slate-400'>
            可在 chrome://extensions/shortcuts 里改成你自己的按键
          </p>
          <ul className='mt-2 space-y-1.5'>
            {shortcutHints.map(item => (
              <li
                key={item.id}
                className='flex items-center justify-between gap-3 text-xs text-slate-300'
              >
                <span className='flex-1'>{item.description}</span>
                <span className='flex shrink-0 items-center'>
                  {item.keys.map((key, index) => (
                    <span
                      key={`${item.id}-${index}`}
                      className='flex items-center'
                    >
                      {index > 0 ? (
                        <span className='px-0.5 text-slate-400'>+</span>
                      ) : null}
                      <kbd className='rounded border border-white/15 bg-slate-800 px-1 py-0.5 font-mono text-[10px] text-slate-200'>
                        {key}
                      </kbd>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 本月用量：让"要花钱的人"随时能看到账单，而不是只在这里点一下
            才知道花了多少。数据在本地，不产生任何请求。 */}
        <p className='text-center text-[11px] leading-snug text-slate-400'>
          {isLocalProvider(provider)
            ? `本月 ${usageSummary.billableCalls} 次模型调用（本机模型，不产生费用）`
            : `本月 ${usageSummary.billableCalls} 次 API 调用`}
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
        description='将移除本页所有译文覆盖层与阅读面板内容，无法撤销。翻译缓存会保留，之前翻译成功的图片再次翻译时不会产生新的 API 费用（换了服务商或模型则另算；之前翻译失败的图片本来就没有进缓存）。'
        confirmLabel='清除'
        cancelLabel='取消'
        destructive={true}
        onConfirm={confirmDanger}
        onCancel={() => setPendingDanger(null)}
      />
      <ConfirmDialog
        open={pendingDanger === 'forceRetranslate'}
        title='忽略缓存重翻当前页？'
        description={forceRetranslateDescription}
        confirmLabel='重翻'
        cancelLabel='取消'
        destructive={true}
        onConfirm={confirmDanger}
        onCancel={() => setPendingDanger(null)}
      />
      <ConfirmDialog
        open={pendingDanger === 'retryFailed'}
        title='重试失败的图片？'
        description={`只重新翻译失败的 ${retryTargetCount} 张图片。${describeRetryFailedCost(provider)}`}
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
