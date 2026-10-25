import {
  createAutoTranslateMessage,
  isTranslationEnabled,
  shouldAutoTranslatePage,
} from './auto-translate';
/**
 * Message protocols handled by this background script.
 *
 * The dispatcher accepts TWO coexisting envelopes:
 *
 * 1. Action-based (legacy): { action: 'fetchImage' | 'getConfig' | ... }
 *    Used by:
 *    - image-processor.ts (CORS-tainted image proxy)
 *    - popup.tsx and options.tsx (config read/write)
 *
 * 2. Type-based (new): { type: 'JOB_TRANSLATE_IMAGE' | 'FETCH_IMAGE_BYTES' | ... }
 *    Used by:
 *    - translation-transport.ts (translation job dispatch)
 *
 * Response field naming differs: action-based returns `{ success, imageBase64 }`,
 * type-based returns `{ success, job: { ... }, textAreas }` (envelope shape).
 * Do NOT unify without also migrating the consumers; see
 * docs/architecture-notes.md.
 */
import type {
  TranslateImageJobRequest,
  TranslateImageJobResponse,
  RequestedExecutionPath,
  ConfigUpdatedMessage,
  FetchImageBytesResponse,
} from '@/shared/runtime-contracts';
import { DEFAULT_CONFIG, APP_CONFIG_STORAGE_KEY } from '@/shared/app-config';
import { isSupportedPageUrl } from '@/shared/app-config';
import { normalizeRuntimeAppConfig } from '@/shared/preloaded-config';
import { buildContentConfigSnapshot } from '@/shared/content-config';
import { getErrorMessage } from '@/utils/error-message';
import { deobfuscateAllApiKeys } from '@/utils/crypto';
import { useUsageStore } from '@/stores/usage-store';

import { translateImageViaProviderDirect } from './provider-direct-client';
import {
  resolveActiveProvider,
  isProviderUsable,
  type ActiveProviderConfig,
} from './provider-config';
import { createProvider } from '@/providers';
import { BackgroundJobQueue, createJobStatus } from './job-queue';
import { fetchImageBytes } from './image-fetch-guard';
import {
  isConfigEnvelope,
  toConfigEnvelope,
  writeConfigEnvelope,
} from './config-writer';
import {
  deriveRequestedPath,
  MASTER_SWITCH_OFF_MESSAGE,
  PROVIDER_NOT_READY_MESSAGE,
} from '@/shared/runtime-contracts';
import {
  CONTEXT_MENU_TRANSLATE_IMAGE,
  CONTEXT_MENU_TRANSLATE_PAGE,
  SUPPORTED_PAGE_URL_PATTERNS,
  createTranslateSingleImageMessage,
  resolveCommandAction,
} from './commands';

interface MessageRequest {
  action?: string;
  type?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  imageUrl?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * A response the worker sends back.
 *
 * The index signature is what lets a typed protocol response
 * (`FetchImageBytesResponse`, say) be sent without widening it: the
 * protocol types describe the payload, this describes the envelope.
 */
interface MessageResponse {
  success?: boolean;
  error?: string;
  received?: boolean;
  state?: unknown;
  config?: unknown;
  [key: string]: unknown;
}

// 默认并发度使用 DEFAULT_CONFIG.parallelLimit
const translationJobQueue = new BackgroundJobQueue(
  DEFAULT_CONFIG.parallelLimit,
  500
);

// The worker's refusals come from the shared protocol, not from local
// copies. The worker says them and the page reads them back, so one file
// cannot change the wording behind the other's back — which is how a refusal
// used to reach the reader as 「发生未知错误」.

/**
 * Is this message from one of our own extension pages?
 *
 * This is a credential gate: `getConfig` answers with the *deobfuscated* API
 * key and `setConfig` can rewrite the provider's endpoint, which is how the
 * key ends up at the right host. So the question has to be about where the
 * message came from, and it has to be answerable from the sender alone.
 *
 * It used to be answered indirectly — "an extension page is a sender with no
 * tab" — which is a fact about the tab, not about the origin. It happened to
 * hold, because only our own content script carries a tab. But the day
 * anything else starts sending the worker a message with a tab in it, that
 * reasoning silently stops applying, and it is a credential gate: it must be
 * stated as the proposition it is, so a reader can check it.
 *
 * So: the sender's own document is served by this extension. A content
 * script's `sender.url` is the web page it was injected into, which is never
 * on this origin, and a web page cannot message us at all (the manifest
 * declares no `externally_connectable`).
 */
function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  const url = sender.url;
  if (typeof url !== 'string' || url.length === 0) {
    // No URL to judge by. The only other signal an extension page has is
    // that it is not running in somebody's tab.
    return !sender.tab?.id;
  }
  return url.startsWith(chrome.runtime.getURL(''));
}

