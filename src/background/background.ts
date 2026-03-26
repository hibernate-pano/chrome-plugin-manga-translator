/**
 * Background Service Worker - Manga Translator v2
 * 
 * Responsibilities:
 * - Extension lifecycle management (install, update, startup)
 * - Message relay (Popup ↔ Content Script)
 * - Configuration management
 * - Cross-tab state synchronization
 * - AI API 代理（解决 content script 的 CORS 限制）
 */

import { createProvider, type ProviderType } from '@/providers';
import type { TranslationStylePreset } from '@/utils/translation-style';

// ==================== Types ====================

interface MessageRequest {
  action?: string;
  type?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

interface MessageResponse {
  success?: boolean;
  error?: string;
  received?: boolean;
  state?: TranslationState;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

interface TranslationState {
  enabled: boolean;
  isProcessing: boolean;
  processedCount: number;
  totalCount: number;
  error?: string;
}

// ==================== Constants ====================

const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

const DEFAULT_CONFIG = {
  enabled: false,
  provider: 'siliconflow',
  providers: {
    siliconflow: { apiKey: '', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-32B-Instruct' },
    dashscope: { apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
    openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    claude: { apiKey: '', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' },
    deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llava' },
  },
  targetLanguage: 'zh-CN',
  maxImageSize: 1920,
  parallelLimit: 3,
  cacheEnabled: true,
  translationStylePreset: 'natural-zh',
  readingMode: 'panel',
  renderMode: 'strong-overlay-compat',
  translationPipeline: 'full-image-vlm',
  regionBatchSize: 10,
  fallbackToFullImage: true,
};

// ==================== Lifecycle Events ====================

/**
 * Handle extension installation or update
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);

  // Create context menus
  chrome.contextMenus.create({
    id: 'translateImage',
    title: '翻译此图像',
    contexts: ['image'],
  });
  chrome.contextMenus.create({
    id: 'translatePage',
    title: '翻译页面上的漫画',
    contexts: ['page'],
  });

  if (details.reason === 'install') {
    // First time installation - initialize default settings
    initializeDefaultSettings();
    // Open options page to guide user through setup
    chrome.runtime.openOptionsPage();
  } else if (details.reason === 'update') {
    // Extension updated - migrate settings if needed
    migrateSettings(details.previousVersion);
  }
});

/**
 * Handle browser startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Browser started');
  checkAndSetDefaultConfig();
});

/**
 * Handle extension suspend (cleanup)
 */
chrome.runtime.onSuspend.addListener(() => {
  console.log('[Background] Extension suspending');
  // Cleanup resources if needed
});

// ==================== Configuration Management ====================

/**
 * Initialize default settings on first install
 */
async function initializeDefaultSettings(): Promise<void> {
  try {
    await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: DEFAULT_CONFIG });
    console.log('[Background] Default settings initialized');
  } catch (error) {
    console.error('[Background] Failed to initialize settings:', error);
  }
}

/**
 * Migrate settings from previous version
 */
async function migrateSettings(previousVersion?: string): Promise<void> {
  console.log('[Background] Migrating from version:', previousVersion);

  try {
    const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
    const currentConfig = result[CONFIG_STORAGE_KEY];

    if (!currentConfig) {
      // No existing config, initialize defaults
      await initializeDefaultSettings();
      return;
    }

    // Merge with defaults to add any new fields
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...currentConfig,
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...currentConfig.providers,
      },
    };

    await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: mergedConfig });
    console.log('[Background] Settings migrated successfully');
  } catch (error) {
    console.error('[Background] Migration failed:', error);
  }
}

/**
 * Check and set default config if not exists
 */
async function checkAndSetDefaultConfig(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
    if (!result[CONFIG_STORAGE_KEY]) {
      await initializeDefaultSettings();
    }
  } catch (error) {
    console.error('[Background] Failed to check config:', error);
  }
}

/**
 * Get current configuration
 */
async function getConfig(): Promise<Record<string, unknown>> {
  try {
    const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
    return result[CONFIG_STORAGE_KEY] || DEFAULT_CONFIG;
  } catch (error) {
    console.error('[Background] Failed to get config:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Update configuration
 */
async function setConfig(config: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: config });
    console.log('[Background] Config updated');
  } catch (error) {
    console.error('[Background] Failed to set config:', error);
    throw error;
  }
}

// ==================== Message Handling ====================

/**
 * Main message handler
 * Routes messages between Popup, Content Script, and Options page
 */
chrome.runtime.onMessage.addListener(
  (
    request: MessageRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ): boolean => {
    console.log('[Background] Received message:', request.action, 'from:', sender.tab?.id || 'popup/options');

    // Handle message asynchronously
    handleMessage(request, sender, sendResponse);

    // Return true to indicate async response
    return true;
  }
);

