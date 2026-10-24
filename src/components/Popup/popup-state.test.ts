import { describe, expect, it } from 'vitest';

import { describeForceRetranslate } from '@/shared/cost-wording';
import {
  buildResultSummary,
  describeAutoTranslate,
  describeImageCount,
  getPageAvailability,
  getPrimaryActionState,
  isHostAutoTranslated,
  matchingAllowlistEntries,
  type PageAvailability,
} from './popup-state';

describe('popup page availability', () => {
  it('returns unsupported availability for unsupported urls', () => {
    expect(
      getPageAvailability({
        url: 'chrome://extensions',
        contentScriptReachable: false,
      })
    ).toMatchObject({
      state: 'unsupported',
      canRefresh: false,
      canRetry: false,
    });
  });

  it('returns refresh-needed availability when content script is unreachable', () => {
    expect(
      getPageAvailability({
        url: 'https://example.com/chapter/1',
        contentScriptReachable: false,
      })
    ).toMatchObject({
      state: 'needs-refresh',
      canRefresh: true,
      canRetry: true,
    });
  });

  it('returns ready availability when page is supported and reachable', () => {
    expect(
      getPageAvailability({
        url: 'https://example.com/chapter/1',
        contentScriptReachable: true,
      })
    ).toMatchObject({
      state: 'ready',
      canRefresh: false,
      canRetry: false,
    });
  });
});

describe('allowlist switch reflects the worker matcher', () => {
  // The switch compared the current host to the stored list with a plain
  // `includes`, so a wildcard entry that the worker honoured showed as off —
  // and switching off removed only an exact host, leaving the wildcard in
  // place. Both halves must go through the same matcher the worker uses.
  it('treats a wildcard entry as covering a subdomain', () => {
    const hosts = ['*.example.com'];
    expect(
      isHostAutoTranslated('https://manga.example.com/chapter-1', hosts)
    ).toBe(true);
    expect(
      matchingAllowlistEntries('https://manga.example.com/', hosts)
    ).toEqual(['*.example.com']);
  });

  it('reports off for an unrelated host', () => {
    expect(
      isHostAutoTranslated('https://notexample.com/', ['example.com'])
    ).toBe(false);
  });

  it('returns no match when the tab url is unknown', () => {
    expect(matchingAllowlistEntries(null, ['example.com'])).toEqual([]);
    expect(isHostAutoTranslated(null, ['example.com'])).toBe(false);
  });

  it('returns every entry that matches so all of them can be removed', () => {
    const hosts = ['manga.example.com', '*.example.com', 'other.com'];
    expect(
      matchingAllowlistEntries('https://manga.example.com/chapter-1', hosts)
    ).toEqual(['manga.example.com', '*.example.com']);
  });

  it('scopes a port-bearing entry to that port', () => {
    expect(
      isHostAutoTranslated('http://localhost:8080/read', ['localhost:8080'])
    ).toBe(true);
    expect(
      isHostAutoTranslated('http://localhost:9999/admin', ['localhost:8080'])
    ).toBe(false);
  });
});

