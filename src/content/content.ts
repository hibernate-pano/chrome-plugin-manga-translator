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
import { parseTranslationError, TranslationErrorCode, type FriendlyError, type ErrorAction } from '@/utils/error-handler';
import {
  getViewportFirstImages,
  processInParallel,
  type ParallelProcessingOptions,
} from '@/utils/image-priority';
import { useAppConfigStore } from '@/stores/config-v2';
import { isTranslatableImage } from './image-filter';
import { FloatingHud } from './floating-hud';
import { ReadingPanel } from './reading-panel';
import { ReadingAnchors } from './reading-anchors';
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
  | { status: 'scanning'; candidateCount?: number }
  | { status: 'translating'; current: number; total: number; currentImageIndex?: number; phase?: 'translating' | 'rendering' }
  | {
      status: 'complete';
      count: number;
      failedCount?: number;
      cachedCount?: number;
      /** Images on the page that were filtered out (size/position/duplicate). */
      skippedCount?: number;
    }
  | {
      status: 'error';
      message: string;
      suggestion?: string;
      action?: import('@/utils/error-handler').ErrorAction;
    };

// ==================== 常量 ====================

const PROCESSED_CLASS = 'manga-translator-processed';
const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

// ==================== 运行时状态 ====================

let currentState: ContentState = { status: 'idle' };
let abortController: AbortController | null = null;
let translator: TranslatorService | null = null;
let renderer: OverlayRenderer | null = null;
let hud: FloatingHud | null = null;
let readingPanel: ReadingPanel | null = null;
let readingAnchors: ReadingAnchors | null = null;
let autoTranslateObserver: MutationObserver | null = null;
let isAutoTranslateEnabled = false;
let failedCount = 0;
let cachedCount = 0;
let skippedCount = 0;
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
        hud.update({
          status: 'scanning',
          candidateCount: state.candidateCount,
        });
        break;
      case 'translating':
        hud.update({
          status: 'translating',
          current: state.current,
          total: state.total,
          currentImageIndex: state.currentImageIndex,
          phase: state.phase,
        });
        break;
      case 'complete':
        hud.update({
          status: 'complete',
          translatedCount: state.count,
          failedCount: state.failedCount ?? 0,
          cachedCount: state.cachedCount ?? 0,
          skippedCount: state.skippedCount ?? 0,
        });
        break;
      case 'error':
        hud.update({ status: 'error', message: state.message, suggestion: state.suggestion, action: state.action });
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

  // 首次翻译前创建沉浸式阅读面板与图上编号锚点。
  // 它们只创建一次，整个页面生命周期内复用。
  if (!readingPanel) {
    readingPanel = new ReadingPanel();
    // 监听图上编号点击 → 滚动对应 entry 到面板视口 + 闪高亮
    readingPanel['host'].addEventListener(
      'reading-anchor-click',
      ((e: Event) => {
        const detail = (e as CustomEvent<{ index: number }>).detail;
        focusReadingPanelEntry(detail.index);
      }) as EventListener
    );
  }
  if (!readingAnchors) {
    readingAnchors = new ReadingAnchors();
    // 滚动 / 缩放时重新定位所有锚点
    const reposition = () => readingAnchors?.repositionAll();
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
  }

  // 重新创建 translator 以获取最新配置
  translator = createTranslatorFromConfig();

  try {
    await translator.initialize();
    console.warn('[ContentScript] Translator 初始化成功');
  } catch (error) {
    console.error('[ContentScript] Translator 初始化失败:', error);
    const friendly = parseTranslationError(error);
    setState({ status: 'error', message: `初始化失败: ${friendly.message}`, suggestion: friendly.suggestion, action: resolveErrorAction(friendly) });
    throw error;
  }
}

/**
 * 滚动阅读面板的对应编号 entry 到视口，并闪高亮。
 */
function focusReadingPanelEntry(index: number): void {
  if (!readingPanel) return;
  const shadow = (readingPanel as unknown as { shadow: ShadowRoot }).shadow;
  const entryNode = shadow.querySelector<HTMLElement>(
    `.entry[data-index="${index}"]`
  );
  if (!entryNode) return;
  entryNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
  entryNode.classList.add('flash');
  setTimeout(() => entryNode.classList.remove('flash'), 1200);
}

// ==================== 图片处理 ====================

interface ImageScanResult {
  /** 过滤后真正会被翻译的图片 */
  translatable: HTMLImageElement[];
  /** 页面 img 元素总数（不过滤） */
  total: number;
  /** 通过 isTranslatableImage 但已被处理过的（去重后剩余） */
  skippedDuplicate: number;
  /** 被 isTranslatableImage 过滤掉的（尺寸/位置/类型） */
  skippedFilter: number;
}

function scanImages(): ImageScanResult {
  const allImages = Array.from(document.querySelectorAll('img'));
  let skippedFilter = 0;
  let skippedDuplicate = 0;
  const translatable: HTMLImageElement[] = [];

  for (const img of allImages) {
    if (!isTranslatableImage(img)) {
      skippedFilter++;
      continue;
    }
    if (processedImages.has(getImageKey(img))) {
      skippedDuplicate++;
      continue;
    }
    translatable.push(img);
  }

  return {
    translatable,
    total: allImages.length,
    skippedFilter,
    skippedDuplicate,
  };
}

function findTranslatableImages(): HTMLImageElement[] {
  return scanImages().translatable;
}

function getImageKey(img: HTMLImageElement): string {
  return (
    img.src ||
    `img-${img.offsetLeft}-${img.offsetTop}-${img.width}-${img.height}`
  );
}

