/**
 * Content Script - Manga Translator v2
 *
 * 重构后的 content script，采用清晰的状态机架构：
 * - ContentState 类型驱动所有 UI 和行为
 * - 支持整页翻译、hover 选图翻译、取消、清除
 * - 通过 FloatingHud 展示页面内状态
 * - 通过消息协议与 Background/Popup 同步状态
 *
 * 消息协议：
 *   PopupToContent: TRANSLATE_PAGE | ENTER_HOVER_SELECT | EXIT_HOVER_SELECT
 *                   | CANCEL_TRANSLATION | CLEAR_ALL
 *   ContentToPopup: STATE_UPDATE | READY
 */

import { TranslatorService, createTranslatorFromConfig } from '@/services/translator';
import { OverlayRenderer, getRenderer, removeAllOverlaysFromDOM } from '@/services/renderer';
import { parseTranslationError } from '@/utils/error-handler';
import {
  getViewportFirstImages,
  processInParallel,
  type ParallelProcessingOptions,
} from '@/utils/image-priority';
import { useAppConfigStore } from '@/stores/config-v2';
import { ReadingLayer } from './reading-layer';
import { isTranslatableImage } from './hover-selector';
import { HoverSelector } from './hover-selector';
import { FloatingHud } from './floating-hud';
import {
  collectSiteCandidateImages,
  getRealImageSource,
  matchSiteAdapter,
  prepareImageForTranslation,
  type SiteAdapter,
} from './site-adapters';

// ==================== 消息类型定义 ====================

export type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'ENTER_HOVER_SELECT' }
  | { type: 'EXIT_HOVER_SELECT' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' }
  | { type: 'RETRY_FAILED' };

export type ContentToPopupMsg =
  | { type: 'STATE_UPDATE'; state: ContentState }
  | { type: 'READY' };

// ==================== 状态类型定义 ====================

export interface TranslationSessionStats {
  sessionId: string | null;
  queuedCount: number;
  translatedCount: number;
  failedCount: number;
  skippedCount: number;
  cachedCount: number;
  lastError: string | null;
}

export interface ContentState {
  status: 'idle' | 'scanning' | 'translating' | 'complete' | 'hover-select' | 'error';
  current?: number;
  total?: number;
  count?: number;
  message?: string;
  session: TranslationSessionStats;
}

// ==================== 常量 ====================

const PROCESSED_CLASS = 'manga-translator-processed';
const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

// ==================== 运行时状态 ====================

let currentState: ContentState = {
  status: 'idle',
  session: createEmptySession(),
};
let abortController: AbortController | null = null;
let translator: TranslatorService | null = null;
let renderer: OverlayRenderer | null = null;
let readingLayer: ReadingLayer | null = null;
let hud: FloatingHud | null = null;
let hoverSelector: HoverSelector | null = null;
const processedImages: Set<string> = new Set();
let servicesReady = false;
let currentSiteAdapter: SiteAdapter | null = null;
let currentSession: TranslationSessionStats = createEmptySession();
const failedImageQueue: Map<string, HTMLImageElement> = new Map();
let autoTranslateObserver: MutationObserver | null = null;
let autoTranslateDebounce: ReturnType<typeof setTimeout> | null = null;
let autoTranslateEnabled = false;
let pageFollowTranslateEnabled = false;
let autoTranslatePending = false;

// ==================== 状态更新 ====================

function createEmptySession(): TranslationSessionStats {
  return {
    sessionId: null,
    queuedCount: 0,
    translatedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    cachedCount: 0,
    lastError: null,
  };
}

function setState(state: Omit<ContentState, 'session'>): void {
  currentState = {
    ...state,
    session: { ...currentSession },
  };

  // 同步 HUD 显示
  if (hud) {
    switch (currentState.status) {
      case 'idle':
        hud.update({ status: 'hidden' });
        break;
      case 'scanning':
        hud.update({ status: 'translating', current: 0, total: 0 });
        break;
      case 'translating':
        hud.update({
          status: 'translating',
          current: currentState.current ?? 0,
          total: currentState.total ?? 0,
        });
        break;
      case 'complete':
        hud.update({
          status: 'complete',
          translatedCount: currentSession.translatedCount,
          failedCount: currentSession.failedCount,
          cachedCount: currentSession.cachedCount,
        });
        break;
      case 'hover-select':
        hud.update({ status: 'hover-select' });
        break;
      case 'error':
        hud.update({
          status: 'error',
          message: currentState.message ?? 'Unknown error',
        });
        break;
    }
  }

  // 发送状态给 background -> popup
  sendToBackground({ type: 'STATE_UPDATE', state: currentState });
}

// ==================== 服务初始化 ====================

/**
 * 等待 Config Store 从 chrome.storage.sync 水合完成
 *
 * 问题：Zustand `persist` 中间件异步加载配置，若翻译前未等待水合完成，
 * 会读到默认空配置（API Key 为空），导致每次翻译都静默失败。
 *
 * 解决：订阅 `onRehydrateStorage` 回调，最多等待 3 秒。
 */
async function waitForConfigHydration(): Promise<void> {
  // 先检查 chrome.storage.sync 中是否有数据
  return new Promise<void>(resolve => {
    // 如果已经有 API Key，说明水合已完成
    const currentState = useAppConfigStore.getState();
    const providerSettings = currentState.providers[currentState.provider];
    if (providerSettings?.apiKey) {
      resolve();
      return;
    }

    // 等待水合完成（最多 3 秒）
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('[ContentScript] Config 水合超时，使用当前配置');
        resolve();
      }
    }, 3000);

    // 监听 storage 变化，当配置更新时解析
    chrome.storage.sync.get(['manga-translator-config-v2'], result => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // 将数据注入 store（触发水合等价操作）
        const savedConfig = result['manga-translator-config-v2'];
        if (savedConfig?.providers) {
          // Zustand persist 会自动处理，这里只需短暂等待让它完成
          setTimeout(resolve, 50);
        } else {
          resolve();
        }
      }
    });
  });
}

async function getPersistedAutoTranslateEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.sync.get([CONFIG_STORAGE_KEY]);
    const persisted =
      result[CONFIG_STORAGE_KEY] as
        | { state?: { enabled?: boolean }; enabled?: boolean }
        | undefined;

    return persisted?.state?.enabled ?? persisted?.enabled ?? false;
  } catch {
    return useAppConfigStore.getState().enabled;
  }
}

async function ensureServicesInitialized(): Promise<void> {
  // 如果服务已初始化且实例存在，直接跳过（避免每次点击重复初始化）
  if (servicesReady && translator && renderer) {
    return;
  }

  // 等待 Config Store 从 chrome.storage 水合（解决竞态条件）
  await waitForConfigHydration();

  // 确保 renderer 总是被初始化
  if (!renderer) {
    renderer = getRenderer();
  }

  // 重新创建 translator 以获取最新配置
  translator = createTranslatorFromConfig();

  try {
    await translator.initialize();
    servicesReady = true;
    console.warn('[ContentScript] Translator 初始化成功');
  } catch (error) {
    console.error('[ContentScript] Translator 初始化失败:', error);
    const friendly = parseTranslationError(error);
    setState({ status: 'error', message: `初始化失败: ${friendly.message}` });
    throw error;
  }
}

// ==================== 图片处理 ====================

function findTranslatableImages(): HTMLImageElement[] {
  currentSiteAdapter = matchSiteAdapter(window.location.href);
  const siteImages = collectSiteCandidateImages(currentSiteAdapter);
  const allImages = Array.from(document.querySelectorAll('img'));
  const uniqueImages = [...new Set([...siteImages, ...allImages])];

  console.warn(`[ContentScript] 分析所有 ${uniqueImages.length} 张图片...`);

  // 对于可能被懒加载干扰的图片，尝试将 data-src / data-original 等恢复到 src
  uniqueImages.forEach(img => {
    if (!img.src || img.src.includes('data:image') || img.src.includes('blank')) {
      const realSrc = getRealImageSource(img, currentSiteAdapter);
      if (realSrc && typeof realSrc === 'string') {
        // 我们只在内存中标记它的真实 src 或者直接将 src 赋值
        // 为了不破坏原网页行为，最好不要直接改 src，但为了测量可能需要。这里保守先不改。
      }
    }
  });

  return uniqueImages.filter((img) => {
    const isTranslatable = isTranslatableImage(img, {
      debug: true,
      allowIncomplete: true,
      siteAdapter: currentSiteAdapter,
    });
    const originalKey = getProcessedImageKey(img);
    const notProcessed = !processedImages.has(originalKey);
    // 这里如果已经被处理过，也要算在「无需重新处理的源」里，但对于本次队列过滤掉
    return isTranslatable && notProcessed;
  });
}

