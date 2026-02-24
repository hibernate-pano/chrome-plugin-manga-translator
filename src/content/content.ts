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
import { isTranslatableImage } from './hover-selector';
import { HoverSelector } from './hover-selector';
import { FloatingHud } from './floating-hud';

// ==================== 消息类型定义 ====================

export type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'ENTER_HOVER_SELECT' }
  | { type: 'EXIT_HOVER_SELECT' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' };

export type ContentToPopupMsg =
  | { type: 'STATE_UPDATE'; state: ContentState }
  | { type: 'READY' };

// ==================== 状态类型定义 ====================

export type ContentState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'translating'; current: number; total: number }
  | { status: 'complete'; count: number }
  | { status: 'hover-select' }
  | { status: 'error'; message: string };

// ==================== 常量 ====================

const PROCESSED_CLASS = 'manga-translator-processed';
const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

// ==================== 运行时状态 ====================

let currentState: ContentState = { status: 'idle' };
let abortController: AbortController | null = null;
let translator: TranslatorService | null = null;
let renderer: OverlayRenderer | null = null;
let hud: FloatingHud | null = null;
let hoverSelector: HoverSelector | null = null;
const processedImages: Set<string> = new Set();

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
        hud.update({ status: 'translating', current: state.current, total: state.total });
        break;
      case 'complete':
        hud.update({ status: 'complete', count: state.count });
        break;
      case 'hover-select':
        hud.update({ status: 'hover-select' });
        break;
      case 'error':
        hud.update({ status: 'error', message: state.message });
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
    setState({ status: 'error', message: `初始化失败: ${friendly.message}` });
    throw error;
  }
}

// ==================== 图片处理 ====================

function findTranslatableImages(): HTMLImageElement[] {
  // 等待一小段时间确保图片已加载（懒加载页面）
  const allImages = Array.from(document.querySelectorAll('img'));

  return allImages.filter(
    (img) => isTranslatableImage(img) && !processedImages.has(getImageKey(img))
  );
}

function getImageKey(img: HTMLImageElement): string {
  return img.src || `img-${img.offsetLeft}-${img.offsetTop}-${img.width}-${img.height}`;
}

async function processSingleImage(img: HTMLImageElement): Promise<void> {
  if (!translator || !renderer) {
    throw new Error('Services not initialized');
  }

  img.classList.add(PROCESSED_CLASS);

  const result = await translator.translateImage(img);

  if (!result.success) {
    throw new Error(result.error || 'Translation failed');
  }

  if (result.textAreas.length === 0) {
    return;
  }

  renderer.render(img, result.textAreas);
}

// ==================== 核心动作 ====================

/**
 * 整页翻译
 */
async function translatePage(): Promise<void> {
  console.warn('[ContentScript] translatePage 开始执行');

  if (currentState.status === 'translating' || currentState.status === 'scanning') {
    console.warn('[ContentScript] 翻译已在进行中');
    return;
  }

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
    const parallelLimit = config.parallelLimit || 3;
    const total = images.length;
    let current = 0;
    let successCount = 0;

    setState({ status: 'translating', current: 0, total });

    const options: ParallelProcessingOptions = {
      maxConcurrent: parallelLimit,
      signal: abortController.signal,
      onItemComplete: (completed) => {
        current = completed;
        if (currentState.status === 'translating') {
          setState({ status: 'translating', current, total });
        }
      },
      onError: (error) => {
        const friendly = parseTranslationError(error);
        console.error('[ContentScript] 图片处理失败:', friendly.message);
      },
    };

    await processInParallel(
      images,
      async (img) => {
        if (abortController?.signal.aborted) {
          throw new Error('Translation cancelled');
        }
        const beforeCount = processedImages.size;
        await processSingleImage(img);
        // Only count if it wasn't already processed
        if (processedImages.size > beforeCount) {
          successCount++;
        }
        processedImages.add(getImageKey(img));
      },
      options
    );

    // 检查是否被取消
    if (abortController?.signal.aborted) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'complete', count: successCount });
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 翻译流程失败:', friendly.message);
    setState({ status: 'error', message: friendly.message });
  } finally {
    abortController = null;
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
    hoverSelector = null;
    setState({ status: 'translating', current: 0, total: 1 });

    try {
      await ensureServicesInitialized();
      await processSingleImage(img);
      processedImages.add(getImageKey(img));
      setState({ status: 'complete', count: 1 });
    } catch (error) {
      const friendly = parseTranslationError(error);
      setState({ status: 'error', message: friendly.message });
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
  setState({ status: 'idle' });
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
  document.querySelectorAll(`.${PROCESSED_CLASS}`).forEach((img) => {
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
  }
}

// ==================== HUD 取消按钮监听 ====================

function setupHudCancelListener(): void {
  document.addEventListener('hud-cancel', () => {
    cancelTranslation();
  });
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

    // 监听 HUD 取消按钮
    setupHudCancelListener();

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
  if (hoverSelector) {
    hoverSelector.exit();
    hoverSelector = null;
  }
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
