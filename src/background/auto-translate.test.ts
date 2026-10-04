import { describe, expect, it } from 'vitest';

import {
  createAutoTranslateMessage,
  isAutoContinueEnabled,
  isTranslationEnabled,
  shouldAutoTranslatePage,
} from './auto-translate';

/**
 * These helpers decide when the extension acts without being asked. Getting
 * them wrong means a page the user never mentioned gets sent to a paid vision
 * endpoint, so the cases are spelled out rather than inferred.
 */
describe('master switch', () => {
  it('reads enabled from a flat config', () => {
    expect(isTranslationEnabled({ enabled: true })).toBe(true);
    expect(isTranslationEnabled({ enabled: false })).toBe(false);
  });

  it('reads enabled from the zustand persisted envelope', () => {
    expect(isTranslationEnabled({ state: { enabled: true } })).toBe(true);
    expect(isTranslationEnabled({ state: { enabled: false } })).toBe(false);
  });

  it('is not affected by auto-continue', () => {
    // The master switch and "keep translating new images" are separate
    // concepts; conflating them is what made the extension act on every page.
    expect(
      isTranslationEnabled({ enabled: true, autoContinueEnabled: false })
    ).toBe(true);
    expect(
      isTranslationEnabled({
        state: { enabled: true, autoContinueEnabled: false },
      })
    ).toBe(true);
  });

  it('defaults to disabled for invalid config', () => {
    expect(isTranslationEnabled(null)).toBe(false);
    expect(isTranslationEnabled(undefined)).toBe(false);
    expect(isTranslationEnabled('bad')).toBe(false);
    expect(isTranslationEnabled({})).toBe(false);
  });
});

describe('autoContinue switch', () => {
  it('requires the master switch and defaults on', () => {
    expect(isAutoContinueEnabled({ enabled: true })).toBe(true);
    expect(isAutoContinueEnabled({ enabled: false })).toBe(false);
    expect(
      isAutoContinueEnabled({ enabled: true, autoContinueEnabled: false })
    ).toBe(false);
  });
});

describe('automatic page translation is opt-in per host', () => {
  const allowlisted = {
    enabled: true,
    autoTranslateHosts: ['manga.example.com'],
  };

  it('does not translate a page when the allowlist is empty', () => {
    expect(
      shouldAutoTranslatePage({ enabled: true }, 'https://any.site/x')
    ).toBe(false);
    expect(
      shouldAutoTranslatePage(
        { enabled: true, autoTranslateHosts: [] },
        'https://any.site/x'
      )
    ).toBe(false);
  });

  it('translates an allowlisted host', () => {
    expect(
      shouldAutoTranslatePage(allowlisted, 'https://manga.example.com/read/1')
    ).toBe(true);
  });

  it('does not translate a different host', () => {
    expect(
      shouldAutoTranslatePage(allowlisted, 'https://other.example.com/read/1')
    ).toBe(false);
  });

  it('does not treat a lookalike suffix as a match', () => {
    // A naive endsWith() would let notmanga.example.com through.
    expect(
      shouldAutoTranslatePage(allowlisted, 'https://notmanga.example.com/x')
    ).toBe(false);
    expect(
      shouldAutoTranslatePage(allowlisted, 'https://evil.com/manga.example.com')
    ).toBe(false);
  });

  it('supports an explicit subdomain wildcard', () => {
    const config = { enabled: true, autoTranslateHosts: ['*.example.com'] };
    expect(shouldAutoTranslatePage(config, 'https://a.example.com/x')).toBe(
      true
    );
    expect(
      shouldAutoTranslatePage(config, 'https://deep.a.example.com/x')
    ).toBe(true);
    expect(shouldAutoTranslatePage(config, 'https://example.com/x')).toBe(true);
    expect(shouldAutoTranslatePage(config, 'https://notexample.com/x')).toBe(
      false
    );
  });

  it('respects the master switch even when allowlisted', () => {
    expect(
      shouldAutoTranslatePage(
        { enabled: false, autoTranslateHosts: ['manga.example.com'] },
        'https://manga.example.com/x'
      )
    ).toBe(false);
  });

  it('refuses non-http(s) URLs', () => {
    expect(shouldAutoTranslatePage(allowlisted, undefined)).toBe(false);
    expect(shouldAutoTranslatePage(allowlisted, 'not a url')).toBe(false);
    expect(
      shouldAutoTranslatePage(
        { enabled: true, autoTranslateHosts: ['localhost'] },
        'chrome-extension://abc/x'
      )
    ).toBe(false);
  });

  it('reads the allowlist out of the zustand envelope too', () => {
    expect(
      shouldAutoTranslatePage(
        { state: { enabled: true, autoTranslateHosts: ['manga.example.com'] } },
        'https://manga.example.com/x'
      )
    ).toBe(true);
  });
});

describe('message shape', () => {
  it('creates correct messages for auto translate transitions', () => {
    expect(createAutoTranslateMessage(true)).toEqual({
      type: 'TRANSLATE_PAGE',
    });
    expect(createAutoTranslateMessage(false)).toEqual({
      type: 'CANCEL_TRANSLATION',
    });
  });
});