function getImageKey(img: HTMLImageElement): string {
  const realSrc = getRealImageSource(img, currentSiteAdapter);
  return `${realSrc || 'unknown'}::${img.naturalWidth || img.width}x${img.naturalHeight || img.height}`;
}

function getPipelineFingerprint(): string {
  const config = useAppConfigStore.getState();
  const providerSettings = config.providers[config.provider];
  return [
    config.executionMode,
    config.server.enabled ? config.server.baseUrl : 'no-server',
    config.provider,
    providerSettings.model || 'default',
    config.targetLanguage,
    config.translationStylePreset,
    config.translationPipeline,
    config.renderMode,
    config.regionBatchSize,
    config.fallbackToFullImage,
  ].join('::');
}

function getProcessedImageKey(img: HTMLImageElement): string {
  return `${getImageKey(img)}::${getPipelineFingerprint()}`;
}

async function processSingleImage(
  img: HTMLImageElement,
  viewportCrop: boolean = false,
  autoPinned: boolean = false,
  forceRefresh: boolean = false
) {
  if (!translator || !renderer) {
    throw new Error('Services not initialized');
  }

  await prepareImageForTranslation(img, currentSiteAdapter);

  img.classList.add(PROCESSED_CLASS);

  const imageKey = getImageKey(img);
  const result = await translator.translateImage(
    img,
    viewportCrop,
    imageKey,
    forceRefresh
  );

  if (!result.success) {
    throw new Error(result.error || 'Translation failed');
  }

  if (result.readingResult?.entries.length) {
    if (useAppConfigStore.getState().renderMode === 'anchors-only') {
      if (!readingLayer) {
        readingLayer = new ReadingLayer();
      }
      readingLayer?.upsert(img, result.readingResult);
    } else {
      renderer.render(img, result.textAreas, autoPinned);
    }
    return result;
  }

  if (result.textAreas.length === 0) {
    return result;
  }

  renderer.render(img, result.textAreas, autoPinned);
  return result;
}

async function processImageBatch(
  images: HTMLImageElement[],
  preserveSession: boolean = false,
  forceRefresh: boolean = false
): Promise<void> {
  if (images.length === 0) {
    if (!preserveSession) {
      setState({ status: 'complete', count: 0 });
    }
    return;
  }

  const config = useAppConfigStore.getState();
  const parallelLimit = config.parallelLimit || 3;
  const total = images.length;
  let current = 0;

  if (!preserveSession) {
    currentSession = createEmptySession();
    currentSession.sessionId = `session-${Date.now()}`;
    currentSession.queuedCount = total;
  } else {
    currentSession.queuedCount += total;
  }

  setState({ status: 'translating', current: 0, total });

  const options: ParallelProcessingOptions = {
    maxConcurrent: parallelLimit,
    signal: abortController?.signal,
    onItemComplete: (completed) => {
      current = completed;
      if (currentState.status === 'translating') {
        setState({ status: 'translating', current, total });
      }
    },
    onError: (error) => {
      const friendly = parseTranslationError(error);
      console.error('[ContentScript] 图片处理失败:', friendly.message);
      currentSession.lastError = friendly.message;
    },
  };

  await processInParallel(
    images,
    async (img) => {
      const imageKey = getProcessedImageKey(img);
      if (abortController?.signal.aborted) {
        throw new Error('Translation cancelled');
      }
      try {
        const result = await processSingleImage(img, false, true, forceRefresh);
        processedImages.add(imageKey);
        failedImageQueue.delete(imageKey);

        if (result.cached) {
          currentSession.cachedCount += 1;
        }

        if (result.textAreas.length === 0) {
          currentSession.skippedCount += 1;
        } else {
          currentSession.translatedCount += 1;
        }
      } catch (error) {
        currentSession.failedCount += 1;
        failedImageQueue.set(imageKey, img);
        throw error;
      }
    },
    options
  );
}

// ==================== 核心动作 ====================

/**
 * 整页翻译
 */
