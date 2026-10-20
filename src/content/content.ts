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
 *                   | CANCEL_TRANSLATION | CLEAR_ALL | COUNT_IMAGES
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
import {
  parseTranslationError,
  TranslationErrorCode,
  type FriendlyError,
  type ErrorAction,
} from '@/utils/error-handler';
import {
  getViewportFirstImages,
  processInParallel,
  type ParallelProcessingOptions,
} from '@/utils/image-priority';
import { sortTextAreasByReadingOrder } from '@/services/reading-order';
import { useContentConfigStore } from '@/stores/content-config';
import { hostMatchesAllowlist } from '@/shared/app-config';
import { fetchContentConfig } from '@/shared/config-client';
import type { ContentConfigSnapshot } from '@/shared/content-config';
import { isTranslatableImage } from './image-filter';
import { FloatingHud } from './floating-hud';
import { ReadingPanel } from './reading-panel';
import { ReadingAnchors } from './reading-anchors';
import { clampPageTranslationConcurrency } from './page-translation-utils';
import {
  createDebouncedAutoTranslate,
  shouldAutoTranslateFollowUp,
  MAX_AUTO_TRANSLATE_FOLLOW_UP_RUNS,
} from './auto-translate-observer';
import { getEnabledFromConfig } from './config-snapshot';

// ==================== 消息类型定义 ====================

export type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_FAILED' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' }
  | { type: 'COUNT_IMAGES' }
  | { type: 'TOGGLE_READING_PANEL' }
  | { type: 'DISARM_PAGE_AUTO_TRANSLATE' }
  | { type: 'TRANSLATE_SINGLE_IMAGE'; imageUrl: string };

/**
 * Messages the worker sends to the content script.
 *
 * `CONFIG_UPDATED` carries the redacted configuration snapshot. The content
 * script used to read `chrome.storage.local` itself; it no longer does, so
 * this is how it learns that the master switch or the provider changed.
 */
export type BackgroundToContentMsg = {
  type: 'CONFIG_UPDATED';
  config: ContentConfigSnapshot;
};

export type ContentToPopupMsg =
  | { type: 'STATE_UPDATE'; state: ContentState }
  | { type: 'READY' }
  | { type: 'HUD_CANCELLED' };

// ==================== 状态类型定义 ====================

/**
 * 页面级的事实：不管当前处于什么状态，这些数字都是真的。
 *
 * 弹窗要靠它们回答用户最关心的几个问题——"这一页有几张图"、"为什么少了
 * 几张"、"现在还会自动扣费吗"、"阅读面板开着没有"。以前这些数字只在一部分
 * 状态下才有，弹窗只能自己猜，用户因此被多扣费，或者以为翻译成功其实没有。
 */
export interface ContentStateReport {
  /**
   * 本页会被翻译的图片数量（最近一次扫描选中的候选）。
   *
   * 翻译结束后也会带上：否则弹窗在"已完成"这个状态下拿不到本页的图片总数，
   * 只能显示一个没有分母的数字。
   */
  candidateCount?: number;
  /**
   * 因尺寸/位置不符合要求被过滤掉的图片数。
   *
   * 以前这个数字把"已经翻译过"和"尺寸不合格"混在一起，用户看到"跳过 12 张"
   * 根本分不清是哪种情况。现在只算尺寸/位置不合格的那些。
   */
  skippedCount?: number;
  /**
   * 已经翻译过、所以这一次没有再翻译的图片数。
   *
   * 这部分不会再花钱，和上面那种"跳过的"必须分开报。
   */
  skippedDuplicateCount?: number;
  /**
   * 这一页当前是否处于自动续翻状态。
   *
   * 为 true 时，新加载进来的图片会被自动送去翻译并产生费用。判定依据就是
   * 内部那个真正决定是否自动翻译的布尔值：主开关 && 自动续翻开关 &&
   * （白名单命中 || 用户在本页手动翻译过）。弹窗里那个"自动翻译本站"开关
   * 只反映白名单，和这个真实状态不是一回事，用户正是因此被误导的。
   */
  autoContinueArmed?: boolean;
  /** 阅读面板当前是否显示。 */
  readingPanelVisible?: boolean;
}

export type ContentState = ContentStateReport &
  (
    | { status: 'idle' }
    | { status: 'scanning' }
    | {
        status: 'translating';
        current: number;
        total: number;
        currentImageIndex?: number;
        phase?: 'translating' | 'rendering';
      }
    | {
        status: 'complete';
        count: number;
        failedCount?: number;
        cachedCount?: number;
        /**
         * Why the first image failed. The upstream translator flattens every
         * provider error into a message, and that message is the only place
         * "API key invalid" or "rate limited" ever shows up. Dropping it left
         * the user staring at "failed 20" with no way to diagnose it.
         */
        lastError?: string;
      }
    | {
        status: 'error';
        message: string;
        suggestion?: string;
        action?: ErrorAction;
      }
  );

// ==================== 常量 ====================

const PROCESSED_CLASS = 'manga-translator-processed';
const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';

/**
 * Error signatures that mean "this whole run is doomed", not "this one image
 * failed".
 *
 * A 401/403 means the API key is wrong; a 429 means the provider is
 * throttling. Running the remaining 19 images in that state costs the user
 * money and time to produce the same failure 19 more times. Abort the run and
 * show the root cause instead.
 */
const FATAL_ERROR_PATTERNS: RegExp[] = [
  /\b401\b/,
  /\b403\b/,
  /\b429\b/,
  /unauthorized/i,
  /forbidden/i,
  /invalid[\s_-]*(api[\s_-]*)?key/i,
  /api[\s_-]*key[\s_-]*invalid/i,
  /incorrect[\s_-]*api[\s_-]*key/i,
  /rate[\s_-]*limit/i,
  /too[\s_-]*many[\s_-]*requests/i,
  /请求过于频繁/,
  /限流/,
  /密钥无效/,
  /api\s*密钥\s*无效/i,
];

/**
 * 用户在弹窗里把"启用扩展"关掉时，正在跑的那批翻译必须停下来。
 *
 * 已经发出去的请求撤不回来，所以这句话既说"停了"，也说"钱已经花掉了"，
 * 不能让用户以为一切都没发生。
 */
const EXTENSION_DISABLED_MESSAGE =
  '扩展已关闭，本次翻译已停止（已发出的请求无法撤回）';
const EXTENSION_DISABLED_SUGGESTION =
  '已经产生的费用不会退回，但剩下的图片不会再发送请求；重新开启「启用扩展」后可以继续翻译。';

/**
 * "扩展被关掉了"这个错误和别的失败不一样：它不是某一张图失败，而是整轮
 * 翻译都不该再继续。用一个专门的错误类型把它和"这张图翻译失败"分开。
 */
class ExtensionDisabledError extends Error {
  constructor() {
    super(EXTENSION_DISABLED_MESSAGE);
    this.name = 'ExtensionDisabledError';
  }
}

/**
 * 判断一个错误是不是"扩展被关掉了"。
 *
 * 写成接收 `unknown` 的判断函数，而不是到处写 `error instanceof X`：
 * `fatalError` 是在回调里被赋值的，TypeScript 的控制流分析在外层看不到那次
 * 赋值，会把它收窄成 `never`，直接写 `instanceof` 会报类型错误。
 */
function isExtensionDisabledError(
  error: unknown
): error is ExtensionDisabledError {
  return error instanceof ExtensionDisabledError;
}

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
/**
 * 最近一次从 worker 拿到的配置快照（脱敏版）。
 *
 * 记下来是为了能在不等待网络往返的情况下重新判定"这一页是不是还在自动
 * 续翻"，这样上报给弹窗的 `autoContinueArmed` 和页面真正的行为不会错位。
 */
let lastConfigSnapshot: ContentConfigSnapshot | null = null;
/**
 * 最近一次已知的"启用扩展"开关值。
 *
 * 用来发现"从开变成关"这个瞬间：那一刻必须把正在跑的翻译停掉，而不是等
 * 下一张图发请求时才发现。
 */
