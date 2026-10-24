import { hostMatchesAllowlist, isSupportedPageUrl } from '@/shared/app-config';
import {
  SKIPPED_IMAGES_REASON,
  describeFee,
  describePendingImages,
  describeRequestCount,
} from '@/shared/cost-wording';

export interface PageAvailability {
  state: 'ready' | 'unsupported' | 'needs-refresh';
  message: string;
  canRefresh: boolean;
  canRetry: boolean;
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
 * 但真正决定行为的条件有四件事：
 *
 *   1. 主开关关着 → 什么都不做。
 *   2. 主人在白名单里 → **每次打开这个站的页面，整页图片都会被自动翻译
 *      并计费**。这一条跟「自动续翻」没有任何关系：worker 判断名单的时
 *      候（background/auto-translate.ts）只看得懂主开关和名单，页面打开
 *      时收到的 TRANSLATE_PAGE 会翻译整页。
 *   3. 「自动续翻」开着 +（白名单命中 || 用户手动翻过本页）→ 页面打开之
 *      后新加载进来的图片也会被自动翻译并计费。
 *   4. 三个开关都摆在那儿，用户却只能看到其中三个：真正发生的是第 2 和
 *      第 3 种组合，而弹窗上没有任何一处写着它们。
 *
 * 弹窗以前对白名单站点说的是"「自动续翻」关着，所以不会自动翻译"——那是
 * 假的：白名单站点照样每次打开都整页自动翻译、照样扣费，而它给的按钮
 * 「打开自动续翻」既修不了这件事，还会再开一条扣费的来源。
 */
interface AutoTranslateDescription {
  /** 这一页现在会不会自动翻译新加载的图片。 */
  armed: boolean;
  /** 提示的口气：active 是"正在花钱"，idle 是"不会花钱"。 */
  tone: 'active' | 'idle';
  /** 一句话说明真实状态。 */
  message: string;
  /**
   * 用户能按的一个按钮，没有可做的事时是 undefined。
   *
   * 只有两种：把这一页停下来（stop-page），或者把这个站从名单里去掉
   * （remove-host）。以前还有第三种"打开自动续翻"，但它跟"让这个站别再
   * 自动翻译"没有关系——那是一个会继续花钱的开关，不是修复手段。
   */
  action?: {
    label: string;
    kind: 'stop-page' | 'remove-host';
  };
}

export function describeAutoTranslate(args: {
  /** 页面脚本报上来的真实状态。 */
  armed?: boolean;
  /**
   * 这一页的自动续翻次数是不是用完了。
   *
   * 用完之后页面不会再翻译新出现的图片，而这不是"没开开关"——是这一页已经
   * 自动翻了太多次。弹窗以前只有 armed 一个字段，于是这两种状态被说成同一
   * 句话，读者分不清自己该去开开关还是该重新翻一次。
   */
  budgetExhausted?: boolean;
  /** 本站是不是在白名单里。 */
  hostAllowlisted: boolean;
  /** 「自动续翻」这个设置本身开没开。 */
  autoContinueEnabled: boolean;
  /** 主开关开没开。 */
  masterEnabled: boolean;
  /**
   * 用的是哪个服务商。
   *
   * 本地服务商的请求不花钱，自动翻译对这样的读者不是一件要算钱的事——
   * 弹窗却在每一句关于"自动翻译"的提示里写着"会产生费用"。
   */
  provider?: string | null;
}): AutoTranslateDescription {
  const {
    armed,
    budgetExhausted,
    hostAllowlisted,
    autoContinueEnabled,
    masterEnabled,
    provider,
  } = args;
  const fee = describeFee(provider);

  if (!masterEnabled) {
    return {
      armed: false,
      tone: 'idle',
      message: '扩展已关闭，不会自动翻译。',
    };
  }

  if (hostAllowlisted) {
    /*
     * 名单里的站点：每次打开都会整页自动翻译并计费。
     *
     * 这一段以前写的是"名单里的站点在「自动续翻」关着时不会自动翻译"，
     * 那是假的，而且它指向的按钮（打开自动续翻）根本改不了这件事。
     */
    const parts = [
      `本站在自动翻译名单里：每次打开它的页面都会自动翻译整页图片（${fee}）。`,
    ];
    if (armed) {
      parts.push('本页打开时已自动翻译过整页。');
    }
    parts.push(
      budgetExhausted
        ? '这一页的自动续翻已经用完次数，新出现的图片不会再自动翻译（不会产生费用）。'
        : autoContinueEnabled
          ? '页面打开后新出现的图片也会自动翻译。'
          : '「自动续翻」是关的，所以页面打开后新出现的图片不会自动翻译。'
    );
    return {
      armed: armed === true,
      tone: 'active',
      message: parts.join(''),
      action: { label: '关闭本站自动翻译', kind: 'remove-host' },
    };
  }

  if (budgetExhausted) {
    /*
     * The budget on this page is spent.
     *
     * The popup used to fall through to "「自动续翻」已打开，但本站不在名单
     * 里，本页也没有手动翻译过" — which is false in every part: the setting
     * is on, and the page *was* translated. The reader was told to check a
     * switch that was already on, and the real reason (this page has been
     * auto-translating too many times) never came up.
     *
     * It also has to be said that nothing more will be charged, because
     * "it stopped" reads like a failure. And it has to say how to start it
     * again: one press of the translate button refills the budget.
     */
    return {
      armed: false,
      tone: 'idle',
      message:
        '这一页的自动续翻已经用完次数，新出现的图片不会再自动翻译（不会产生费用）。再点一次「翻译当前页面」可以重新开始。',
    };
  }

  if (armed) {
    // 正在自动翻译：这句话要说得让人敢去关掉它。
    return {
      armed: true,
      tone: 'active',
      message: `这一页会自动翻译新加载的图片（${fee}）。`,
      action: { label: '本页不再自动翻译', kind: 'stop-page' },
    };
  }

  if (autoContinueEnabled) {
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
type PrimaryActionBlocker =
  | 'none'
  | 'extension-disabled'
  | 'provider-unconfigured'
  | 'page-unsupported'
  | 'page-unreachable';

interface PrimaryActionState {
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
interface ResultSummary {
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
  retryTargetCount?: number;
  cachedCount?: number;
  skippedCount?: number;
  skippedDuplicateCount?: number;
  pendingCount?: number;
  missingCount?: number;
}): ResultSummary {
  const failed = state.failedCount ?? 0;
  /*
   * The number the user can act on is not "how many failed in the last
   * run" but "how many are still untranslated".
   *
   * The last run's counter goes back to zero the moment a run succeeds,
   * while the failures from an earlier run stay on the retry list. The
   * popup used to quote the counter: it said "成功翻译 2 张" with no
   * mention of the three images that were still waiting, and the button
   * right below it offered to re-request three. Two numbers for one fact,
   * and only one of them true.
   */
  const outstanding = state.retryTargetCount ?? failed;
  const cached = state.cachedCount ?? 0;
  const filtered = state.skippedCount ?? 0;
  const duplicate = state.skippedDuplicateCount ?? 0;
  /*
   * 这一页跑完了，但有几处找到了却没翻出来。
   *
   * 「成功翻译 12 张」说的是"翻了 12 张"，不是"这一页每一句都翻了"。
   * 模型给了气泡却没给译文的那几处留在画面上还是原文，而弹窗以前只说
   * 成功 —— 读者只当自己看漏了。
   */
  const missing = state.missingCount ?? 0;
  const details: string[] = [];

  if (state.count > 0) {
    if (cached > 0) {
      details.push(`${cached} 张来自缓存（没有产生费用）`);
    }
    if (outstanding > 0) {
      details.push(`${outstanding} 张待重试`);
    }
    if (missing > 0) {
      details.push(`有 ${missing} 处文字没有翻出来（仍是原文）`);
    }
    if (filtered > 0) {
      details.push(`${filtered} 张被忽略（${SKIPPED_IMAGES_REASON}）`);
    }
    return {
      tone: outstanding > 0 || missing > 0 ? 'warning' : 'success',
      title: `成功翻译 ${state.count} 张`,
      details,
    };
  }

  if (outstanding > 0) {
    return {
      tone: 'warning',
      title: `没有翻译成功（${outstanding} 张待重试）`,
      details: ['查看下面的失败原因，改完配置再重试。'],
    };
  }

  if (duplicate > 0) {
    details.push(
      filtered > 0
        ? `另有 ${filtered} 张被忽略（${SKIPPED_IMAGES_REASON}）。`
        : ''
    );
    /*
     * The reader pressed the main button and the product says "nothing to
     * do". The one action that does something about it — re-translating
     * without the cache — sits further down the popup, so the card used to
     * be a dead end.
     */
    details.push('想重新翻译，用下面的「忽略缓存重翻」。');
    return {
      tone: 'neutral',
      title: `本页 ${duplicate} 张图片已经翻译过了`,
      details: details.filter(Boolean),
    };
  }

  /*
   * Nothing was translated and the page still has images on its way.
   *
   * The two "nothing to translate" stories look the same from the outside
   * and lead to opposite actions: "the images are too small" sends the user
   * off to resize them, while "the images have not arrived yet" sends them
   * to scroll. Guessing wrong is worse than saying nothing, so the pending
   * count gets its own answer.
   */
  const pending = state.pendingCount ?? 0;
  if (pending > 0) {
    return {
      tone: 'neutral',
      title: '图片还在加载中',
      details: [
        `本页有 ${pending} 张图片尚未加载完成，滚动页面让它们出现后再试。`,
        filtered > 0
          ? `另有 ${filtered} 张被忽略（${SKIPPED_IMAGES_REASON}）。`
          : '',
      ].filter(Boolean),
    };
  }

  if (filtered > 0) {
    return {
      tone: 'neutral',
      title: '本页没有可翻译的图片',
      details: [`${filtered} 张被忽略（${SKIPPED_IMAGES_REASON}）。`],
    };
  }

  return {
    tone: 'neutral',
    title: '本页没有找到可翻译的图片',
    details: ['漫画页面上的图片通常大于 200×200 像素，且不在页眉页脚里。'],
  };
}

/**
 * The two things the popup says before the user spends anything.
 *
 * They are two different kinds of fact, and the popup used to print them as
 * one paragraph:
 *
 * - the headline is about *this page* — how many images are ready, and what
 *   translating them costs;
 * - the caveat is about *how billing works* — one image can turn into
 *   several requests.
 *
 * Printed together they read as a wall, and the number the user actually
 * needs ("2 images, this costs money") was the first line of a six-line
 * paragraph. Split, the headline can be the loud part and the caveat the
 * reference part — still visible, still true, but not competing with the
 * button it belongs to.
 */
export interface ImageCountSummary {
  /** What pressing the button will cost, in terms of this page. */
  headline: string;
  /** Why the request count can be higher than the image count. */
  caveat: string;
}

/**
 * The line that tells the user what pressing the button will cost.
 *
 * The count comes from a read-only scan, so the user sees it before any
 * request is made. Without it the only number the popup ever showed was the
 * one *after* the money was gone.
 *
 * The scan also counts the images that have *not* loaded yet. A webtoon
 * reader shows two or three pages and keeps forty more in the wings, so a
 * count that only knows about the loaded ones is systematically low — and a
 * number that is wrong in the user's favour is worse than no number, because
 * they weigh it against the price.
 *
 * `alreadyTranslated` is how many of this page's images have been translated
 * before. They are not in `count` — the button would not translate them
 * again — but their absence is not the same as their not being there: a page
 * that has been fully translated reports zero, and "this page has no
 * translatable images" sends the reader off to resize images that are
 * perfectly fine.
 */
export function describeImageCount(
  count: number | null,
  pending: number | null = null,
  autoContinueEnabled: boolean = true,
  provider?: string | null,
  alreadyTranslated: number = 0
): ImageCountSummary {
  const fee = describeFee(provider);
  const caveat = describeRequestCount(provider);
  if (count === null) {
    /*
     * 数量没数出来，不等于不用花钱。
     *
     * 这一行以前是空的，于是「翻译当前页面」按钮在屏幕上独自出现，旁边
     * 一句「这要花钱」都没有 —— 而按钮是亮的，可以按。计价的告知不该
     * 取决于我们数没数得出来：数不出来的时候，说明的是"我们还不知道
     * 多少张"，不是"这次不花钱"。
     */
    return {
      headline: `本页可翻译的图片数量还没数出来；翻译会调用模型服务，${fee}。`,
      caveat,
    };
  }
  const pendingCount = pending ?? 0;
  /*
   * Whether the pending images will be translated is not a fact about the
   * page — it is a fact about the settings. The observer only arms when
   * auto-continue is on, so promising it without saying so is a promise
   * about a bill the user may not be charged. The sentence itself lives in
   * `cost-wording` because the in-page confirmation says it too.
   */
  const pendingLine = describePendingImages(pendingCount, autoContinueEnabled);
  if (count <= 0) {
    if (pendingCount > 0) {
      return {
        headline: autoContinueEnabled
          ? `本页有 ${pendingCount} 张图片还在加载，加载后会被自动翻译，${fee}。`
          : `本页有 ${pendingCount} 张图片还在加载；自动续翻是关着的，需要再点一次翻译才会处理它们。`,
        caveat,
      };
    }
    /*
     * 这一页的图已经翻过了。
     *
     * 「本页没有可翻译的图片」是一句会把人送去改图片大小的话，而真相是
     * 这一页的图全都翻好了、根本不需要再翻。弹窗下面那张结果卡片说的
     * 是后者，按钮上方这句说的是前者 —— 同一页，两句互相打架的话。
     */
    if (alreadyTranslated > 0) {
      return {
        headline: `本页 ${alreadyTranslated} 张图片已经翻译过了。`,
        caveat: '想重新翻译，用下面的「忽略缓存重翻」。',
      };
    }
    // 没有图，也就不会有请求 —— 这时候说"一次请求可能变多次"是噪音。
    return { headline: '本页没有可翻译的图片。', caveat: '' };
  }
  return {
    headline: `本页 ${count} 张可翻译图片，翻译会调用模型服务，${fee}。${pendingLine}`,
    caveat,
  };
}

/**
 * The cost note that belongs next to the auto-translate switch.
 *
 * Auto-translation is the one switch in the extension that spends money
 * without the user pressing anything. The switch used to say only that the
 * site would be translated on load, and the sentence about what that costs
 * was buried in a collapsed panel — the one warning in the whole product that
 * nobody could see.
 */
/**
 * The note next to the switch that arms automatic translation.
 *
 * It says what automatic translation costs, so it says it for the provider
 * the reader actually chose.
 */
export function describeAutoTranslateCost(provider?: string | null): string {
  return `打开页面时自动翻译，${describeFee(provider)}`;
}
