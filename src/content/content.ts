/**
 * Content Script - Manga Translator v2
 *
 * 重构后的 content script，采用清晰的状态机架构：
 * - ContentState 类型驱动所有 UI 和行为
 * - 支持整页翻译、强制重翻、取消、清除
 * - 通过 FloatingHud 展示页面内状态
 * - 通过消息协议与 Background/Popup 同步状态
 *
 * 消息协议：
 *   PopupToContent: TRANSLATE_PAGE | FORCE_RETRANSLATE_PAGE
 *                   | CANCEL_TRANSLATION | CLEAR_ALL
 *   ContentToPopup: STATE_UPDATE | READY
 */

import {
  TranslatorService,
  createTranslatorFromConfig,
} from '@/services/translator';
import {
  OverlayRenderer,
  getRenderer,
  removeAllOverlaysFromDOM,
} from '@/services/renderer';
import { parseTranslationError } from '@/utils/error-handler';
import { incrementErrorStats } from '@/utils/error-stats';
import {
  isOnboardingDismissed,
  setOnboardingDismissed,
  requestConfigureFocus,
} from '@/utils/onboarding';
import { isProviderSettingsComplete } from '@/shared/app-config';
import {
  getViewportFirstImages,
  processInParallel,
  type ParallelProcessingOptions,
} from '@/utils/image-priority';
import { useAppConfigStore } from '@/stores/config-v2';
import { isTranslatableImage } from './image-filter';
import { FloatingHud } from './floating-hud';
import { clampPageTranslationConcurrency } from './page-translation-utils';
import {
  createDebouncedAutoTranslate,
  shouldAutoTranslateFollowUp,
} from './auto-translate-observer';
import {
  getEnabledFromConfig,
  getOverlayStyleFromConfig,
} from './config-snapshot';

// ==================== 消息类型定义 ====================

export type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' };

export type ContentToPopupMsg =
  | { type: 'STATE_UPDATE'; state: ContentState }
  | { type: 'READY' }
  | { type: 'HUD_CANCELLED' };

// ==================== 状态类型定义 ====================

export type ContentState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'translating'; current: number; total: number; currentImageIndex?: number; etaSeconds?: number }
  | { status: 'complete'; count: number; failedCount?: number; cachedCount?: number }
  | { status: 'error'; message: string; suggestion?: string }
  | { status: 'onboarding' };

// ==================== 常量 ====================

const PROCESSED_CLASS = 'manga-translator-processed';
const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

// ==================== 运行时状态 ====================

let currentState: ContentState = { status: 'idle' };
let abortController: AbortController | null = null;
let translator: TranslatorService | null = null;
let renderer: OverlayRenderer | null = null;
let hud: FloatingHud | null = null;
let autoTranslateObserver: MutationObserver | null = null;
let isAutoTranslateEnabled = false;
let isTranslating = false;
let failedCount = 0;
let cachedCount = 0;
const processedImages: Set<string> = new Set();
const failedImageKeys: Set<string> = new Set();
const autoTranslateScheduler = createDebouncedAutoTranslate(() => {
  void maybeAutoTranslateNewImages();
});

// ==================== 状态更新 ====================

function setState(state: ContentState): void {
  currentState = state;

  // 同步 HUD 显示
  if (hud) {
    switch (state.status) {
      case 'idle':
        hud.update({ status: 'hidden' });
        break;
      case 'scanning':
        hud.update({ status: 'translating', current: 0, total: 0 });
        break;
      case 'translating':
        hud.update({
          status: 'translating',
          current: state.current,
          total: state.total,
          currentImageIndex: state.currentImageIndex,
          etaSeconds: state.etaSeconds,
        });
        break;
      case 'complete':
        hud.update({
          status: 'complete',
          translatedCount: state.count,
          failedCount: state.failedCount ?? 0,
          cachedCount: state.cachedCount ?? 0,
        });
        break;
      case 'error':
        hud.update({ status: 'error', message: state.message, suggestion: state.suggestion });
        break;
      case 'onboarding':
        hud.update({ status: 'onboarding' });
        break;
    }
  }

  // 发送状态给 background -> popup
  sendToBackground({ type: 'STATE_UPDATE', state });
}

// ==================== 服务初始化 ====================

