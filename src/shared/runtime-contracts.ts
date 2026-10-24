import type { TextArea, ProviderType } from '@/providers/base';
import type { ContentConfigSnapshot } from '@/shared/content-config';
import type { TranslationStylePreset } from '@/utils/translation-style';
import type { ErrorAction } from '@/utils/error-handler';

interface TranslationDiagnostics {
  detectedRegions: number;
  fallbackRegions: number;
  ocrMs: number;
  translateMs: number;
  totalMs: number;
}

export type RequestedExecutionPath = 'plugin-direct' | 'ollama-direct';

/**
 * Derive the execution path based on provider type.
 * Local providers (ollama, lm-studio) use direct execution,
 * while cloud providers use plugin-mediated execution.
 */
export function deriveRequestedPath(provider: string): RequestedExecutionPath {
  return provider === 'ollama' || provider === 'lm-studio'
    ? 'ollama-direct'
    : 'plugin-direct';
}

export type JobPriorityClass =
  | 'visible-now'
  | 'next-up'
  | 'warm-cache'
  | 'manual-retry'
  | 'deferred-failure';

type JobScope = 'viewport' | 'page' | 'chapter' | 'manual';

export type FetchImageBytesResponse = {
  success: boolean;
  error?: string;
  imageBase64?: string;
  mimeType?: string;
};

export interface JobStatusPayload {
  jobId: string;
  pageKey: string;
  priorityClass: JobPriorityClass;
  requestedPath: RequestedExecutionPath;
  actualCapabilityUsed?: RequestedExecutionPath;
  scope: JobScope;
  state:
    | 'queued'
    | 'running'
    | 'partial'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  fallbackReason?: string;
  diagnostics?:
    | (TranslationDiagnostics & {
        retryCount?: number;
        cacheStatus?: 'hit' | 'miss' | 'bypass';
      })
    | null;
}

/**
 * A translation job, as it travels from a content script to the worker.
 *
 * The request carries the *work*, never the *credentials*. `provider`,
 * `apiKey`, `baseUrl` and `model` used to be part of it, which meant any
 * content script able to post a message could choose the endpoint that the
 * user's API key was sent to. The worker now resolves the provider and its
 * settings from the authoritative configuration instead, so the only endpoint
 * a request can ever reach is the one the user configured.
 */
export interface TranslateImageJobRequest {
  type: 'JOB_TRANSLATE_IMAGE';
  jobId: string;
  pageKey: string;
  scope: JobScope;
  priorityClass: JobPriorityClass;
  imageBase64: string;
  mimeType: string;
  imageUrl?: string;
  sourcePageUrl?: string;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  forceRefresh?: boolean;
  isHybridRegions?: boolean;
}

export interface TranslateImageJobResponse {
  success: boolean;
  job: JobStatusPayload;
  textAreas: TextArea[];
  /**
   * Bubbles the model found and translated but gave no box for.
   *
   * They cannot be drawn, so the page shows fewer bubbles than the model
   * found. The reader has to be told: a bubble that is still in the source
   * language while the page says "translated" is a lie.
   */
  unplacedCount?: number;
  pipeline?: 'ocr-first' | 'region-fallback' | 'full-image-fallback';
  cached?: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  error?: string;
}

/**
 * Ask the worker for the redacted configuration.
 *
 * The worker answers with a snapshot that carries no credential — see
 * `@/shared/content-config`. Content scripts use it instead of reading
 * `chrome.storage.local` themselves, so the master switch and the provider
 * settings they act on are the worker's view of the truth.
 */
export type GetConfigRequest = {
  type: 'GET_CONFIG';
};

export type GetConfigResponse = {
  success: boolean;
  config?: ContentConfigSnapshot;
  error?: string;
};

/**
 * Ask the worker to check that the configured provider is usable.
 *
 * The check needs the API key, so it cannot run in the content script: the
 * worker builds the provider from the authoritative configuration and
 * reports back only whether the configuration is valid.
 */
export type ProviderPreflightRequest = {
  type: 'PROVIDER_PREFLIGHT';
};

export type ProviderPreflightResponse = {
  success: boolean;
  valid: boolean;
  message: string;
  error?: string;
};

/**
 * The worker telling every tab that the configuration changed.
 *
 * The payload is the same redacted snapshot, so a content script can refresh
 * its view without reading storage.
 */