let lastKnownEnabled: boolean | null = null;
/**
 * The scroll/resize handler that repositions the anchor badges.
 *
 * Saved so `cleanup()` can remove it. `addEventListener` needs the very same
 * function reference to remove the listener.
 */
let anchorRepositionHandler: (() => void) | null = null;
/**
 * Set once the user asks for this page to be translated (popup button, context
 * menu, or the host being on the auto-translate allowlist). Auto-continue is
 * meaningless before that: without it, a page the user never asked about would
 * translate itself as soon as it scrolled.
 */
let pageTranslationRequested = false;
let translationRunInFlight = false;
/**
 * Follow-up scans left before the auto-continue observer stops itself. Seeded
 * whenever the user explicitly asks for the page, so a deliberate translation
 * always gets a full budget.
 */
let autoTranslateRunsRemaining = MAX_AUTO_TRANSLATE_FOLLOW_UP_RUNS;
let failedCount = 0;
let cachedCount = 0;
/**
 * 本页会被翻译的图片数量（最近一次扫描选中的候选）。
 *
 * 翻译结束后依然有效：弹窗要在"已完成"这个状态下告诉用户这一页一共几张，
 * 否则只能显示一个没有分母的数字。
 */
let candidateCount: number | undefined = undefined;
/**
 * 因尺寸/位置不符合要求被过滤掉的图片数。
 *
 * 只算"永远不会被翻译"的那部分。以前这里把"已经翻译过"也算进来，用户看到
 * "跳过 12 张"根本不知道是图片太小，还是这张图早就翻过了。
 */
let skippedCount = 0;
/**
 * 已经翻译过、所以这一次没有再翻译的图片数。
 *
 * 这部分不会再产生费用，单独报出来用户才知道"少的那几张"是什么情况。
 */
let skippedDuplicateCount = 0;
/**
 * Set once the user cancels a run. `cancelTranslation()` nulls the abort
 * controller, so the run's own `abortController?.signal.aborted` check
 * short-circuits to `undefined` and the run used to finish as "complete".
 * This flag is what actually remembers the cancellation.
 */
let translationCancelled = false;
/**
 * 这一轮是被什么中止的。
 *
 * 用户自己按取消，和"用户把扩展关掉了"，对用户来说不是一回事：后者必须
 * 告诉用户已经花掉的钱退不了，但剩下的图不会再发出去。
 */
type AbortReason = 'user' | 'extension-disabled' | null;
let abortReason: AbortReason = null;
/**
 * The promise of the currently running translation, if any.
 *
 * "Force retranslate" has to wait for the previous run to unwind before it
 * can start a new one: the old run holds the mutex and would otherwise make
 * the new one a no-op.
 */
let activeRunPromise: Promise<void> | null = null;
/**
 * Incremented every time a run starts.
 *
 * A run that is being torn down (cancelled, cleared, or superseded by a
 * route change) still reaches its `finally` block, and that block used to
 * release the mutex unconditionally. If a *new* run had already started in
 * the meantime, the old run's `finally` cleared the new run's mutex and the
 * third request could start a duplicate run.
 *
 * The generation lets a run tell "is my mutex still mine?" from "has my
 * mutex been taken over?".
 */
let translationRunGeneration = 0;
const processedImages: Set<string> = new Set();
const failedImageKeys: Set<string> = new Set();
/**
 * The images that failed, so a retry can un-mark them.
 *
 * `isTranslatableImage` rejects any image carrying PROCESSED_CLASS, so
 * forgetting the element means the retry can never pick the image up again.
 *
 * A Set rather than a WeakSet on purpose: the retry has to *iterate* the
 * failed images to strip their class, and a WeakSet is not iterable. The set
 * is cleared at the start of every run and on clear, so it cannot outlive
 * the page's images by more than one run.
 */
const failedImages: Set<HTMLImageElement> = new Set();
const autoTranslateScheduler = createDebouncedAutoTranslate(() => {
  void maybeAutoTranslateNewImages();
});

// ==================== 状态更新 ====================

/**
 * 页面当前的事实。
 *
 * 这些数字不随状态变化：它们描述的是"这一页现在有什么"，所以每一个上报的
 * 状态都带着它们，弹窗不用等到某个特定状态才能拿到。
 */
function currentReport(): ContentStateReport {
  return {
    candidateCount,
    skippedCount,
    skippedDuplicateCount,
    autoContinueArmed: isAutoTranslateEnabled,
    readingPanelVisible: readingPanel?.isVisible() ?? false,
  };
}

function setState(state: ContentState): void {
  // 页面级的事实统一由 report 补齐，保证同一个数字在任何状态下都是同一个
  // 意思：弹窗看到的"跳过 N 张"永远是"因尺寸/位置不合格被过滤掉的 N 张"。
  const reported: ContentState = { ...state, ...currentReport() };
  currentState = reported;

  // 同步 HUD 显示
  if (hud) {
    switch (reported.status) {
      case 'idle':
        hud.update({ status: 'hidden' });
        break;
      case 'scanning':
        hud.update({
          status: 'scanning',
          candidateCount: reported.candidateCount,
        });
        break;
      case 'translating':
        hud.update({
          status: 'translating',
          current: reported.current,
          total: reported.total,
          currentImageIndex: reported.currentImageIndex,
          phase: reported.phase,
        });
        break;
      case 'complete':
        hud.update({
          status: 'complete',
          translatedCount: reported.count,
          failedCount: reported.failedCount ?? 0,
          cachedCount: reported.cachedCount ?? 0,
          skippedCount: reported.skippedCount ?? 0,
          lastError: reported.lastError,
        });
        break;
      case 'error':
        hud.update({
          status: 'error',
          message: reported.message,
          suggestion: reported.suggestion,
          action: reported.action,
        });
        break;
    }
  }

  // 发送状态给 background -> popup
  sendToBackground({ type: 'STATE_UPDATE', state: reported });
}

// ==================== 配置快照 ====================

/**
 * Ask the worker for the redacted configuration.
 *
 * The content script must not hold the API key, and it must not read the
 * persisted config to get it: the persisted form is obfuscated, but the
 * obfuscation is reversible by anyone who has the extension's code. It also
 * must not decide on its own which endpoint is configured — the worker owns
 * the configuration, so the worker owns this answer.
 *
 * The snapshot carries no credential. `hasApiKey` is enough to tell the user
 * "fill in your API key" and to refuse to start a paid request.
 */
async function refreshContentConfig(): Promise<ContentConfigSnapshot | null> {
  const result = await fetchContentConfig();
  if (!result.config) {
    return null;
  }
  lastConfigSnapshot = result.config;
  useContentConfigStore.getState().setConfig(result.config);
  return result.config;
}

/**
 * Apply the overlay style from a snapshot.
 *
 * The style is the only part of the configuration the renderer needs, and it
 * is not a secret.
 */
function applyOverlayStyle(config: ContentConfigSnapshot | null): void {
  if (!config || !renderer) {
    return;
  }
  renderer.updateStyleFromConfig(config.overlayStyle);
}

/**
 * Check that the configured provider is usable, in the worker.
 *
 * The check needs the API key, so it cannot run here: the worker builds the
 * provider from the authoritative configuration and reports back a verdict.
 * Running it there also means the probe follows the same path as the real
 * request — a probe from the page's origin tested a route the translation
 * never takes.
 */
async function probeProviderInWorker(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'PROVIDER_PREFLIGHT',
  })) as { success?: boolean; valid?: boolean; message?: string } | undefined;

  if (!response || response.success !== true || response.valid !== true) {
    throw new Error(response?.message || 'Provider 预检查失败');
  }
}

// ==================== 服务初始化 ====================