/**
 * Process incoming messages
 */
async function handleMessage(
  request: MessageRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): Promise<void> {
  try {
    // Handle type-based messages from new content script (v2 protocol)
    if (request['type'] && !request.action) {
      switch (request['type']) {
        case 'STATE_UPDATE':
          // Forward state update to popup
          chrome.runtime.sendMessage(request).catch(() => {
            // Popup may not be open
          });
          sendResponse({ received: true });
          return;
        case 'READY':
          try {
            const config = await getConfig();
            const enabled =
              (config as { state?: { enabled?: boolean }; enabled?: boolean })
                ?.state?.enabled ??
              (config as { enabled?: boolean })?.enabled ??
              false;

            if (enabled && sender.tab?.id) {
              await sendToTab(sender.tab.id, { type: 'TRANSLATE_PAGE' });
            }
          } catch {
            // Ignore auto-start failure on ready
          }
          sendResponse({ received: true });
          return;
        default:
          sendResponse({ received: true });
          return;
      }
    }

    switch (request.action) {
      // ==================== Config Operations ====================

      case 'getConfig': {
        const config = await getConfig();
        sendResponse({ success: true, config });
        break;
      }

      case 'setConfig':
        if (request.config) {
          await setConfig(request.config);
          // Notify all content scripts of config change
          await broadcastToAllTabs({ action: 'configUpdated' });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No config provided' });
        }
        break;

      // ==================== Translation Control ====================

      case 'toggleTranslation':
        // Forward to active tab's content script with new protocol (type field)
        await forwardToActiveTab(
          request.enabled
            ? { type: 'TRANSLATE_PAGE' }
            : { type: 'CANCEL_TRANSLATION' },
          sendResponse
        );
        break;

      case 'startTranslation':
        // Forward to active tab's content script
        await forwardToActiveTab({ type: 'TRANSLATE_PAGE' }, sendResponse);
        break;

      case 'stopTranslation':
        // Forward to active tab's content script
        await forwardToActiveTab({ type: 'CANCEL_TRANSLATION' }, sendResponse);
        break;

      // ==================== State Queries ====================

      case 'getState':
        // Forward to active tab's content script with new protocol
        await forwardToActiveTab({ type: 'GET_STATE' }, sendResponse);
        break;

      case 'checkState':
        // Forward to active tab's content script with new protocol
        await forwardToActiveTab({ type: 'GET_STATE' }, sendResponse);
        break;

      // ==================== Status Updates (from Content Script) ====================

      case 'processingStart':
      case 'processingUpdate':
      case 'complete':
      case 'error':
      case 'noImages':
        // These messages come from content script
        // Forward to popup (if open) by broadcasting
        // The popup listens via chrome.runtime.onMessage
        sendResponse({ received: true });
        break;

      // ==================== Navigation ====================

      case 'openOptionsPage':
        chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        break;

      // ==================== Image Fetching (CORS bypass) ====================

      case 'fetchImage': {
        const imageUrl = request['url'] as string;
        if (!imageUrl) {
          sendResponse({ success: false, error: 'No URL provided' });
          break;
        }
        try {
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            sendResponse({ success: false, error: `Failed to fetch image: ${imageResponse.status}` });
            break;
          }
          const blob = await imageResponse.blob();
          const mimeType = blob.type || 'image/jpeg';
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuffer);
          sendResponse({ success: true, base64, mimeType });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch image',
          });
        }
        break;
      }

      // ==================== AI Translation Proxy (CORS bypass) ====================
      // content script 无法直接调用第三方 AI API（受页面 CORS/CSP 限制），
      // 由 background service worker 代理调用，绕过 CORS 限制。

      case 'translateImage': {
        const {
          imageBase64,
          mimeType = 'image/jpeg',
          targetLanguage = 'zh-CN',
          provider: providerType = 'siliconflow',
          apiKey,
          baseUrl,
          model,
          translationStylePreset = 'natural-zh',
        } = request as {
          imageBase64?: string;
          mimeType?: string;
          targetLanguage?: string;
          provider?: string;
          apiKey?: string;
          baseUrl?: string;
          model?: string;
          translationStylePreset?: TranslationStylePreset;
        };

        if (!imageBase64) {
          sendResponse({ success: false, error: '未提供图片数据' });
          break;
        }

        try {
          // 创建 provider 实例（静态 import，构建时打包）
          const visionProvider = await createProvider(
            providerType as ProviderType,
            { apiKey, baseUrl, model }
          );

          // 快速校验：仅检查 API Key 存在性，跳过网络请求，提升性能
          if (providerType !== 'ollama' && !apiKey) {
            sendResponse({ success: false, error: '请先配置 API Key' });
            break;
          }

          // 构造图片数据 URL（用于 AI API）
          const imageDataUrl = imageBase64.startsWith('data:')
            ? imageBase64
            : `data:${mimeType};base64,${imageBase64}`;

          // 调用 Vision LLM（getMangaTranslationPrompt 已内置在 provider 的 analyzeAndTranslate 中）
          const visionResponse = await visionProvider.analyzeAndTranslate(
            imageDataUrl,
            targetLanguage,
            translationStylePreset
          );

          sendResponse({
            success: true,
            textAreas: visionResponse.textAreas,
            usage: visionResponse.usage ?? null,
          });

        } catch (error) {
          const errMsg = error instanceof Error ? error.message : '翻译失败，请检查 API 配置';
          console.error('[Background] translateImage 失败:', errMsg);
          sendResponse({ success: false, error: errMsg });
        }
        break;
      }


      // ==================== Unknown Action ====================

      default:
        console.warn('[Background] Unknown action:', request.action);
        sendResponse({ success: false, error: `Unknown action: ${request.action}` });
    }
  } catch (error) {
    console.error('[Background] Error handling message:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ==================== Tab Communication ====================

/**
 * Forward message to the active tab's content script
 */
async function forwardToActiveTab(
  request: MessageRequest,
  sendResponse: (response: MessageResponse) => void
): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tabs[0]?.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    const tabId = tabs[0].id;

    // Check if content script is injected
    try {
      const response = await chrome.tabs.sendMessage(tabId, request);
      sendResponse(response);
    } catch (error) {
      // Content script might not be injected
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('Receiving end does not exist')) {
        sendResponse({
          success: false,
          error: 'Content script not loaded. Please refresh the page.',
        });
      } else {
        sendResponse({
          success: false,
          error: `Failed to communicate with page: ${errorMessage}`,
        });
      }
    }
  } catch (error) {
    console.error('[Background] forwardToActiveTab error:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to forward message',
    });
  }
}