async function translatePage(forceRefresh: boolean = false): Promise<void> {
  console.warn('[ContentScript] translatePage 开始执行');
  pageFollowTranslateEnabled = true;
  setupAutoTranslateObserver();

  if (currentState.status === 'translating' || currentState.status === 'scanning') {
    console.warn('[ContentScript] 翻译已在进行中');
    return;
  }

  abortController = new AbortController();
  failedImageQueue.clear();
  if (forceRefresh) {
    renderer?.removeAll();
    readingLayer?.clear();
    processedImages.clear();
  }
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

    await processImageBatch(images, false, forceRefresh);

    // 检查是否被取消
    if (abortController?.signal.aborted) {
      setState({ status: 'idle' });
      return;
    }

    setState({
      status: 'complete',
      count: currentSession.translatedCount,
    });
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 翻译流程失败:', friendly.message);
    currentSession.lastError = friendly.message;
    setState({ status: 'error', message: friendly.message });
  } finally {
    abortController = null;
    if (isAutoTranslateActive() && autoTranslatePending) {
      autoTranslatePending = false;
      scheduleAutoTranslateScan(300);
    }
  }
}

async function translateNewImages(): Promise<void> {
  if (
    !isAutoTranslateActive() ||
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  ) {
    autoTranslatePending = true;
    return;
  }

  try {
    await ensureServicesInitialized();
    const images = getViewportFirstImages(findTranslatableImages());

    if (images.length === 0) {
      autoTranslatePending = false;
      return;
    }

    if (!abortController) {
      abortController = new AbortController();
    }

    await processImageBatch(images, true, false);
    setState({
      status: 'complete',
      count: currentSession.translatedCount,
    });
  } catch (error) {
    const friendly = parseTranslationError(error);
    currentSession.lastError = friendly.message;
    setState({ status: 'error', message: friendly.message });
  } finally {
    abortController = null;
    autoTranslatePending = false;
  }
}

/**
 * 进入 hover 选图模式
 */
function enterHoverSelect(): void {
  if (hoverSelector) {
    hoverSelector.exit();
  }

  hoverSelector = new HoverSelector();
  hoverSelector.onImageClick(async (img) => {
    // 翻译期间先退出当前选图器
    if (hoverSelector) {
      hoverSelector.exit();
      hoverSelector = null;
    }
    setState({ status: 'translating', current: 0, total: 1 });

    try {
      await ensureServicesInitialized();
      if (renderer) {
        renderer.renderLoading(img);
      }
      // 单图翻译：viewportCrop + autoPinned（覆盖层自动固定显示）
      const result = await processSingleImage(img, true, true, false);
      processedImages.add(getProcessedImageKey(img));
      currentSession = createEmptySession();
      currentSession.sessionId = `session-${Date.now()}`;
      currentSession.queuedCount = 1;
      currentSession.translatedCount = result.textAreas.length > 0 ? 1 : 0;
      currentSession.skippedCount = result.textAreas.length === 0 ? 1 : 0;
      currentSession.cachedCount = result.cached ? 1 : 0;
    } catch (error) {
      const friendly = parseTranslationError(error);
      currentSession.lastError = friendly.message;
      setState({ status: 'error', message: friendly.message });
    } finally {
      if (renderer) {
        renderer.removeLoading(img);
      }
      // 翻译完成后自动回到 hover-select 模式，支持连续翻译
      if (currentState.status !== 'error') {
        enterHoverSelect();
      }
    }
  });

  hoverSelector.enter();
  setState({ status: 'hover-select' });
}

/**
 * 退出 hover 选图模式
 */
function exitHoverSelect(): void {
  if (hoverSelector) {
    hoverSelector.exit();
    hoverSelector = null;
  }
  setState({ status: 'idle' });
}

/**
 * 取消正在进行的翻译
 */
function cancelTranslation(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (hoverSelector) {
    hoverSelector.exit();
    hoverSelector = null;
  }
  if (!autoTranslateEnabled) {
    pageFollowTranslateEnabled = false;
    teardownAutoTranslateObserver();
  }
  autoTranslatePending = false;
  setState({ status: 'idle' });
}