async function ensureServicesInitialized(): Promise<void> {
  // 确保 renderer 总是被初始化
  if (!renderer) {
    renderer = getRenderer();
  }

  // 重新创建 translator 以获取最新配置
  translator = createTranslatorFromConfig();

  try {
    await translator.initialize();
    console.warn('[ContentScript] Translator 初始化成功');
  } catch (error) {
    console.error('[ContentScript] Translator 初始化失败:', error);
    const friendly = parseTranslationError(error);
    setState({ status: 'error', message: `初始化失败: ${friendly.message}`, suggestion: friendly.suggestion });
    throw error;
  }
}

// ==================== 图片处理 ====================

function findTranslatableImages(): HTMLImageElement[] {
  // 等待一小段时间确保图片已加载（懒加载页面）
  const allImages = Array.from(document.querySelectorAll('img'));

  return allImages.filter(
    img => isTranslatableImage(img) && !processedImages.has(getImageKey(img))
  );
}

function getImageKey(img: HTMLImageElement): string {
  return (
    img.src ||
    `img-${img.offsetLeft}-${img.offsetTop}-${img.width}-${img.height}`
  );
}

async function processSingleImage(
  img: HTMLImageElement,
  forceRefresh: boolean = false
): Promise<void> {
  if (!translator || !renderer) {
    throw new Error('Services not initialized');
  }

  img.classList.add(PROCESSED_CLASS);

  // 检测是否为漫画长图：高宽比 >= 2.4 且自然高度 >= 2000px
  const isTallImage =
    img.naturalWidth > 0 &&
    img.naturalHeight > 0 &&
    img.naturalHeight / img.naturalWidth >= 2.4 &&
    img.naturalHeight >= 2000;

  const result = await translator.translateImage(
    img,
    isTallImage,
    undefined,
    forceRefresh
  );

  if (!result.success) {
    throw new Error(result.error || 'Translation failed');
  }

  if (result.textAreas.length === 0) {
    return;
  }

  renderer.render(img, result.textAreas, true);
}

async function syncAutoTranslateMode(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([CONFIG_STORAGE_KEY]);
    const enabled = getEnabledFromConfig(result[CONFIG_STORAGE_KEY]);
    isAutoTranslateEnabled = enabled;

    if (enabled) {
      startAutoTranslateObserver();
    } else {
      stopAutoTranslateObserver();
    }
  } catch {
    isAutoTranslateEnabled = false;
    stopAutoTranslateObserver();
  }
}

async function maybeAutoTranslateNewImages(): Promise<void> {
  const pendingImages = findTranslatableImages();
  // The auto-translate gate only knows a fixed set of statuses; the
  // 'onboarding' state should behave like 'idle' for this decision.
  const statusForGate = currentState.status === 'onboarding' ? 'idle' : currentState.status;
  if (
    shouldAutoTranslateFollowUp({
      enabled: isAutoTranslateEnabled,
      status: statusForGate,
      hasPendingImages: pendingImages.length > 0,
    })
  ) {
    await translatePage();
  }
}

function startAutoTranslateObserver(): void {
  if (autoTranslateObserver) {
    return;
  }

  autoTranslateObserver = new MutationObserver(mutations => {
    const hasNewImages = mutations.some(mutation =>
      Array.from(mutation.addedNodes).some(node => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }

        if (
          node.tagName === 'IMG' &&
          isTranslatableImage(node as HTMLImageElement)
        ) {
          return true;
        }

        return !!node.querySelector('img');
      })
    );

    if (hasNewImages) {
      autoTranslateScheduler.schedule();
    }
  });

  autoTranslateObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopAutoTranslateObserver(): void {
  autoTranslateScheduler.cancel();
  if (autoTranslateObserver) {
    autoTranslateObserver.disconnect();
    autoTranslateObserver = null;
  }
}

// ==================== 核心动作 ====================

/**
 * 整页翻译
 */
