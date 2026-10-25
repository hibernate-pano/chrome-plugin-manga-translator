/**
 * Content Script - Manga Translator v2
 *
 * 重构后的 content script，采用清晰的状态机架构：
 * - ContentState 类型驱动所有 UI 和行为
 * - 支持整页翻译、忽略缓存重翻、取消、清除
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
  computeTiles,
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
  isInViewport,
  processInParallel,
  type ParallelProcessingOptions,
} from '@/utils/image-priority';
import { sortTextAreasByReadingOrder } from '@/services/reading-order';
import { refineTextAreasForImage } from '@/services/text-box-refiner.service';
import { useContentConfigStore } from '@/stores/content-config';
import { hostMatchesAllowlist } from '@/shared/app-config';
import type { JobPriorityClass } from '@/shared/runtime-contracts';
import { describeFee } from '@/shared/cost-wording';
import { RUN_SCOPE_ID } from '@/shared/run-scope';
import { fetchContentConfig } from '@/shared/config-client';
import type { ContentConfigSnapshot } from '@/shared/content-config';
import type {
  BackgroundToContentMsg,
  ContentResponse,
  ContentState,
  ContentStateReport,
  ContentToPopupMsg,
  ImageFailure,
  PopupToContentMsg,
  ProviderPreflightRequest,
  ProviderPreflightResponse,
} from '@/shared/runtime-contracts';
import {
  MASTER_SWITCH_OFF_MESSAGE,
  findWorkerRefusal,
} from '@/shared/runtime-contracts';
import { isTranslatableImage } from './image-filter';
import { getForceRetranslateConfirm } from './force-retranslate-confirm';
import { getImageExportDialog } from './image-export-dialog';
import { FloatingHud } from './floating-hud';
import { FailureBadges } from './failure-badges';
import { ReadingPanel } from './reading-panel';
import { ReadingAnchors } from './reading-anchors';
import { clampPageTranslationConcurrency } from './page-translation-utils';
import {
  createDebouncedAutoTranslate,
  shouldAutoTranslateFollowUp,
  MAX_AUTO_TRANSLATE_FOLLOW_UP_RUNS,
} from './auto-translate-observer';

// ==================== 消息类型定义 ====================

// The message protocol and the page state live in `@/shared/runtime-contracts`,
// so the popup, the worker and the content script all speak the same shapes.
// The content script used to define them, and the popup kept its own copy:
// two definitions of one protocol, which had already drifted apart.

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
 * 画面在翻译途中被换掉了。
 *
 * 服务商没有失败，失败的是这一份结果：它描述的是旧的那张画面。告诉用户
 * 真相，比报一个"翻译失败"有用——他要做的不是重试，而是让这一张重新
 * 翻一次。
 */
const ARTWORK_CHANGED_MESSAGE = '翻译途中画面被换掉了，这张图需要重新翻译一次';

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

/**
 * "画面在翻译途中被换掉了"。
 *
 * 这不是服务商的错：模型好好地回答了，只是它回答的是**另一张**图。译文
 * 描述的是旧像素，画到新画面上就是错的，所以这一份必须丢掉。
 *
 * 用专门的错误类型，是为了把它和"这张图翻译失败"分开：服务商没有失败，
 * 失败的是这一份结果。
 */
class ArtworkChangedError extends Error {
  constructor() {
    super(ARTWORK_CHANGED_MESSAGE);
    this.name = 'ArtworkChangedError';
  }
}

// ==================== 运行时状态 ====================

let currentState: ContentState = { status: 'idle' };
let abortController: AbortController | null = null;
let translator: TranslatorService | null = null;
let renderer: OverlayRenderer | null = null;
let hud: FloatingHud | null = null;
let readingPanel: ReadingPanel | null = null;
let readingAnchors: ReadingAnchors | null = null;
/**
 * 失败的图上打的角标。
 *
 * 和阅读面板、编号锚点一样，是"这一页发生了什么"的一个视图。它自己不发
 * 请求、不花钱，存在的意义只有一个：让读者知道**哪一张**坏了。
 */
let failureBadges: FailureBadges | null = null;
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
 * The same, for the failure badges: they are anchored to their images, so
 * they have to follow a scroll or a resize. Saved so `cleanup()` can remove
 * the listeners by the same reference.
 */
let failureBadgeRepositionHandler: (() => void) | null = null;
/**
 * Set once the user asks for this page to be translated (popup button, context
 * menu, or the host being on the auto-translate allowlist). Auto-continue is
 * meaningless before that: without it, a page the user never asked about would
 * translate itself as soon as it scrolled.
 */
let pageTranslationRequested = false;
let translationRunInFlight = false;
/**
 * 现在有没有一轮翻译占着互斥锁。
 *
 * 锁是整页翻译的：右键单图翻译不占它（它只翻一张，不和整页翻译抢）。
 */
function holdsTheRunMutex(): boolean {
  return (
    translationRunInFlight ||
    currentState.status === 'translating' ||
    currentState.status === 'scanning'
  );
}
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
 * 还没加载完、但很可能是漫画页的图片数。
 *
 * 弹窗要靠它区分两种"没有可翻译的图片"：图太小，和图还没来。前者让用户
 * 去调尺寸，后者让用户去滚动页面——给错方向比不给更糟。
 */
let pendingCount = 0;
/**
 * 一轮翻译的身份。
 *
 * 取消以前是一个模块级布尔量：任何一处取消都会把它置上，而只有"整页翻译"
 * 会在开始时把它清回 false。这两个动作之间，任何读到它的代码都会以为自己
 * 被取消了——上一轮取消留下的状态，会让**下一轮**付了钱之后把结果丢掉。
 *
 * 取消属于**一轮**，不属于页面。这就是这个对象存在的全部理由。
 */
interface RunToken {
  /**
   * 这一轮开始时页面的纪元。
   *
   * 纪元在「清除译文」「换章」「页面卸载」时推进。一轮翻译如果发现手里的
   * 纪元已经过时，说明它被取代了：它拿到的一切结果都属于旧的那一页，
   * 不能画到屏幕上，也不能记进这一页的账。
   */
  readonly epoch: number;
  /** 用户按了取消（或扩展被关掉了）。 */
  cancelled: boolean;
  /** 这一轮是被什么中止的。 */
  reason: AbortReason;
}

/**
 * 页面的纪元。
 *
 * 清除、换章、卸载都推进它：这些动作之后，页面上的一切记录都不再作数，
 * 任何还在路上的结果都属于旧的那一页。
 */
let pageEpoch = 0;

/**
 * 正在进行的翻译轮次。
 *
 * 取消是发给"所有正在跑的轮次"的——用户按取消的时候，不会先去分辨页面上
 * 到底跑着哪一轮。
 */
const activeRuns: Set<RunToken> = new Set();

/**
 * 当前这一轮**整页**翻译的身份。
 *
 * 用来回答"现在占着互斥锁的那一轮，是不是已经被用户取消了"。右键单图
 * 翻译不占这个锁，所以它不在这里。
 */
let pageRunToken: RunToken | null = null;

/**
 * 开一轮翻译。
 */
function beginRun(): RunToken {
  const token: RunToken = {
    epoch: pageEpoch,
    cancelled: false,
    reason: null,
  };
  activeRuns.add(token);
  return token;
}

/**
 * 结束一轮翻译。
 */
function endRun(token: RunToken): void {
  activeRuns.delete(token);
  if (pageRunToken === token) {
    pageRunToken = null;
  }
}

/**
 * 这一轮是不是已经作废了（被取消，或者这一页已经被清除/换章）。
 *
 * 两种情况：用户按了取消，或者这一页已经被清除/换章（纪元变了）。两种
 * 情况下这一轮拿到的东西都不能画到屏幕上——前者是用户不要了，后者是已经
 * 不是这一页了。
 */
function isRunDead(token: RunToken): boolean {
  return token.cancelled || isRunStale(token);
}

/**
 * 这一轮是不是已经属于旧的那一页了。
 *
 * 清除、换章、卸载之后，这一轮拿到的一切都是旧页的：不能画到屏幕上，也不
 * 能记进这一页的账。
 */