async function ensureServicesInitialized(): Promise<void> {
  // 确保 renderer 总是被初始化
  if (!renderer) {
    renderer = getRenderer();
  }
  // 用户在图上点 ✕ 删除译文时，面板和锚点必须跟着删。
  //
  // 以前只有图上的浮层被删掉，面板里那条译文还挂着，徽章也还在说
  // "这张图翻过了"：三个视图说的是三件不同的事。
  renderer.setRemovalListener(image => {
    readingPanel?.remove(image);
    readingAnchors?.remove(image);
  });

  // 首次翻译前创建沉浸式阅读面板与图上编号锚点。
  // 它们只创建一次，整个页面生命周期内复用。
  //
  // 例外：页面把自己的 document.body 换掉时（有些 SPA 会这么干），宿主
  // 元素会被静默地 detach 掉，而引用还在。这时候必须重建，否则面板和
  // 锚点在余下的页面生命周期里永远不可见。
  if (readingPanel && !readingPanel.isAttached()) {
    readingPanel = null;
  }
  if (readingAnchors && !readingAnchors.isAttached()) {
    readingAnchors = null;
  }

  if (!readingPanel) {
    readingPanel = new ReadingPanel();
    // 面板自己的 ✕ 按钮。
    //
    // 面板请求隐藏之后，宿主要把它真的收起来，并把状态报给弹窗：
    // 弹窗上那个按钮写的是"显示译文阅读面板"，而面板还挂在页面上，
    // 按钮和现实对不上。
    readingPanel.hideEventTarget.addEventListener('reading-panel-hide', (() => {
      readingPanel?.setVisible(false);
      setState(currentState);
    }) as EventListener);
  }
  if (!readingAnchors) {
    readingAnchors = new ReadingAnchors();
    // 监听图上编号点击 → 滚动对应 entry 到面板视口 + 闪高亮。
    // 必须挂在 readingAnchors.host 上（事件从锚点 host 冒泡出来），
    // 不能挂在 readingPanel.host 上（两者是兄弟节点，互不冒泡）。
    readingAnchors['host'].addEventListener('reading-anchor-click', ((
      e: Event
    ) => {
      const detail = (e as CustomEvent<{ index: number }>).detail;
      readingPanel?.focusEntryByIndex(detail.index);
    }) as EventListener);
    // 滚动 / 缩放时重新定位所有锚点。
    // 监听函数的引用被保存下来，cleanup() 才能把它们摘掉 —— 否则每次
    // 扩展重载都会在页面上多挂一对监听。
    const reposition = () => readingAnchors?.repositionAll();
    anchorRepositionHandler = reposition;
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition);
  }

  // 重新创建 translator 以获取最新配置
  //
  // 配置来自 worker 的脱敏快照：先刷新，再建 translator，这样 provider、
  // 端点、模型和语言都是当下的设置，而不是页面加载时的那一份。
  await refreshContentConfig();
  translator = createTranslatorFromConfig();

  try {
    await translator.initialize();
    if (import.meta.env.DEV) {
      console.warn('[ContentScript] Translator 初始化成功');
    }
  } catch (error) {
    console.error('[ContentScript] Translator 初始化失败:', error);
    const friendly = parseTranslationError(error);
    setState({
      status: 'error',
      message: `初始化失败: ${friendly.message}`,
      suggestion: friendly.suggestion,
      action: resolveErrorAction(friendly),
    });
    throw error;
  }
}

// ==================== 图片处理 ====================

interface ImageScanResult {
  /** 过滤后真正会被翻译的图片 */
  translatable: HTMLImageElement[];
  /** 页面 img 元素总数（不过滤） */
  total: number;
  /** 已经翻译过、这一次不用再翻译的 */
  skippedDuplicate: number;
  /** 被 isTranslatableImage 过滤掉的（尺寸/位置/类型） */
  skippedFilter: number;
}

// Lazy-load sites (Korean webtoons, etc.) swap src and only the image's
// `load` event fires once bytes arrive. attribute-only MutationObserver misses
// the moment naturalWidth becomes >0, so incomplete-but-valid images were
// filtered and never re-picked up. We attach a one-shot `load` listener to
// candidate-but-incomplete images so a debounced rescan fires as soon as the
// bytes land.
const pendingLoadImages = new WeakSet<HTMLImageElement>();

