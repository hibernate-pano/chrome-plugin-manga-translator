import {
  createAutoTranslateMessage,
  isTranslationEnabled,
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
 * 2. Type-based (new): { type: 'JOB_TRANSLATE_IMAGE' | 'JOB_QUERY_STATUS' | ... }
 *    Used by:
 *    - translation-transport.ts (translation job dispatch)
 *
 * Response field naming differs: action-based returns `{ success, imageBase64 }`,
 * type-based returns `{ success, job: { ... }, textAreas }` (envelope shape).
 * Do NOT unify without also migrating the consumers; see CLAUDE.md.
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
  action?: string;
  type?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  imageUrl?: string;
  url?: string;
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
  if (areaName !== 'sync') {
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
    void chrome.runtime.openOptionsPage();
  } else if (details.reason === 'update') {
    void migrateSettings();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void checkAndSetDefaultConfig();
});

async function initializeDefaultSettings(): Promise<void> {
  await setConfig(DEFAULT_CONFIG);
}

async function migrateSettings(): Promise<void> {
  const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
  const currentConfig = result[CONFIG_STORAGE_KEY];
  if (!currentConfig) {
    await initializeDefaultSettings();
    return;
  }

  await setConfig(normalizeStoredConfigSnapshot(currentConfig));
}

async function checkAndSetDefaultConfig(): Promise<void> {
  const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
  if (!result[CONFIG_STORAGE_KEY]) {
    await initializeDefaultSettings();
  }
}

async function getConfig(): Promise<Record<string, unknown>> {
  const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
  const config = normalizeStoredConfigSnapshot(result[CONFIG_STORAGE_KEY]);
  deobfuscateAllApiKeys(config);
  return config;
}

async function setConfig(config: Record<string, unknown>): Promise<void> {
  const cloned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  obfuscateAllApiKeys(cloned);
  await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: cloned });
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
    // 涉及配置读写（包含 API Key 解混淆结果）的接口仅信任扩展内部页面。
    // content script 即使被注入到任意 tab 也不应读到去混淆后的 key，
    // 也不应改写配置。其它 job / fetch / state 接口对两者都开放。
    const requestAction =
      typeof request.action === 'string' ? request.action : null;
    const requestType =
      typeof request.type === 'string' ? request.type : null;
    const isSensitiveRequest =
      requestAction === 'getConfig' || requestAction === 'setConfig';
    if (isSensitiveRequest && !isExtensionOrigin) {
      sendResponse({
        success: false,
        error: `${requestAction ?? requestType ?? 'request'} requires extension origin`,
      });
      return;
    }
    if (request.type && !request.action) {
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
        await broadcastToAllTabs({ action: 'configUpdated' });
        sendResponse({ success: true });
        return;
      case 'toggleTranslation':
        await forwardToActiveTab(
          request.enabled ? { type: 'TRANSLATE_PAGE' } : { type: 'CANCEL_TRANSLATION' },
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
        sendResponse(await fetchImageBytesResponse(imageUrl));
        return;
      }
      default:
        sendResponse({ success: false, error: `Unknown action: ${request.action}` });
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

async function broadcastToAllTabs(message: Record<string, unknown>): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
      .map(tab => sendToTab(tab.id, message).catch(() => undefined))
  );
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
    if (ipv6Match) {
      const ipv6 = ipv6Match[1]!.toLowerCase();
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
    void chrome.storage.sync
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
