import { describe, expect, it } from 'vitest';
import {
  getPageAvailability,
  isHostAutoTranslated,
  isSupportedPageUrl,
  matchingAllowlistEntries,
} from './popup-state';

describe('popup page availability', () => {
  it('marks chrome urls as unsupported', () => {
    expect(isSupportedPageUrl('chrome://extensions')).toBe(false);
    expect(isSupportedPageUrl('about:blank')).toBe(false);
  });

  it('marks normal web pages as supported', () => {
    expect(isSupportedPageUrl('https://example.com/chapter/1')).toBe(true);
    expect(isSupportedPageUrl('http://localhost:3000')).toBe(true);
  });

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