export type ConfigUpdatedMessage = {
  type: 'CONFIG_UPDATED';
  config: ContentConfigSnapshot;
};

// ==================== 页面状态 ====================

/**
 * Where a page is in its translation run.
 *
 * The five states a page can be in, and nothing else. The content script
 * produces them; the popup reads them.
 */
export type ContentStatus =
  | 'idle'
  | 'scanning'
  | 'translating'
  | 'complete'
  | 'error';

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
   * 还没加载完、但很可能是漫画页的图片数。
   *
   * 这是一个不同的数字：这些图迟早会滚进来，届时会被自动翻译并同样产生
   * 费用。没有它，弹窗在一章只加载了两三页的条漫上会说"本页没有找到可
   * 翻译的图片，图片通常大于 200×200 像素"——把用户送去调图片大小，而真
   * 实原因是图还没到。
   */
  pendingCount?: number;
  /**
   * 因尺寸/位置不符合要求被过滤掉的图片数。
   *
   * 以前这个数字把"已经翻译过"和"尺寸不合格"混在一起，用户看到"跳过 12 张"
   * 根本分不清是哪种情况。现在只算尺寸/位置不合格的那些。
   */
  skippedCount?: number;
  /**
   * 本页当前盖着译文的图片数。
   *
   * 「清除本页译文」在没有译文时是一个空动作：点下去会弹一个"无法撤销"
   * 的破坏性确认框，然后什么也没发生。弹窗需要这个数字才知道该不该拦
   * 这一下。
   */
  overlayCount?: number;
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
   *
   * 它同时是"预算用完了就为 false"：自动续翻有次数上限，用完之后页面
   * 不会翻译新出现的图片——这个事实必须由这一个字段说，否则 HUD 和弹窗
   * 会继续承诺一件不会发生的事。
   */
  autoContinueArmed?: boolean;
  /**
   * 这一页的自动续翻次数是不是已经用完了。
   *
   * 用完之后页面不再翻译新出现的图片，而这件事以前没有任何地方说出来：
   * 上报的 `autoContinueArmed` 还是 true，HUD 写着"滚动到它们出现后会自动
   * 继续翻译"，弹窗写着"这一页会自动翻译新加载的图片"——读者滚动、等待，
   * 什么也不会发生。
   *
   * 这个字段把"为什么不会自动翻译了"告诉弹窗：不是用户没开开关，而是这
   * 一页已经自动翻了太多次。它只在页面本来是武装状态时才有意义——主开关
   * 关着或者用户自己关了自动续翻，那是另一回事，不该用这句话解释。
   */
  autoContinueBudgetExhausted?: boolean;
  /**
   * 这一页现在有多少张图片会被「重试失败」重新请求一遍。
   *
   * 它跟 `failedCount` 不是一回事。`failedCount` 是上一轮失败的张数，而
   * 中途夭折的一轮（致命错误、超时）会把还没轮到的图片放回失败列表，却
   * 不增加那个计数——于是弹窗写着"失败 1 张"，下一次点击却会重新请求二十
   * 张。用户按之前看到的必须是真正会被计费的那几张。
   */
  retryTargetCount?: number;
  /** 阅读面板当前是否显示。 */
  readingPanelVisible?: boolean;
}

