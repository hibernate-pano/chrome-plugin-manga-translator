import { getRenderer } from '@/services/renderer';
import type {
  ContentRequest,
  ContentResponse,
  ContentStatus,
  ContentRuntimeState,
  ContentStateUpdateMessage,
  TestServerConnectionResponse,
  TranslateViaServerRequest,
  TranslateViaServerResponse,
} from '@/shared/runtime-contracts';
import { loadRuntimeAppConfig } from '@/shared/app-config';
import { parseTranslationError } from '@/utils/error-handler';
import { HoverSelector } from './hover-selector';
import {
  createPageContext,
  getPageContextKey,
  hasPageContextChanged,
  type ContentPageContext,
} from './page-context';
import {
  matchSiteAdapter,
  prepareImageForTranslation,
  type RenderablePage,
  type SiteAdapter,
  waitForRenderablePages,
} from './site-adapters';

const renderer = getRenderer();
const PAGE_SYNC_EVENT = 'manga-translator:page-sync';

let adapter: SiteAdapter | null = null;
let hoverSelector: HoverSelector | null = null;
let renderablePages: RenderablePage[] = [];
let pageContext = readPageContext();
let restoreHistoryHooks: Array<() => void> = [];

function readPageContext(): ContentPageContext {
  const nextAdapter = matchSiteAdapter(window.location.href);
  const bootstrap = nextAdapter?.getChapterBootstrap(window) ?? null;

  return createPageContext(window.location.href, nextAdapter, bootstrap);
}

function createRuntimeStateFromContext(
  context: ContentPageContext,
  status?: ContentStatus,
  message?: string | null
): ContentRuntimeState {
  return {
    status:
      status ?? (context.support.supported ? 'idle' : 'unsupported'),
    support: context.support,
    message: message ?? context.support.reason,
    selectedImageUrl: null,
    translatedCount: 0,
  };
}

function createInitialState(): ContentRuntimeState {
  pageContext = readPageContext();
  adapter = pageContext.adapter;
  return createRuntimeStateFromContext(pageContext);
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

function syncPageContext(): boolean {
  const nextContext = readPageContext();
  const changed = hasPageContextChanged(pageContext, nextContext);

  pageContext = nextContext;
  adapter = nextContext.adapter;

  if (!changed) {
    return false;
  }

  renderablePages = [];
  exitPicking();
  renderer.removeAll();
  setState(createRuntimeStateFromContext(nextContext));

  return true;
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

async function ensureServerReady(): Promise<void> {
  const config = await loadRuntimeAppConfig();

  if (!config.server.baseUrl.trim()) {
    throw new Error('请先在设置页配置服务端地址');
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'TEST_SERVER_CONNECTION',
  })) as TestServerConnectionResponse;

  if (!response?.success) {
    throw new Error(response?.message || '无法连接到服务端');
  }
}

async function translateRenderablePage(page: RenderablePage): Promise<void> {
  const requestPageContextKey = getPageContextKey(pageContext);

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

    if (requestPageContextKey !== getPageContextKey(pageContext)) {
      return;
    }

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
    if (requestPageContextKey !== getPageContextKey(pageContext)) {
      return;
    }

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
  syncPageContext();

  if (!currentState.support.supported || !adapter) {
    throw new Error(currentState.support.reason || '当前页面不受支持');
  }

  if (currentState.status === 'translating') {
    throw new Error('翻译进行中，请稍后再试');
  }

  patchState({ message: '正在检查服务端连接' });
  await ensureServerReady();

  patchState({ message: '正在查找章节图片' });
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
  renderablePages = [];
  renderer.removeAll();
  syncPageContext();
  setState(createRuntimeStateFromContext(pageContext));
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
  syncPageContext();

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

function handlePageSync(): void {
  syncPageContext();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    syncPageContext();
  }
}

function installHistoryHook(
  method: 'pushState' | 'replaceState'
): () => void {
  const original = window.history[method];

  window.history[method] = function (
    ...args: Parameters<History[typeof method]>
  ) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event(PAGE_SYNC_EVENT));
    return result;
  };

  return () => {
    window.history[method] = original;
  };
}

function initialize(): void {
  currentState = createInitialState();
  restoreHistoryHooks = [
    installHistoryHook('pushState'),
    installHistoryHook('replaceState'),
  ];
  chrome.runtime.onMessage.addListener(handleMessage);
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('popstate', handlePageSync);
  window.addEventListener('pageshow', handlePageSync);
  window.addEventListener('focus', handlePageSync);
  window.addEventListener(PAGE_SYNC_EVENT, handlePageSync);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  broadcastState();
}

function cleanup(): void {
  exitPicking();
  renderablePages = [];
  renderer.removeAll();
  restoreHistoryHooks.forEach(restore => restore());
  restoreHistoryHooks = [];
  window.removeEventListener('popstate', handlePageSync);
  window.removeEventListener('pageshow', handlePageSync);
  window.removeEventListener('focus', handlePageSync);
  window.removeEventListener(PAGE_SYNC_EVENT, handlePageSync);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

initialize();

export { createInitialState, handleMessage, startPicking, clearOverlays };