function scanImages(): ImageScanResult {
  const allImages = Array.from(document.querySelectorAll('img'));
  let skippedFilter = 0;
  let skippedDuplicate = 0;
  const translatable: HTMLImageElement[] = [];

  for (const img of allImages) {
    // 已经翻译过的图先算出来。
    //
    // 它带着"已翻译"标记，而 `isTranslatableImage` 会把带标记的图判为不合格
    // —— 那样它就被算进"尺寸/位置不合格"里了，用户看到"跳过了 12 张"根本
    // 不知道是图太小，还是这张图早就翻过了。两种"跳过"必须分开报。
    if (
      img.classList.contains(PROCESSED_CLASS) ||
      processedImages.has(getImageKey(img))
    ) {
      skippedDuplicate++;
      continue;
    }
    if (!isTranslatableImage(img)) {
      skippedFilter++;
      continue;
    }
    if (!img.complete) {
      // Image passes the filter but bytes haven't arrived yet. Arm a
      // one-shot `load` listener so we re-scan the moment it does.
      if (!pendingLoadImages.has(img)) {
        pendingLoadImages.add(img);
        img.addEventListener(
          'load',
          () => {
            autoTranslateScheduler.schedule();
          },
          { once: true }
        );
      }
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

/**
 * Outcome of translating one image.
 *
 * `processSingleImage` used to return `void` and let the caller guess
 * whether the image had succeeded by watching a `Set` it never touched. The
 * caller then reported "success 0" for a page where every image had
 * translated fine.
 */
interface ImageProcessResult {
  /** The image was translated and its overlay rendered. */
  success: boolean;
  /** The translation came from the local cache (no API call, no cost). */
  cached: boolean;
}

async function processSingleImage(
  img: HTMLImageElement,
  forceRefresh: boolean = false,
  onCacheHit?: (hit: boolean) => void
): Promise<ImageProcessResult> {
  if (!translator || !renderer) {
    throw new Error('Services not initialized');
  }

  // 每张图发请求之前再确认一次主开关。
  //
  // 整批开始时检查一次是不够的：用户在翻译途中关掉开关时，已经排进队列的
  // 请求还会照发不误。这里每张图都问一次 worker，所以关掉开关之后最多只
  // 会多发一张，其余的都停在这里——不会再有新的费用产生。
  //
  // 检查放在打标记之前：这张图没被翻译，就不能留下"已经翻译过"的痕迹。
  if (!(await isMasterSwitchEnabled())) {
    throw new ExtensionDisabledError();
  }

  // The marker goes on before the request, so a concurrent scan does not
  // pick the same image up twice. It has to come off again if the request
  // does not produce a translation.
  //
  // `isTranslatableImage` rejects any image carrying the marker, so a
  // marker left behind by a failed or cancelled translation made that image
  // permanently un-translatable: the only way back was "force retranslate",
  // which re-bills the whole page. The images that had not been reached
  // when the run stopped were exactly the ones the user still needed.
  img.classList.add(PROCESSED_CLASS);

  // The result is needed after the try block, so it is declared here rather
  // than inside it.
  let result: Awaited<ReturnType<TranslatorService['translateImage']>>;
  try {
    result = await translator.translateImage(img, forceRefresh);

    if (onCacheHit) {
      onCacheHit(Boolean(result.cached));
    }

    if (!result.success) {
      throw new Error(result.error || 'Translation failed');
    }

    // The answer arrived after the user pressed cancel, so the run's result
    // is discarded: no overlay, and no marker. A marker left on an image the
    // user never saw translated makes it permanently un-translatable —
    // `isTranslatableImage` rejects any image carrying it.
    if (translationCancelled) {
      throw new Error('Translation cancelled');
    }
  } catch (error) {
    // The image was not translated, so it must not look translated.
    img.classList.remove(PROCESSED_CLASS);
    throw error;
  }

  if (result.textAreas.length === 0) {
    return { success: true, cached: Boolean(result.cached) };
  }

  // 气泡按阅读顺序排一遍。
  //
  // 视觉模型返回的是"它注意到的顺序"，不是读者读的顺序。以前面板直接用它，
  // 于是六句话的漫画在面板里是乱的：读者得自己找"接在上一句后面"的那句。
  const orderedAreas = sortTextAreasByReadingOrder(
    result.textAreas,
    renderer.getStyle().verticalText
  );

  // autoPinned = true: the translation is drawn straight over the artwork.
  // Without it the overlay sits at opacity 0 until the user hovers the image,
  // so a finished translation looks like nothing happened.
  renderer.render(img, orderedAreas, true);

  // 同步到阅读面板 + 图上编号锚点。
  //
  // 面板按图片在 DOM 中的位置插入并编号，插在中间会把后面的编号顶掉一位。
  // 锚点必须立刻跟上：等一批跑完再统一改，用户看到的编号会先错后跳。
  const entryIndex = readingPanel?.upsert(img, orderedAreas);
  if (entryIndex !== undefined) {
    readingAnchors?.upsert(img, entryIndex);
    readingAnchors?.syncIndices(readingPanel?.getIndexByImage() ?? new Map());
  }

  return { success: true, cached: Boolean(result.cached) };
}

/**
 * Decide whether this page should translate itself, and start or stop the
 * observer accordingly.
 *
 * Two independent reasons to auto-translate:
 *   - the host is on the user's auto-translate allowlist, or
 *   - the user already translated this page, in which case new images that
 *     load later should follow (the original "auto-continue").
 *
 * The master switch and the auto-continue setting still gate both.
 */
async function syncAutoTranslateMode(): Promise<void> {
  applyAutoTranslateMode(await refreshContentConfig());
}

/**
 * Arm or disarm the auto-translate observer from a configuration snapshot.
 *
 * The snapshot is the worker's redacted view of the configuration. The
 * master switch, the auto-continue setting and the host allowlist are all
 * read from it, so a content script can never arm a paid action on its own.
 */
function applyAutoTranslateMode(config: ContentConfigSnapshot | null): void {
  if (!config) {
    isAutoTranslateEnabled = false;
    stopAutoTranslateObserver();
    return;
  }

  // 主开关的变化要先处理：它决定的是"还要不要继续花钱"。
  handleEnabledChange(config.enabled);

  const allowlisted =
    typeof window !== 'undefined' &&
    hostMatchesAllowlist(window.location.href, config.autoTranslateHosts);

  isAutoTranslateEnabled =
    config.enabled &&
    config.autoContinueEnabled &&
    (allowlisted || pageTranslationRequested);

  if (isAutoTranslateEnabled) {
    startAutoTranslateObserver();
  } else {
    stopAutoTranslateObserver();
  }
}

/**
 * 处理"启用扩展"这个主开关的变化。
 *
 * 用户在弹窗里把它关掉时，页面上正在跑的那批翻译必须立刻停下。弹窗上写着
 * "关闭后不会请求任何模型"，而实际行为是那批请求还在继续发——用户以为停了，
 * 账单却还在涨。
 *
 * 只有"从开变成关"才会中止：扩展本来就是关的时候（比如用户只是改了别的
 * 设置），没有正在跑的翻译，也不该凭空弹一个错误。真的在跑的时候才中止，
 * 并且告诉用户发生了什么。
 */
function handleEnabledChange(enabled: boolean): void {
  const wasEnabled = lastKnownEnabled;
  lastKnownEnabled = enabled;

  if (wasEnabled === true && enabled === false && isTranslationActive()) {
    cancelTranslation('extension-disabled');
  }
}

/**
 * 现在有没有翻译正在跑。
 *
 * 没有在跑的时候中止它没有意义——中止了也没有请求可以撤回来，只会让用户
 * 看到一个吓人的错误提示。
 */
function isTranslationActive(): boolean {
  return (
    translationRunInFlight ||
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  );
}

async function maybeAutoTranslateNewImages(): Promise<void> {
  const pendingImages = findTranslatableImages();
  if (
    shouldAutoTranslateFollowUp({
      enabled: isAutoTranslateEnabled,
      status: currentState.status,
      hasPendingImages: pendingImages.length > 0,
      runsRemaining: autoTranslateRunsRemaining,
    })
  ) {
    // translatePage owns spending the budget and stopping the observer once it
    // runs out, so a run blocked by its mutex cannot leak a charge.
    await translatePage(false, 'follow-up');
  }
}

function startAutoTranslateObserver(): void {
  if (autoTranslateObserver) {
    return;
  }

  autoTranslateObserver = new MutationObserver(mutations => {
    const hasNewImages = mutations.some(mutation => {
      // Lazy-loaders swap src/data-src on an existing <img> without adding
      // DOM nodes. Image only becomes translatable once it is complete, so
      // key off the new src to detect an untouched, ready image.
      if (
        mutation.type === 'attributes' &&
        mutation.target instanceof HTMLImageElement
      ) {
        const img = mutation.target;
        return (
          isTranslatableImage(img) && !processedImages.has(getImageKey(img))
        );
      }

      return Array.from(mutation.addedNodes).some(node => {
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
      });
    });

    if (hasNewImages) {
      autoTranslateScheduler.schedule();
    }
  });

  // childList catches newly added <img> nodes; attributes catches lazy
  // loaders that swap src/data-src on an existing <img>. subtree covers
  // images inside containers. The debounced schedule re-scans ~800ms later,
  // by which point the swapped image is usually complete.
  autoTranslateObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'srcset'],
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
 * Ask the worker whether the extension is switched on.
 *
 * The popup says "closing the extension means no model is ever called", so
 * the check has to live on the path that actually calls the model — not only
 * in the popup UI, which the context menu and a hand-crafted message can
 * bypass.
 *
 * The worker is the authority: it owns the configuration, and it re-checks
 * the switch itself before it lets a job run.
 */
async function isMasterSwitchEnabled(): Promise<boolean> {
  const config = await refreshContentConfig();
  if (!config) {
    // If the worker cannot be reached we cannot prove the user enabled the
    // extension. Fail closed: an unknown config must not become a paid API
    // call.
    return false;
  }
  return config.enabled === true;
}

/**
 * Does this error mean the whole run should stop?
 *
 * A wrong API key or a throttled provider fails identically for every image
 * on the page. Running the rest of the queue burns the user's money to
 * collect the same error 19 more times.
 */
function isFatalTranslationError(message: string): boolean {
  return FATAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * 整页翻译
 *
 * `retryImages` restricts the run to a given set of images. It is how the
 * "retry the failed images" action works: the page is not re-scanned and the
 * images that already succeeded are not touched, so the user only pays for
 * the images that actually failed.
 */
async function translatePage(
  forceRefresh: boolean = false,
  origin: 'user' | 'follow-up' = 'user',
  retryImages?: HTMLImageElement[]
): Promise<void> {
  if (import.meta.env.DEV) {
    console.warn('[ContentScript] translatePage 开始执行');
  }

  // An explicit request refills the follow-up budget: asking again is the
  // signal that continued auto-translation is wanted, and only the observer's
  // own re-entries should spend it.
  if (origin === 'user') {
    autoTranslateRunsRemaining = MAX_AUTO_TRANSLATE_FOLLOW_UP_RUNS;
  }

  // 翻译进行中的互斥：直接用 currentState 判断，不再维护冗余的 isTranslating 布尔
  if (
    translationRunInFlight ||
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  ) {
    if (import.meta.env.DEV) {
      console.warn('[ContentScript] 翻译已在进行中');
    }
    return;
  }

  // Reserve the mutex synchronously, before the first await. READY and
  // tabs.onUpdated can both send TRANSLATE_PAGE in the same tick; if the
  // reservation happened after the await inside `runTranslation`, both would
  // pass the check above and translate the page twice.
  translationRunInFlight = true;
  translationRunGeneration += 1;
  const generation = translationRunGeneration;

  const run = runTranslation(forceRefresh, origin, generation, retryImages);
  // The handle is published before the first await inside `runTranslation`,
  // so "force retranslate" can always find the run it has to wait for.
  activeRunPromise = run;
  try {
    await run;
  } finally {
    // Only clear the handle if this is still the current run: a
    // "force retranslate" chains a second run behind this one.
    if (activeRunPromise === run) {
      activeRunPromise = null;
    }
  }
}

/**
 * The body of a translation run.
 *
 * Split out of `translatePage` so the whole run — including the master
 * switch check — is covered by a single promise. "Force retranslate" waits
 * on that promise before starting the next run, which is what keeps the two
 * runs from overlapping on the mutex.
 */
async function runTranslation(
  forceRefresh: boolean,
  origin: 'user' | 'follow-up',
  generation: number,
  retryImages?: HTMLImageElement[]
): Promise<void> {
  try {
    // 纵深防御：主开关关闭时不做任何事。
    //
    // Popup 上写着"关闭后不会请求任何模型"，所以这个检查必须落在真正调用
    // 模型的路径上，而不是只在 Popup UI 里 —— 右键菜单和直接发消息都能
    // 绕过 UI。
    //
    // 这一步刻意不碰 `pageTranslationRequested`：用户要求过翻译这个事实
    // 应该保留，否则"关闭再打开"会让用户必须重新点一次。
    if (!(await isMasterSwitchEnabled())) {
      setState({
        status: 'error',
        message: '扩展已关闭，请先在弹窗中开启「启用扩展」',
        suggestion: '开启后即可翻译当前页面',
        action: { type: 'open-settings', label: '打开设置' },
      });
      return;
    }

    // A new run starts from a clean slate: a previous run's cancellation must
    // not make this one look cancelled.
    translationCancelled = false;
    abortReason = null;
    // Charged only now that the run is committed, so a follow-up blocked by
    // the mutex does not burn budget for a run that never happened.
    if (origin === 'follow-up') {
      autoTranslateRunsRemaining -= 1;
      if (autoTranslateRunsRemaining <= 0) {
        stopAutoTranslateObserver();
      }
    }
    // From here on the user wants this page translated, so newly loaded images
    // should follow. This is what arms auto-continue for a page that is not
    // on the auto-translate allowlist.
    pageTranslationRequested = true;
    // Re-evaluate the observer now that this page counts as requested; on a
    // host that is not allowlisted this is the moment auto-continue arms.
    //
    // 先用最近一次已知的配置同步判定一次：这样本次运行上报的
    // `autoContinueArmed` 就是真的值，弹窗不会显示"未开启"而页面其实已经
    // 在自动续翻。紧接着的异步刷新会把配置更新到最新。
    applyAutoTranslateMode(lastConfigSnapshot);
    void syncAutoTranslateMode();
    abortController = new AbortController();

    await ensureServicesInitialized();
    if (import.meta.env.DEV) {
      console.warn('[ContentScript] 服务初始化完成');
    }

    // v1.1.1: pre-flight provider health check (especially Ollama origin
    // policy). If the provider is misconfigured (e.g. OLLAMA_ORIGINS not
    // whitelisting the extension origin), fail fast with one clear error
    // instead of running every image and reporting 5 duplicates.
    //
    // The probe runs in the worker: it needs the API key, and it has to
    // follow the same origin the real request will follow.
    try {
      await probeProviderInWorker();
    } catch (probeError) {
      const friendly = parseTranslationError(probeError);
      console.error('[ContentScript] 翻译预检查失败:', friendly.message);
      setState({
        status: 'error',
        message: friendly.message,
        suggestion: friendly.suggestion,
        action: resolveErrorAction(friendly),
      });
      return;
    }

    // 扫描阶段：把"这一页有几张图""为什么少了几张"也告诉用户。
    //
    // 重试失败图片时不需要重新扫描页面：调用方已经指定了要重跑的那几张，
    // 扫整页只会把没问题的图片再算一遍。
    let images: HTMLImageElement[];
    if (retryImages) {
      images = retryImages;
    } else {
      const scan = scanImages();
      // 两种"跳过"是两回事，必须分开报：
      // - skippedCount：尺寸/位置不合格，永远不会被翻译；
      // - skippedDuplicateCount：已经翻译过，这一次不用再花钱。
      skippedCount = scan.skippedFilter;
      skippedDuplicateCount = scan.skippedDuplicate;
      // 本页的候选数量。翻译结束后它依然有效，弹窗靠它说清"这一页一共
      // 几张"，而不是只给一个没有分母的"完成 8 张"。
      candidateCount = scan.translatable.length;
      images = getViewportFirstImages(scan.translatable);
      if (import.meta.env.DEV) {
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
      }
    }

    setState({ status: 'scanning' });

    if (images.length === 0) {
      if (import.meta.env.DEV) {
        console.warn('[ContentScript] 没有找到可翻译的图片');
      }
      setState({
        status: 'complete',
        count: 0,
        failedCount: 0,
        cachedCount: 0,
      });
      return;
    }

    const config = useContentConfigStore.getState();
    const parallelLimit = clampPageTranslationConcurrency(
      config.parallelLimit || 3
    );
    const total = images.length;
    let current = 0;
    let currentImageIndex = 0;
    let successCount = 0;
    failedCount = 0;
    cachedCount = 0;
    if (retryImages) {
      // The retry owns the failure list: the images it is about to run are
      // taken out of it now, and the ones that fail again are put back by
      // `onError`. The images that were not reached at all are put back
      // after the run.
      for (const img of retryImages) {
        failedImages.delete(img);
        failedImageKeys.delete(getImageKey(img));
      }
    } else {
      failedImageKeys.clear();
      failedImages.clear();
    }
    /**
     * The reason the first image failed. The upstream translator folds every
     * provider error into one message, so this string is the only place the
     * root cause ("API key invalid", "rate limited") ever surfaces.
     */
    let firstErrorMessage: string | undefined;
    /**
     * A fatal error (auth, rate limit) aborts the run. The remaining images
     * would fail identically and cost the user money.
     */
    let fatalError: Error | null = null;

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
      onError: (error, index) => {
        // A cancelled run is not a failed run.
        //
        // When the user cancels, the abort signal fires and the in-flight
        // workers throw. Counting those as failures reported "失败 12 张"
        // for a run the user deliberately stopped, and put the untouched
        // images into the retry list — so the "retry failed images" button
        // would offer to re-translate images that had never failed.
        if (translationCancelled || abortController?.signal.aborted) {
          return;
        }
        // "扩展被关掉了"不是某一张图失败，是整轮翻译都不该再继续：剩下的图
        // 再发请求就是继续扣费。立刻停掉，并让用户知道发生了什么。
        if (error instanceof ExtensionDisabledError) {
          fatalError = error;
          abortController?.abort();
          return;
        }
        failedCount++;
        const img = images[index];
        if (img) {
          failedImageKeys.add(getImageKey(img));
          failedImages.add(img);
        }
        if (!firstErrorMessage) {
          // The friendly message turns a raw provider string ("401
          // unauthorized") into something the user can act on ("API 密钥无效，
          // 请检查配置").
          firstErrorMessage = parseTranslationError(error).message;
        }
        if (!fatalError && isFatalTranslationError(error.message)) {
          fatalError = error;
          // Stop the remaining images: they would fail the same way.
          abortController?.abort();
        }
      },
    };

    await processInParallel(
      images,
      async img => {
        if (abortController?.signal.aborted) {
          throw new Error('Translation cancelled');
        }
        const result = await processSingleImage(img, forceRefresh, hit => {
          if (hit) cachedCount++;
        });
        if (result.success) {
          successCount++;
        }
        processedImages.add(getImageKey(img));
      },
      options
    );

    if (retryImages) {
      // A retry that was cut short must not lose its failure list: the
      // images that were never reached are still untranslated, so they stay
      // on the list the user can retry again.
      for (const img of retryImages) {
        const key = getImageKey(img);
        if (!processedImages.has(key) && !failedImages.has(img)) {
          failedImages.add(img);
          failedImageKeys.add(key);
        }
      }
    }

    // 整批完成后统一按 DOM 位置重排编号。
    //
    // 翻译是并发跑的，完成顺序 = 视口优先级，不是阅读顺序。面板编号
    // 必须来自 DOM 位置，锚点编号跟着一起改。
    if (readingPanel) {
      readingPanel.reindex();
      readingAnchors?.syncIndices(readingPanel.getIndexByImage());
    }

    if (fatalError) {
      if (isExtensionDisabledError(fatalError)) {
        // 用户把扩展关掉了：这不是"某张图翻译失败"，必须说清楚已经花掉的
        // 钱退不了、但剩下的图不会再发请求。
        console.error('[ContentScript] 翻译中止:', EXTENSION_DISABLED_MESSAGE);
        setState({
          status: 'error',
          message: EXTENSION_DISABLED_MESSAGE,
          suggestion: EXTENSION_DISABLED_SUGGESTION,
          action: { type: 'open-settings', label: '打开设置' },
        });
        return;
      }
      const friendly = parseTranslationError(fatalError);
      console.error('[ContentScript] 翻译中止:', friendly.message);
      setState({
        status: 'error',
        message: friendly.message,
        suggestion: friendly.suggestion,
        action: resolveErrorAction(friendly),
      });
      return;
    }

    // 取消优先于"完成"：`cancelTranslation()` 会把 abortController 置空，
    // 光看 `abortController?.signal.aborted` 会短路成 undefined，从而
    // 把一次取消报成"翻译完成"。
    if (translationCancelled || abortController?.signal.aborted) {
      if (abortReason === 'extension-disabled') {
        // 用户在翻译途中关掉了扩展：这次中止要说明白，而不是安静地回到
        // "空闲"，否则用户以为翻译已经完成。
        setState({
          status: 'error',
          message: EXTENSION_DISABLED_MESSAGE,
          suggestion: EXTENSION_DISABLED_SUGGESTION,
          action: { type: 'open-settings', label: '打开设置' },
        });
        return;
      }
      setState({ status: 'idle' });
      return;
    }

    setState({
      status: 'complete',
      count: successCount,
      failedCount,
      cachedCount,
      lastError: firstErrorMessage,
    });
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 翻译流程失败:', friendly.message);
    setState({
      status: 'error',
      message: friendly.message,
      suggestion: friendly.suggestion,
      action: resolveErrorAction(friendly),
    });
  } finally {
    // The mutex is released here for every exit path, including the
    // "extension is disabled" early return. A rejected call that kept the
    // flag set would block the user's first translation after they switch
    // the extension back on.
    //
    // Only if the mutex is still ours: a run that was superseded (cancelled,
    // cleared, or replaced by a route change) must not release the mutex of
    // the run that took over from it.
    if (translationRunGeneration === generation) {
      translationRunInFlight = false;
      abortController = null;
    }
  }
}

/**
 * 取消正在进行的翻译
 *
 * `reason` 区分两种中止：用户自己按的取消，和用户把"启用扩展"关掉了。
 * 后者必须告诉用户已经花掉的钱退不了、但剩下的图不会再发，否则用户以为
 * 页面已经翻译完了。
 */
function cancelTranslation(reason: AbortReason = 'user'): void {
  // The flag is what makes the run report "cancelled" instead of
  // "complete": `cancelTranslation` nulls the controller, so the run's own
  // `abortController?.signal.aborted` check would short-circuit to
  // `undefined` and fall through to the success path.
  translationCancelled = true;
  abortReason = reason;
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (reason === 'extension-disabled') {
    setState({
      status: 'error',
      message: EXTENSION_DISABLED_MESSAGE,
      suggestion: EXTENSION_DISABLED_SUGGESTION,
      action: { type: 'open-settings', label: '打开设置' },
    });
  } else {
    setState({ status: 'idle' });
  }
  // 通知 popup 取消成功，按钮状态需要更新
  sendToBackground({ type: 'HUD_CANCELLED' });
}

/**
 * 清除所有覆盖层
 */
function clearAll(): void {
  cancelTranslation();

  // The mutex is released here, not only in translatePage's `finally`:
  // `clearAll` can be called on its own (the popup's "clear" button), and
  // leaving the flag set would block the next translation.
  //
  // The generation is bumped so the run that is still unwinding does not
  // release a mutex that a newer run has already claimed.
  translationRunGeneration += 1;
  translationRunInFlight = false;
  translationCancelled = false;
  abortReason = null;

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

  // Clearing drops the processed-image record, so every image on the page now
  // looks new. Leaving auto-translate armed would immediately re-translate the
  // whole page the user just cleared — a surprising bill. Auto-translate on
  // an allowlisted host re-arms on the next navigation; elsewhere it re-arms
  // when the user translates again.
  pageTranslationRequested = false;
  void syncAutoTranslateMode();

  setState({ status: 'idle' });
}

// ==================== 消息处理 ====================

/**
 * Find the image a context-menu request refers to.
 *
 * The context menu hands us the URL of the image the user right-clicked.
 * Matching it back to a DOM element is not as simple as comparing `img.src`,
 * because the two strings are not always identical:
 *
 *   - The page may use a relative `src`, so `img.src` is absolute while the
 *     menu reports whatever the browser resolved (also absolute, but the two
 *     can differ in trailing-slash or encoding form).
 *   - The page may set `srcset` and let the browser pick a candidate, in
 *     which case `img.currentSrc` — not `img.src` — is what is displayed.
 *   - Some sites serve the same image under several URLs (a CDN host with a
 *     version query string, a resized derivative).
 *
 * So the search runs in three passes, from the most precise to the most
 * forgiving: an exact match on the resolved URL, then a match on the URL
 * with its query string removed, and finally a match on the file path
 * alone. Only if all three fail does it fall back to the closest image by
 * natural size, which is the best guess available at that point.
 */
function findImageByUrl(imageUrl: string): HTMLImageElement | null {
  const images = Array.from(document.querySelectorAll('img'));
  if (images.length === 0) {
    return null;
  }

  const normalize = (value: string): string => {
    try {
      const parsed = new URL(value, document.baseURI);
      return parsed.href;
    } catch {
      return value;
    }
  };

  const stripQuery = (value: string): string => {
    try {
      const parsed = new URL(value, document.baseURI);
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch {
      return value.split('?')[0]?.split('#')[0] ?? value;
    }
  };

  const target = normalize(imageUrl);
  const targetWithoutQuery = stripQuery(imageUrl);

  // Pass 1 and 2: the URL itself, then the URL without its query string.
  for (const img of images) {
    const candidates = [img.currentSrc, img.src].filter(Boolean);
    for (const candidate of candidates) {
      const resolved = normalize(candidate);
      if (resolved === target || stripQuery(candidate) === targetWithoutQuery) {
        return img;
      }
    }
  }

  // Pass 3: same file path, different query string.
  for (const img of images) {
    const candidates = [img.currentSrc, img.src].filter(Boolean);
    for (const candidate of candidates) {
      if (stripQuery(candidate) === targetWithoutQuery) {
        return img;
      }
    }
  }

  // Fallback: the image whose rendered size is closest to the requested
  // one. `info.srcUrl` carries no dimensions, so this is the only signal
  // left, and it is better than refusing outright.
  const requested = new URL(imageUrl, document.baseURI);
  const requestedName = decodeURIComponent(
    requested.pathname.split('/').pop() ?? ''
  );
  if (requestedName) {
    for (const img of images) {
      const name = decodeURIComponent(
        (img.currentSrc || img.src).split('/').pop()?.split('?')[0] ?? ''
      );
      if (name && name === requestedName) {
        return img;
      }
    }
  }

  return null;
}

/**
 * Translate one image, on its own, without touching the rest of the page.
 *
 * The right-click menu offers "translate this image". The request arrives
 * here with a URL, and the whole page is not the unit of work: the user
 * pointed at one image, so only that image should be translated, and only
 * that image should cost money.
 */
async function translateSingleImage(imageUrl: string): Promise<void> {
  if (!(await isMasterSwitchEnabled())) {
    setState({
      status: 'error',
      message: '扩展已关闭，请先在弹窗中开启「启用扩展」',
      suggestion: '开启后即可翻译当前页面',
      action: { type: 'open-settings', label: '打开设置' },
    });
    return;
  }

  const img = findImageByUrl(imageUrl);
  if (!img) {
    setState({
      status: 'error',
      message: '找不到这张图片，它可能已经不在页面上了',
      suggestion: '刷新页面后重试',
    });
    return;
  }

  await ensureServicesInitialized();

  setState({
    status: 'translating',
    current: 0,
    total: 1,
    currentImageIndex: 1,
    phase: 'translating',
  });

  try {
    const result = await processSingleImage(img);
    processedImages.add(getImageKey(img));
    setState({
      status: 'complete',
      count: result.success ? 1 : 0,
      failedCount: result.success ? 0 : 1,
      cachedCount: result.cached ? 1 : 0,
    });
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 单图翻译失败:', friendly.message);
    setState({
      status: 'error',
      message: friendly.message,
      suggestion: friendly.suggestion,
      action: resolveErrorAction(friendly),
    });
  }
}

/**
 * Show or hide the reading panel.
 *
 * The panel is created lazily on the first translation, so the shortcut has
 * to be able to create it on demand — otherwise pressing it before the first
 * translation would do nothing, which is exactly when a user would try it.
 */
async function toggleReadingPanel(): Promise<void> {
  try {
    if (!readingPanel || !readingPanel.isAttached()) {
      await ensureServicesInitialized();
    }
    if (!readingPanel) {
      return;
    }
    readingPanel.setVisible(!readingPanel.isVisible());
    // 重新上报一次状态：弹窗要知道阅读面板现在是开着还是关着，否则它显示的
    // 按钮状态和页面上的实际情况对不上。
    setState(currentState);
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 切换阅读面板失败:', friendly.message);
  }
}

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
  request: PopupToContentMsg | BackgroundToContentMsg,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: {
    success: boolean;
    error?: string;
    state?: ContentState;
    count?: number;
  }) => void
): boolean {
  if (import.meta.env.DEV) {
    console.warn('[ContentScript] 收到消息:', request.type);
  }

  switch (request.type) {
    case 'GET_STATE':
      sendResponse({ success: true, state: currentState });
      break;

    case 'CONFIG_UPDATED': {
      // The worker pushed a fresh redacted snapshot. The stored config is
      // never read here: it holds the (obfuscated) API key, and a content
      // script has no business holding that.
      translator = null;
      lastConfigSnapshot = request.config;
      useContentConfigStore.getState().setConfig(request.config);
      applyOverlayStyle(request.config);
      // `applyAutoTranslateMode` 也会发现主开关被关掉，并把正在跑的翻译停掉。
      applyAutoTranslateMode(request.config);
      sendResponse({ success: true });
      break;
    }

    case 'COUNT_IMAGES': {
      // 纯只读扫描：告诉弹窗"这一页还有多少张图会被翻译"。
      //
      // 不发任何请求、不改任何状态、不写缓存——它只是把 `scanImages()`
      // 数出来的候选数量报回去，所以用户在看价格之前不会因为"看一眼"而
      // 多花一分钱。
      const count = scanImages().translatable.length;
      sendResponse({ success: true, count });
      break;
    }

    case 'FORCE_RETRANSLATE_FAILED': {
      // Only the images that failed are retried. The page is not cleared
      // and the images that translated fine are not paid for twice.
      const count = retranslateFailedImages();
      sendResponse({ success: true, count });
      break;
    }

    case 'TRANSLATE_PAGE':
      translatePage()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'FORCE_RETRANSLATE_PAGE':
      // Serialise: the previous run still holds the mutex, and `clearAll`
      // only aborts it — the abort is observed asynchronously. Starting the
      // new run immediately would hit the mutex and silently do nothing,
      // leaving the user with an empty page and no new translation.
      void (async () => {
        // Wait for the in-flight run to unwind so it releases the mutex.
        const previous = activeRunPromise;
        if (previous) {
          await previous.catch(() => undefined);
        }
        clearAll();
        await translatePage(true);
      })()
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

    case 'TOGGLE_READING_PANEL':
      toggleReadingPanel()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'DISARM_PAGE_AUTO_TRANSLATE': {
      // 用户不想让这一页继续自动翻译。
      //
      // 只清掉"用户手动翻译过这一页"这一条依据：站点白名单是站点级的设置，
      // 归弹窗里那个「自动翻译本站」开关管，页面这边不替用户改。
      //
      // 改完要立刻重算，否则弹窗上"本页会自动翻译"的提示会一直亮着，
      // 而页面其实已经不翻译了。
      pageTranslationRequested = false;
      applyAutoTranslateMode(lastConfigSnapshot);
      setState(currentState);
      sendResponse({ success: true });
      break;
    }

    case 'TRANSLATE_SINGLE_IMAGE':
      translateSingleImage(request.imageUrl)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
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
    // 配置变更时重置 translator，下次使用时重新初始化
    translator = null;

    // The stored value is not read here: it holds the (obfuscated) API key,
    // and a content script has no business holding that. The worker sends
    // the redacted snapshot instead, and this listener only says "something
    // changed, go ask".
    void (async () => {
      const config = await refreshContentConfig();

      // 更新 renderer 样式
      applyOverlayStyle(config);

      // The auto-translate mode is re-derived from the full config, not from
      // the master switch alone.
      //
      // Reading only `enabled` here meant that *any* settings write — the
      // target language, the overlay style, the API key — turned
      // auto-translate on in every open tab, on pages the user never asked
      // to translate. That is a paid action taken without consent.
      //
      // `applyAutoTranslateMode` re-reads all three inputs (master switch,
      // auto-continue, host allowlist) plus the "the user asked for this
      // page" flag, and it starts or stops the observer accordingly.
      //
      // 它同时会发现主开关被关掉，并把正在跑的那批翻译停掉：用户在弹窗里
      // 关掉开关时，页面这边必须立刻停下来，而不是继续发请求。
      applyAutoTranslateMode(config);
    })();

    // Deliberately no `autoTranslateScheduler.schedule()` here: a config
    // change is not a request to translate this page. Scheduling a rescan
    // would translate the page (and bill for it) as a side effect of the
    // user opening the options page.
  }
}

// ==================== HUD 事件监听 ====================

function handleHudCancel(): void {
  cancelTranslation();
}

/**
 * Re-run the translation for the images that failed, and only for them.
 *
 * The popup shows "重新翻译失败的 N 张" and asks for a cost confirmation
 * first, so the run has to touch exactly those images: the page is not
 * cleared, the page is not re-scanned, and the images that already
 * translated are not sent to the provider a second time.
 *
 * Returns how many images the retry will run, so the caller can tell the
 * user what it is about to pay for.
 */
function retranslateFailedImages(): number {
  const targets = Array.from(failedImages).filter(img => img.isConnected);

  if (targets.length === 0) {
    return 0;
  }

  // The image also has to lose PROCESSED_CLASS: `isTranslatableImage`
  // rejects any image that still carries it, so without this the retry
  // finds nothing to do and the button looks broken.
  for (const img of targets) {
    img.classList.remove(PROCESSED_CLASS);
    processedImages.delete(getImageKey(img));
  }

  // Wait for any run that is still unwinding: it holds the mutex, and a
  // retry that arrives while it does would be refused silently — the button
  // would look as broken as it did before this fix.
  void (async () => {
    const previous = activeRunPromise;
    if (previous) {
      await previous.catch(() => undefined);
    }
    await translatePage(true, 'user', targets);
  })();

  return targets.length;
}

function handleRetryFailed(): void {
  if (
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  ) {
    return;
  }
  retranslateFailedImages();
}

/**
 * 根据当前 provider 配置，定制 friendly error 的 action.command。
 * 让 "copy-command" 按钮直接复制用户能跑的命令，而不是通用模板。
 *
 * 例如 MODEL_NOT_FOUND 默认的 command 是 "ollama pull <model>"，
 * 这里会替换为 "ollama pull qwen3-vl:8b"，并且只在 Ollama 后端下生效
 * （OpenAI-compatible / LM Studio 的模型不在用户本机，
 *   误显示 ollama pull 会误导，改为 open-settings）。
 */
function resolveErrorAction(friendly: FriendlyError): ErrorAction | undefined {
  const action = friendly.action;
  if (!action || action.type !== 'copy-command' || !action.command) {
    return action;
  }
  if (friendly.code !== TranslationErrorCode.MODEL_NOT_FOUND) {
    return action;
  }
  const state = useContentConfigStore.getState();
  // 非 Ollama 后端的 "model not found" 没法用 ollama pull 修复，
  // 改为 open-settings 让用户换模型。
  if (state.provider !== 'ollama') {
    return { type: 'open-settings', label: '打开设置' };
  }
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
    void chrome.runtime
      .sendMessage({ action: 'openOptionsPage' })
      .catch(() => undefined);
  } else if (detail.type === 'copy-command') {
    const command = detail.command;
    if (command) {
      void navigator.clipboard.writeText(command).then(
        () => {
          if (import.meta.env.DEV) {
            console.warn('[ContentScript] 已复制修复命令到剪贴板');
          }
        },
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

// ==================== SPA 路由变化 ====================

/**
 * How often the URL is polled for a SPA route change.
 *
 * 400ms is well under the time a reader needs to notice that the chapter
 * changed, and the check itself is a string comparison.
 */
const ROUTE_WATCH_INTERVAL_MS = 400;

/**
 * The URL the page was on when we last looked.
 */
let lastKnownUrl = '';

/**
 * The poller that detects SPA route changes.
 */
let routeWatchTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Drop everything tied to the previous chapter.
 *
 * On a SPA the page replaces its own DOM, but our overlays, the reading
 * panel and the anchor badges still hold references to the *old* images.
 * That leaks the previous chapter's DOM and makes the panel's "scroll to
 * image" a no-op, because the node it holds is no longer in the document.
 *
 * The translation cache is deliberately kept: the next chapter usually
 * reuses the same panels, and the cache is what keeps that free.
 */
function handleRouteChange(): void {
  // A running translation is about the old DOM; abort it.
  cancelTranslation();
  translationRunGeneration += 1;
  translationRunInFlight = false;
  translationCancelled = false;
  abortReason = null;

  if (renderer) {
    renderer.removeAll();
  }
  removeAllOverlaysFromDOM();

  readingPanel?.reset();
  readingAnchors?.reset();

  processedImages.clear();
  failedImageKeys.clear();
  failedImages.clear();
  document.querySelectorAll(`.${PROCESSED_CLASS}`).forEach(img => {
    img.classList.remove(PROCESSED_CLASS);
  });

  // The user asked for *this* page to be translated. After a route change
  // that is a different page: the request does not carry over, so
  // auto-translate must not fire on the new chapter until the user asks
  // again (or the new host is on the allowlist).
  pageTranslationRequested = false;
  void syncAutoTranslateMode();

  setState({ status: 'idle' });
}

/**
 * Act on a route change, but only once per actual URL change.
 *
 * `popstate` and the poller can both fire for the same navigation, so the
 * URL is the single source of truth for "did the route change".
 */
function checkRouteChange(): void {
  const current = window.location.href;
  if (current === lastKnownUrl) {
    return;
  }
  lastKnownUrl = current;
  handleRouteChange();
}

/**
 * Detect SPA route changes.
 *
 * A SPA that calls `history.pushState` changes the URL without navigating,
 * and without reloading the document — so the content script's DOM
 * references (overlays, panel entries, anchor badges) all keep pointing at
 * the *previous* chapter.
 *
 * The obvious fix is to wrap `history.pushState`, but a content script runs
 * in an isolated world: it has its own `History.prototype`, so the page's
 * own calls never go through the wrapper. Wrapping it would silently do
 * nothing. Polling `location.href` does work, because the isolated world
 * shares the document's URL with the page.
 */
function setupRouteChangeListener(): void {
  lastKnownUrl = window.location.href;
  window.addEventListener('popstate', checkRouteChange);
  if (routeWatchTimer === null) {
    routeWatchTimer = setInterval(checkRouteChange, ROUTE_WATCH_INTERVAL_MS);
  }
}

/**
 * One-shot route check, exported for tests.
 *
 * The poller runs on a timer, which a test cannot wait for without
 * fake timers. This is the same code path the poller calls.
 */
function checkRouteChangeOnce(): void {
  checkRouteChange();
}

// ==================== 初始化 ====================

async function initialize(): Promise<void> {
  if (import.meta.env.DEV) {
    console.warn('[ContentScript] Manga Translator v2 初始化');
  }

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

    // SPA 路由变化：切章后清掉上一章的覆盖层/面板/锚点
    setupRouteChangeListener();

    // 页面卸载时清理
    window.addEventListener('beforeunload', cleanup);

    // 通知 background 已就绪
    sendToBackground({ type: 'READY' });

    if (import.meta.env.DEV) {
      console.warn('[ContentScript] 初始化完成');
    }
  } catch (error) {
    console.error('[ContentScript] 初始化失败:', error);
  }
}

function cleanup(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  translationRunGeneration += 1;
  translationRunInFlight = false;
  translationCancelled = false;
  if (renderer) {
    // dispose() also releases the ResizeObserver and the window resize
    // listener; removeAll() alone would leave both attached to the page.
    renderer.dispose();
    // Drop the reference. `ensureServicesInitialized` only calls getRenderer()
    // when this is null, so keeping a disposed instance would hand the next run
    // a renderer with no observer and no resize listener — overlays would stop
    // following the art with nothing logged.
    renderer = null;
  }
  if (hud) {
    hud.destroy();
    hud = null;
  }
  // The reading panel and the anchor badges are DOM we injected into the
  // page. Leaving them behind would keep the previous chapter's images
  // alive and keep our handlers wired to a page that is going away.
  readingPanel?.destroy();
  readingPanel = null;
  readingAnchors?.destroy();
  readingAnchors = null;
  if (anchorRepositionHandler) {
    window.removeEventListener('scroll', anchorRepositionHandler);
    window.removeEventListener('resize', anchorRepositionHandler);
    anchorRepositionHandler = null;
  }
  stopAutoTranslateObserver();
  processedImages.clear();
  failedImageKeys.clear();
  failedImages.clear();
  // A cleanup that throws leaves the page half-torn-down, and it runs on
  // unload where the error would be invisible. Every removal is guarded:
  // the extension context may already be gone.
  chrome.runtime.onMessage?.removeListener(handleMessage);
  chrome.storage.onChanged?.removeListener(handleStorageChange);
  document.removeEventListener('hud-cancel', handleHudCancel);
  document.removeEventListener('hud-retry-failed', handleRetryFailed);
  document.removeEventListener('hud-error-action', handleHudErrorAction);
  window.removeEventListener('beforeunload', cleanup);
  window.removeEventListener('popstate', checkRouteChange);
  if (routeWatchTimer !== null) {
    clearInterval(routeWatchTimer);
    routeWatchTimer = null;
  }
}

// ==================== 启动 ====================

initialize();

const autoTranslateState = {
  get remaining(): number {
    return autoTranslateRunsRemaining;
  },
  reset(): void {
    autoTranslateRunsRemaining = MAX_AUTO_TRANSLATE_FOLLOW_UP_RUNS;
  },
};

/**
 * Read-only view of the auto-translate switch.
 *
 * A getter, not a plain export: `isAutoTranslateEnabled` is reassigned by
 * `syncAutoTranslateMode`, and an exported binding would freeze the value at
 * import time and make the flag impossible to observe.
 */
const autoTranslateMode = {
  get enabled(): boolean {
    return isAutoTranslateEnabled;
  },
};

// ==================== 测试导出 ====================

export {
  currentState,
  findTranslatableImages,
  getEnabledFromConfig,
  handleMessage,
  handleStorageChange,
  translatePage,
  autoTranslateState,
  autoTranslateMode,
  cancelTranslation,
  clearAll,
  cleanup,
  setState,
  handleRetryFailed,
  handleRouteChange,
  checkRouteChangeOnce,
  isFatalTranslationError,
};
