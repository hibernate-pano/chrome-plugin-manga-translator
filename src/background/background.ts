import {
  createAutoTranslateMessage,
  isTranslationEnabled,
} from './auto-translate';
/**
 * Background message dispatcher.
 *
 * All incoming messages use the type-based envelope: `{ type: '...' }`.
 * The type switch handles translation jobs, image-bytes fetch, content
 * state broadcasts, and the ready handshake. The only access control
 * is the top-level sender check (extension origin or content script);
 * no per-type gating is currently enforced.
 */
import type {
  QueryJobStatusRequest,
  TranslateImageJobRequest,
  TranslateImageJobResponse,
  RequestedExecutionPath,
} from '@/shared/runtime-contracts';
import type { TranslationTransportRequest } from '@/services/translation-transport';
import {
  DEFAULT_CONFIG,
  normalizeRuntimeAppConfig,
  APP_CONFIG_STORAGE_KEY,
} from '@/shared/app-config';
import { getErrorMessage } from '@/utils/error-message';
import { obfuscateAllApiKeys, deobfuscateAllApiKeys } from '@/utils/crypto';

import { translateImageViaProviderDirect } from './provider-direct-client';
import { BackgroundJobQueue, createJobStatus } from './job-queue';
import { deriveRequestedPath } from '@/shared/runtime-contracts';

interface MessageRequest {
  type?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  imageUrl?: string;
  [key: string]: unknown;
}

interface MessageResponse {
  success?: boolean;
  error?: string;
  received?: boolean;
  state?: unknown;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

// 默认并发度使用 DEFAULT_CONFIG.parallelLimit 
const translationJobQueue = new BackgroundJobQueue(DEFAULT_CONFIG.parallelLimit, 500);

// 同步并发度配置
function syncQueueLimit(config: Record<string, unknown>): void {
  const state = (config['state'] || config) as Record<string, unknown>;
  const limit = (typeof state['parallelLimit'] === 'number' ? state['parallelLimit'] : null)
    || (typeof config['parallelLimit'] === 'number' ? config['parallelLimit'] : null)
    || DEFAULT_CONFIG.parallelLimit;
  translationJobQueue.updateMaxConcurrent(limit);
}

// 启动时自动同步一次并发度配置
void getConfig().then(config => {
  syncQueueLimit(config);
}).catch(err => {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractPersistedState(value: unknown): Record<string, unknown> {
  if (isRecord(value) && isRecord(value['state'])) {
    return value['state'] as Record<string, unknown>;
  }
  return isRecord(value) ? value : {};
}

function normalizeStoredConfigSnapshot(value: unknown): Record<string, unknown> {
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
  chrome.contextMenus.create({
    id: 'translatePage',
    title: '翻译当前页面',
    contexts: ['page'],
  });

  if (details.reason === 'install') {
    void initializeDefaultSettings();
  } else if (details.reason === 'update') {
    void migrateSettings();
  }
});

// 右键菜单"翻译当前页面" → 转发 TRANSLATE_PAGE 到当前 tab 的 content script。
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'translatePage' || !tab?.id) {
    return;
  }
  void sendToTab(tab.id, { type: 'TRANSLATE_PAGE' }).catch(() => undefined);
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
 */
async function migrateConfigFromSyncToLocal(): Promise<void> {
  try {
    const local = await chrome.storage.local.get([CONFIG_STORAGE_KEY]);
    if (local[CONFIG_STORAGE_KEY]) {
      return; // local 已有配置，无需迁移
    }
    const synced = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
    const syncedConfig = synced[CONFIG_STORAGE_KEY];
    if (!syncedConfig) {
      return; // sync 里也没有，没东西可迁
    }
    await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: syncedConfig });
    await chrome.storage.sync.remove([CONFIG_STORAGE_KEY]);
    console.warn(
      '[Background] 已将配置从 chrome.storage.sync 迁移到 chrome.storage.local（API key 不再跨设备同步）'
    );
  } catch (error) {
    console.error('[Background] sync→local 配置迁移失败:', error);
  }
}

async function migrateSettings(): Promise<void> {
  await migrateConfigFromSyncToLocal();
  const result = await chrome.storage.local.get([CONFIG_STORAGE_KEY]);
  const currentConfig = result[CONFIG_STORAGE_KEY];
  if (!currentConfig) {
    await initializeDefaultSettings();
    return;
  }

  await setConfig(normalizeStoredConfigSnapshot(currentConfig));
}

async function checkAndSetDefaultConfig(): Promise<void> {
  const result = await chrome.storage.local.get([CONFIG_STORAGE_KEY]);
  if (!result[CONFIG_STORAGE_KEY]) {
    await initializeDefaultSettings();
  }
}

async function getConfig(): Promise<Record<string, unknown>> {
  const result = await chrome.storage.local.get([CONFIG_STORAGE_KEY]);
  const config = normalizeStoredConfigSnapshot(result[CONFIG_STORAGE_KEY]);
  deobfuscateAllApiKeys(config);
  return config;
}