async function translatePage(forceRefresh: boolean = false): Promise<void> {
  console.warn('[ContentScript] translatePage 开始执行');

  if (isTranslating) {
    console.warn('[ContentScript] 翻译已在进行中（锁保护）');
    return;
  }

  if (
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  ) {
    console.warn('[ContentScript] 翻译已在进行中');
    return;
  }

  isTranslating = true;
  abortController = new AbortController();
  setState({ status: 'scanning' });

  try {
    await ensureServicesInitialized();
    console.warn('[ContentScript] 服务初始化完成');

    const allImages = Array.from(document.querySelectorAll('img'));
    console.warn('[ContentScript] 页面上的 img 元素数量:', allImages.length);

    const images = getViewportFirstImages(findTranslatableImages());
    console.warn('[ContentScript] 可翻译图片数量:', images.length);

    if (images.length === 0) {
      console.warn('[ContentScript] 没有找到可翻译的图片');
      setState({ status: 'complete', count: 0 });
      return;
    }

    const config = useAppConfigStore.getState();
    const parallelLimit = clampPageTranslationConcurrency(
      config.parallelLimit || 3
    );
    const total = images.length;
    let current = 0;
    let currentImageIndex = 0;
    let successCount = 0;
    failedCount = 0;
    cachedCount = 0;
    failedImageKeys.clear();
    const translateStartTime = performance.now();

    setState({ status: 'translating', current: 0, total, currentImageIndex: 0 });

    const computeEtaSeconds = (): number | undefined => {
      if (current === 0) return undefined;
      const elapsed = (performance.now() - translateStartTime) / 1000;
      const remaining = total - current;
      // Avoid divide-by-zero and don't claim 0s during first item
      if (current < 1 || remaining <= 0) return undefined;
      return Math.max(0, Math.round((elapsed / current) * remaining));
    };

    const options: ParallelProcessingOptions = {
      maxConcurrent: parallelLimit,
      signal: abortController.signal,
      onItemStart: index => {
        currentImageIndex = index;
        if (currentState.status === 'translating') {
          setState({ status: 'translating', current, total, currentImageIndex: index, etaSeconds: computeEtaSeconds() });
        }
      },
      onItemComplete: completed => {
        current = completed;
        if (currentState.status === 'translating') {
          setState({ status: 'translating', current, total, currentImageIndex, etaSeconds: computeEtaSeconds() });
        }
      },
      onError: (_error, index) => {
        failedCount++;
        const img = images[index];
        if (img) {
          failedImageKeys.add(getImageKey(img));
        }
      },
    };

    await processInParallel(
      images,
      async img => {
        if (abortController?.signal.aborted) {
          throw new Error('Translation cancelled');
        }
        const beforeCount = processedImages.size;
        await processSingleImage(img, forceRefresh);
        if (processedImages.size > beforeCount) {
          successCount++;
        }
        processedImages.add(getImageKey(img));
      },
      options
    );

    if (abortController?.signal.aborted) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'complete', count: successCount, failedCount, cachedCount });
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 翻译流程失败:', friendly.message);
    setState({ status: 'error', message: friendly.message, suggestion: friendly.suggestion });
    void incrementErrorStats(friendly.code);
  } finally {
    abortController = null;
    isTranslating = false;
  }
}

/**
 * 取消正在进行的翻译
 */
function cancelTranslation(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  setState({ status: 'idle' });
  // 通知 popup 取消成功，按钮状态需要更新
  sendToBackground({ type: 'HUD_CANCELLED' });
}

/**
 * 清除所有覆盖层
 */
function clearAll(): void {
  cancelTranslation();

  if (renderer) {
    renderer.removeAll();
  }
  removeAllOverlaysFromDOM();

  processedImages.clear();
  failedImageKeys.clear();
  document.querySelectorAll(`.${PROCESSED_CLASS}`).forEach(img => {
    img.classList.remove(PROCESSED_CLASS);
  });

  setState({ status: 'idle' });
}

// ==================== 消息处理 ====================

function sendToBackground(msg: ContentToPopupMsg): void {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {
      // popup 可能未打开，忽略
    });
  } catch {
    // extension context 可能已失效
  }
}

function handleMessage(
  request: PopupToContentMsg,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: {
    success: boolean;
    error?: string;
    state?: ContentState;
  }) => void
): boolean {
  console.warn('[ContentScript] 收到消息:', request.type);

  switch (request.type) {
    case 'GET_STATE':
      sendResponse({ success: true, state: currentState });
      break;

    case 'TRANSLATE_PAGE':
      translatePage()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'FORCE_RETRANSLATE_PAGE':
      clearAll();
      translatePage(true)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'CANCEL_TRANSLATION':
      cancelTranslation();
      sendResponse({ success: true });
      break;

    case 'CLEAR_ALL':
      clearAll();
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return false;
}

// ==================== 存储变更监听 ====================

function handleStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  _areaName: string
): void {
  if (changes[CONFIG_STORAGE_KEY]) {
    // 配置变更时重置 translator，下次使用时重新初始化
    translator = null;
    const newConfig = changes[CONFIG_STORAGE_KEY].newValue;
    const enabled = getEnabledFromConfig(newConfig);
    const overlayStyle = getOverlayStyleFromConfig(newConfig);
    isAutoTranslateEnabled = enabled;

    // 更新 renderer 样式
    if (renderer && overlayStyle) {
      renderer.updateStyleFromConfig(overlayStyle);
    }

    if (enabled) {
      startAutoTranslateObserver();
      autoTranslateScheduler.schedule();
    } else {
      stopAutoTranslateObserver();
    }
  }
}