describe('primary action gating', () => {
  const ready: PageAvailability = {
    state: 'ready',
    message: '',
    canRefresh: false,
    canRetry: false,
  };

  it('allows translating when everything is configured', () => {
    const state = getPrimaryActionState({
      enabled: true,
      providerConfigured: true,
      availability: ready,
      providerLabel: 'Ollama',
    });
    expect(state.canTranslate).toBe(true);
    expect(state.blocker).toBe('none');
    expect(state.message).toBe('');
  });

  // The master switch used to gate only the automatic paths. Turning the
  // extension off still left the button live, so a billed API call could go
  // out while the UI promised "关闭后不会请求任何模型". Off has to mean off.
  it('blocks the primary action when the extension is disabled', () => {
    const state = getPrimaryActionState({
      enabled: false,
      providerConfigured: true,
      availability: ready,
      providerLabel: 'Ollama',
    });
    expect(state.canTranslate).toBe(false);
    expect(state.blocker).toBe('extension-disabled');
    expect(state.message).toContain('开启');
  });

  it('blocks the primary action when the provider is not configured', () => {
    const state = getPrimaryActionState({
      enabled: true,
      providerConfigured: false,
      availability: ready,
      providerLabel: 'LM Studio',
    });
    expect(state.canTranslate).toBe(false);
    expect(state.blocker).toBe('provider-unconfigured');
    expect(state.message).toContain('LM Studio');
  });

  it('blocks the primary action on an unsupported page', () => {
    const state = getPrimaryActionState({
      enabled: true,
      providerConfigured: true,
      availability: {
        state: 'unsupported',
        message: '当前页面不支持扩展脚本。',
        canRefresh: false,
        canRetry: false,
      },
      providerLabel: 'Ollama',
    });
    expect(state.canTranslate).toBe(false);
    expect(state.blocker).toBe('page-unsupported');
  });

  it('blocks the primary action when the content script is unreachable', () => {
    const state = getPrimaryActionState({
      enabled: true,
      providerConfigured: true,
      availability: {
        state: 'needs-refresh',
        message: '当前页面尚未准备好，请刷新页面后重试。',
        canRefresh: true,
        canRetry: true,
      },
      providerLabel: 'Ollama',
    });
    expect(state.canTranslate).toBe(false);
    expect(state.blocker).toBe('page-unreachable');
  });

  it('reports the disabled switch before anything else', () => {
    // A disabled extension with an unconfigured provider is still "off"
    // first: the message has to tell the user what to do about the switch.
    const state = getPrimaryActionState({
      enabled: false,
      providerConfigured: false,
      availability: ready,
      providerLabel: 'Ollama',
    });
    expect(state.blocker).toBe('extension-disabled');
  });
});

describe('这一页到底会不会自动翻译', () => {
  it('says so when the page is armed and the user did not ask for it', () => {
    // 三个开关都是关的，但用户刚手动翻译过这一页：页面照样会自己翻。
    // 弹窗以前只摆开关，不说结果，用户以为不会扣费。
    const status = describeAutoTranslate({
      armed: true,
      hostAllowlisted: false,
      autoContinueEnabled: false,
      masterEnabled: true,
    });
    expect(status.armed).toBe(true);
    expect(status.tone).toBe('active');
    expect(status.message).toContain('会产生费用');
    expect(status.action?.kind).toBe('stop-page');
  });

  it('offers to turn the site off when the site is on the list', () => {
    const status = describeAutoTranslate({
      armed: true,
      hostAllowlisted: true,
      autoContinueEnabled: true,
      masterEnabled: true,
    });
    expect(status.action?.kind).toBe('remove-host');
    expect(status.action?.label).toContain('本站');
  });

  it('does not claim an allowlisted site will not be translated', () => {
    // 名单里的站点每次打开都会被整页自动翻译——这一条跟「自动续翻」无关。
    // 弹窗以前写的是"「自动续翻」关着，所以不会自动翻译"，那是假的：
    // worker 判名单的时候根本不看那个开关。
    const status = describeAutoTranslate({
      armed: false,
      hostAllowlisted: true,
      autoContinueEnabled: false,
      masterEnabled: true,
    });
    expect(status.tone).toBe('active');
    expect(status.message).toContain('每次打开它的页面都会自动翻译整页图片');
    expect(status.message).toContain('会产生费用');
    expect(status.message).not.toContain('所以不会自动翻译');
  });

  it('says what the closed auto-continue switch does and does not stop', () => {
    // 「自动续翻」关着，只影响页面打开之后新出现的图片；整页自动翻译照旧。
    const status = describeAutoTranslate({
      armed: false,
      hostAllowlisted: true,
      autoContinueEnabled: false,
      masterEnabled: true,
    });
    expect(status.message).toContain('「自动续翻」是关的');
    expect(status.message).toContain('新出现的图片不会自动翻译');
  });

  it('offers to take the site off the list, not to turn on auto-continue', () => {
    // 「打开自动续翻」修不了这件事：名单站点照样每次打开都自动翻译。
    // 而且那是一个会继续花钱的开关，不是修复手段。
    const status = describeAutoTranslate({
      armed: false,
      hostAllowlisted: true,
      autoContinueEnabled: false,
      masterEnabled: true,
    });
    expect(status.action?.kind).toBe('remove-host');
    expect(status.action?.label).toContain('关闭本站自动翻译');
  });

  it('says the page was translated when it was opened', () => {
    const status = describeAutoTranslate({
      armed: true,
      hostAllowlisted: true,
      autoContinueEnabled: true,
      masterEnabled: true,
    });
    expect(status.message).toContain('本页打开时已自动翻译过整页');
    expect(status.message).toContain('新出现的图片也会自动翻译');
  });

  it('does not claim the site is armed when it is not', () => {
    const status = describeAutoTranslate({
      armed: false,
      hostAllowlisted: false,
      autoContinueEnabled: true,
      masterEnabled: true,
    });
    expect(status.armed).toBe(false);
    expect(status.tone).toBe('idle');
    expect(status.action).toBeUndefined();
  });

  it('says nothing is running when the extension is off', () => {
    const status = describeAutoTranslate({
      armed: false,
      hostAllowlisted: true,
      autoContinueEnabled: true,
      masterEnabled: false,
    });
    expect(status.tone).toBe('idle');
    expect(status.message).toContain('扩展已关闭');
  });

  it('says the budget ran out instead of sending the reader to a switch', () => {
    // 自动续翻的次数用完了，页面不会再翻新出现的图片。弹窗以前把这说成
    // "「自动续翻」已打开，但本站不在名单里，本页也没有手动翻译过"——
    // 每一句都是假的：开关是开着的，本页也翻过。
    const status = describeAutoTranslate({
      armed: false,
      budgetExhausted: true,
      hostAllowlisted: false,
      autoContinueEnabled: true,
      masterEnabled: true,
    });
    expect(status.armed).toBe(false);
    expect(status.tone).toBe('idle');
    expect(status.message).toContain('用完次数');
    expect(status.message).toContain('不会产生费用');
    expect(status.message).toContain('再点一次');
    expect(status.message).not.toContain('本站不在自动翻译名单里');
  });

  it('does not promise new images on an allowlisted site after the budget ran out', () => {
    // 名单里的站点整页自动翻译照旧，但"新出现的图片也会自动翻译"这句话
    // 受同一个预算管着。
    const status = describeAutoTranslate({
      armed: false,
      budgetExhausted: true,
      hostAllowlisted: true,
      autoContinueEnabled: true,
      masterEnabled: true,
    });
    expect(status.message).toContain('每次打开它的页面都会自动翻译整页图片');
    expect(status.message).not.toContain('新出现的图片也会自动翻译');
    expect(status.message).toContain('不会再自动翻译');
  });
});