/**
 * Broadcast message to all tabs with content script
 */
async function broadcastToAllTabs(message: MessageRequest): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch {
          // Content script not injected in this tab, skip
        }
      }
    }
  } catch (error) {
    console.error('[Background] broadcastToAllTabs error:', error);
  }
}

/**
 * Send message to a specific tab
 */
async function sendToTab(tabId: number, message: MessageRequest): Promise<MessageResponse | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

// ==================== Tab Events ====================

/**
 * Handle tab updates (page navigation, reload)
 * 
 * Requirements: 1.4 - Remember toggle state across page refreshes
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
  if (changeInfo.status === 'complete') {
    // Page finished loading
    // Notify content script to check if translation should be active
    try {
      const config = await getConfig();
      const enabled = (config as { state?: { enabled?: boolean }; enabled?: boolean })?.state?.enabled ??
        (config as { enabled?: boolean })?.enabled ?? false;

      if (enabled) {
        await sendToTab(tabId, { type: 'TRANSLATE_PAGE' });
      }
    } catch {
      // Content script might not be ready yet, ignore
    }
  }
});

/**
 * Handle tab activation (switching tabs)
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // When user switches to a tab, we could sync state if needed
  // For now, just log for debugging
  console.log('[Background] Tab activated:', activeInfo.tabId);
});

// ==================== Context Menu Handler ====================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'translateImage' && info.srcUrl) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'ENTER_HOVER_SELECT',
      });
    } catch {
      // Content script not injected
    }
  } else if (info.menuItemId === 'translatePage') {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TRANSLATE_PAGE',
      });
    } catch {
      // Content script not injected
    }
  }
});

// ==================== Storage Change Listener ====================

/**
 * Listen for storage changes and sync state
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[CONFIG_STORAGE_KEY]) {
    console.log('[Background] Config changed in storage');

    const newValue = changes[CONFIG_STORAGE_KEY].newValue;
    const oldValue = changes[CONFIG_STORAGE_KEY].oldValue;

    // Check if enabled state changed
    const newEnabled = newValue?.state?.enabled ?? newValue?.enabled ?? false;
    const oldEnabled = oldValue?.state?.enabled ?? oldValue?.enabled ?? false;

    if (newEnabled !== oldEnabled) {
      console.log('[Background] Enabled state changed:', oldEnabled, '->', newEnabled);
      // Broadcast to all tabs with correct protocol
      broadcastToAllTabs(
        newEnabled
          ? { type: 'TRANSLATE_PAGE' }
          : { type: 'CANCEL_TRANSLATION' }
      );
    }
  }
});

// ==================== Utility Functions ====================

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// ==================== Initialization ====================

console.log('[Background] Manga Translator v2 background script loaded');