// ==================== Service worker keepalive ====================

/**
 * A translating webtoon chapter fans out into one job per tile plus retries,
 * and a vision model can take 10-30s per tile, so a long chapter keeps the
 * queue busy for minutes. MV3 terminates an idle service worker after ~30s and
 * termination takes the in-memory queue with it.
 *
 * What this alarm does and does not do:
 *
 * - It does NOT prevent termination. `chrome.alarms` schedules wake-ups; the
 *   documented ways to hold a worker open are an active port connection, an
 *   offscreen document, or periodic storage writes. The in-flight jobs here are
 *   kept reachable in practice by the content script's outstanding
 *   `sendMessage` response channel, not by this alarm.
 * - It DOES keep a restarted worker re-synchronised. Chrome replays events to a
 *   freshly started worker, and this listener re-reads the concurrency limit
 *   from storage so a worker that came back mid-chapter does not run with a
 *   stale one.
 *
 * `periodInMinutes` is 0.5 because that is the documented floor: anything
 * smaller is silently clamped, and an authored value below it (this used to be
 * 0.34, commented as "~20s") describes a cadence Chrome will never deliver.
 */
const KEEPALIVE_ALARM = 'manga-translator-keepalive';
const KEEPALIVE_PERIOD_MINUTES = 0.5;

function startKeepalive(): void {
  chrome.alarms?.create(KEEPALIVE_ALARM, {
    periodInMinutes: KEEPALIVE_PERIOD_MINUTES,
    delayInMinutes: KEEPALIVE_PERIOD_MINUTES,
  });
}

function stopKeepalive(): void {
  chrome.alarms?.clear(KEEPALIVE_ALARM);
}

chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm.name !== KEEPALIVE_ALARM) {
    return;
  }
  void getConfig()
    .then(syncQueueLimit)
    .catch(() => undefined);
});

// Only hold the worker awake while translation is actually switched on.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  const configChange = changes[APP_CONFIG_STORAGE_KEY];
  if (!configChange) {
    return;
  }
  if (isTranslationEnabled(configChange.newValue)) {
    startKeepalive();
    return;
  }

  stopKeepalive();

  // The switch went off. The queue may still be holding jobs that would
  // each become a real, billed request, so they are dropped rather than
  // started. (Running jobs are already on the wire and cannot be recalled —
  // that is the one half of "off" no switch can undo.)
  const dropped = translationJobQueue.cancelAll(MASTER_SWITCH_OFF_MESSAGE);
  if (dropped > 0) {
    console.warn(
      `[Background] 扩展已关闭，已取消 ${dropped} 个排队中的翻译任务`
    );
  }
});

chrome.runtime.onStartup.addListener(() => {
  void getConfig()
    .then(config => {
      syncQueueLimit(config);
      if (isTranslationEnabled(config)) {
        startKeepalive();
      }
    })
    .catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  void getConfig()
    .then(config => {
      if (isTranslationEnabled(config)) {
        startKeepalive();
      }
    })
    .catch(() => undefined);
});

// 同步并发度配置
function syncQueueLimit(config: Record<string, unknown>): void {
  const state = (config['state'] || config) as Record<string, unknown>;
  const limit =
    (typeof state['parallelLimit'] === 'number'
      ? state['parallelLimit']
      : null) ||
    (typeof config['parallelLimit'] === 'number'
      ? config['parallelLimit']
      : null) ||
    DEFAULT_CONFIG.parallelLimit;
  translationJobQueue.updateMaxConcurrent(limit);
}

// 启动时自动同步一次并发度配置
void getConfig()
  .then(config => {
    syncQueueLimit(config);
  })
  .catch(err => {
    console.error('[Background] 无法在启动时同步队列限制:', err);
  });

// 监听外部配置变更，自动同步并发度
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  const configChange = changes[APP_CONFIG_STORAGE_KEY];
  if (!configChange) {
    return;
  }
  syncQueueLimit(configChange.newValue || {});
});

// 配置变化后，把新的脱敏快照推给所有标签页。
//
// Content script 不再自己读 chrome.storage.local：它们拿的是 worker 发出的
// 脱敏快照（没有 API key）。这个广播让快照保持新鲜，即使 content script
// 之后不再能收到 storage.onChanged。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  if (!changes[APP_CONFIG_STORAGE_KEY]) {
    return;
  }
  void broadcastConfigSnapshot().catch(() => undefined);
});

/**
 * Push the redacted configuration snapshot to every tab.
 *
 * The snapshot carries no credential, so it is safe to hand to a content
 * script — which is exactly what it is for.
 */