describe('这一页要花多少钱', () => {
  it('says how many images are ready to be translated', () => {
    const hint = describeImageCount(12, 0);
    expect(hint.headline).toContain('12');
    expect(hint.headline).toContain('产生费用');
  });

  it('says how many images are still on their way', () => {
    // 懒加载的漫画页：现在只加载了两张，还有三十张在路上。那些到了以后
    // 会被自动翻译，也一样要钱——用户按按钮之前就该知道。
    const hint = describeImageCount(2, 30);
    expect(hint.headline).toContain('2');
    expect(hint.headline).toContain('30');
  });

  it('says that a long image is charged as several requests', () => {
    // 图片数不是请求数：长条图会被拆成多片分别请求。用户拿 12 张图片去
    // 估价，和 12 次请求去估价，是两个价。这句话以前只在重翻对话框里，
    // 按按钮之前的那一句反而不说。
    const hint = describeImageCount(12, 0);
    expect(hint.caveat).toContain('长条图会拆成多片分别请求');
    expect(hint.caveat).toContain('实际请求次数可能高于图片数');
  });

  it('keeps the request-count caveat out of the headline', () => {
    // 弹窗顶上的那一块是两件事：headline 说这一页有几张图、要花多少钱，
    // caveat 说计费怎么算。合成一段之后，用户要读六行小字才能找到
    // 「2 张、会花钱」那一句 —— 而那才是他要的数。分开写，弹窗才能给
    // 两句话定不同的视觉轻重。
    const hint = describeImageCount(12, 0);
    expect(hint.headline).not.toContain('长条图');
    expect(hint.headline).not.toContain('实际请求次数');
    expect(hint.caveat).not.toContain('12 张可翻译图片');
  });

  it('says nothing about requests when the page has no images', () => {
    // 没有图就不会有请求。这时候还讲"一次请求可能变多次"是噪音。
    const hint = describeImageCount(0, 0);
    expect(hint.headline).toContain('没有可翻译的图片');
    expect(hint.caveat).toBe('');
  });

  it('says the page is already translated instead of claiming it has no images', () => {
    // 整页都翻完了：可翻的张数是 0，但"0"说的是"没有需要翻的"，不是
    // "这一页没有图"。以前这里写「本页没有可翻译的图片」，把读者送去
    // 改图片大小 —— 而图片一点问题都没有。
    const hint = describeImageCount(0, 0, true, null, 12);
    expect(hint.headline).toContain('12');
    expect(hint.headline).toContain('已经翻译过');
    expect(hint.headline).not.toContain('没有可翻译的图片');
    expect(hint.caveat).toContain('忽略缓存重翻');
  });

  it('does not count an unknown number as zero, and still says it costs', () => {
    // 数不出来不是"不用花钱"。这一行以前是空的，于是「翻译当前页面」
    // 按钮独自出现，旁边一句关于费用的话都没有 —— 而按钮是亮的。
    const hint = describeImageCount(null, 0);
    expect(hint.headline).not.toContain('0 张');
    expect(hint.headline).toContain('产生费用');
    expect(hint.caveat).toContain('长条图会拆成多片分别请求');
  });

  it('names the price of a full re-translate', () => {
    // 忽略缓存重翻会把整页再翻一遍——已经翻过的也算钱。
    const cost = describeForceRetranslate(40);
    expect(cost).toContain('40');
    expect(cost).toContain('已经翻译成功的图片也会重新翻译');
    expect(cost).toContain('会产生费用');
    // 图片数不是请求数：长条图会被拆成多片分别请求。
    expect(cost).toContain('长条图会拆成多片分别请求');
    expect(cost).toContain('实际请求次数可能高于图片数');
  });

  it('does not tell a local provider that it will be charged', () => {
    // Ollama / LM Studio 在本机跑：不花钱，图片也不离开这台机器。
    // 每一句"会产生费用"对这样的读者都是错的。
    const cost = describeForceRetranslate(40, 'ollama');
    expect(cost).toContain('不产生服务商费用');
    expect(cost).not.toContain('会产生费用');

    const hint = describeImageCount(12, 0, true, 'ollama');
    expect(hint.headline).toContain('不产生服务商费用');
    expect(hint.headline).not.toContain('会产生费用');
  });

  it('does not quote a request count as if it were the image count', () => {
    // 「约 N 次计费调用」是错的：这个 N 是图片数，而计费按请求算，长条图
    // 一张图会拆成好几片。用户拿这句话去估价的，必须改成图片数 + 拆片提示。
    const cost = describeForceRetranslate(40);
    expect(cost).not.toContain('计费调用');
    expect(cost).not.toContain('40 次');
  });

  it('falls back to "all the images" when the number is unknown', () => {
    const cost = describeForceRetranslate(null);
    expect(cost).toContain('本页全部图片');
    expect(cost).not.toContain('0');
  });
});

