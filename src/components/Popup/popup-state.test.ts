import { describe, expect, it } from 'vitest';
import { getPageAvailability, isSupportedPageUrl } from './popup-state';

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