// ==================== HUD 事件监听 ====================

function handleHudCancel(): void {
  cancelTranslation();
}

function handleRetryFailed(): void {
  if (isTranslating) return;
  // 清除失败图片记录，让它们可以被重新处理
  for (const key of failedImageKeys) {
    processedImages.delete(key);
  }
  failedImageKeys.clear();
  void translatePage(true);
}

function handleHudConfigure(): void {
  const config = useAppConfigStore.getState();
  const provider = config.provider;
  void requestConfigureFocus(provider).then(() => {
    try {
      chrome.runtime.openOptionsPage();
    } catch {
      // Extension context may be invalid; ignore.
    }
  });
}

function handleHudDismissOnboarding(): void {
  void setOnboardingDismissed();
  setState({ status: 'idle' });
}

function setupHudEventListeners(): void {
  document.addEventListener('hud-cancel', handleHudCancel);
  document.addEventListener('hud-retry-failed', handleRetryFailed);
  document.addEventListener('hud-configure', handleHudConfigure);
  document.addEventListener('hud-dismiss-onboarding', handleHudDismissOnboarding);
}

// ==================== 初始化 ====================

async function initialize(): Promise<void> {
  console.warn('[ContentScript] Manga Translator v2 初始化');

  try {
    // 创建 HUD
    hud = new FloatingHud();

    // 设置消息监听
    chrome.runtime.onMessage.addListener(handleMessage);

    // 设置存储变更监听
    chrome.storage.onChanged.addListener(handleStorageChange);

    await syncAutoTranslateMode();

    // Translate the page on load (one-shot). The auto-translate
    // observer handles new images; this handles images that were
    // already in the DOM when the content script injected.
    // shouldAutoTranslateFollowUp already maps 'onboarding' to
    // 'idle' (see P3a fix), so this is a no-op when the user is
    // not configured.
    autoTranslateScheduler.schedule();

    // 监听 HUD 按钮事件
    setupHudEventListeners();

    // 页面卸载时清理
    window.addEventListener('beforeunload', cleanup);

    // Onboarding check: if the user hasn't dismissed the corner
    // card this session AND the current provider is not properly
    // configured (apiKey + baseUrl + model for OpenAI; baseUrl + model
    // for Ollama / LM Studio), show the card. Runs after
    // syncAutoTranslateMode so config is loaded.
    try {
      const dismissed = await isOnboardingDismissed();
      if (!dismissed) {
        const config = useAppConfigStore.getState();
        const provider = config.provider;
        const settings = config.providers[provider];
        if (!isProviderSettingsComplete(provider, settings)) {
          setState({ status: 'onboarding' });
        }
      }
    } catch (err) {
      console.warn('[ContentScript] onboarding check failed:', err);
    }

    // 通知 background 已就绪
    sendToBackground({ type: 'READY' });

    console.warn('[ContentScript] 初始化完成');
  } catch (error) {
    console.error('[ContentScript] 初始化失败:', error);
  }
}

function cleanup(): void {
  if (abortController) {
    abortController.abort();
  }
  if (renderer) {
    renderer.removeAll();
  }
  if (hud) {
    hud.destroy();
    hud = null;
  }
  stopAutoTranslateObserver();
  processedImages.clear();
  failedImageKeys.clear();
  chrome.runtime.onMessage.removeListener(handleMessage);
  chrome.storage.onChanged.removeListener(handleStorageChange);
  document.removeEventListener('hud-cancel', handleHudCancel);
  document.removeEventListener('hud-retry-failed', handleRetryFailed);
  document.removeEventListener('hud-configure', handleHudConfigure);
  document.removeEventListener('hud-dismiss-onboarding', handleHudDismissOnboarding);
  window.removeEventListener('beforeunload', cleanup);
}

// ==================== 启动 ====================

initialize();

// ==================== 测试导出 ====================

export {
  currentState,
  findTranslatableImages,
  getEnabledFromConfig,
  handleMessage,
  handleStorageChange,
  translatePage,
  cancelTranslation,
  clearAll,
  setState,
};