async function broadcastConfigSnapshot(): Promise<void> {
  const config = await getConfig();
  const message: ConfigUpdatedMessage = {
    type: 'CONFIG_UPDATED',
    config: buildContentConfigSnapshot(config),
  };
  await broadcastToAllTabs(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractPersistedState(value: unknown): Record<string, unknown> {
  if (isRecord(value) && isRecord(value['state'])) {
    return value['state'] as Record<string, unknown>;
  }
  return isRecord(value) ? value : {};
}

function normalizeStoredConfigSnapshot(
  value: unknown
): Record<string, unknown> {
  const state = extractPersistedState(value);
  const normalizedRuntime = normalizeRuntimeAppConfig(value);

  return {
    ...DEFAULT_CONFIG,
    ...state,
    ...normalizedRuntime,
    providers: {
      ...DEFAULT_CONFIG.providers,
      'openai-compatible': {
        ...DEFAULT_CONFIG.providers['openai-compatible'],
        ...normalizedRuntime.openaiCompatible,
      },
      ollama: {
        ...DEFAULT_CONFIG.providers.ollama,
        ...normalizedRuntime.ollama,
      },
      'lm-studio': {
        ...DEFAULT_CONFIG.providers['lm-studio'],
        ...normalizedRuntime.lmStudio,
      },
    },
  };
}

chrome.runtime.onInstalled.addListener(details => {
  // 菜单项必须先 removeAll 再 create。
  //
  // onInstalled 在 install 和 update 两种情况下都会跑，而菜单项的 id 是
  // 固定的。用同一个 id 直接 create 两次，第二次会报 duplicate id 并且
  // 失败（menu item not created）。removeAll 是异步的，所以创建动作放在
  // 它的回调里，保证顺序。
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_TRANSLATE_PAGE,
      title: '翻译当前页面',
      contexts: ['page'],
      documentUrlPatterns: SUPPORTED_PAGE_URL_PATTERNS,
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU_TRANSLATE_IMAGE,
      title: '翻译这张图片',
      contexts: ['image'],
      documentUrlPatterns: SUPPORTED_PAGE_URL_PATTERNS,
    });
  });

  if (details.reason === 'install') {
    void initializeDefaultSettings();
    void chrome.runtime.openOptionsPage();
  } else if (details.reason === 'update') {
    void migrateSettings();
  }
});

// 右键菜单 → 转发到当前 tab 的 content script。
// 复用 sendToTab 已有的错误处理链路。
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_TRANSLATE_PAGE) {
    if (!isSupportedPageUrl(tab.url ?? info.pageUrl)) {
      return;
    }
    void sendToTab(tab.id, { type: 'TRANSLATE_PAGE' }).catch(() => undefined);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_TRANSLATE_IMAGE) {
    if (!isSupportedPageUrl(tab.url ?? info.pageUrl)) {
      return;
    }
    // srcUrl 是 Chrome 认定的被右键图片地址，可能是缩略图，也可能是
    // CDN 的另一个尺寸变体，和页面里 img.src 不一定一致。URL 原样传过去，
    // 由 content script 按最接近的 img 匹配。
    const imageUrl = info.srcUrl;
    if (!imageUrl) {
      return;
    }
    void sendToTab(tab.id, createTranslateSingleImageMessage(imageUrl)).catch(
      () => undefined
    );
  }
});

