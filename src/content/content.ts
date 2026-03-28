import { getRenderer } from '@/services/renderer';
import type {
  ContentRequest,
  ContentResponse,
  ContentRuntimeState,
  ContentStateUpdateMessage,
  PageSupportState,
  TranslateViaServerRequest,
  TranslateViaServerResponse,
} from '@/shared/runtime-contracts';
import { loadRuntimeAppConfig } from '@/shared/app-config';
import { parseTranslationError } from '@/utils/error-handler';
import { HoverSelector } from './hover-selector';
import {
  matchSiteAdapter,
  prepareImageForTranslation,
  type RenderablePage,
  type SiteAdapter,
  waitForRenderablePages,
} from './site-adapters';

const renderer = getRenderer();

let adapter: SiteAdapter | null = null;
let hoverSelector: HoverSelector | null = null;
let renderablePages: RenderablePage[] = [];

function createSupportState(siteAdapter: SiteAdapter | null): PageSupportState {
  if (!siteAdapter) {
    return {
      supported: false,
      site: null,
      reason: '当前页面不是 ManhwaRead 章节阅读页',
    };
  }

  return {
    supported: true,
    site: siteAdapter.id,
    reason: null,
  };
}

function createInitialState(): ContentRuntimeState {
  adapter = matchSiteAdapter(window.location.href);
  const support = createSupportState(adapter);

  return {
    status: support.supported ? 'idle' : 'unsupported',
    support,
    message: support.reason,
    selectedImageUrl: null,
    translatedCount: 0,
  };
}

let currentState = createInitialState();

function broadcastState(): void {
  const message: ContentStateUpdateMessage = {
    type: 'CONTENT_STATE_UPDATE',
    state: currentState,
  };

  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may be closed.
  });
}

function setState(state: ContentRuntimeState): void {
  currentState = state;
  broadcastState();
}

function patchState(
  patch: Partial<Omit<ContentRuntimeState, 'support'>>,
  nextStatus?: ContentRuntimeState['status']
): void {
  setState({
    ...currentState,
    ...patch,
    status: nextStatus ?? currentState.status,
  });
}

async function ensureRenderableImages(): Promise<RenderablePage[]> {
  if (!adapter) {
    throw new Error('当前页面不受支持');
  }

  const pages = await waitForRenderablePages(adapter);
  renderablePages = pages;
  return pages;
}

function exitPicking(): void {
  if (!hoverSelector) {
    return;
  }

  hoverSelector.exit();
  hoverSelector = null;
}

function findRenderablePage(image: HTMLImageElement): RenderablePage | null {
  const existing = renderablePages.find(page => page.image === image);
  return existing ?? null;
}

async function translateRenderablePage(page: RenderablePage): Promise<void> {
  patchState(
    {
      message: '正在请求服务端翻译',
      selectedImageUrl: page.canonicalUrl,
      translatedCount: 0,
    },
    'translating'
  );

  renderer.renderLoading(page.image);

  try {
    await prepareImageForTranslation(page.image, adapter);

    const config = await loadRuntimeAppConfig();
    const request: TranslateViaServerRequest = {
      type: 'TRANSLATE_VIA_SERVER',
      imageUrl: page.canonicalUrl,
      targetLanguage: config.targetLanguage,
      translationStylePreset: config.translationStylePreset,
      forceRefresh: false,
    };

    const response = (await chrome.runtime.sendMessage(
      request
    )) as TranslateViaServerResponse;

    if (!response?.success) {
      throw new Error(response?.error || '服务端翻译失败');
    }

    renderer.render(page.image, response.textAreas, true);

    setState({
      status: 'rendered',
      support: currentState.support,
      message:
        response.textAreas.length > 0
          ? '翻译完成'
          : '未检测到可渲染的文字区域',
      selectedImageUrl: page.canonicalUrl,
      translatedCount: response.textAreas.length,
    });
  } catch (error) {
    const friendly = parseTranslationError(error);
    setState({
      status: 'error',
      support: currentState.support,
      message: friendly.message,
      selectedImageUrl: page.canonicalUrl,
      translatedCount: 0,
    });
  } finally {
    renderer.removeLoading(page.image);
  }
}

async function startPicking(): Promise<void> {
  if (!currentState.support.supported || !adapter) {
    throw new Error(currentState.support.reason || '当前页面不受支持');
  }

  if (currentState.status === 'translating') {
    throw new Error('翻译进行中，请稍后再试');
  }

  const pages = await ensureRenderableImages();
  const allowedImages = new Set(pages.map(page => page.image));

  exitPicking();

  hoverSelector = new HoverSelector({
    allowImage: image => allowedImages.has(image),
  });

  hoverSelector.onImageClick(image => {
    const page = findRenderablePage(image);
    if (!page) {
      setState({
        status: 'error',
        support: currentState.support,
        message: '未找到章节图片绑定信息',
        selectedImageUrl: null,
        translatedCount: 0,
      });
      return;
    }

    exitPicking();
    void translateRenderablePage(page);
  });

  hoverSelector.enter();
  setState({
    status: 'picking',
    support: currentState.support,
    message: '点击章节图片开始翻译',
    selectedImageUrl: null,
    translatedCount: 0,
  });
}

function clearOverlays(): void {
  exitPicking();
  renderer.removeAll();
  setState({
    status: currentState.support.supported ? 'idle' : 'unsupported',
    support: currentState.support,
    message: currentState.support.reason,
    selectedImageUrl: null,
    translatedCount: 0,
  });
}

function cancelPicking(): void {
  if (currentState.status !== 'picking') {
    return;
  }

  exitPicking();
  setState({
    status: 'idle',
    support: currentState.support,
    message: null,
    selectedImageUrl: null,
    translatedCount: 0,
  });
}

function handleMessage(
  request: ContentRequest,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: ContentResponse) => void
): boolean {
  switch (request.type) {
    case 'GET_CONTENT_STATE':
      sendResponse({ success: true, state: currentState });
      return false;
    case 'START_PICKING':
      void startPicking()
        .then(() => sendResponse({ success: true, state: currentState }))
        .catch(error => {
          const friendly = parseTranslationError(error);
          setState({
            status: 'error',
            support: currentState.support,
            message: friendly.message,
            selectedImageUrl: null,
            translatedCount: 0,
          });
          sendResponse({
            success: false,
            error: friendly.message,
            state: currentState,
          });
        });
      return true;
    case 'CANCEL_PICKING':
      cancelPicking();
      sendResponse({ success: true, state: currentState });
      return false;
    case 'CLEAR_OVERLAYS':
      clearOverlays();
      sendResponse({ success: true, state: currentState });
      return false;
    default:
      sendResponse({
        success: false,
        error: '未知内容脚本请求',
        state: currentState,
      });
      return false;
  }
}

function initialize(): void {
  currentState = createInitialState();
  chrome.runtime.onMessage.addListener(handleMessage);
  window.addEventListener('beforeunload', cleanup);
  broadcastState();
}

function cleanup(): void {
  exitPicking();
  renderer.removeAll();
}

initialize();

export { createInitialState, handleMessage, startPicking, clearOverlays };