async function processSingleImage(
  img: HTMLImageElement,
  forceRefresh: boolean = false,
  onCacheHit?: (hit: boolean) => void
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

  if (onCacheHit) {
    onCacheHit(Boolean(result.cached));
  }

  if (!result.success) {
    throw new Error(result.error || 'Translation failed');
  }

  if (result.textAreas.length === 0) {
    return;
  }

  renderer.render(img, result.textAreas);

  // 同步到阅读面板 + 图上编号锚点。
  // panel 内部按 upsert 顺序给图片分配 1-based 编号。
  readingPanel?.upsert(img, result.textAreas);
  const entryCount = readingPanel?.getEntryCount() ?? 0;
  readingAnchors?.upsert(img, entryCount);
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
  if (
    shouldAutoTranslateFollowUp({
      enabled: isAutoTranslateEnabled,
      status: currentState.status,
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

  // 翻译进行中的互斥：直接用 currentState 判断，不再维护冗余的 isTranslating 布尔
  if (
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  ) {
    console.warn('[ContentScript] 翻译已在进行中');
    return;
  }

  abortController = new AbortController();

  try {
    await ensureServicesInitialized();
    console.warn('[ContentScript] 服务初始化完成');

    // 扫描阶段：把"过滤掉多少张"也告诉用户。
    const scan = scanImages();
    skippedCount = scan.skippedFilter + scan.skippedDuplicate;
    const candidateCount = scan.translatable.length;
    setState({ status: 'scanning', candidateCount });

    const images = getViewportFirstImages(scan.translatable);
    console.warn(
      '[ContentScript] 页面 img 总数:',
      scan.total,
      '过滤:',
      scan.skippedFilter,
      '去重:',
      scan.skippedDuplicate,
      '可翻译:',
      images.length
    );

    if (images.length === 0) {
      console.warn('[ContentScript] 没有找到可翻译的图片');
      setState({
        status: 'complete',
        count: 0,
        failedCount: 0,
        cachedCount: 0,
        skippedCount,
      });
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

    setState({
      status: 'translating',
      current: 0,
      total,
      currentImageIndex: 0,
      phase: 'translating',
    });

    const options: ParallelProcessingOptions = {
      maxConcurrent: parallelLimit,
      signal: abortController.signal,
      onItemStart: index => {
        currentImageIndex = index;
        if (currentState.status === 'translating') {
          setState({
            status: 'translating',
            current,
            total,
            currentImageIndex: index,
            phase: 'translating',
          });
        }
      },
      onItemComplete: completed => {
        current = completed;
        if (currentState.status === 'translating') {
          setState({
            status: 'translating',
            current,
            total,
            currentImageIndex,
            phase: 'translating',
          });
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
        await processSingleImage(img, forceRefresh, hit => {
          if (hit) cachedCount++;
        });
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

    setState({
      status: 'complete',
      count: successCount,
      failedCount,
      cachedCount,
      skippedCount,
    });
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 翻译流程失败:', friendly.message);
    setState({ status: 'error', message: friendly.message, suggestion: friendly.suggestion, action: resolveErrorAction(friendly) });
  } finally {
    abortController = null;
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

  readingPanel?.reset();
  readingAnchors?.reset();

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
  if (
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  ) {
    return;
  }
  // 清除失败图片记录，让它们可以被重新处理
  for (const key of failedImageKeys) {
    processedImages.delete(key);
  }
  failedImageKeys.clear();
  void translatePage(true);
}

/**
 * 根据当前 provider 配置，定制 friendly error 的 action.command。
 * 让 "copy-command" 按钮直接复制用户能跑的命令，而不是通用模板。
 *
 * 例如 MODEL_NOT_FOUND 默认的 command 是 "ollama pull <model>"，
 * 这里会替换为 "ollama pull qwen3-vl:8b"。
 */
function resolveErrorAction(friendly: FriendlyError): ErrorAction | undefined {
  const action = friendly.action;
  if (!action || action.type !== 'copy-command' || !action.command) {
    return action;
  }
  if (friendly.code !== TranslationErrorCode.MODEL_NOT_FOUND) {
    return action;
  }
  const state = useAppConfigStore.getState();
  const settings = state.providers[state.provider];
  const modelName = settings.model?.trim();
  if (!modelName) {
    return action;
  }
  return {
    ...action,
    command: action.command.replace('<model>', modelName),
  };
}

// 错误"修复入口"按钮：根据 action 类型执行
function handleHudErrorAction(e: Event): void {
  const detail = (e as CustomEvent<{ type: string; command?: string }>).detail;
  if (!detail) return;
  if (detail.type === 'open-settings') {
    void chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(
      () => undefined
    );
  } else if (detail.type === 'copy-command') {
    const command = detail.command;
    if (command) {
      void navigator.clipboard.writeText(command).then(
        () => console.warn('[ContentScript] 已复制修复命令到剪贴板'),
        () => console.error('[ContentScript] 复制到剪贴板失败')
      );
    }
  }
}

function setupHudEventListeners(): void {
  document.addEventListener('hud-cancel', handleHudCancel);
  document.addEventListener('hud-retry-failed', handleRetryFailed);
  document.addEventListener('hud-error-action', handleHudErrorAction);
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

    // 监听 HUD 按钮事件
    setupHudEventListeners();

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
  stopAutoTranslateObserver();
  processedImages.clear();
  failedImageKeys.clear();
  chrome.runtime.onMessage.removeListener(handleMessage);
  chrome.storage.onChanged.removeListener(handleStorageChange);
  document.removeEventListener('hud-cancel', handleHudCancel);
  document.removeEventListener('hud-retry-failed', handleRetryFailed);
  document.removeEventListener('hud-error-action', handleHudErrorAction);
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