// 键盘快捷键 → 转发到当前活动标签页的 content script。
//
// 目标标签页用 tabs.query({active:true, currentWindow:true}) 取，和
// forwardToActiveTab 是同一个口径。
chrome.commands.onCommand.addListener((command, tab) => {
  const action = resolveCommandAction(command);
  if (!action) {
    return;
  }

  void (async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const targetTab = activeTab ?? tab;
    if (!targetTab?.id) {
      return;
    }
    // content script 不会注入内部页面，命令发过去只会得到
    // "Receiving end does not exist"，所以直接不执行。
    // tab.url 需要 "tabs" 权限才拿得到，拿不到时退回到事件自带的 tab。
    if (!isSupportedPageUrl(targetTab.url ?? tab?.url)) {
      return;
    }
    await sendToTab(targetTab.id, action).catch(() => undefined);
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void migrateConfigFromSyncToLocal();
  void checkAndSetDefaultConfig();
});

async function initializeDefaultSettings(): Promise<void> {
  await setConfig(DEFAULT_CONFIG);
}

/**
 * v0.3.5 之前配置存在 chrome.storage.sync（会随 Google 账户跨设备同步），
 * 导致混淆后的 API key 也会被同步出去。v0.3.5 起改用 chrome.storage.local。
 *
 * 本函数做一次性迁移：若 local 里没有配置但 sync 里有，就把 sync 的搬过来，
 * 然后删掉 sync 里的副本。幂等 —— 已迁移过的用户再跑也是 no-op。
 *
 * 搬进来的东西一律先变成 store 读得懂的信封（`{ state, version }`）。
 * 这一步以前是省略的：sync 里的旧值有可能就是扁平对象，而扁平对象在
 * zustand 眼里等于"什么都没存"—— 默认值会被合并到用户的设置上再写回去，
 * 用户的 API key、端点、模型和白名单就没了。搬家的动作本身不能毁掉它要
 * 搬的东西。
 */
async function migrateConfigFromSyncToLocal(): Promise<void> {
  try {
    const local = await chrome.storage.local.get([APP_CONFIG_STORAGE_KEY]);
    const stored = local[APP_CONFIG_STORAGE_KEY];

    if (stored !== undefined && stored !== null) {
      // local 已有配置，不再从 sync 搬。但它可能还是 envelope 之前的扁平
      // 对象——就地纠正，让这个键永远只存一种形状。
      if (!isConfigEnvelope(stored)) {
        const envelope = toConfigEnvelope(stored);
        if (envelope) {
          // Written through the one writer, so this key holds exactly one
          // shape. The version is the one the value came off disk with, so
          // the store's own migration still runs on it.
          await writeConfigEnvelope(envelope.state, envelope.version);
          console.warn(
            '[Background] 已把本地配置从旧格式转换为新格式（防止设置被默认值覆盖）'
          );
        }
      }
      return;
    }

    const synced = await chrome.storage.sync.get([APP_CONFIG_STORAGE_KEY]);
    const syncedConfig = synced[APP_CONFIG_STORAGE_KEY];
    if (!syncedConfig) {
      return; // sync 里也没有，没东西可迁
    }

    const envelope = toConfigEnvelope(syncedConfig);
    if (!envelope) {
      // The synced value is not a configuration at all — a string, a number,
      // an array, or something an older version wrote by mistake.
      //
      // It cannot be read back by the store (zustand takes `state` from the
      // envelope, so a non-envelope value reads as "nothing stored" and the
      // defaults get merged over it and written back), and it is about to be
      // deleted anyway. Writing it through verbatim would put a shape nobody
      // can read into the one key that is supposed to hold exactly one
      // shape. So the honest thing is to fall back to the defaults.
      await initializeDefaultSettings();
      await chrome.storage.sync.remove([APP_CONFIG_STORAGE_KEY]);
      console.warn(
        '[Background] chrome.storage.sync 里的配置不是可读的配置对象，已改用默认配置'
      );
      return;
    }

    await writeConfigEnvelope(envelope.state, envelope.version);
    await chrome.storage.sync.remove([APP_CONFIG_STORAGE_KEY]);
    console.warn(
      '[Background] 已将配置从 chrome.storage.sync 迁移到 chrome.storage.local（API key 不再跨设备同步）'
    );
  } catch (error) {
    console.error('[Background] sync→local 配置迁移失败:', error);
  }
}

async function migrateSettings(): Promise<void> {
  // Only the sync→local move belongs here.
  //
  // This used to end with `setConfig(normalizeStoredConfigSnapshot(...))`,
  // which wrote a *flat* object to the same key zustand reads. Zustand then
  // rehydrated from `state` → `undefined`, merged the defaults over the
  // user's settings and wrote the defaults back: the API key, endpoint,
  // model and auto-translate allowlist were gone after one update.
  //
  // Version upgrades are the store's own job — its `migrate` and `merge`
  // already handle them — so the worker has nothing to rewrite.
  await migrateConfigFromSyncToLocal();
}

async function checkAndSetDefaultConfig(): Promise<void> {
  const result = await chrome.storage.local.get([APP_CONFIG_STORAGE_KEY]);
  if (!result[APP_CONFIG_STORAGE_KEY]) {
    await initializeDefaultSettings();
  }
}

async function getConfig(): Promise<Record<string, unknown>> {
  const result = await chrome.storage.local.get([APP_CONFIG_STORAGE_KEY]);
  const config = normalizeStoredConfigSnapshot(result[APP_CONFIG_STORAGE_KEY]);
  deobfuscateAllApiKeys(config);
  return config;
}

async function setConfig(config: Record<string, unknown>): Promise<void> {
  // One write path, one shape: the envelope zustand reads. See
  // src/background/config-writer.ts for why the flat shape was fatal.
  await writeConfigEnvelope(config);
  syncQueueLimit(config);
}

async function requestAutoTranslateForTab(tabId?: number): Promise<void> {
  if (!tabId) return;
  await sendToTab(tabId, { type: 'TRANSLATE_PAGE' });
}

chrome.runtime.onMessage.addListener(
  (
    request: MessageRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ): boolean => {
    void handleMessage(request, sender, sendResponse);
    return true;
  }
);

async function handleMessage(
  request: MessageRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): Promise<void> {
  // 验证消息发送者。
  //
  // `sender.id` 是发送这条消息的扩展的 id。**别的**扩展的 content script
  // 也会带 `sender.tab`，所以"有没有 tab"不能用来判断消息是不是我们自己
  // 发出来的——那样任何一个装了别的扩展的页面都能让本扩展用用户的密钥
  // 去发请求（一次翻译任务就是一次真实的计费调用）。
  //
  // 需要说清楚的是：预检查本身是免费的。`validateConfig()` 只看字符串，
  // 不发网络请求；真正会花钱的是「测试配置」按钮——那是另一个入口，
  // 一次真实的 chat completion，在 `openai-compatible-base.ts` 里记账。
  //
  // 页面自己发不进来：`externally_connectable` 没有声明，网页无法直接
  // 给我们发消息。
  const isExtensionOrigin = sender.id === chrome.runtime.id;
  if (!isExtensionOrigin) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return;
  }

  // 扩展页（弹窗、设置页）才被信任到能读/写配置。
  //
  // 判据是发送方自己的文档是不是由本扩展提供的，而不是"有没有 tab"。
  // 见 isExtensionPageSender 的注释：这是一道凭据闸门，必须把命题本身
  // 写出来，而不是靠一个间接信号。
  const isExtensionPage = isExtensionPageSender(sender);

  try {
    // 涉及配置读写（包含 API Key 解混淆结果）的接口仅信任扩展内部页面。
    // content script 即使被注入到任意 tab 也不应读到去混淆后的 key，
    // 也不应改写配置。其它 job / fetch / state 接口对两者都开放。
    const requestAction =
      typeof request.action === 'string' ? request.action : null;
    const requestType = typeof request.type === 'string' ? request.type : null;
    const isSensitiveRequest =
      requestAction === 'getConfig' || requestAction === 'setConfig';
    if (isSensitiveRequest && !isExtensionPage) {
      sendResponse({
        success: false,
        error: `${requestAction ?? requestType ?? 'request'} requires extension origin`,
      });
      return;
    }
    if (request.type && !request.action) {
      switch (request.type) {
        case 'JOB_TRANSLATE_IMAGE':
          // Only this extension's own contexts may ask for a translation.
          // Another extension's content script shares the page but not the
          // origin, and it would be spending the user's key.
          //
          // The sender here is normally this extension's own content script
          // — it is the only thing that can trigger a run, and it carries a
          // tab — so this guard is about *whose* message it is, not about
          // whether it has a tab.
          if (!isExtensionOrigin) {
            sendResponse({
              success: false,
              error: 'JOB_TRANSLATE_IMAGE requires extension origin',
            });
            return;
          }
          sendResponse(
            (await enqueueTranslationJob(
              request as unknown as TranslateImageJobRequest
            )) as unknown as MessageResponse
          );
          return;
        case 'GET_CONFIG': {
          // The redacted snapshot: no credential crosses this boundary, so a
          // content script can read it without the worker giving away the
          // API key.
          const config = await getConfig();
          sendResponse({
            success: true,
            config: buildContentConfigSnapshot(config),
          });
          return;
        }
        case 'PROVIDER_PREFLIGHT': {
          const config = await getConfig();
          const active = resolveActiveProvider(config);
          const probe = await probeProvider(active);
          sendResponse(probe);
          return;
        }
        case 'STATE_UPDATE':
          void chrome.runtime.sendMessage(request).catch(() => undefined);
          sendResponse({ received: true });
          return;
        case 'READY': {
          const config = await getConfig();
          // Same opt-in rule as tabs.onUpdated: the content script announces
          // itself on every page load, so an ungated check here would
          // auto-translate every site the moment the extension is enabled.
          if (
            sender.tab?.id &&
            shouldAutoTranslatePage(config, sender.tab.url ?? sender.url)
          ) {
            await requestAutoTranslateForTab(sender.tab.id);
          }
          sendResponse({ received: true });
          return;
        }
        case 'FETCH_IMAGE_BYTES': {
          const imageUrl = request.imageUrl;
          if (!imageUrl) {
            sendResponse({ success: false, error: 'No image URL provided' });
            return;
          }
          const response = await fetchImageBytesResponse(imageUrl, sender);
          sendResponse(response);
          return;
        }
        case 'RECORD_CACHE_HIT': {
          /*
           * 一张图是缓存命中的。
           *
           * 命中不发请求、不花 Token，但用户要看得到它：「缓存命中 62%」
           * 是他判断缓存有没有在干活的那句话。
           *
           * 这条记录以前是页面自己写的，于是同一个月的合计散在两个地方：
           * worker 记的计费调用在一处，页面记的命中在另一处，谁也加不出
           * 总数。现在只有 worker 记，页面报一声，账只有一份。
           */
          const provider = request['provider'];
          if (
            provider === 'openai-compatible' ||
            provider === 'ollama' ||
            provider === 'lm-studio'
          ) {
            useUsageStore.getState().addRecord({
              provider,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              cached: true,
            });
          }
          sendResponse({ received: true });
          return;
        }
        case 'HUD_CANCELLED': {
          /*
           * 取消要真的停住队列。
           *
           * 以前这条消息只是转发给弹窗，worker 队列里排着的 job 一个不少地
           * 继续跑、继续发真实请求、继续计费——读者点了「取消当前翻译」，看到
           * HUD 回到空闲，账单却还在涨。
           *
           * 现在按 runScope 精确丢掉**这一页**还没开始的 job。别的标签页正在
           * 翻的章节不受影响：读者的「取消」说的是这一页，不是整个扩展。
           *
           * 已经在飞的 job 不动：请求已经在路上，收不回来，那一笔钱也已经花
           * 了。这是这条路径一直以来的诚实边界。
           */
          const runScope = request['runScope'];
          if (typeof runScope === 'string' && runScope) {
            const dropped = translationJobQueue.cancelByRunScope(runScope);
            if (dropped > 0) {
              console.info(
                `[Background] 取消翻译：丢弃了 ${dropped} 个尚未开始的请求`
              );
            }
          }
          void chrome.runtime.sendMessage(request).catch(() => undefined);
          sendResponse({ received: true });
          return;
        }
        default:
          sendResponse({ received: true });
          return;
      }
    }

    switch (request.action) {
      case 'getConfig':
        sendResponse({ success: true, config: await getConfig() });
        return;
      case 'setConfig':
        if (!request.config) {
          sendResponse({ success: false, error: 'No config provided' });
          return;
        }
        await setConfig(request.config);
        await broadcastConfigSnapshot();
        sendResponse({ success: true });
        return;
      case 'toggleTranslation':
        await forwardToActiveTab(
          request.enabled
            ? { type: 'TRANSLATE_PAGE' }
            : { type: 'CANCEL_TRANSLATION' },
          sendResponse
        );
        return;
      case 'startTranslation':
        await forwardToActiveTab({ type: 'TRANSLATE_PAGE' }, sendResponse);
        return;
      case 'stopTranslation':
        await forwardToActiveTab({ type: 'CANCEL_TRANSLATION' }, sendResponse);
        return;
      case 'getState':
      case 'checkState':
        await forwardToActiveTab({ type: 'GET_STATE' }, sendResponse);
        return;
      case 'openOptionsPage':
        void chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        return;
      case 'fetchImage': {
        const imageUrl = request.url;
        if (!imageUrl) {
          sendResponse({ success: false, error: 'No URL provided' });
          return;
        }
        sendResponse(await fetchImageBytesResponse(imageUrl, sender));
        return;
      }
      default:
        sendResponse({
          success: false,
          error: `Unknown action: ${request.action}`,
        });
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: getErrorMessage(error),
    });
  }
}