function isRunStale(token: RunToken): boolean {
  return token.epoch !== pageEpoch;
}

/**
 * 这一页是不是已经作废了。
 *
 * 清除、换章、卸载走的是同一条路：这一页的记录不再作数，任何还在路上的
 * 结果都属于旧的那一页。
 */
function invalidatePage(): void {
  pageEpoch += 1;
}

/**
 * 这一轮是被什么中止的。
 *
 * 用户自己按取消，和"用户把扩展关掉了"，对用户来说不是一回事：后者必须
 * 告诉用户已经花掉的钱退不了，但剩下的图不会再发出去。
 */
type AbortReason = 'user' | 'extension-disabled' | null;
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
/**
 * 每张"已经问过模型"的图。
 *
 * `processedImages` 只记成功的那几张。失败的那张既没有标记，也不在这个
 * 集合里——它会重新回到候选池，于是观察器每一轮都把它捡回来重新请求一次。
 * 用户没有点过任何按钮，账单却一直在涨；最多能涨二十轮。
 *
 * 所以这里记的是"问过了"，不是"问成了"：只要为一张图发过一次请求，它就
 * 不该再被观察器自动捡起。要不要再花钱重试是用户的决定——页面把失败的图
 * 报出来，弹窗给一个「重新翻译失败的 N 张」的按钮。
 */
const attemptedImageKeys: Set<string> = new Set();
/**
 * The same record, keyed on the element instead of on its address.
 *
 * The key is the image's URL — but a page is allowed to change it. A
 * responsive webtoon replaces a thumbnail with the full-size panel, a zoom
 * swaps the source, and an <img> that only carries a `srcset` has no `src`
 * at all (its address is a layout position, which moves as the page
 * reflows). Every one of those changes the key of an image the extension
 * has already asked about, and the observer — whose whole job is to ask
 * about images it has never asked about — would ask again. Money, for the
 * same picture.
 *
 * The element is the stable identity: it does not change while the image is
 * on the page. Both are kept, and an image counts as "asked about" when
 * either says so — the element catches a changed URL, the URL catches an
 * element the page rebuilt from scratch.
 */
const attemptedImages: Set<HTMLImageElement> = new Set();
/**
 * The images that failed, so a retry can un-mark them.
 *
 * `isTranslatableImage` rejects any image carrying PROCESSED_CLASS, so
 * forgetting the element means the retry can never pick the image up again.
 *
 * A Set rather than a WeakSet on purpose: the retry has to *iterate* the
 * failed images to strip their class, and a WeakSet is not iterable. The set
 * is cleared when the user asks for the page again and on clear, so it
 * cannot outlive the page's images by more than one run.
 */
const failedImages: Set<HTMLImageElement> = new Set();
/**
 * 失败的图，以及各自的原因。
 *
 * `failedImages` 只回答"哪些图要重翻"，这个回答的是"哪张图、为什么坏"。
 * 两者不是一回事：`failedImages` 里也装着那些还没轮到就被中止的图——它们
 * 没失败，只是没翻到。
 *
 * 以前这一页只留了**第一张**失败的原因（`lastError`），三张图以三种原因
 * 失败，读者只被告知其中一种，而那一种很可能不是让这一轮卡住的那一种。
 */
const pageFailures: Map<HTMLImageElement, ImageFailure> = new Map();

/**
 * 记下这张图失败了，以及为什么。
 *
 * 角标和卡片读的是同一个记录，所以画面上标的和卡片上写的一定是同一件事。
 */
function rememberImageFailure(
  img: HTMLImageElement,
  index: number,
  reason: string
): void {
  pageFailures.set(img, { index, reason });
  failureBadges?.mark(img, reason);
}

/**
 * 这张图现在没有失败记录了——重试成功了，或者这一页被清了。
 *
 * 重试成功之后画面上还留着那个红色角标，就是一句谎话。
 */
function forgetImageFailure(img: HTMLImageElement): void {
  if (pageFailures.delete(img)) {
    failureBadges?.clear(img);
  }
}
/**
 * 译完的时候，这张图是哪个地址。
 *
 * 页面可以在翻译之后把地址换掉——懒加载站点把缩略图换成大图是常规做法，
 * 阅读器点一下"看大图"也是。换掉之后，屏幕上已经是另一张画面，而旧译文
 * 还盖在上面：它描述的是别的像素，读起来是错的。
 *
 * 记下地址，才知道画面是什么时候换的。
 */
const translatedImageKeys: Map<HTMLImageElement, string> = new Map();
/**
 * 已经挂上"画面变了"监听的图片。
 *
 * 一张图只挂一次：挂两次会让同一次换图被处理两遍。
 */
const artworkWatchers: Set<HTMLImageElement> = new Set();
/**
 * Forget every per-image record this page holds.
 *
 * Three sets describe "what has already happened to an image on this page":
 * the processed keys, the attempted keys, and the failed elements. They are
 * always read and written together — `retranslateFailedImages` walks
 * `failedImages`, `isTranslatableImage` consults `processedImages`, and the
 * observer consults `attemptedImageKeys` — so a reset that leaves one of
 * them behind makes the page disagree with itself.
 *
 * That is not a cosmetic mismatch: the leftover `failedImages` entries are
 * exactly the list `FORCE_RETRANSLATE_FAILED` bills for, so a "clear this
 * page" that forgot to clear them would re-translate (and re-charge) the
 * images the user had just dismissed. The three reset sites (clear, route
 * change, teardown) therefore all come through this one function.
 *
 * `keepAttempted` is for the "clear this page" site. Clearing the overlays
 * is not a request to translate the page again, and on an auto-translated
 * host the observer is still armed: if the marks went with the overlays,
 * the next image that loaded would bring the whole page back — twenty
 * requests the user never asked for. The marks stay until the page really
 * changes (a route change) or the user asks for the page again.
 */
function resetPerImageState(options: { keepAttempted?: boolean } = {}): void {
  processedImages.clear();
  if (!options.keepAttempted) {
    attemptedImageKeys.clear();
    attemptedImages.clear();
  }
  failedImages.clear();
  // 失败记录和角标也是"这一页发生过什么"的一部分，清页面就得一起清。
  //
  // 留着它们的话，卡片会写「失败 3 张」而画面上那三张其实已经翻好了，
  // 而「重新翻译失败的 N 张」会把它们再翻一遍、再收一次钱。
  pageFailures.clear();
  failureBadges?.reset();
  // 译文没了，"这张图是在哪个地址上翻的"也就没意义了：覆盖层已经被撤掉，
  // 留着它只会让下一次换图去撤一层早就不存在的译文。
  translatedImageKeys.clear();
}
const autoTranslateScheduler = createDebouncedAutoTranslate(() => {
  void maybeAutoTranslateNewImages();
});

// ==================== 状态更新 ====================

/**
 * The images a "retry the failed ones" would actually re-request.
 *
 * The popup used to quote `failedCount`, which is the number of failures in
 * the last run. A run that dies halfway puts the images it never got to back
 * into `failedImages` without raising that counter — so the popup said "1
 * failed" while the next click billed twenty images. The list the retry
 * walks is the truth, so that is what gets reported.
 */
