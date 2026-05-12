import {
  createAutoTranslateMessage,
  isTranslationEnabled,
} from './auto-translate';
import type {
  QueryJobStatusRequest,
  TranslateImageJobRequest,
  TranslateImageJobResponse,
} from '@/shared/runtime-contracts';
import type { TranslationTransportRequest } from '@/services/translation-transport';
import {
  DEFAULT_RUNTIME_APP_CONFIG,
  normalizeRuntimeAppConfig,
} from '@/shared/app-config';
import { getErrorMessage } from '@/utils/error-message';
import { translateImageViaProviderDirect } from './provider-direct-client';
import { BackgroundJobQueue, createJobStatus } from './job-queue';

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

const DEFAULT_CONFIG = {
  ...DEFAULT_RUNTIME_APP_CONFIG,
  providers: {
    'openai-compatible': { ...DEFAULT_RUNTIME_APP_CONFIG.openaiCompatible },
    ollama: { ...DEFAULT_RUNTIME_APP_CONFIG.ollama },
  },
  maxImageSize: 1920,
  parallelLimit: 3,
  cacheEnabled: true,
  readingMode: 'panel',
  renderMode: 'strong-overlay-compat',
  translationPipeline: 'hybrid-regions',
  regionBatchSize: 10,
  fallbackToFullImage: true,
};

const translationJobQueue = new BackgroundJobQueue(2);

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
  await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: DEFAULT_CONFIG });
}

async function migrateSettings(): Promise<void> {
  const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
  const currentConfig = result[CONFIG_STORAGE_KEY];
  if (!currentConfig) {
    await initializeDefaultSettings();
    return;
  }

  await chrome.storage.sync.set({
    [CONFIG_STORAGE_KEY]: normalizeStoredConfigSnapshot(currentConfig),
  });
}

async function checkAndSetDefaultConfig(): Promise<void> {
  const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
  if (!result[CONFIG_STORAGE_KEY]) {
    await initializeDefaultSettings();
  }
}

async function getConfig(): Promise<Record<string, unknown>> {
  const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
  return normalizeStoredConfigSnapshot(result[CONFIG_STORAGE_KEY]);
}

async function setConfig(config: Record<string, unknown>): Promise<void> {
  await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: config });
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
  try {
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
): TranslateImageJobRequest['requestedPath'] {
  return request.provider === 'ollama' ? 'ollama-direct' : 'plugin-direct';
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

async function fetchImageBytesResponse(imageUrl: string): Promise<MessageResponse> {
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