function deriveActualPath(provider: string): RequestedExecutionPath {
  return deriveRequestedPath(provider);
}

/**
 * Check that the configured provider is usable.
 *
 * The check needs the API key, so it can only run in the worker. The content
 * script asks for it over a message and gets back a verdict, never the key.
 */
async function probeProvider(active: ActiveProviderConfig): Promise<{
  success: boolean;
  valid: boolean;
  message: string;
  error?: string;
}> {
  try {
    const provider = await createProvider(active.provider, {
      apiKey: active.apiKey,
      baseUrl: active.baseUrl,
      model: active.model,
    });
    const probe = await provider.validateConfig();
    return {
      success: true,
      valid: probe.valid,
      message: probe.message,
    };
  } catch (error) {
    return {
      success: false,
      valid: false,
      message: getErrorMessage(error),
    };
  }
}

async function enqueueTranslationJob(
  request: TranslateImageJobRequest
): Promise<TranslateImageJobResponse> {
  // The master switch gates every path that can reach a paid endpoint.
  //
  // The content script checks it too, but that check lives in a context a
  // user can bypass — the context menu, a keyboard shortcut, or a message
  // sent directly. The background worker is the last place before the
  // request, so the check belongs here as well: "off" has to mean off all
  // the way down, or the extension bills the user for a switch they turned
  // off.
  const currentConfig = await getConfig();

  // The provider, the endpoint and the API key are resolved here, from the
  // worker's own configuration.
  //
  // The request used to carry them, which meant any content script able to
  // post a message could point the user's real key at an endpoint of its
  // choosing. Nothing a requester sends can influence which endpoint the
  // key is sent to any more.
  const active = resolveActiveProvider(currentConfig);

  const requestedPath = deriveActualPath(active.provider);

  if (!isTranslationEnabled(currentConfig)) {
    return {
      success: false,
      job: createJobStatus({
        jobId: request.jobId,
        pageKey: request.pageKey,
        runScope: request.runScope,
        priorityClass: request.priorityClass,
        requestedPath,
        scope: request.scope,
      }),
      textAreas: [],
      error: MASTER_SWITCH_OFF_MESSAGE,
    };
  }

  /*
   * 一个注定失败的请求不要排进队列。
   *
   * `run` 里已经有同一道检查（配置可能在排队期间被改），但那要等一页的
   * 排期走完才有答案。更糟的是：空密钥真的发出去，服务商回 401，分类器
   * 会告诉用户「API 密钥无效」—— 而他根本没有密钥可"无效"，该做的是去
   * 设置里填一个。这里提前拒绝，用的是同一条"扩展自己没准备好"的句子，
   * 用户看到的是「去设置」而不是一个假的服务商错误。
   */
  if (!isProviderUsable(active)) {
    return {
      success: false,
      job: createJobStatus({
        jobId: request.jobId,
        pageKey: request.pageKey,
        runScope: request.runScope,
        priorityClass: request.priorityClass,
        requestedPath,
        scope: request.scope,
      }),
      textAreas: [],
      error: PROVIDER_NOT_READY_MESSAGE,
    };
  }

  const job = createJobStatus({
    jobId: request.jobId,
    pageKey: request.pageKey,
    runScope: request.runScope,
    priorityClass: request.priorityClass,
    requestedPath,
    scope: request.scope,
  });

  return translationJobQueue.enqueue({
    job,
    // A user-initiated retry has to actually re-run. Without this the queue
    // collapses it onto the in-flight job for the same image and the retry
    // silently returns the result it was meant to replace.
    forceRefresh: request.forceRefresh,
    run: async () => {
      // The master switch, checked again at the last moment before the
      // request.
      //
      // The check above only covers the moment the job was queued. A chapter
      // sits in the queue for minutes — one job per tile, a vision model
      // that takes 10-30s each — and the user can turn the extension off
      // while it waits. "Off" has to mean off all the way down, or the
      // extension bills the user for a switch they turned off.
      const configAtRunTime = await getConfig();
      if (!isTranslationEnabled(configAtRunTime)) {
        const cancelledJob = translationJobQueue.updateJob(request.jobId, {
          state: 'cancelled',
        });
        return {
          success: false,
          job: cancelledJob ?? job,
          textAreas: [],
          error: MASTER_SWITCH_OFF_MESSAGE,
        };
      }

      // The provider is resolved again here, and the one resolved when the
      // job was queued is not used.
      //
      // The same argument as the master switch applies, one level up: a
      // chapter sits in the queue for minutes, and the reader can open the
      // settings page while it waits. The usual reason for switching
      // provider mid-run is to stop paying — to move from a cloud endpoint
      // to a local one — and a queue that keeps calling the old endpoint
      // would bill the reader for a provider they had just left. The other
      // direction matters too: a key that expired and was replaced must be
      // the key the job uses, or the job fails against a key that is gone.
      const activeAtRunTime = resolveActiveProvider(configAtRunTime);

      if (!isProviderUsable(activeAtRunTime)) {
        const failedJob = translationJobQueue.updateJob(request.jobId, {
          state: 'failed',
        });
        return {
          success: false,
          job: failedJob ?? job,
          textAreas: [],
          error: PROVIDER_NOT_READY_MESSAGE,
        };
      }

      const actualCapabilityUsed = deriveActualPath(activeAtRunTime.provider);
      translationJobQueue.updateJob(request.jobId, {
        actualCapabilityUsed,
        state: 'running',
      });

      const response = await translateImageViaProviderDirect({
        provider: activeAtRunTime.provider,
        apiKey: activeAtRunTime.apiKey,
        baseUrl: activeAtRunTime.baseUrl,
        model: activeAtRunTime.model,
        imageBase64: request.imageBase64,
        targetLanguage: request.targetLanguage,
        translationStylePreset: request.translationStylePreset,
        isHybridRegions: request.isHybridRegions,
      });

      if (!response.success) {
        const failureJob = translationJobQueue.updateJob(request.jobId, {
          actualCapabilityUsed,
          state: 'failed',
        });

        if (!failureJob) {
          throw new Error('Background job state missing during failure update');
        }

        return {
          success: false,
          job: failureJob,
          textAreas: [],
          pipeline: response.pipeline,
          cached: response.cached,
          usage: response.usage ?? null,
          error: response.error,
          // The status travels as a number, not only as the `[HTTP nnn]`
          // marker inside the message: a provider that never wrote a marker
          // used to arrive with no status at all, and a 401 became
          // 「发生未知错误」 instead of 「API 密钥无效，请检查配置」.
          errorStatus: response.errorStatus,
        };
      }

      const successJob = translationJobQueue.updateJob(request.jobId, {
        actualCapabilityUsed,
        state: 'succeeded',
        diagnostics: {
          detectedRegions: 0,
          fallbackRegions: 0,
          ocrMs: 0,
          translateMs: 0,
          totalMs: 0,
          retryCount: 0,
          cacheStatus: response.cached ? 'hit' : 'miss',
        },
      });

      if (!successJob) {
        throw new Error('Background job state missing during success update');
      }

      return {
        success: true,
        job: successJob,
        textAreas: response.textAreas ?? [],
        unplacedCount: response.unplacedCount ?? 0,
        pipeline: response.pipeline,
        cached: response.cached,
        usage: response.usage ?? null,
      };
    },
  });
}