/**
 * What the content script reports to the popup.
 *
 * The popup used to keep its own, narrower copy of this shape — one that
 * dropped `failedCount`, `cachedCount`, `skippedCount` and the error repair
 * action — so a run that translated 8 images and failed 4 was reported as
 * "已完成 12 张图片". A number that hides failures is worse than no number
 * at all. One definition, one truth.
 */
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
        /**
         * Rough seconds left, once there is enough signal to estimate.
         *
         * A 20-page chapter takes minutes. "第 7 张 / 20" alone leaves the
         * user guessing whether to wait or to give up; a rough ETA is the
         * difference between "it is working" and "it is stuck". Undefined
         * means "not enough information yet" — never rendered as zero.
         */
        etaSeconds?: number;
        /**
         * What this run is about to cost, when the number of requests is not
         * the number of images.
         *
         * Right-clicking one long strip is one image and many requests: the
         * strip is cut into tiles, and each tile is a separate billed call.
         * Without this the page says "1 / 1" and never mentions the bill.
         */
        costNote?: string;
      }
    | {
        status: 'complete';
        count: number;
        failedCount?: number;
        cachedCount?: number;
        /**
         * How many spots on the page were found but not translated.
         *
         * The run finished and most of the page is translated, but some
         * bubbles are still in the source language — the model found them
         * and gave no translation, or a strip of a long image never
         * answered. "Done" and "fully translated" are different facts, and
         * the reader is the one who has to live with the difference.
         */
        missingCount?: number;
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

// ==================== 消息协议 ====================

/**
 * The one wording for "the master switch is off".
 *
 * It lives in the protocol because three contexts have to say it and they
 * must say the same thing: the worker refuses a job with it, the content
 * script stops a run with it, and the page recognises it to know the stop
 * was the switch and not a provider error. It used to be written out in
 * each of them, and the copies had already drifted — a worker refusal
 * reached the reader as 「发生未知错误」.
 */
export const MASTER_SWITCH_OFF_MESSAGE =
  '扩展已关闭，请先在弹窗中开启「启用扩展」';

/**
 * The one wording for "the provider is not set up".
 *
 * The worker says it when a job starts against a provider the reader has
 * not finished configuring — the provider can change while a chapter is in
 * the queue. The page has to recognise that same sentence to stop the run.
 */
export const PROVIDER_NOT_READY_MESSAGE =
  '当前服务商还没有配置好，请先在设置页完成配置';

/**
 * The sentences the worker uses to refuse a job, and what to tell the
 * reader next to each one.
 *
 * A refusal is not a provider error. The provider was never asked, so
 * nothing was billed and nothing about the image is wrong — the extension
 * itself is not ready. That distinction is what the page has to render: the
 * worker's own sentence, and 「打开设置」, rather than a generic error with
 * no way out.
 *
 * Every one of these fails identically for every image left on the page, so
 * the run stops on the first of them. Continuing would ask the worker
 * nineteen more times for something it has already said it cannot do — and
 * on an account that is throttled or out of credit, "ask again" is the one
 * thing that costs.
 */
export const WORKER_REFUSALS: ReadonlyArray<{
  message: string;
  suggestion: string;
}> = [
  {
    message: MASTER_SWITCH_OFF_MESSAGE,
    // The honest half of "off": requests already sent cannot be recalled,
    // and a card that hides that tells the reader the run cost nothing when
    // part of it did.
    suggestion:
      '已经发出的请求无法撤回、不会退款；重新开启后这一页可以继续翻译。',
  },
  {
    message: PROVIDER_NOT_READY_MESSAGE,
    suggestion:
      '在设置页选好服务商、填好接口地址或 API Key，再翻一次这一页。本次没有发出任何请求，不会产生费用。',
  },
];

/**
 * Is this failure one of the worker's own refusals?
 *
 * Matching is `includes`, not equality: the translator folds the worker's
 * message into an Error, and the retry path can append its own note to the
 * end of it.
 *
 * A refusal that matches here stops the whole run — the page asks
 * `isFatalTranslationError` on the way, so the check and the rendering read
 * the same table and cannot disagree about whether a message is a refusal.
 */
export function findWorkerRefusal(
  message: string | undefined
): { message: string; suggestion: string } | undefined {
  if (!message) {
    return undefined;
  }
  return WORKER_REFUSALS.find(refusal => message.includes(refusal.message));
}

/**
 * The content script telling the worker that an image came from the cache.
 *
 * A cache hit is a translation that cost nothing: no request went out, no
 * tokens were spent. The user still wants to see it counted — 「缓存命中
 * 62%」 is how they know the cache is doing its job — so it has to be
 * recorded somewhere.
 *
 * The content script used to write that record itself, and that is why the
 * monthly totals lived in two places: the calls the worker billed were in
 * the worker's accumulator, the hits the page served were in the page's
 * own. Two accumulators per context, and the list grew by one every time a
 * context started.
 *
 * The worker is the one context that records usage, so the page tells it
 * and the worker writes. The message carries no money and no text: it only
 * says "this provider served one image from the cache".
 */
export type RecordCacheHitMessage = {
  type: 'RECORD_CACHE_HIT';
  provider: ProviderType;
};

/**
 * Messages the popup and the keyboard commands send to the content script.
 *
 * One definition, shared by every sender. The popup used to keep its own
 * copy of this union, and the two had already drifted: the popup's copy was
 * missing `TRANSLATE_SINGLE_IMAGE`, so a message the content script handled
 * did not type-check on the sender's side.
 */
export type PopupToContentMsg =
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_PAGE' }
  | {
      type: 'FORCE_RETRANSLATE_PAGE';
      /**
       * The sender already asked the user.
       *
       * Forcing a re-translate is the one action that bypasses the cache and
       * re-requests every image on the page, so it has to be confirmed
       * somewhere the user can see. The popup confirms in the popup; the
       * keyboard shortcut and the context menu have no popup to confirm in,
       * so the page asks instead. This flag says "the question has already
       * been asked" — without it, the popup's own confirmation would be
       * followed by a second one in the page.
       */
      confirmed?: boolean;
    }
  | { type: 'FORCE_RETRANSLATE_FAILED' }
  | { type: 'CANCEL_TRANSLATION' }
  | { type: 'CLEAR_ALL' }
  | { type: 'COUNT_IMAGES' }
  | { type: 'TOGGLE_READING_PANEL' }
  | { type: 'DISARM_PAGE_AUTO_TRANSLATE' }
  | { type: 'TRANSLATE_SINGLE_IMAGE'; imageUrl: string };

/**
 * The answer to `COUNT_IMAGES`.
 *
 * "这一页有几张图"有三个诚实的答案，缺一个就是在骗用户的钱包：
 *
 * - `count`：已经加载好、现在就能翻的张数；
 * - `pending`：通过了过滤、但字节还没到的张数（懒加载的漫画页），它们
 *   迟早会滚进来，届时会被自动翻译并同样产生费用；
 * - `total`：一次全页重翻会请求多少张——已经翻过的也算，因为"忽略缓存
 *   重翻"会把它们全部再翻一遍。还没加载的图片不在其中：它们不在这一轮里，
 *   会不会被翻取决于自动续翻。
 *
 * 以前只有 `count`，而且它只数已经加载出来的图：一章四十页的漫画只报了
 * 两三张。一个系统性偏低的数字比没有数字更糟。
 */
export interface CountImagesResponse {
  success: boolean;
  /** 已加载、现在就能翻译的图片数。 */
  count?: number;
  /** 通过了过滤、但字节还没到的图片数。 */
  pending?: number;
  /** 一次全页重翻会请求的图片数（已翻过的也算）。 */
  total?: number;
  error?: string;
}

/**
 * What the content script answers with.
 *
 * One shape for every message, so the sender and the receiver cannot drift
 * apart — the popup used to keep its own, narrower copy.
 */
export interface ContentResponse extends CountImagesResponse {
  state?: ContentState;
  /**
   * The page asked the user to confirm instead of acting.
   *
   * A force-re-translate that was not confirmed yet puts a confirmation in
   * the page and answers with this flag, so the sender knows the run has not
   * started yet.
   */
  pendingConfirmation?: boolean;
  /**
   * 阅读面板现在是不是显示着。
   *
   * 只有页面知道答案。弹窗以前自己猜——翻转一下按钮上的字，结果在一页
   * 从没翻过的页面上，它声称"隐藏面板"而页面上什么都没有。
   */
  readingPanelVisible?: boolean;
}

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

/**
 * Messages the content script sends to the extension.
 */
export type ContentToPopupMsg =
  | { type: 'STATE_UPDATE'; state: ContentState }
  | { type: 'READY' }
  | { type: 'HUD_CANCELLED' };

/**
 * The keyboard-command messages.
 *
 * A subset of `PopupToContentMsg`: the shortcuts the browser registers can
 * only ask for a page-level action.
 */
export type CommandAction =
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'CLEAR_ALL' }
  | { type: 'TOGGLE_READING_PANEL' };

/**
 * The right-click "translate this image" message.
 *
 * `imageUrl` is the address Chrome reports for the right-clicked image. It
 * may be a thumbnail or another CDN size, and need not match the page's
 * `img.src`, so the URL travels as-is and the content script matches it
 * against the closest image.
 */
export type TranslateSingleImageMessage = {
  type: 'TRANSLATE_SINGLE_IMAGE';
  imageUrl: string;
};
