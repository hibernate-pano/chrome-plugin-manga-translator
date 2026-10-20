import { describe, expect, it } from 'vitest';
import {
  describeAutoTranslate,
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
    expect(status.message).toContain('会继续产生费用');
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

  it('points at the switch that is actually blocking the feature', () => {
    // 站点在名单里，但「自动续翻」关着：名单不会生效。
    const status = describeAutoTranslate({
      armed: false,
      hostAllowlisted: true,
      autoContinueEnabled: false,
      masterEnabled: true,
    });
    expect(status.tone).toBe('blocked');
    expect(status.action?.kind).toBe('enable-continue');
    expect(status.message).toContain('自动续翻');
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
});