async function forwardToActiveTab(
  message: Record<string, unknown>,
  sendResponse: (response: MessageResponse) => void
): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    sendResponse({ success: false, error: 'No active tab found' });
    return;
  }

  try {
    const response = await sendToTab(tab.id, message);
    sendResponse((response as MessageResponse) ?? { success: true });
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reach page',
    });
  }
}

async function broadcastToAllTabs(
  message: Record<string, unknown>
): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter(
        (tab): tab is chrome.tabs.Tab & { id: number } =>
          typeof tab.id === 'number'
      )
      .map(tab => sendToTab(tab.id, message).catch(() => undefined))
  );
}

async function sendToTab(
  tabId: number,
  message: Record<string, unknown>
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

async function fetchImageBytesResponse(
  imageUrl: string,
  sender: chrome.runtime.MessageSender
): Promise<FetchImageBytesResponse> {
  if (!isImageFetchAllowedForSender(imageUrl, sender)) {
    return {
      success: false,
      error: 'Image fetch not allowed for this page',
    };
  }
  const result = await fetchImageBytes(imageUrl);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return {
    success: true,
    imageBase64: result.base64,
    mimeType: result.mimeType,
  };
}

/**
 * Decide whether a sender may proxy this image.
 *
 * The image URL is only trustworthy when it belongs to the page asking for
 * it. Without this check, any page the user visits could ask the worker to
 * retrieve an arbitrary URL and read the bytes back — a fetch proxy. Same
 * origin is always allowed. A cross-origin URL is allowed only when it looks
 * like an image, which keeps the common cases working (a comic CDN, a
 * same-origin asset path) while removing the open-proxy primitive; the
 * internal-network checks in `fetchImageBytes` still apply either way.
 *
 * Extension pages are refused outright: they never legitimately proxy images.
 */
function isImageFetchAllowedForSender(
  imageUrl: string,
  sender: chrome.runtime.MessageSender
): boolean {
  if (!sender.tab?.id) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return false;
  }

  const senderUrl = sender.url ?? sender.tab.url;
  if (senderUrl) {
    try {
      if (new URL(senderUrl).origin === parsed.origin) {
        return true;
      }
    } catch {
      // Unparseable sender URL: fall through to the cross-origin rule.
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return /\.(?:jpe?g|png|webp|gif|avif|bmp)(?:$|\?)/i.test(
    parsed.pathname + parsed.search
  );
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') {
    return;
  }
  void chrome.storage.local
    .get([APP_CONFIG_STORAGE_KEY])
    .then(result => {
      const config = result[APP_CONFIG_STORAGE_KEY] || DEFAULT_CONFIG;
      // Only act unprompted on sites the user has opted in for. The manual
      // paths (popup button, context menu) are unaffected.
      if (!shouldAutoTranslatePage(config, tab?.url)) {
        return undefined;
      }
      return sendToTab(tabId, createAutoTranslateMessage(true)).catch(
        () => undefined
      );
    })
    .catch(() => undefined);
});