function retryTargets(): HTMLImageElement[] {
  return Array.from(failedImages).filter(img => img.isConnected);
}

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
    pendingCount,
    autoContinueArmed: isAutoContinueArmed(),
    autoContinueBudgetExhausted:
      isAutoTranslateEnabled && autoTranslateRunsRemaining <= 0,
    retryTargetCount: retryTargets().length,
    // 已经坏了几张、分别为什么。这两个数字在翻译进行中就是真的：读者盯着
    // 进度条的时候，最想知道的正是"已经坏了几张"。
    failedCount: pageFailures.size,
    failures: Array.from(pageFailures.values()),
    // 这一页现在盖着几片译文。「清除本页译文」在没有译文时是空动作，
    // 弹窗靠这个数字决定要不要拦下那一下。
    overlayCount: renderer?.getOverlayCount() ?? 0,
    // `false` means "there is a panel and it is not showing". `undefined`
    // means "this page has no panel at all" — the panel is only created by a
    // translation run, so on a page that was never translated there is
    // nothing for the popup to toggle. The popup used to be told "hidden"
    // and offered a 「显示译文阅读面板」 button; pressing it created an empty
    // panel that covered the right edge of the artwork with nothing in it.
    readingPanelVisible: readingPanel ? readingPanel.isVisible() : undefined,
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
          etaSeconds: reported.etaSeconds,
          // 已经坏了几张。进度条把失败也算成"走完了一张"，所以这一行是
          // 读者在整轮结束之前唯一能知道"有几张白花钱了"的地方。
          failedCount: reported.failedCount ?? 0,
          costNote: reported.costNote,
        });
        break;
      case 'complete':
        hud.update({
          status: 'complete',
          translatedCount: reported.count,
          /*
           * What is still untranslated, not what the last run happened to
           * fail.
           *
           * Three images failed in one run; a later automatic run
           * succeeded on two more and reset the counter. The HUD said
           * "失败 0" — while the popup, one click away, offered to retry
           * three images. The HUD counts what the retry would re-request,
           * so the two never contradict each other.
           */
          failedCount: reported.retryTargetCount ?? reported.failedCount ?? 0,
          cachedCount: reported.cachedCount ?? 0,
          // 这一页有几处找到了却没翻出来。卡片要说得出来，否则它写着
          // 「翻译完成」，而画面上还有几处原文。
          missingCount: reported.missingCount ?? 0,
          // The HUD's wording about money depends on which provider this
          // page is using: a local provider does not charge the reader.
          provider: useContentConfigStore.getState().provider,
          skippedCount: reported.skippedCount ?? 0,
          // The HUD tells a reader why a run came out empty. It can only
          // tell "the pages have not loaded yet" apart from "they are too
          // small" if it knows the pending count, so it has to be passed.
          pendingCount: reported.pendingCount ?? 0,
          skippedDuplicateCount: reported.skippedDuplicateCount ?? 0,
          /*
           * And it has to know whether scrolling is enough.
           *
           * The HUD used to promise "scroll to them and they will be
           * translated" to every reader, whether or not the page was armed
           * for auto-continue. On a page that is not armed the images sit
           * there until the reader presses the button again — and the HUD
           * had told them otherwise. The flag is the page's own truth.
           */
          autoContinueArmed: reported.autoContinueArmed ?? false,
          /*
           * And it has to know *why* it is not armed.
           *
           * "Not armed" and "the budget ran out" call for different things
           * from the reader: the first needs a click on the button, the
           * second needs the same click but with the reason said out loud —
           * otherwise a reader who waited for a continuation that never came
           * has no way to tell a broken promise from a stopped run.
           */
          autoContinueBudgetExhausted:
            reported.autoContinueBudgetExhausted ?? false,
          lastError: reported.lastError,
          // 哪几张、分别为什么。`lastError` 只是第一张的原因，它留在那里
          // 是为了兼容没有这张列表的旧状态。
          failures: reported.failures ?? [],
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

/**
 * 把当前状态重新报一遍，但不重画 HUD。
 *
 * HUD 上的卡片记录的是"刚跑完的那一轮"（成功 N 张）。页面上的画面变了以后，
 * 那个数字已经不准了；把它改掉，读者会看到一张自相矛盾的卡片，而把它留着，
 * 一张早就自动收起的卡片又会被重新弹出来——两个都不是好事。
 *
 * 弹窗那边必须重新报：它上面写的是"本页有几张图"，那是此刻的事实。
 */
function publishState(): void {
  const reported: ContentState = { ...currentState, ...currentReport() };
  currentState = reported;
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
  const request: ProviderPreflightRequest = { type: 'PROVIDER_PREFLIGHT' };
  const response = (await chrome.runtime.sendMessage(request)) as
    | ProviderPreflightResponse
    | undefined;

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

  // 图上的「⬇ 保存」按钮：把这一页的译文合成成 PNG 交给用户。
  //
  // 渲染器只负责画按钮——它不知道怎么把一张图变成一个文件；合成和下载是
  // 内容脚本的事。
  const activeRenderer = renderer;
  activeRenderer.setExportHandler((image, textAreas, trigger) => {
    const entry = readingPanel
      ?.getEntriesInOrder()
      .find(item => item.image === image);
    getImageExportDialog().open({
      image,
      textAreas,
      style: activeRenderer.getStyle(),
      index: entry?.index ?? 1,
      trigger,
    });
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

  // 失败角标：和锚点一样跟着图走，页面把自己的 body 换掉时也要重建。
  if (failureBadges && !failureBadges.isAttached()) {
    failureBadges = null;
  }
  if (!failureBadges) {
    failureBadges = new FailureBadges();
    const repositionBadges = () => failureBadges?.repositionAll();
    failureBadgeRepositionHandler = repositionBadges;
    window.addEventListener('scroll', repositionBadges, { passive: true });
    window.addEventListener('resize', repositionBadges);
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
  /**
   * 通过了过滤、但字节还没到的图片（懒加载的漫画页）。
   *
   * 它们现在还不会被翻译，但迟早会——这就是"这一页到底有几张图"以前
   * 少算的那一大截。页面只加载了前 4 张的时候，真实数量是 40 张。
   */
  pending: number;
}

// Lazy-load sites (Korean webtoons, etc.) swap src and only the image's
// `load` event fires once bytes arrive. attribute-only MutationObserver misses
// the moment naturalWidth becomes >0, so incomplete-but-valid images were
// filtered and never re-picked up. We attach a one-shot `load` listener to
// candidate-but-incomplete images so a debounced rescan fires as soon as the
// bytes land.
const pendingLoadImages = new WeakSet<HTMLImageElement>();

/**
 * Ignore the cache and translate the whole page again.
 *
 * Serialised against the run that may still be in flight: the previous run
 * holds the mutex, and `clearAll` only aborts it — the abort is observed
 * asynchronously. Starting the new run immediately would hit the mutex and
 * silently do nothing, leaving the user with an empty page and no new
 * translation.
 */
async function forceRetranslatePage(): Promise<void> {
  const previous = activeRunPromise;
  if (previous) {
    await previous.catch(() => undefined);
  }
  clearAll();
  await translatePage(true);
}

function scanImages(): ImageScanResult {
  const allImages = Array.from(document.querySelectorAll('img'));
  let skippedFilter = 0;
  let skippedDuplicate = 0;
  let pending = 0;
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
    if (!img.complete) {
      // 字节还没到。这张图有多大还不知道，所以尺寸这一关没法判，但位置和
      // 类型可以判——它很可能是一张还没加载出来的漫画页。
      //
      // 这以前被算成"尺寸不合格"，于是懒加载的一章只报了 2 张，而真实
      // 数量是 40 张：一个系统性偏低的数字比没有数字更糟。
      if (
        !isTranslatableImage(img, {
          allowIncomplete: true,
          allowUnknownSize: true,
        })
      ) {
        skippedFilter++;
        continue;
      }
      pending++;
      // Arm a one-shot `load` listener so we re-scan the moment the bytes
      // land. The rescan is what picks the image up — and it only spends
      // money if auto-translate is armed.
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
    if (!isTranslatableImage(img)) {
      skippedFilter++;
      continue;
    }
    translatable.push(img);
  }

  return {
    translatable,
    total: allImages.length,
    skippedFilter,
    skippedDuplicate,
    pending,
  };
}

/**
 * Record what the last scan found.
 *
 * These are facts about the page, not about a run: they stay true whether or
 * not a translation is going on. Recording them here — rather than only in
 * the translation flow — means the popup gets an honest answer after a
 * read-only count too, instead of "0 images are still loading" until the
 * user has translated something.
 */
function recordScan(result: ImageScanResult): void {
  skippedCount = result.skippedFilter;
  skippedDuplicateCount = result.skippedDuplicate;
  pendingCount = result.pending;
  candidateCount = result.translatable.length;
}

function findTranslatableImages(): HTMLImageElement[] {
  return scanImages().translatable;
}

/**
 * 这一轮翻译会花多少钱，一句话。
 *
 * 弹窗在按钮旁边就写着"会产生费用"，但从快捷键和右键菜单进来的翻译没有弹窗
 * 可说话——钱立刻就开始花了。于是这句话出现在页面上，在翻译还在跑、用户
 * 还能取消的时候。
 *
 * 长条图是这里唯一不显然的部分：一张图会被拆成好几片，每片一次请求。
 */
function describeRunCost(images: HTMLImageElement[]): string | undefined {
  if (images.length === 0) {
    return undefined;
  }
  let tiled = 0;
  for (const img of images) {
    if (computeTiles(img.naturalWidth, img.naturalHeight).length > 1) {
      tiled += 1;
    }
  }
  const provider = useContentConfigStore.getState().provider;
  const fee = describeFee(provider);
  const base = `翻译这 ${images.length} 张图${fee}（缓存命中不计费）`;
  return tiled > 0
    ? `${base}；其中 ${tiled} 张长条会拆成多片分别请求，实际请求次数更多`
    : base;
}

/**
 * 这一页里"还没问过模型"的图。
 *
 * 观察器只捡这些。
 *
 * 失败过的图已经被报给用户了（弹窗上有「重新翻译失败的 N 张」），要不要
 * 再花钱重试是用户的决定。观察器把它们捡回来，等于用户没点任何按钮，账单
 * 却每一轮都在涨——这是这个扩展里最贵的一个洞。
 *
 * 成功过的图根本不会出现在这里：`scanImages()` 已经把它们算作"已经处理
 * 过"排除掉了。
 */
function findUnattemptedImages(): HTMLImageElement[] {
  return findTranslatableImages().filter(img => !hasAskedAbout(img));
}

/**
 * Has this image already been sent to the model?
 *
 * Either record answers it: the element (the picture on this page) or its
 * address (the same picture, even if the page rebuilt the element).
 */
function hasAskedAbout(img: HTMLImageElement): boolean {
  return attemptedImages.has(img) || attemptedImageKeys.has(getImageKey(img));
}

function getImageKey(img: HTMLImageElement): string {
  /*
   * `currentSrc` is the address the browser actually fetched, and it is the
   * one that survives a `srcset` picture: an <img> that carries only a
   * `srcset` has an empty `src`, and the fallback below (a layout position)
   * changes every time the page reflows.
   */
  return (
    img.currentSrc ||
    img.src ||
    `img-${img.offsetLeft}-${img.offsetTop}-${img.width}-${img.height}`
  );
}

/**
 * 去掉地址里的查询串和锚点。
 *
 * 同一个文件换个版本号（`page.webp?v=2`）还是同一张画面。把它当成"画面换了"
 * 会白白撤掉一层还没坏的译文，再让用户重新点一次。
 */
function stripUrlQuery(value: string): string {
  try {
    const parsed = new URL(value, document.baseURI);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return value.split('?')[0]?.split('#')[0] ?? value;
  }
}

/**
 * 两个地址是不是同一张画面。
 *
 * 判据只有一条：**换掉查询串之后还是同一个文件**。版本号变了还是同一张图
 * （译文留着），文件名变了就是另一张（译文作废）。
 */
function isSameArtwork(a: string, b: string): boolean {
  return a === b || stripUrlQuery(a) === stripUrlQuery(b);
}

/**
 * 记住这张图是在哪个地址上翻的，并盯住它的下一次换图。
 *
 * 听的是 `load` 事件而不是 `src` 属性：属性可以先改、字节后到，只有
 * `load` 才意味着"屏幕上现在这张画面已经到位"。
 */
function rememberTranslatedArtwork(img: HTMLImageElement): void {
  translatedImageKeys.set(img, getImageKey(img));

  if (artworkWatchers.has(img)) {
    return;
  }
  artworkWatchers.add(img);
  img.addEventListener('load', () => {
    const recorded = translatedImageKeys.get(img);
    if (recorded === undefined) {
      return;
    }
    const current = getImageKey(img);
    if (isSameArtwork(current, recorded)) {
      /*
       * 还是同一张画面（只是地址里的版本号变了）：译文留着。
       *
       * 但"翻过了"这条记录要跟着换成新地址 —— 否则这张图会重新变成候选，
       * 弹窗把它算进待翻的张数里，读者还以为有一张没翻。
       */
      if (current !== recorded) {
        processedImages.delete(recorded);
        processedImages.add(current);
        attemptedImageKeys.add(current);
      }
      translatedImageKeys.set(img, current);
      return;
    }
    handleArtworkChange(img, recorded);
  });
}

/**
 * 画面换了，旧译文就作废。
 *
 * 三件事，顺序不能乱：
 *
 * 1. 撤掉旧译文。它描述的是别的像素，盖在新画面上就是错的。
 * 2. 把"这张图翻过了"的标记撤掉。新画面是一张还没被翻过的图，它要回到候
 *    选池里——弹窗会把它算进"本页有几张图"，价格也跟着算对。
 * 3. 保留"问过了"那条记录。观察器不替用户重花这一次钱：这是同一页漫画换
 *    了个分辨率，不是新的一页。要重翻，用户自己点一次「翻译当前页面」。
 */
function handleArtworkChange(img: HTMLImageElement, previousKey: string): void {
  translatedImageKeys.delete(img);
  renderer?.removeTranslation(img);
  img.classList.remove(PROCESSED_CLASS);
  processedImages.delete(previousKey);

  // 这一页现在有几张图变了，重扫一次再上报：弹窗上"已经翻过了"这句话已经
  // 不成立了，而"本页有 1 张可翻译图片"才是现在的实话。
  recordScan(scanImages());
  publishState();
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
  /**
   * How many spots on this image were left untranslated.
   *
   * The model found a bubble and gave no translation for it, or a tile never
   * answered. The image is still a success — most of it is translated — but
   * the reader has to be told, because a page that says 「翻译完成」 while
   * four bubbles are still in the source language is a page that lies.
   */
  missing: number;
}

/**
 * 这一张图该排多急。
 *
 * worker 的队列是所有标签页共用的，它按这个标记排序：
 *
 * - 用户点了「重试失败项」：用户正盯着这几张等，最急；
 * - 图在当前视口里：用户正在读它；
 * - 其余的：页面下面的图，先排队。
 *
 * 以前每一张图都是同一个标记，于是这套排序从来没生效过——队列里排的是
 * "谁先到"，不是"谁最急"。用户点了重试之后，那几张图要排在别人标签页的
 * 整页翻译后面才轮得到。
 */
function priorityClassForImage(
  image: HTMLImageElement,
  isManualRetry: boolean
): JobPriorityClass {
  if (isManualRetry) {
    return 'manual-retry';
  }
  return isInViewport(image) ? 'visible-now' : 'next-up';
}

async function processSingleImage(
  img: HTMLImageElement,
  token: RunToken,
  forceRefresh: boolean = false,
  onCacheHit?: (hit: boolean) => void,
  priorityClass: JobPriorityClass = 'visible-now',
  signal?: AbortSignal
): Promise<ImageProcessResult> {
  // The worker pushes a fresh snapshot whenever the user changes anything in
  // Settings, and that handler nulls the translator so the next image picks
  // up the new provider / language / style. If a change lands while a run is
  // in flight, the images that had not started yet used to find `translator`
  // null and fail with 「发生未知错误：Services not initialized」 — and the
  // popup's 「重新翻译失败的 N 张」 then offered to re-bill images that never
  // failed at all, they were only unlucky enough to be queued behind a
  // settings change.
  //
  // Re-initialise instead of throwing: the config the snapshot carried is the
  // config the user just asked for, so building a fresh translator here is
  // exactly the right move, not an error. (Images already mid-request hold
  // the old provider object and finish on it; only the not-yet-started ones
  // take the new one. That is the point of nulling rather than swapping in
  // place.)
  if (!translator || !renderer) {
    await ensureServicesInitialized();
  }
  if (!translator || !renderer) {
    // Still missing after the attempt — the provider probe or config refresh
    // failed. This is a genuine "cannot start", not a mid-run settings edit.
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

  // 这一轮是不是已经作废了？作废了还发请求就是在花用户不要花的钱。
  //
  // 用户按了取消，或者这一页已经被清除/换章（纪元变了）——两种情况下，
  // 这一轮剩下的图都不该再发出去。
  if (isRunDead(token)) {
    throw new Error('Translation cancelled');
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

  /*
   * From here on this image counts as "asked about".
   *
   * The mark goes on before the request, not after it: the request can
   * fail, time out, or be cancelled by the user, but the money may already
   * be gone. The observer only picks up images it has never asked about, so
   * without this mark a failed image would be re-requested on every
   * follow-up round — up to twenty rounds the user never asked for.
   */
  attemptedImageKeys.add(getImageKey(img));
  attemptedImages.add(img);

  /**
   * 这张图在这份请求发出的时候，是哪一张画面。
   *
   * 请求飞着的时候页面是可以换图的（懒加载站点把缩略图换成大图是常规做
   * 法）。回来的译文描述的是**旧**的那张画面，画到新画面上就是错的。
   */
  const requestedKey = getImageKey(img);

  // The result is needed after the try block, so it is declared here rather
  // than inside it.
  let result: Awaited<ReturnType<TranslatorService['translateImage']>>;
  try {
    result = await translator.translateImage(img, forceRefresh, undefined, {
      priorityClass,
      // 这一轮的取消信号。
      //
      // 它要走到**切片**那一层：一条长条漫会被切成十几片，读者点取消之后，
      // 剩下的片不该再一张张发出去。翻译服务以前有一个自己的
      // AbortController，可它从来没被赋值过——那个信号一直是 undefined，
      // 所以长条漫的切片在取消之后照跑照计费。
      signal,
    });

    if (onCacheHit) {
      onCacheHit(Boolean(result.cached));
    }

    if (!result.success) {
      /*
       * The status has to travel with the error.
       *
       * The classifier in this file reads `error.status` to tell "invalid
       * API key" (401) from "request timed out" (408). The result carries
       * the status as a number for exactly that, and dropping it here is
       * what made every failure arrive as 「发生未知错误」 — a sentence that
       * names no cause and no next step.
       */
      const failure = new Error(result.error || 'Translation failed');
      if (typeof result.errorStatus === 'number') {
        (failure as Error & { status?: number }).status = result.errorStatus;
      }
      throw failure;
    }

    /*
     * 这一张成了。
     *
     * 它之前失败过的记录和角标都要撤掉：重试成功之后，画面上还留着那个
     * 红色角标，就是一句谎话；而卡片上还挂着「第 3 张：请求超时」，读者
     * 会去查一个已经解决的问题。
     */
    forgetImageFailure(img);

    // The answer arrived after the user pressed cancel, so the run's result
    // is discarded: no overlay, and no marker. A marker left on an image the
    // user never saw translated makes it permanently un-translatable —
    // `isTranslatableImage` rejects any image carrying it.
    //
    // 判据是"这一轮还活着吗"，不是"页面上有没有一个取消标志"：上一轮
    // 取消留下的标志会让**这一轮**付了钱却把结果丢掉。
    if (isRunDead(token)) {
      throw new Error('Translation cancelled');
    }

    // 画面在请求飞着的时候换了：这份译文描述的是别的像素，不能用。
    if (!isSameArtwork(getImageKey(img), requestedKey)) {
      throw new ArtworkChangedError();
    }
  } catch (error) {
    // The image was not translated, so it must not look translated.
    //
    // 除非这一张已经被别的某一轮翻过了：那时候标记要留着——译文是真的在
    // 页面上，只是这一轮没画上去（这一轮被取消了，而新一轮已经画了）。
    if (!processedImages.has(getImageKey(img))) {
      img.classList.remove(PROCESSED_CLASS);
    }
    throw error;
  }

  if (result.textAreas.length === 0) {
    // 没有文字也要记：这张图已经翻过了（页面上不会再有别的翻译），而画面
    // 换了之后它要重新回到候选池里去。
    rememberTranslatedArtwork(img);
    return {
      success: true,
      cached: Boolean(result.cached),
      missing: result.missingCount ?? 0,
    };
  }

  // 气泡按阅读顺序排一遍。
  //
  // 视觉模型返回的是"它注意到的顺序"，不是读者读的顺序。以前面板直接用它，
  // 于是六句话的漫画在面板里是乱的：读者得自己找"接在上一句后面"的那句。
  const orderedAreas = sortTextAreasByReadingOrder(
    result.textAreas,
    renderer.getStyle().verticalText
  );

  // 把模型给的框吸附到文字真正的边界上。
  //
  // 这一步放在渲染之前而不是翻译时，是有原因的：翻译结果会进缓存，
  // 而缓存里存的是模型给的框。放在翻译时精修的话，升级前存下的旧框
  // 永远不会被修正，读者升级后看到的还是漏字的译文。放在渲染前，
  // 缓存命中与否都走同一条路。
  //
  // 精修只依赖像素，不请求模型，所以不花钱；缓存的 key 也不变，
  // 不会让任何用户的缓存失效、重新计费。
  const refinedAreas = refineTextAreasForImage(img, orderedAreas);

  // autoPinned = true: the translation is drawn straight over the artwork.
  // Without it the overlay sits at opacity 0 until the user hovers the image,
  // so a finished translation looks like nothing happened.
  renderer.render(img, refinedAreas, true);

  // 记住这张图是在哪个地址上翻的。页面之后把地址换掉（缩略图换大图、
  // 点开看大图）时，旧译文要作废——它描述的是别的像素。
  rememberTranslatedArtwork(img);

  // 同步到阅读面板 + 图上编号锚点。
  //
  // 面板按图片在 DOM 中的位置插入并编号，插在中间会把后面的编号顶掉一位。
  // 锚点必须立刻跟上：等一批跑完再统一改，用户看到的编号会先错后跳。
  const entryIndex = readingPanel?.upsert(img, refinedAreas);
  if (entryIndex !== undefined) {
    readingAnchors?.upsert(img, entryIndex);
    readingAnchors?.syncIndices(readingPanel?.getIndexByImage() ?? new Map());
  }

  return {
    success: true,
    cached: Boolean(result.cached),
    missing: result.missingCount ?? 0,
  };
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
 * 这一页现在还会不会自动翻译新出现的图片。
 *
 * 配置上的三个条件（主开关、自动续翻、白名单或用户翻过这一页）之外，还有
 * 一个预算条件：自动续翻的次数用完了就不再翻了。
 *
 * 预算这一条以前是看不见的。次数用完时观察器被停掉，但上报给弹窗的
 * `autoContinueArmed` 仍然是 true —— 于是 HUD 写着「滚动到它们出现后会自动
 * 继续翻译」，弹窗写着「这一页会自动翻译新加载的图片」，而实际上再也不会
 * 有下一张图被翻译。读者滚动、等待，什么也不会发生。
 */
function isAutoContinueArmed(): boolean {
  return isAutoTranslateEnabled && autoTranslateRunsRemaining > 0;
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

  /*
   * The observer is armed by the *effective* state, not by the configuration
   * alone.
   *
   * It used to be armed by `isAutoTranslateEnabled`, which stayed true after
   * the follow-up budget ran out — so every configuration refresh re-armed an
   * observer that could never fire (the budget check refuses every run), and
   * the page kept claiming it would carry on by itself.
   */
  if (isAutoContinueArmed()) {
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
  const pendingImages = findUnattemptedImages();
  if (
    shouldAutoTranslateFollowUp({
      enabled: isAutoContinueArmed(),
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
 *
 * The worker's own refusals belong here too. A provider that is not set up
 * fails the same way for every image left: the remaining twenty would each
 * ask the worker something it has already said it cannot do, and each would
 * be reported to the reader as another failed image.
 */
function isFatalTranslationError(message: string): boolean {
  if (findWorkerRefusal(message)) {
    return true;
  }
  return FATAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * The card to show when the worker refused the job.
 *
 * The refusal is not a provider error. Nothing was sent, nothing was billed,
 * and nothing about this image is wrong — the extension itself is not ready.
 * Flattening it into the generic error path loses all three of those facts:
 * the reader gets 「发生未知错误」 for a setting they can fix themselves, and
 * the sentence the worker actually wrote — which names the fix — is left
 * behind as a suffix nobody reads.
 *
 * Returns null for anything that is not a refusal, so the caller falls
 * through to the normal error translation.
 */
function describeWorkerRefusal(
  error: unknown
): { message: string; suggestion: string; action: ErrorAction } | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const refusal = findWorkerRefusal(message);
  if (!refusal) {
    return null;
  }
  return {
    // The worker's own sentence, not a copy of it: one wording in two
    // files is a wording that drifts.
    message: refusal.message,
    suggestion: refusal.suggestion,
    action: { type: 'open-settings', label: '打开设置' },
  };
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
  if (holdsTheRunMutex()) {
    /*
     * 上一轮已经被用户取消了 —— 用户多半是按完取消就想重来一次。
     *
     * 这一次点击不能被丢掉。上一轮还在收尾（在路上的请求撤不回来），但它
     * 反正不会再发新的请求了：等它收完，把这一轮接上去，用户点的这一次
     * 才算数。
     *
     * 真的有一轮在跑的时候（没被取消），这一次的点击仍然被挡下：那是另
     * 一件事，用户没有要求跑两遍。
     */
    const previous = activeRunPromise;
    if (previous && pageRunToken?.cancelled) {
      await previous.catch(() => undefined);
      // 等的过程中可能有别的一轮插进来：再抢一次锁。
      if (holdsTheRunMutex()) {
        if (import.meta.env.DEV) {
          console.warn('[ContentScript] 翻译已在进行中');
        }
        return;
      }
    } else {
      if (import.meta.env.DEV) {
        console.warn('[ContentScript] 翻译已在进行中');
      }
      return;
    }
  }

  // Reserve the mutex synchronously, before the first await. READY and
  // tabs.onUpdated can both send TRANSLATE_PAGE in the same tick; if the
  // reservation happened after the await inside `runTranslation`, both would
  // pass the check above and translate the page twice.
  translationRunInFlight = true;
  translationRunGeneration += 1;
  const generation = translationRunGeneration;
  const token = beginRun();
  pageRunToken = token;

  const run = runTranslation(
    forceRefresh,
    origin,
    generation,
    token,
    retryImages
  );
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
  token: RunToken,
  retryImages?: HTMLImageElement[]
): Promise<void> {
  /*
   * The fatal error of this run (auth, rate limit — the remaining images
   * would fail identically and cost the user money). Hoisted out of the
   * `try` so the `finally` block can read it: a run that died on a bad key
   * must not schedule a follow-up, because the follow-up would fail the
   * same way and spend budget to do it.
   */
  let fatalError: Error | null = null;
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
        message: MASTER_SWITCH_OFF_MESSAGE,
        suggestion: '开启后即可翻译当前页面',
        action: { type: 'open-settings', label: '打开设置' },
      });
      return;
    }

    // A new run starts from a clean slate: a previous run's cancellation must
    // not make this one look cancelled.
    //
    // 这一轮的身份是它自己的（`token`）：上一轮取消过，不等于这一轮被取
    // 消了。以前这两件事共用一个模块级布尔量，于是上一轮取消留下的状态会
    // 让这一轮付了钱之后把结果丢掉。
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
    /*
     * 把这一轮的信号**抓住**，而不是每次去读 `abortController`。
     *
     * 取消的时候 `cancelTranslation` 会把 `abortController` 置空（那是刻意的，
     * 它要靠这个区分"被取消"和"正常结束"）。于是任何在取消之后才去读
     * `abortController?.signal` 的地方拿到的都是 `undefined`——信号也就传
     * 不下去了。抓住的是 AbortSignal 对象本身，它一旦被 abort 就一直是
     * aborted 的。
     */
    const runSignal = abortController.signal;

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
      recordScan(scan);
      // 本页的候选数量。翻译结束后它依然有效，弹窗靠它说清"这一页一共
      // 几张"，而不是只给一个没有分母的"完成 8 张"。
      const candidates = getViewportFirstImages(scan.translatable);
      /*
       * 观察器这一轮只翻"还没问过"的图。
       *
       * 失败过的图不会消失：它们既没有标记，也不在 `processedImages` 里，
       * 所以 `scanImages()` 仍然会把它们算成候选——这是对的，用户随时可以
       * 点「重新翻译失败的 N 张」再试一次。但观察器不能自己去试：那是没人
       * 授权的二次扣费。
       */
      images =
        origin === 'follow-up'
          ? candidates.filter(img => !hasAskedAbout(img))
          : candidates;
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

    /*
     * What this run is about to cost.
     *
     * The popup discloses the cost before the button is pressed. The other
     * two ways into a page translation — the keyboard shortcut and the
     * context menu — have no popup to say it in, and the money starts
     * moving immediately. So the page says it, on the page, while the run
     * is in flight and the user can still cancel.
     *
     * The tile count is the part that is not obvious: a long strip is one
     * image and several billed calls.
     */
    const costNote = describeRunCost(images);

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
    /**
     * Rough seconds left, for the HUD.
     *
     * One chapter page can hold 20+ images, and each one costs a round trip
     * to the provider. "第 7 张 / 20" says nothing about whether the run is
     * worth waiting for; an ETA does. The estimate is deliberately coarse —
     * average time per finished image times the ones still to go — and it
     * stays absent until the first image lands, because dividing by zero
     * yields a number that is confidently wrong.
     */
    const translateStartedAt = performance.now();
    const computeEtaSeconds = (): number | undefined => {
      const remaining = total - current;
      if (current < 1 || remaining <= 0) return undefined;
      const elapsedSeconds = (performance.now() - translateStartedAt) / 1000;
      if (elapsedSeconds <= 0) return undefined;
      return Math.max(1, Math.round((elapsedSeconds / current) * remaining));
    };
    let successCount = 0;
    failedCount = 0;
    cachedCount = 0;
    /**
     * How many spots on this page were found but not translated.
     *
     * A page can be "done" and still have untranslated bubbles in it. The
     * number travels with the state so the HUD and the popup can say so
     * instead of claiming a clean success.
     */
    let missingCount = 0;
    if (retryImages) {
      // The retry owns the failure list: the images it is about to run are
      // taken out of it now, and the ones that fail again are put back by
      // `onError`. The images that were not reached at all are put back
      // after the run.
      for (const img of retryImages) {
        failedImages.delete(img);
        // The retry is the user saying "spend on these again", so these
        // images get their turn back.
        attemptedImageKeys.delete(getImageKey(img));
        attemptedImages.delete(img);
      }
    } else if (origin === 'user') {
      failedImages.clear();
      /*
       * A user-initiated run gives every image a fresh chance.
       *
       * The observer may only pick up images it has never asked about, so
       * the "asked" marks have to go when the user asks for the page again.
       * The images that translated fine are not affected: they are excluded
       * by their own mark (`PROCESSED_CLASS`), not by this one.
       */
      attemptedImageKeys.clear();
      attemptedImages.clear();
    }
    /*
     * A follow-up run leaves the failure list alone.
     *
     * That list is the user's list of images to retry — the popup's
     * 「重新翻译失败的 N 张」 button is built from it. An automatic
     * follow-up that erased it would silently throw away the user's
     * outstanding work and make the button disappear.
     */
    /**
     * The reason the first image failed. The upstream translator folds every
     * provider error into one message, so this string is the only place the
     * root cause ("API key invalid", "rate limited") ever surfaces.
     */
    let firstErrorMessage: string | undefined;

    setState({
      status: 'translating',
      current: 0,
      total,
      currentImageIndex: 0,
      phase: 'translating',
      costNote,
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
            etaSeconds: computeEtaSeconds(),
            costNote,
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
            etaSeconds: computeEtaSeconds(),
            costNote,
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
        if (isRunDead(token) || abortController?.signal.aborted) {
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
        /*
         * 原因，每张图各留一份。
         *
         * 上游把 provider 的报错归一化过了，这里拿到的就是给读者看的那句话：
         * 原始的 provider 字符串（"401 unauthorized"）被换成读者能行动的话
         * （"API 密钥无效，请检查配置"）。
         *
         * 以前只留**第一张**的：三张图以三种原因失败，读者只被告知其中一种，
         * 而那一种很可能不是让这一轮卡住的那一种。
         */
        const reason =
          error instanceof ArtworkChangedError
            ? ARTWORK_CHANGED_MESSAGE
            : parseTranslationError(error).message;

        if (img) {
          failedImages.add(img);
          rememberImageFailure(img, index + 1, reason);
        }
        if (!firstErrorMessage) {
          firstErrorMessage = reason;
        }

        /*
         * 让页面**现在**就知道已经坏了几张。
         *
         * 以前失败只是被记下来，整轮跑完才写进状态——所以读者盯着进度条看
         * 到 100%，才知道有六张白花了钱。而进度条把失败也算成"走完了一张"，
         * 那六张在进度条上和成功的那几张长得一模一样。
         */
        if (currentState.status === 'translating') {
          setState({
            status: 'translating',
            current,
            total,
            currentImageIndex,
            phase: 'translating',
            etaSeconds: computeEtaSeconds(),
            costNote,
          });
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
        const result = await processSingleImage(
          img,
          token,
          forceRefresh,
          hit => {
            if (hit) cachedCount++;
          },
          priorityClassForImage(img, Boolean(retryImages)),
          runSignal
        );
        if (result.success) {
          successCount++;
          /*
           * 这一张图上没翻出来的地方，要记下来。
           *
           * 模型找到了气泡却没给出译文（或者有一片根本没有回答）—— 那一
           * 处还是原文，而这一轮会被记成"成功"。整轮跑完时，HUD 写着
           * 「翻译完成」，读者却看到几处日文，只当自己看漏了。
           */
          missingCount += result.missing;
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
        }
      }
    }

    /*
     * The images this run never reached.
     *
     * A run that was cancelled, or that died on a fatal error (a bad key, a
     * throttled account), must not leave the rest of the page to the
     * observer: the observer would pick them up and translate them, and the
     * user had just said "stop". They are marked as asked-about so the
     * observer leaves them alone.
     *
     * They are not lost. The next user-initiated run clears the marks, so
     * one more click on 「翻译当前页」 gives them a fresh chance.
     *
     * The generation check keeps a superseded run from writing into the
     * state of the run that took over from it: a route change and a clear
     * both reset the per-image records, and a late block from the old run
     * would put marks back into the new page's records.
     */
    if (
      translationRunGeneration === generation &&
      !isRunStale(token) &&
      (token.cancelled || fatalError || abortController?.signal.aborted)
    ) {
      for (const img of images) {
        const key = getImageKey(img);
        if (!attemptedImageKeys.has(key)) {
          attemptedImageKeys.add(key);
        }
        attemptedImages.add(img);
      }
    }

    /*
     * 这一轮已经被取代了：这一页被清过、换过章，或者页面已经卸载。
     *
     * 它拿到的一切都属于旧的那一页。不能画（上面已经拦住了），也不能写进
     * 这一页的状态——新一轮可能正在跑，旧的一轮把它的状态覆盖掉，用户会
     * 看到一个跑着的翻译突然变成"空闲"。
     */
    if (isRunStale(token)) {
      return;
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
      const refusal = describeWorkerRefusal(fatalError);
      if (refusal) {
        // The worker refused the job: nothing was sent and nothing was
        // billed, so the card has to say that, not "unknown error".
        console.error('[ContentScript] 翻译中止:', refusal.message);
        setState({ status: 'error', ...refusal });
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
    if (token.cancelled || abortController?.signal.aborted) {
      if (token.reason === 'extension-disabled') {
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
      // 跑完了，但有几处找到了却没翻出来 —— 说出来，别让「完成」把它盖住。
      missingCount,
      lastError: firstErrorMessage,
    });
  } catch (error) {
    // 这一轮已经作废了：它报出来的错属于旧的那一页，不能写进这一页的状态。
    if (!isRunStale(token)) {
      const friendly = parseTranslationError(error);
      console.error('[ContentScript] 翻译流程失败:', friendly.message);
      setState({
        status: 'error',
        message: friendly.message,
        suggestion: friendly.suggestion,
        action: resolveErrorAction(friendly),
      });
    }
  } finally {
    endRun(token);

    // The mutex is released here for every exit path, including the
    // "extension is disabled" early return. A rejected call that kept the
    // flag set would block the user's first translation after they switch
    // the extension back on.
    //
    // Only if the mutex is still ours: a run that was superseded (cancelled,
    // cleared, or replaced by a route change) must not release the mutex of
    // the run that took over from it.
    if (translationRunGeneration === generation) {
      // Read the abort state before the controller goes — after the
      // assignment below it would short-circuit to `undefined` and the
      // "stop means stop" check would always pass.
      const wasAborted = abortController?.signal.aborted === true;
      translationRunInFlight = false;
      abortController = null;

      /*
       * Images that loaded *during* this run still owe a follow-up.
       *
       * The observer's debounce is 800ms and a vision request takes ten to
       * thirty seconds, so an image that appears mid-run schedules its
       * follow-up into the one moment when a follow-up cannot happen:
       * `shouldAutoTranslateFollowUp` refuses while the page is translating,
       * and nothing reschedules afterwards. The image then sits there
       * un-translated forever on a page the reader believes is
       * auto-translating — the popup's 「滚动到它们出现后会自动继续翻译」
       * is a promise the run just broke.
       *
       * Rescheduling after the mutex goes is what closes that window. A
       * cancelled or fatally failed run does not reschedule: "stop" means
       * stop, and a provider that failed every image here will fail the
       * follow-up too, spending budget to do it.
       */
      if (
        !token.cancelled &&
        !fatalError &&
        !wasAborted &&
        isAutoContinueArmed()
      ) {
        autoTranslateScheduler.schedule();
      }
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
  /*
   * 取消发给**所有正在跑的轮次**。
   *
   * 用户按取消的时候不会先去分辨页面上跑着哪一轮，所以每一轮都要被通知到。
   * 而且取消属于这一轮：下一轮开始的时候，标志是它自己的，不会继承上一轮
   * 的取消状态。
   *
   * 这个标志是让这一轮报"已取消"而不是"完成"的东西：`cancelTranslation`
   * 会把 abortController 置空，只看 `abortController?.signal.aborted` 会
   * 短路成 undefined，于是掉进成功那条路。
   */
  for (const token of activeRuns) {
    token.cancelled = true;
    token.reason = reason;
  }
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
  // 通知 popup 取消成功，按钮状态需要更新。
  //
  // 同时带上这一页的运行标识：worker 用它精确丢掉**这一页**还没开始的
  // 请求。以前这条消息只是转发给弹窗，队列里排着的 job 一个不少地继续跑、
  // 继续发真实请求、继续计费——读者点了取消，账单还在涨。
  sendToBackground({ type: 'HUD_CANCELLED', runScope: RUN_SCOPE_ID });
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
  //
  // 这一页作废了：还在路上的那一轮拿到的一切都属于刚被清掉的页面，不能画
  // 回来，也不能记进这一页的账。以前这件事靠一个模块级布尔量记着，而那个
  // 布尔量会被下一轮清掉——旧的那一轮于是以为"我没被取消"，把答案画回用户
  // 刚清干净的页面上。纪元不会：新的一轮拿到的是新的纪元。
  invalidatePage();
  translationRunGeneration += 1;
  translationRunInFlight = false;

  if (renderer) {
    renderer.removeAll();
  }
  removeAllOverlaysFromDOM();

  readingPanel?.reset();
  readingAnchors?.reset();

  // The overlays go, the page's "asked about" marks stay.
  //
  // Clearing is not a request to translate the page again. On an
  // auto-translated host the observer is still armed, and if the marks went
  // with the overlays, the next image that loaded would bring the whole
  // page back — twenty requests the user never asked for.
  resetPerImageState({ keepAttempted: true });
  document.querySelectorAll(`.${PROCESSED_CLASS}`).forEach(img => {
    img.classList.remove(PROCESSED_CLASS);
  });

  // Clearing drops the processed-image record, so every image on the page now
  // looks new. Auto-translate on an allowlisted host re-arms on the next
  // navigation; elsewhere it re-arms when the user translates again.
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
      message: MASTER_SWITCH_OFF_MESSAGE,
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

  /*
   * 一张长条图是很多次请求。
   *
   * 右键「翻译这张图片」听起来是"翻一张"，但条漫的一"张"常常是整章，
   * 高度好几千像素；翻译管线会把它切成若干片，每片各发一次请求，也就是
   * 各记一次费。HUD 上写的是「第 1 张 / 1」——关于图片是真的，关于账单
   * 一句话都没说。用户点一下右键，账单上多出十行，而界面上只出现一个
   * "1"。
   *
   * 所以这里先算清楚片数，写进进度条下面那一行。翻译要跑几十秒，这一行
   * 在钱花出去之前就在屏幕上了，用户还来得及取消。
   */
  const tiles = computeTiles(img.naturalWidth, img.naturalHeight);
  const costNote =
    tiles.length > 1
      ? `这张图是长条，会拆成 ${tiles.length} 片分别请求（实际请求次数可能高于 ${tiles.length} 次，${describeFee(
          useContentConfigStore.getState().provider
        )}）`
      : undefined;

  setState({
    status: 'translating',
    current: 0,
    total: 1,
    currentImageIndex: 1,
    phase: 'translating',
    costNote,
  });

  /*
   * 这一轮有自己的身份。
   *
   * 右键这一条路不占整页翻译的锁，但它仍然是一轮翻译：取消要能取消它，
   * 而**上一轮**取消留下的状态不能连累它。以前取消是一个模块级布尔量，
   * 于是"取消过一次之后右键翻一张"会先把钱花出去，再在拿到结果时读到那个
   * 布尔量、以为"我被取消了"，把结果丢掉——用户付了钱，什么都没看到。
   */
  const token = beginRun();
  try {
    const result = await processSingleImage(img, token);
    processedImages.add(getImageKey(img));
    setState({
      status: 'complete',
      count: result.success ? 1 : 0,
      failedCount: result.success ? 0 : 1,
      cachedCount: result.cached ? 1 : 0,
    });
  } catch (error) {
    if (isRunStale(token)) {
      // 这一页已经不是这一页了：这一张的译文属于旧的那一页，不能报状态。
      return;
    }
    const refusal = describeWorkerRefusal(error);
    if (refusal) {
      console.error('[ContentScript] 单图翻译被拒:', refusal.message);
      setState({ status: 'error', ...refusal });
      return;
    }
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 单图翻译失败:', friendly.message);
    setState({
      status: 'error',
      message: friendly.message,
      suggestion: friendly.suggestion,
      action: resolveErrorAction(friendly),
    });
  } finally {
    endRun(token);
  }
}

/**
 * Show or hide the reading panel.
 *
 * The panel is created lazily on the first translation, so the shortcut has
 * to be able to create it on demand — otherwise pressing it before the first
 * translation would do nothing, which is exactly when a user would try it.
 *
 * A panel that has just been created starts out visible, so the toggle has to
 * treat "there was no panel" as "show it" rather than as "hide it": on a page
 * that was never translated, the first press used to create the panel and
 * immediately hide it, and the user saw nothing at all while the popup said
 * the panel was being hidden.
 */
async function toggleReadingPanel(): Promise<boolean | undefined> {
  try {
    const hadPanel = Boolean(readingPanel && readingPanel.isAttached());
    if (!hadPanel) {
      await ensureServicesInitialized();
    }
    if (!readingPanel) {
      return undefined;
    }
    readingPanel.setVisible(hadPanel ? !readingPanel.isVisible() : true);
    // 重新上报一次状态：弹窗要知道阅读面板现在是开着还是关着，否则它显示的
    // 按钮状态和页面上的实际情况对不上。
    setState(currentState);
    return readingPanel.isVisible();
  } catch (error) {
    const friendly = parseTranslationError(error);
    console.error('[ContentScript] 切换阅读面板失败:', friendly.message);
    return undefined;
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
  sendResponse: (response: ContentResponse) => void
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
      //
      // 三个数字各有各的用处：
      // - count：已经加载好、现在就能翻的图片；
      // - pending：通过了过滤但字节还没到的图片（懒加载的漫画页），它们
      //   迟早会滚进来并被自动翻译；
      // - total：这一页一共会向模型请求多少次——已经翻过的也算，因为
      //   "忽略缓存重翻"会把它们全部再翻一遍。
      const scan = scanImages();
      recordScan(scan);
      sendResponse({
        success: true,
        count: scan.translatable.length,
        pending: scan.pending,
        total: scan.translatable.length + scan.skippedDuplicate,
      });
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

    case 'FORCE_RETRANSLATE_PAGE': {
      /*
       * Forcing a re-translate is the only action here that bypasses the
       * cache and re-requests every image on the page, so it has to be
       * confirmed somewhere the user can see.
       *
       * The popup confirms in the popup (it has the image count and the
       * "a run is in progress" note). The keyboard shortcut and the context
       * menu have no popup to confirm in — the shortcut is even advertised
       * in the popup's permanent shortcut list — so the page asks instead.
       * Without this, one keypress re-requested a whole page and the only
       * feedback was 「翻译完成 成功 12」.
       */
      if (!request.confirmed) {
        const scan = scanImages();
        getForceRetranslateConfirm().open({
          // The images already on the page: the ones that are ready now plus
          // the ones that were translated before (this action ignores the
          // cache, so they are billed again).
          imageCount: scan.translatable.length + scan.skippedDuplicate,
          // ...and the ones that have not loaded yet. They are not translated
          // by this run, but with auto-continue armed they will be translated
          // and billed as soon as their bytes land. Leaving them out of the
          // sentence made it quote a floor as if it were the total.
          pending: scan.pending,
          autoContinueArmed: isAutoContinueArmed(),
          provider: useContentConfigStore.getState().provider,
          onConfirm: () => {
            void forceRetranslatePage();
          },
          onCancel: () => undefined,
        });
        sendResponse({ success: true, pendingConfirmation: true });
        return true;
      }
      void forceRetranslatePage()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    case 'CANCEL_TRANSLATION':
      cancelTranslation();
      sendResponse({ success: true });
      break;

    case 'CLEAR_ALL':
      clearAll();
      sendResponse({ success: true });
      break;

    case 'TOGGLE_READING_PANEL':
      // 回传面板现在是不是显示着：弹窗的按钮文字听页面的，不自己猜。
      toggleReadingPanel()
        .then(readingPanelVisible =>
          sendResponse({ success: true, readingPanelVisible })
        )
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
  const targets = retryTargets();

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
  //
  // 旧章的那一轮还在收尾，它拿到的一切都属于旧章：不能画到新章上，也不能
  // 记进新章的账（新章的第一张图地址常常和旧章的一样，记进去就等于把新章
  // 的图标成"已经翻过了"——用户再点多少次都没用）。纪元就是干这个的：它
  // 不会像那个模块级布尔量一样被下一轮清掉。
  cancelTranslation();
  invalidatePage();
  translationRunGeneration += 1;
  translationRunInFlight = false;

  if (renderer) {
    renderer.removeAll();
  }
  removeAllOverlaysFromDOM();

  readingPanel?.reset();
  readingAnchors?.reset();

  resetPerImageState();
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
  // 页面要走了：还在路上的那一轮拿到的一切都不作数。
  for (const token of activeRuns) {
    token.cancelled = true;
  }
  invalidatePage();
  translationRunGeneration += 1;
  translationRunInFlight = false;
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
  failureBadges?.destroy();
  failureBadges = null;
  if (failureBadgeRepositionHandler) {
    window.removeEventListener('scroll', failureBadgeRepositionHandler);
    window.removeEventListener('resize', failureBadgeRepositionHandler);
    failureBadgeRepositionHandler = null;
  }
  stopAutoTranslateObserver();
  resetPerImageState();
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

/**
 * How many follow-up auto-translate runs are left.
 *
 * The counter itself is production state; this is the read-only view of it
 * that the test surface uses. The reset that used to live here as a method
 * is inlined where it actually happens (the start of a page translation),
 * because a second way to reset it is a second way to get it wrong.
 */
function getAutoTranslateRunsRemaining(): number {
  return autoTranslateRunsRemaining;
}

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
  handleMessage,
  handleStorageChange,
  translatePage,
  getAutoTranslateRunsRemaining,
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