async function retryFailedTranslations(): Promise<void> {
  if (failedImageQueue.size === 0) {
    setState({
      status: 'complete',
      count: currentSession.translatedCount,
    });
    return;
  }

  const images = [...failedImageQueue.values()].filter(image => image.isConnected);

  currentSession = createEmptySession();
  currentSession.sessionId = `session-${Date.now()}`;
  currentSession.queuedCount = images.length;
  abortController = new AbortController();
  setState({ status: 'translating', current: 0, total: images.length });

  try {
    await ensureServicesInitialized();

    await processInParallel(
      images,
      async img => {
        const imageKey = getProcessedImageKey(img);
        const result = await processSingleImage(img, false, true, false);
        processedImages.add(imageKey);
        failedImageQueue.delete(imageKey);

        if (result.cached) {
          currentSession.cachedCount += 1;
        }

        if (result.textAreas.length === 0) {
          currentSession.skippedCount += 1;
        } else {
          currentSession.translatedCount += 1;
        }
      },
      {
        maxConcurrent: useAppConfigStore.getState().parallelLimit || 3,
        signal: abortController.signal,
        onItemComplete: completed => {
          setState({
            status: 'translating',
            current: completed,
            total: images.length,
          });
        },
        onError: error => {
          const friendly = parseTranslationError(error);
          currentSession.failedCount += 1;
          currentSession.lastError = friendly.message;
        },
      }
    );

    setState({
      status: 'complete',
      count: currentSession.translatedCount,
    });
  } catch (error) {
    const friendly = parseTranslationError(error);
    currentSession.lastError = friendly.message;
    setState({ status: 'error', message: friendly.message });
  } finally {
    abortController = null;
  }
}

/**
 * 清除所有覆盖层
 */
function clearAll(): void {
  cancelTranslation();

  if (renderer) {
    renderer.removeAll();
  }
  if (readingLayer) {
    readingLayer.clear();
  }
  removeAllOverlaysFromDOM();

  processedImages.clear();
  failedImageQueue.clear();
  pageFollowTranslateEnabled = false;
  currentSession = createEmptySession();
  document.querySelectorAll(`.${PROCESSED_CLASS}`).forEach((img) => {
    img.classList.remove(PROCESSED_CLASS);
  });

  setState({ status: 'idle' });
}

function scheduleAutoTranslateScan(delay: number = 600): void {
  if (!isAutoTranslateActive()) {
    return;
  }

  if (autoTranslateDebounce) {
    clearTimeout(autoTranslateDebounce);
  }

  autoTranslateDebounce = setTimeout(() => {
    autoTranslateDebounce = null;
    void translateNewImages();
  }, delay);
}

function setupAutoTranslateObserver(): void {
  if (autoTranslateObserver) {
    return;
  }

  autoTranslateObserver = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        if (mutation.addedNodes.length > 0) {
          shouldScan = true;
        }
      }

      if (
        mutation.type === 'attributes' &&
        mutation.target instanceof HTMLImageElement
      ) {
        shouldScan = true;
      }

      if (shouldScan) {
        break;
      }
    }

    if (shouldScan) {
      scheduleAutoTranslateScan();
    }
  });

  autoTranslateObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'src',
      'srcset',
      'data-src',
      'data-original',
      'data-lazy-src',
      'class',
      'style',
    ],
  });

  document.addEventListener('scroll', handleAutoTranslateScroll, true);
}

function teardownAutoTranslateObserver(): void {
  if (autoTranslateObserver) {
    autoTranslateObserver.disconnect();
    autoTranslateObserver = null;
  }

  if (autoTranslateDebounce) {
    clearTimeout(autoTranslateDebounce);
    autoTranslateDebounce = null;
  }

  document.removeEventListener('scroll', handleAutoTranslateScroll, true);
}

function handleAutoTranslateScroll(): void {
  scheduleAutoTranslateScan(400);
}

function isAutoTranslateActive(): boolean {
  return autoTranslateEnabled || pageFollowTranslateEnabled;
}

