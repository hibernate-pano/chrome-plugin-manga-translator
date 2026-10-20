import type { TextArea } from '@/providers/base';
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

// ==================== 消息协议 ====================

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
