import { describe, expect, it, vi } from 'vitest';

import { clampPageTranslationConcurrency } from './page-translation-utils';
import {
  extractPersistedConfigState,
  getEnabledFromConfig,
  getOverlayStyleFromConfig,
} from './config-snapshot';
import { handleMessage } from './content';

function makeSender(): chrome.runtime.MessageSender {
  return { id: 'test-extension' } as chrome.runtime.MessageSender;
}

describe('content page translation settings', () => {
  it('clamps concurrency into stable range 2-3', () => {
    expect(clampPageTranslationConcurrency(1)).toBe(2);
    expect(clampPageTranslationConcurrency(2)).toBe(2);
    expect(clampPageTranslationConcurrency(3)).toBe(3);
    expect(clampPageTranslationConcurrency(9)).toBe(3);
  });

  it('falls back to default for invalid values', () => {
    expect(clampPageTranslationConcurrency(Number.NaN)).toBe(3);
    expect(clampPageTranslationConcurrency(Number.POSITIVE_INFINITY)).toBe(3);
  });

  it('reads enabled state from persisted config envelopes', () => {
    expect(
      getEnabledFromConfig({
        state: { enabled: true, autoContinueEnabled: true },
      })
    ).toBe(true);
    expect(
      getEnabledFromConfig({
        state: { enabled: true, autoContinueEnabled: false },
      })
    ).toBe(false);
    expect(
      getEnabledFromConfig({
        enabled: true,
        autoContinueEnabled: true,
      })
    ).toBe(true);
  });

  it('reads overlay style from persisted config envelopes and flat snapshots', () => {
    const nested = {
      state: {
        overlayStyle: {
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          textColor: '#ffffff',
          minFontSize: 12,
          maxFontSize: 24,
          verticalText: false,
        },
      },
    };
    const flat = {
      overlayStyle: {
        backgroundColor: 'rgba(240, 240, 235, 0.94)',
        textColor: '#111111',
        minFontSize: 10,
        maxFontSize: 22,
        verticalText: false,
      },
    };

    expect(extractPersistedConfigState(nested)).toEqual(nested.state);
    expect(getOverlayStyleFromConfig(nested)).toEqual(
      nested.state.overlayStyle
    );
    expect(getOverlayStyleFromConfig(flat)).toEqual(flat.overlayStyle);
  });
});

// ================================================================
// handleMessage routing (regression guard for t6 — was 0 tested)
// ================================================================
describe('content handleMessage routing', () => {
  it('GET_STATE returns the current ContentState', () => {
    const sendResponse = vi.fn();
    handleMessage(
      { type: 'GET_STATE' },
      makeSender(),
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, state: expect.any(Object) })
    );
  });

  it('CANCEL_TRANSLATION returns success without throwing', () => {
    const sendResponse = vi.fn();
    expect(() =>
      handleMessage(
        { type: 'CANCEL_TRANSLATION' },
        makeSender(),
        sendResponse
      )
    ).not.toThrow();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('CLEAR_ALL returns success without throwing', () => {
    const sendResponse = vi.fn();
    expect(() =>
      handleMessage(
        { type: 'CLEAR_ALL' },
        makeSender(),
        sendResponse
      )
    ).not.toThrow();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('returns an error for unknown message types', () => {
    const sendResponse = vi.fn();
    handleMessage(
      { type: 'NOT_A_REAL_TYPE' as never },
      makeSender(),
      sendResponse
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it('TRANSLATE_PAGE returns true to keep the channel open (async path)', () => {
    const sendResponse = vi.fn();
    // We are not in a real page; translatePage will fail because
    // findTranslatableImages returns nothing. The handler must still
    // return true (keep channel open) and call sendResponse asynchronously.
    const keepOpen = handleMessage(
      { type: 'TRANSLATE_PAGE' },
      makeSender(),
      sendResponse
    );
    expect(keepOpen).toBe(true);
  });
});