describe('结果摘要说的是这一页现在的状态', () => {
  it('counts what is still untranslated, not what the last run failed', () => {
    // 三张图在上一轮失败，之后一轮自动续翻成功了别的图。上一轮的计数器归零，
    // 弹窗于是报「成功翻译 2 张」，下面那个按钮却写着「重新翻译失败的 3 张」——
    // 同一件事，两个数字，只有一个是真的。
    const summary = buildResultSummary({
      count: 2,
      failedCount: 0,
      retryTargetCount: 3,
    });

    expect(summary.details.join(' ')).toContain('3 张待重试');
    expect(summary.tone).toBe('warning');
  });

  it('says nothing about failures when there are none left', () => {
    const summary = buildResultSummary({
      count: 5,
      failedCount: 0,
      retryTargetCount: 0,
    });

    expect(summary.tone).toBe('success');
    expect(summary.details.join(' ')).not.toContain('待重试');
  });

  it('says how many spots were left untranslated', () => {
    // 「成功翻译 12 张」说的是"翻了 12 张"，不是"这一页每一句都翻了"。
    // 模型找到了气泡却没给出译文的那几处留在画面上还是原文，弹窗以前只说
    // 成功，读者只当自己看漏了。
    const summary = buildResultSummary({
      count: 12,
      failedCount: 0,
      retryTargetCount: 0,
      missingCount: 3,
    });

    expect(summary.details.join(' ')).toContain('3 处文字没有翻出来');
    expect(summary.tone).toBe('warning');
  });

  it('falls back to the run counter when the page cannot say', () => {
    const summary = buildResultSummary({
      count: 0,
      failedCount: 2,
    });

    expect(summary.tone).toBe('warning');
    expect(summary.title).toContain('2 张待重试');
  });
});