async function syncAutoTranslateMode(
  explicitEnabled?: boolean
): Promise<void> {
  const enabled =
    explicitEnabled ?? (await getPersistedAutoTranslateEnabled());
  autoTranslateEnabled = enabled;

  if (isAutoTranslateActive()) {
    setupAutoTranslateObserver();
    scheduleAutoTranslateScan(200);
  } else {
    teardownAutoTranslateObserver();
  }
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
  sendResponse: (response: { success: boolean; error?: string; state?: ContentState }) => void
): boolean {
  console.warn('[ContentScript] 收到消息:', request.type);

  switch (request.type) {
    case 'GET_STATE':
      sendResponse({ success: true, state: currentState });
      break;

    case 'TRANSLATE_PAGE':
      translatePage()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'FORCE_RETRANSLATE_PAGE':
      translatePage(true)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'ENTER_HOVER_SELECT':
      enterHoverSelect();
      sendResponse({ success: true });
      break;

    case 'EXIT_HOVER_SELECT':
      exitHoverSelect();
      sendResponse({ success: true });
      break;

    case 'CANCEL_TRANSLATION':
      cancelTranslation();
      sendResponse({ success: true });
      break;

    case 'CLEAR_ALL':
      clearAll();
      sendResponse({ success: true });
      break;

    case 'RETRY_FAILED':
      retryFailedTranslations()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;

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
    // 配置变更时重置 translator 和初始化状态，下次使用时重新初始化
    translator = null;
    servicesReady = false;
    processedImages.clear();
    if (useAppConfigStore.getState().renderMode === 'anchors-only') {
      readingLayer?.clear();
    } else if (readingLayer) {
      readingLayer.destroy();
      readingLayer = null;
    }
    const nextValue = changes[CONFIG_STORAGE_KEY].newValue as
      | { state?: { enabled?: boolean }; enabled?: boolean }
      | undefined;
    const enabled = nextValue?.state?.enabled ?? nextValue?.enabled;
    void syncAutoTranslateMode(enabled);
  }
}

// ==================== HUD 取消按钮监听 ====================

function setupHudCancelListener(): void {
  document.addEventListener('hud-cancel', () => {
    cancelTranslation();
  });
}

// ==================== 键盘快捷键 ====================

/**
 * 注册键盘快捷键
 *
 * 快捷键一览：
 * - Alt+T: 翻译当前页面 / 停止翻译
 * - Alt+H: 进入/退出 悬停选图模式
 * - Escape: 取消翻译 / 退出悬停模式（任何时候均可用）
 */
function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // 忽略输入框、文本框等表单元素中的快捷键
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // Alt+T — 翻译页面 / 停止翻译
    if (e.altKey && e.key === 't') {
      e.preventDefault();
      if (
        currentState.status === 'translating' ||
        currentState.status === 'scanning'
      ) {
        cancelTranslation();
      } else {
        translatePage();
      }
      showKeyboardHint('Alt+T');
      return;
    }

    // Alt+H — 悬停选图模式
    if (e.altKey && e.key === 'h') {
      e.preventDefault();
      if (currentState.status === 'hover-select') {
        exitHoverSelect();
      } else {
        enterHoverSelect();
      }
      showKeyboardHint('Alt+H');
      return;
    }

    // Escape — 取消/退出
    if (e.key === 'Escape') {
      if (
        currentState.status === 'translating' ||
        currentState.status === 'scanning'
      ) {
        cancelTranslation();
      } else if (currentState.status === 'hover-select') {
        exitHoverSelect();
      } else if (currentState.status === 'error') {
        setState({ status: 'idle' });
      }
    }
  });
}

/**
 * 短暂提示用户已触发的快捷键
 */
function showKeyboardHint(_key: string): void {
  // 键盘提示通过 Popup/HUD 状态变化体现，无需额外 UI
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

    await waitForConfigHydration();
    await syncAutoTranslateMode();

    // 监听 HUD 取消按钮
    setupHudCancelListener();

    // 注册键盘快捷键（Alt+T/Alt+H/Escape）
    setupKeyboardShortcuts();

    // 页面卸载时清理
    window.addEventListener('beforeunload', cleanup);

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
  if (readingLayer) {
    readingLayer.destroy();
    readingLayer = null;
  }
  if (hoverSelector) {
    hoverSelector.exit();
    hoverSelector = null;
  }
  teardownAutoTranslateObserver();
  processedImages.clear();
}

// ==================== 启动 ====================

initialize();

// ==================== 测试导出 ====================

export {
  currentState,
  findTranslatableImages,
  handleMessage,
  translatePage,
  enterHoverSelect,
  exitHoverSelect,
  cancelTranslation,
  clearAll,
  setState,
};
