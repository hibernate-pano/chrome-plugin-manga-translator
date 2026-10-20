import { hostMatchesAllowlist } from '@/shared/app-config';

export interface PageAvailability {
  state: 'ready' | 'unsupported' | 'needs-refresh';
  message: string;
  canRefresh: boolean;
  canRetry: boolean;
}

const UNSUPPORTED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'moz-extension:',
  'file:',
];

export function isSupportedPageUrl(url?: string): boolean {
  if (!url) {
    return false;
  }

  return !UNSUPPORTED_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

export function getPageAvailability(args: {
  url?: string;
  contentScriptReachable: boolean;
}): PageAvailability {
  const { url, contentScriptReachable } = args;

  if (!isSupportedPageUrl(url)) {
    return {
      state: 'unsupported',
      message: '当前页面不支持扩展脚本，请切换到普通网页中的漫画页面。',
      canRefresh: false,
      canRetry: false,
    };
  }

  if (!contentScriptReachable) {
    return {
      state: 'needs-refresh',
      message: '当前页面尚未准备好，请刷新页面后重试。',
      canRefresh: true,
      canRetry: true,
    };
  }

  return {
    state: 'ready',
    message: '',
    canRefresh: false,
    canRetry: false,
  };
}

/**
 * Which allowlist entries actually authorise auto-translation of `url`.
 *
 * The switch used to compare the current hostname against the stored list with
 * a plain `includes`, so a `*.example.com` entry — which the worker does treat
 * as covering the page — showed as off. Worse, switching it off then removed
 * only an exact host entry, leaving the wildcard in place and the switch
 * snapping straight back on. Both halves now go through the same matcher the
 * background worker uses, so the switch cannot disagree with the behaviour.
 */
export function matchingAllowlistEntries(
  url: string | null,
  hosts: readonly string[]
): string[] {
  if (!url) {
    return [];
  }
  return hosts.filter(entry => hostMatchesAllowlist(url, [entry]));
}

export function isHostAutoTranslated(
  url: string | null,
  hosts: readonly string[]
): boolean {
  return matchingAllowlistEntries(url, hosts).length > 0;
}

/**
 * 弹窗上"这一页会不会自动开始翻译"这件事的真实状态。
 *
 * 弹窗里有三个开关：主开关、「自动翻译本站」（白名单）、「自动续翻」。
 * 但真正决定行为的条件是四个：
 *
 *   主开关 && 自动续翻 &&（本站在白名单 || 用户手动翻译过本页）
 *
 * 三个开关摆在一起，用户只能看到其中三个，而真正发生的是第四种组合：
 * 两个开关都关着，但用户刚才手动翻译过这一页，于是"自动续翻"照样生效，
 * 新加载的图片会自己送去翻译并扣费。弹窗上没有任何一处写着这件事。
 */
export interface AutoTranslateStatus {
  /** 这一页现在会不会自动翻译新加载的图片。 */
  armed: boolean;
  /** 提示的口气：active 是"正在花钱"，blocked 是"你设的那件事没生效"。 */
  tone: 'active' | 'blocked' | 'idle';
  /** 一句话说明真实状态。 */
  message: string;
  /** 用户能按的一个按钮，没有可做的事时是 undefined。 */
  action?: {
    label: string;
    kind: 'enable-continue' | 'stop-page' | 'remove-host';
  };
}

export function describeAutoTranslate(args: {
  /** 页面脚本报上来的真实状态。 */
  armed?: boolean;
  /** 本站是不是在白名单里。 */
  hostAllowlisted: boolean;
  /** 「自动续翻」这个设置本身开没开。 */
  autoContinueEnabled: boolean;
  /** 主开关开没开。 */
  masterEnabled: boolean;
}): AutoTranslateStatus {
  const { armed, hostAllowlisted, autoContinueEnabled, masterEnabled } = args;

  if (!masterEnabled) {
    return {
      armed: false,
      tone: 'idle',
      message: '扩展已关闭，不会自动翻译。',
    };
  }

  if (armed) {
    // 正在自动翻译：这句话要说得让人敢去关掉它。
    return {
      armed: true,
      tone: 'active',
      message: '这一页会自动翻译新加载的图片，会继续产生费用。',
      action: hostAllowlisted
        ? { label: '关闭本站自动翻译', kind: 'remove-host' }
        : { label: '本页不再自动翻译', kind: 'stop-page' },
    };
  }

  if (hostAllowlisted && !autoContinueEnabled) {
    // 用户把本站加进了名单，却把「自动续翻」关着：名单不会生效。
    // 以前这里什么都不说，用户以为站点已经设好了。
    return {
      armed: false,
      tone: 'blocked',
      message:
        '本站已加入自动翻译名单，但「自动续翻」是关的，所以不会自动翻译。',
      action: { label: '打开自动续翻', kind: 'enable-continue' },
    };
  }

  if (autoContinueEnabled && !hostAllowlisted) {
    return {
      armed: false,
      tone: 'idle',
      message:
        '「自动续翻」已打开，但本站不在自动翻译名单里，本页也没有手动翻译过，所以不会自动翻译。',
    };
  }

  return {
    armed: false,
    tone: 'idle',
    message: '当前不会自动翻译。',
  };
}

/**
 * Why the primary "translate this page" action is unavailable.
 *
 * The master switch has to be part of this. It used to gate only the
 * automatic paths, so a user who turned the extension off could still press
 * the button and get a real, billed API call — while the UI promised "关闭后
 * 不会请求任何模型". Turning the switch off has to mean off.
 */
export type PrimaryActionBlocker =
  | 'none'
  | 'extension-disabled'
  | 'provider-unconfigured'
  | 'page-unsupported'
  | 'page-unreachable';

export interface PrimaryActionState {
  /** Can the primary action be pressed right now? */
  canTranslate: boolean;
  /** Why not, when it cannot. */
  blocker: PrimaryActionBlocker;
  /** The reason, phrased for a human to read. */
  message: string;
  /** The name of the provider, for messages that name it. */
  providerLabel: string;
}

export function getPrimaryActionState(args: {
  enabled: boolean;
  providerConfigured: boolean;
  availability: PageAvailability;
  providerLabel: string;
}): PrimaryActionState {
  const { enabled, providerConfigured, availability, providerLabel } = args;

  if (!enabled) {
    return {
      canTranslate: false,
      blocker: 'extension-disabled',
      message: '扩展已关闭，开启后才能翻译。',
      providerLabel,
    };
  }
  if (!providerConfigured) {
    return {
      canTranslate: false,
      blocker: 'provider-unconfigured',
      // The message used to point at "设置页" and stop there. The popup has
      // one settings icon in the corner, 16 pixels wide, with no text — so
      // the instruction sent a new user to the browser's own settings page.
      // The popup now renders a button next to this line; the wording names
      // the thing they are about to do.
      message: `还没有配置 ${providerLabel}，点下面的按钮去填 API Key。`,
      providerLabel,
    };
  }
  if (availability.state === 'unsupported') {
    return {
      canTranslate: false,
      blocker: 'page-unsupported',
      message: availability.message,
      providerLabel,
    };
  }
  if (availability.state === 'needs-refresh') {
    return {
      canTranslate: false,
      blocker: 'page-unreachable',
      message: availability.message,
      providerLabel,
    };
  }
  return {
    canTranslate: true,
    blocker: 'none',
    message: '',
    providerLabel,
  };
}

/**
 * How the popup should read after a run.
 *
 * `tone` drives the icon and the colour; `title` is the one line the user
 * reads first.
 */
export interface ResultSummary {
  tone: 'success' | 'neutral' | 'warning';
  title: string;
  details: string[];
}

/**
 * What the popup says after a translation run.
 *
 * A run that translated nothing is not a success, and the popup used to say
 * so: it printed "成功 0 张，14 张已跳过" under a green tick. A user who
 * pressed translate twice on the same page read that as "it worked but there
 * was nothing to do", concluded the extension was broken, and reached for
 * the force-retranslate button — which ignores the cache and re-bills the
 * whole page. The three cases are told apart now: something was translated,
 * the page had already been translated, or the page had nothing translatable
 * in it at all.
 */
export function buildResultSummary(state: {
  count: number;
  failedCount?: number;
  cachedCount?: number;
  skippedCount?: number;
  skippedDuplicateCount?: number;
}): ResultSummary {
  const failed = state.failedCount ?? 0;
  const cached = state.cachedCount ?? 0;
  const filtered = state.skippedCount ?? 0;
  const duplicate = state.skippedDuplicateCount ?? 0;
  const details: string[] = [];

  if (state.count > 0) {
    if (cached > 0) {
      details.push(`${cached} 张来自缓存（没有产生费用）`);
    }
    if (failed > 0) {
      details.push(`${failed} 张失败`);
    }
    if (filtered > 0) {
      details.push(`${filtered} 张因尺寸或位置被忽略`);
    }
    return {
      tone: failed > 0 ? 'warning' : 'success',
      title: `成功翻译 ${state.count} 张`,
      details,
    };
  }

  if (failed > 0) {
    return {
      tone: 'warning',
      title: `没有翻译成功（${failed} 张失败）`,
      details: ['查看下面的失败原因，改完配置再重试。'],
    };
  }

  if (duplicate > 0) {
    details.push(filtered > 0 ? `另有 ${filtered} 张因尺寸或位置被忽略。` : '');
    return {
      tone: 'neutral',
      title: `本页 ${duplicate} 张图片已经翻译过了`,
      details: details.filter(Boolean),
    };
  }

  if (filtered > 0) {
    return {
      tone: 'neutral',
      title: '本页没有可翻译的图片',
      details: [`${filtered} 张因尺寸过小或不在正文区域被忽略。`],
    };
  }

  return {
    tone: 'neutral',
    title: '本页没有找到可翻译的图片',
    details: ['漫画页面上的图片通常大于 200×200 像素，且不在页眉页脚里。'],
  };
}

/**
 * The line that tells the user what pressing the button will cost.
 *
 * The count comes from a read-only scan, so the user sees it before any
 * request is made. Without it the only number the popup ever showed was the
 * one *after* the money was gone.
 */
export function describeImageCount(count: number | null): string {
  if (count === null) {
    return '';
  }
  if (count <= 0) {
    return '本页没有可翻译的图片。';
  }
  return `本页 ${count} 张可翻译图片，翻译会调用模型服务并产生费用。`;
}