async function setConfig(config: Record<string, unknown>): Promise<void> {
  const cloned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  obfuscateAllApiKeys(cloned);
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: cloned });
  syncQueueLimit(cloned);
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
  // 验证消息发送者：扩展内部页面或已注入 content script 的标签页
  const isExtensionOrigin = sender.id === chrome.runtime.id;
  const isContentScript = !!sender.tab?.id;
  if (!isExtensionOrigin && !isContentScript) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return;
  }

  try {
    switch (request.type) {
      case 'JOB_TRANSLATE_IMAGE':
        sendResponse(
          (await enqueueTranslationJob(
            request as unknown as TranslateImageJobRequest
          )) as unknown as MessageResponse
        );
        return;
      case 'JOB_QUERY_STATUS': {
        const statusRequest = request as unknown as QueryJobStatusRequest;
        const job = translationJobQueue.getJob(statusRequest.jobId);
        sendResponse(job ? { success: true, job } : { success: false, error: 'Job not found' });
        return;
      }
      case 'STATE_UPDATE':
        void chrome.runtime.sendMessage(request).catch(() => undefined);
        sendResponse({ received: true });
        return;
      case 'READY': {
        const config = await getConfig();
        if (sender.tab?.id && isTranslationEnabled(config)) {
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
        sendResponse(await fetchImageBytesResponse(imageUrl));
        return;
      }
      case 'HUD_CANCELLED':
        void chrome.runtime.sendMessage(request).catch(() => undefined);
        sendResponse({ received: true });
        return;
      default:
        sendResponse({ received: true });
        return;
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: getErrorMessage(error),
    });
  }
}

function deriveActualPath(
  request: TranslateImageJobRequest
): RequestedExecutionPath {
  return deriveRequestedPath(request.provider);
}

async function enqueueTranslationJob(
  request: TranslateImageJobRequest
): Promise<TranslateImageJobResponse> {
  const job = createJobStatus({
    jobId: request.jobId,
    pageKey: request.pageKey,
    priorityClass: request.priorityClass,
    requestedPath: request.requestedPath,
    scope: request.scope,
  });

  return translationJobQueue.enqueue({
    job,
    run: async () => {
      const actualCapabilityUsed = deriveActualPath(request);
      translationJobQueue.updateJob(request.jobId, {
        actualCapabilityUsed,
        state: 'running',
      });

      const response = await translateImageViaProviderDirect(
        request as TranslationTransportRequest
      );

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
        pipeline: response.pipeline,
        cached: response.cached,
        usage: response.usage ?? null,
      };
    },
  });
}

async function sendToTab(
  tabId: number,
  message: Record<string, unknown>
): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    // 阻止 SSRF：拒绝内网/本地地址
    const hostname = parsed.hostname.toLowerCase();
    const privateHosts = [
      'localhost', '127.0.0.1', '0.0.0.0', '::1',
      '[::1]', '169.254.169.254',
    ];
    if (privateHosts.includes(hostname)) {
      return false;
    }
    // 检查私有 IP 段
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number) as [string, number, number];
      if (a === 10) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
    }
    // 检查 IPv6 私有地址段
    const ipv6Match = hostname.match(/^\[([\da-fA-f:]+)\]$/);
    if (ipv6Match && ipv6Match[1]) {
      const ipv6 = ipv6Match[1].toLowerCase();
      // 阻止 ::1 (localhost IPv6)
      if (ipv6 === '::1') return false;
      // fc00::/7 - Unique Local Addresses (fc00:: to fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff)
      if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return false;
      // fe80::/10 - Link-Local (first nibble: fe, second nibble: 8-f)
      if (/^fe[89a-f]/i.test(ipv6)) return false;
      // 2001:db8::/32 - Documentation
      if (ipv6.startsWith('2001:db8')) return false;
      // ::ffff:0:0:0/96 - IPv4-mapped (多种写法)
      if (ipv6.startsWith('::ffff:0') || ipv6.startsWith('::ffff:')) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchImageBytesResponse(imageUrl: string): Promise<MessageResponse> {
  if (!isValidImageUrl(imageUrl)) {
    return { success: false, error: 'Invalid or blocked image URL' };
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch image: ${response.status}`,
      };
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return {
      success: true,
      imageBase64: arrayBufferToBase64(arrayBuffer),
      mimeType: blob.type || 'image/jpeg',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch image',
    };
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    void chrome.storage.local
      .get([CONFIG_STORAGE_KEY])
      .then(result => {
        const config = result[CONFIG_STORAGE_KEY] || DEFAULT_CONFIG;
        if (isTranslationEnabled(config)) {
          return sendToTab(tabId, createAutoTranslateMessage(true)).catch(
            () => undefined
          );
        }
        return undefined;
      })
      .catch(() => undefined);
  }
});
