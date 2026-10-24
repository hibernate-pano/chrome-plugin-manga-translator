import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { clampPageTranslationConcurrency } from './page-translation-utils';
import {
  extractPersistedConfigState,
  getOverlayStyleFromConfig,
} from './config-snapshot';

// ================================================================
// Mocks
//
// `translatePage` is the one function that actually spends money, and it
// had no behavioural test at all: the old suite only checked that
// `handleMessage` returned `true`. These mocks let a real run happen in
// jsdom, so the counting, cancellation and gating logic is exercised
// for real.
// ================================================================

const translateImageMock = vi.fn();
const renderMock = vi.fn();
const removeAllMock = vi.fn();
const providerValidateMock = vi.fn();
/**
 * The renderer double.
 *
 * It is a stable object, not a fresh one per call: the content script keeps
 * the renderer for the whole page, and a test has to be able to look at the
 * callbacks the script registered on it.
 */
const overlayCountMock = vi.fn(() => 0);

const rendererMock = {
  render: renderMock,
  removeAll: removeAllMock,
  remove: vi.fn(),
  // The content script calls this when the artwork under a translation
  // changes: the overlay describes different pixels and has to go.
  removeTranslation: vi.fn(),
  dispose: vi.fn(),
  updateStyleFromConfig: vi.fn(),
  repositionAll: vi.fn(),
  // The content script registers the callback that keeps the reading panel
  // and the anchor badges in step with a translation the user deleted from
  // the image itself.
  setRemovalListener: vi.fn(),
  // The content script registers the callback that turns one translated page
  // into a PNG the user can keep.
  setExportHandler: vi.fn(),
  // The bubbles are sorted into reading order, and vertical manga reads
  // right to left.
  getStyle: () => ({ verticalText: false }),
  // How many images currently carry a translation. The popup needs it to
  // know that 「清除本页译文」 would be a no-op on a fresh page.
  getOverlayCount: overlayCountMock,
};

vi.mock('@/services/translator', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/translator')>();
  return {
    TranslatorService: class {},
    createTranslatorFromConfig: () => ({
      initialize: async () => undefined,
      translateImage: translateImageMock,
    }),
    // The real tiling rule: the content script uses it to tell the user how
    // many requests one long strip costs, and a fake one would make the
    // disclosure untestable.
    computeTiles: actual.computeTiles,
  };
});

vi.mock('@/services/renderer', () => ({
  OverlayRenderer: class {},
  getRenderer: () => rendererMock,
  removeAllOverlaysFromDOM: vi.fn(),
}));

vi.mock('@/providers', () => ({
  createProvider: async () => ({
    validateConfig: providerValidateMock,
  }),
  providerRequiresApiKey: () => false,
}));

import {
  handleMessage,
  handleStorageChange,
  translatePage,
  clearAll,
  cancelTranslation,
  cleanup,
  setState,
  autoTranslateMode,
  handleRouteChange,
  isFatalTranslationError,
} from './content';
import { useAppConfigStore } from '@/stores/config-v2';
import type { ContentResponse, ContentState } from '@/shared/runtime-contracts';
import {
  MASTER_SWITCH_OFF_MESSAGE,
  PROVIDER_NOT_READY_MESSAGE,
} from '@/shared/runtime-contracts';
import { buildContentConfigSnapshot } from '@/shared/content-config';

// ================================================================
// Helpers
// ================================================================

function makeSender(): chrome.runtime.MessageSender {
  return { id: 'test-extension' } as chrome.runtime.MessageSender;
}

const CONFIG_KEY = 'manga-translator-config-v2';

/**
 * Write the persisted config the content script reads.
 *
 * The content script no longer reads `chrome.storage.local` itself: it asks
 * the service worker for a redacted snapshot. The storage mock is still the
 * source of truth for "what did the user configure", and the worker mock
 * below turns it into the snapshot the content script would receive.
 *
 * `parallelLimit: 2` is the default the suites below rely on: three images
 * with a concurrency of two means the first run starts two translations and
 * leaves the third waiting, which is what the mutex tests observe.
 */
async function writeConfig(state: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set({
    [CONFIG_KEY]: {
      state: { enabled: true, parallelLimit: 2, ...state },
      version: 3,
    },
  });
}

/**
 * A comic page image the filter accepts: big enough, complete, and with a
 * resolvable source.
 *
 * `top` places the image at a distinct vertical position, which is what
 * lets a test map an anchor badge back to the image it belongs to.
 */
function makeComicImage(src: string, top = 0, height = 1200): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  Object.defineProperty(img, 'naturalWidth', { value: 800 });
  Object.defineProperty(img, 'naturalHeight', { value: height });
  Object.defineProperty(img, 'width', { value: 800 });
  Object.defineProperty(img, 'height', { value: height });
  // jsdom never loads the bytes, so `complete` stays false for an <img>
  // with a src. The filter rejects incomplete images.
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top,
      right: 800,
      bottom: top + height,
      width: 800,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(img);
  return img;
}

function makeTextAreas(text: string): Array<{
  x: number;
  y: number;
  width: number;
  height: number;
  originalText: string;
  translatedText: string;
}> {
  return [
    {
      x: 0.1,
      y: 0.1,
      width: 0.4,
      height: 0.1,
      originalText: 'original',
      translatedText: text,
    },
  ];
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/**
 * Stand in for the service worker.
 *
 * The content script asks the worker for two things: the redacted config
 * snapshot, and the provider preflight verdict. Both need a key, so both
 * happen in the worker. The mock answers them from the same storage the
 * tests write into, which is what the real worker does.
 *
 * `sendMessage` is also the channel the content script publishes its state
 * on, so the mock has to keep returning a promise for those calls.
 */
function mockWorker(): void {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    async (message: unknown) => {
      const type = (message as { type?: string } | undefined)?.type;
      if (type === 'GET_CONFIG') {
        const stored = await chrome.storage.local.get([CONFIG_KEY]);
        return {
          success: true,
          config: buildContentConfigSnapshot(stored[CONFIG_KEY]),
        };
      }
      if (type === 'PROVIDER_PREFLIGHT') {
        return { success: true, valid: true, message: 'ok' };
      }
      return undefined;
    }
  );
}

/**
 * Read the state the content script last published.
 */
function lastState(): ContentState {
  const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const message = calls[i]?.[0] as { type?: string; state?: ContentState };
    if (message?.type === 'STATE_UPDATE' && message.state) {
      return message.state;
    }
  }
  throw new Error('no STATE_UPDATE was published');
}

// ================================================================
// The worker mock is installed for every test in this file.
//
// The content script asks the service worker for the redacted config
// snapshot and for the provider preflight verdict; both need the API key,
// so both live in the worker. Without this mock the content script would
// see "the extension is off" and every translation test would fail.
// ================================================================

beforeEach(() => {
  mockWorker();
});

// ================================================================
// Existing suites (kept verbatim)
// ================================================================

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
// handleMessage routing
// ================================================================
describe('content handleMessage routing', () => {
  it('GET_STATE returns the current ContentState', () => {
    const sendResponse = vi.fn();
    handleMessage({ type: 'GET_STATE' }, makeSender(), sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, state: expect.any(Object) })
    );
  });

  it('CANCEL_TRANSLATION returns success without throwing', () => {
    const sendResponse = vi.fn();
    expect(() =>
      handleMessage({ type: 'CANCEL_TRANSLATION' }, makeSender(), sendResponse)
    ).not.toThrow();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('CLEAR_ALL returns success without throwing', () => {
    const sendResponse = vi.fn();
    expect(() =>
      handleMessage({ type: 'CLEAR_ALL' }, makeSender(), sendResponse)
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

describe('auto-translate run budget', () => {
  it('exposes a bounded budget that is not yet spent', async () => {
    // The budget exists so an auto-translate observer cannot translate the
    // same page forever: each follow-up run spends one, and the counter
    // stops the observer when it runs out.
    const mod = await import('./content');
    expect(mod.getAutoTranslateRunsRemaining()).toBeGreaterThan(0);
  });
});

describe('content state routing', () => {
  it('setState drives HUD phases through every content state', async () => {
    const mod = await import('./content');
    const setState = mod.setState as (s: unknown) => void;

    const hudStates: unknown[] = [];
    // The HUD instance is created during initialize(); in tests we only assert
    // that setState routes states without throwing when hud exists.
    setState({ status: 'idle' });
    setState({ status: 'scanning', candidateCount: 3 });
    setState({
      status: 'translating',
      current: 1,
      total: 3,
      currentImageIndex: 0,
      phase: 'translating',
    });
    setState({ status: 'complete', count: 3 });
    setState({ status: 'error', message: 'boom' });

    expect(hudStates).toHaveLength(0);
  });

  it('handleMessage returns the current state and acknowledges control messages', async () => {
    const mod = await import('./content');
    const sender = makeSender();
    const responses: unknown[] = [];
    const messages: Array<Record<string, string>> = [
      { type: 'GET_STATE' },
      { type: 'CANCEL_TRANSLATION' },
      { type: 'CLEAR_ALL' },
      { type: 'NOT_A_REAL_TYPE' },
    ];
    for (const message of messages as unknown as Array<
      Parameters<typeof mod.handleMessage>[0]
    >) {
      const response = await new Promise(resolve => {
        void mod.handleMessage(message, sender, resolve);
      });
      responses.push(response);
    }
    expect(responses[0]).toMatchObject({ success: true });
    expect(responses[3]).toMatchObject({ success: false });
  });
});

// ================================================================
// F1 — the success counter
//
// The old code decided "did this image succeed?" by comparing
// `processedImages.size` before and after `processSingleImage`, which
// never touches that Set. The count therefore stayed at 0 and the HUD
// reported "success 0, failed 0, cached 0" for a page where every
// image had translated.
// ================================================================
describe('F1: translation success counter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    // The processed-image registry is module-level, so it survives between
    // tests. Without this, the second test in a suite sees every image as
    // "already translated" and finds nothing to do.
    clearAll();
  });

  it('counts every image that actually translated', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');

    await translatePage();

    expect(translateImageMock).toHaveBeenCalledTimes(2);
    const state = lastState();
    expect(state.status).toBe('complete');
    expect(state).toMatchObject({ count: 2, failedCount: 0 });
  });

  it('tells the worker how urgent each image is', async () => {
    /*
     * worker 的队列是所有标签页共用的，它按这个标记排序。
     *
     * 以前每一张图都是同一个标记（'visible-now'），于是那套排序从来没生效
     * 过：队列里排的是"谁先到"，不是"谁最急"。用户点了「重试失败项」之
     * 后，那几张图要排在别人标签页的整页翻译后面才轮得到。
     */
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const options = translateImageMock.mock.calls[0]?.[3];
    expect(options?.priorityClass).toBe('visible-now');
  });

  it('does not count a failed image as a success', async () => {
    await writeConfig({ enabled: true });
    translateImageMock
      .mockResolvedValueOnce({
        success: true,
        textAreas: makeTextAreas('好'),
      })
      .mockResolvedValueOnce({
        success: false,
        textAreas: [],
        error: 'boom',
      });
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');

    await translatePage();

    const state = lastState();
    expect(state.status).toBe('complete');
    expect(state).toMatchObject({ count: 1, failedCount: 1 });
  });

  it('counts a cached translation as a success', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      cached: true,
      textAreas: makeTextAreas('缓存'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const state = lastState();
    expect(state).toMatchObject({ count: 1, cachedCount: 1 });
  });

  it('renders the translation pinned so it is visible without hovering', async () => {
    // F7: the overlay CSS is opacity 0 until the image is hovered. A
    // finished translation that is invisible is indistinguishable from a
    // broken extension.
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(renderMock.mock.calls[0]?.[2]).toBe(true);
  });
});

// ================================================================
// F2 — "retry failed" was a no-op
//
// The retry only removed the key from `processedImages`. The image kept
// its `manga-translator-processed` class, and the filter rejects any
// image carrying it — so the retry found nothing to translate.
// ================================================================
describe('F2: retrying failed images', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    // The processed-image registry is module-level, so it survives between
    // tests. Without this, the second test in a suite sees every image as
    // "already translated" and finds nothing to do.
    clearAll();
  });

  it('un-marks the failed image so the retry picks it up again', async () => {
    await writeConfig({ enabled: true });
    translateImageMock
      .mockResolvedValueOnce({
        success: false,
        textAreas: [],
        error: 'temporary failure',
      })
      .mockResolvedValue({
        success: true,
        textAreas: makeTextAreas('好了'),
      });
    const img = makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    // A failed translation must not leave the image looking translated:
    // `isTranslatableImage` rejects any image carrying the marker, so a
    // leftover marker made the image permanently un-translatable and the
    // retry had nothing to pick up.
    expect(img.classList.contains('manga-translator-processed')).toBe(false);
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    const { handleRetryFailed } = await import('./content');
    handleRetryFailed();

    // The class is removed synchronously, before the retry starts. Without
    // this the filter would reject the image and the retry would find
    // nothing to do.
    expect(img.classList.contains('manga-translator-processed')).toBe(false);

    await flush();

    // The retry actually re-translated the image.
    expect(translateImageMock).toHaveBeenCalledTimes(2);
  });
});

// ================================================================
// F3 — a settings change used to arm paid auto-translation
//
// `handleStorageChange` set `isAutoTranslateEnabled = enabled`, i.e. it
// read the master switch only. Any settings write — the target
// language, the overlay style, the API key — therefore turned
// auto-translation on in every open tab, on pages the user never asked
// to translate.
// ================================================================
describe('F3: config changes do not arm auto-translation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    useAppConfigStore.setState({
      enabled: true,
      autoContinueEnabled: true,
      autoTranslateHosts: [],
    });
    // `pageTranslationRequested` is module-level: an earlier suite asked for
    // this page to be translated, and that fact would arm auto-continue no
    // matter what the allowlist says. clearAll() drops it.
    clearAll();
  });

  it('keeps auto-translate off when the host is not allowlisted', async () => {
    await writeConfig({
      enabled: true,
      autoContinueEnabled: true,
      autoTranslateHosts: [],
    });

    handleStorageChange(
      {
        [CONFIG_KEY]: {
          oldValue: undefined,
          newValue: { state: { enabled: true, targetLanguage: 'ja-JP' } },
        },
      },
      'local'
    );
    await flush();

    expect(autoTranslateMode.enabled).toBe(false);
  });

  it('does not trigger a translation because of a config change', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    handleStorageChange(
      {
        [CONFIG_KEY]: {
          oldValue: undefined,
          newValue: { state: { enabled: true, targetLanguage: 'ja-JP' } },
        },
      },
      'local'
    );
    await flush(8);

    expect(translateImageMock).not.toHaveBeenCalled();
  });

  it('arms auto-translate for an allowlisted host', async () => {
    await writeConfig({
      enabled: true,
      autoContinueEnabled: true,
      autoTranslateHosts: [window.location.host],
    });

    handleStorageChange(
      {
        [CONFIG_KEY]: {
          oldValue: undefined,
          newValue: {
            state: {
              enabled: true,
              autoContinueEnabled: true,
              autoTranslateHosts: [window.location.host],
            },
          },
        },
      },
      'local'
    );
    await flush();

    expect(autoTranslateMode.enabled).toBe(true);
  });
});

// ================================================================
// F4 — "force retranslate" during a run did nothing
//
// `clearAll()` aborts the running translation, but the abort is only
// observed asynchronously. The old code called `translatePage(true)`
// immediately, which hit the still-held mutex and returned without
// doing anything — the user was left with an empty page.
// ================================================================
describe('F4: force retranslate during a running translation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    // The processed-image registry is module-level, so it survives between
    // tests. Without this, the second test in a suite sees every image as
    // "already translated" and finds nothing to do.
    clearAll();
  });

  it('waits for the running translation and then starts a new one', async () => {
    await writeConfig({ enabled: true });

    const gate: { release: (() => void) | null } = { release: null };
    translateImageMock.mockImplementation(async () => {
      if (!gate.release) {
        await new Promise<void>(resolve => {
          gate.release = resolve;
        });
      }
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    makeComicImage('https://cdn.example.com/a.webp');

    const firstRun = translatePage();
    await flush(2);
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    // The user hits "force retranslate" while the first run is still going.
    // `confirmed: true` because the sender already asked the user — the popup
    // confirms in the popup, the keyboard shortcut confirms in the page.
    const responses: unknown[] = [];
    handleMessage(
      { type: 'FORCE_RETRANSLATE_PAGE', confirmed: true },
      makeSender(),
      response => responses.push(response)
    );
    await flush(2);

    // The new run must not have started yet: the old one still holds the
    // mutex.
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    gate.release?.();
    await firstRun;
    await flush(6);

    // Now the second run happened.
    expect(translateImageMock.mock.calls.length).toBeGreaterThan(1);
    expect(responses[0]).toMatchObject({ success: true });
  });

  it('asks before it re-requests the whole page', async () => {
    // The keyboard shortcut used to go straight through: one keypress
    // re-requested every image on the page and the only feedback was
    // 「翻译完成 成功 12」. The popup confirms in the popup; the shortcut has
    // no popup to confirm in, so the page asks.
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    const responses: unknown[] = [];
    handleMessage({ type: 'FORCE_RETRANSLATE_PAGE' }, makeSender(), response =>
      responses.push(response)
    );
    await flush(2);

    expect(responses[0]).toMatchObject({
      success: true,
      pendingConfirmation: true,
    });
    // Nothing was requested.
    expect(translateImageMock).not.toHaveBeenCalled();
  });
});

// ================================================================
// F5 — cancelling reported "complete"
//
// `cancelTranslation()` nulls the abort controller, so the run's own
// `abortController?.signal.aborted` check short-circuited to
// `undefined` and the run fell through to `setState({status:'complete'})`.
// ================================================================
describe('F5: cancelling a translation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    // The processed-image registry is module-level, so it survives between
    // tests. Without this, the second test in a suite sees every image as
    // "already translated" and finds nothing to do.
    clearAll();
  });

  it('reports idle instead of complete when the user cancels', async () => {
    await writeConfig({ enabled: true });

    const gate: { release: (() => void) | null } = { release: null };
    translateImageMock.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        gate.release = resolve;
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    makeComicImage('https://cdn.example.com/a.webp');

    const run = translatePage();
    await flush(2);
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    cancelTranslation();
    gate.release?.();
    await run;
    await flush(2);

    const state = lastState();
    expect(state.status).not.toBe('complete');
  });
});

// ================================================================
// F6 — the reason for a failure was thrown away
//
// `onError: (_error, index) => { failedCount++; ... }` dropped the
// error. A 401 (bad API key) and a 429 (rate limited) look identical
// to the user: "failed 20".
// ================================================================
describe('F6: failure reasons are surfaced', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    // The processed-image registry is module-level, so it survives between
    // tests. Without this, the second test in a suite sees every image as
    // "already translated" and finds nothing to do.
    clearAll();
  });

  it('records the first failure reason on the complete state', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: '模型输出了无法解析的内容',
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const state = lastState();
    expect(state.status).toBe('complete');
    expect(state).toMatchObject({ failedCount: 1 });
    expect(
      state.status === 'complete' ? state.lastError : undefined
    ).toBeTruthy();
  });

  it('aborts the run on an authentication failure', async () => {
    // A wrong API key fails identically for every image. Running the rest
    // of the queue costs the user money to collect the same error again.
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: '401 Unauthorized',
    });
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');
    makeComicImage('https://cdn.example.com/c.webp');

    await translatePage();

    const state = lastState();
    expect(state.status).toBe('error');
    expect(translateImageMock.mock.calls.length).toBeLessThan(3);
  });

  it('recognises the fatal error signatures', () => {
    expect(isFatalTranslationError('401 Unauthorized')).toBe(true);
    expect(isFatalTranslationError('HTTP 429 Too Many Requests')).toBe(true);
    expect(isFatalTranslationError('Invalid API key provided')).toBe(true);
    expect(isFatalTranslationError('rate limit exceeded')).toBe(true);
    expect(isFatalTranslationError('网络连接失败，请检查网络')).toBe(false);
    expect(isFatalTranslationError('解析失败')).toBe(false);
  });

  it('stops the run when the worker refuses the job', () => {
    // A provider that is not set up fails identically for every image left
    // on the page, so the rest of the run must not start. Without this the
    // reader watches twenty images fail one by one against a setting they
    // can fix in the same place.
    expect(isFatalTranslationError(PROVIDER_NOT_READY_MESSAGE)).toBe(true);
    expect(isFatalTranslationError(MASTER_SWITCH_OFF_MESSAGE)).toBe(true);
    // The refusal is matched inside a longer message: the transport appends
    // its own note to what the worker wrote.
    expect(
      isFatalTranslationError(`${PROVIDER_NOT_READY_MESSAGE}（重试 2 次后）`)
    ).toBe(true);
  });

  it('shows the worker its own sentence when it refuses the job', async () => {
    // The worker never asked the provider, so nothing was sent and nothing
    // was billed. Flattening that into the generic path gave the reader
    // 「发生未知错误：当前服务商还没有配置好…」 — the right words, framed as
    // a fault with no way out, for a setting they can fix themselves.
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: PROVIDER_NOT_READY_MESSAGE,
    });
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');
    makeComicImage('https://cdn.example.com/c.webp');

    await translatePage();

    const state = lastState();
    expect(state.status).toBe('error');
    if (state.status !== 'error') {
      throw new Error('expected the error state');
    }
    // The worker's sentence, with no "unknown error" prefix in front of it.
    expect(state.message).toBe(PROVIDER_NOT_READY_MESSAGE);
    expect(state.suggestion).toContain('设置页');
    expect(state.action?.type).toBe('open-settings');
    // And the rest of the page was not churned through.
    expect(translateImageMock.mock.calls.length).toBeLessThan(3);
  });
});

// ================================================================
// Round 11 — an answer taken too early: the run outlives its own
// cancellation
//
// `clearAll` and `handleRouteChange` both cancel the in-flight run, but the
// run's image requests resolve asynchronously, after the cancel returned. The
// unwinding run used to find `translationCancelled` reset back to `false`,
// decide it had finished normally, and render its results into a page the user
// had just cleared (or navigated away from).
// ================================================================
describe('R11: a superseded run does not resurrect its own results', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('does not redraw a cleared page when a late answer lands', async () => {
    // The user hits 「清除译文」 mid-run. The one image already on the wire
    // answers after the clear. Old behaviour: that answer was drawn back over
    // the artwork the user just asked to be clean, and the run announced
    // 「翻译完成」 instead of staying cleared.
    await writeConfig({ enabled: true });

    const gate: { release: (() => void) | null } = { release: null };
    translateImageMock.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        gate.release = resolve;
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    makeComicImage('https://cdn.example.com/a.webp');

    const run = translatePage();
    await flush(2);
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    clearAll();

    gate.release?.();
    await run;
    await flush(4);

    // Nothing drawn after the clear: the late answer is discarded.
    expect(renderMock).not.toHaveBeenCalled();
    const state = lastState();
    expect(state.status).not.toBe('complete');
  });

  it('does not report the previous chapter as complete after a route change', async () => {
    // An SPA chapter switch mid-run. The old chapter's images resolve after
    // the switch; the run used to stamp 「翻译完成」 with the previous
    // chapter's counts onto the new, empty chapter.
    await writeConfig({ enabled: true });

    const gate: { release: (() => void) | null } = { release: null };
    translateImageMock.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        gate.release = resolve;
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    makeComicImage('https://cdn.example.com/a.webp');

    const run = translatePage();
    await flush(2);

    handleRouteChange();

    gate.release?.();
    await run;
    await flush(4);

    const state = lastState();
    expect(state.status).not.toBe('complete');
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('picks up a mid-run settings change instead of failing the rest of the page', async () => {
    // The worker pushes CONFIG_UPDATED whenever the user edits anything in
    // Settings, and that handler nulls the translator so the next image builds
    // a fresh one. Mid-run, the images that had not started used to find the
    // translator null and fail with 「Services not initialized」 — reported as
    // unknown errors, and offered back as "retry these N failed images" even
    // though nothing about them had failed.
    await writeConfig({ enabled: true });
    const stored = await chrome.storage.local.get([CONFIG_KEY]);

    // Three images, parallelLimit 2: two start and hang, the third waits for
    // a slot. That third image is the one that reaches `processSingleImage`
    // after the translator was nulled — the case the fix is for.
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');
    makeComicImage('https://cdn.example.com/c.webp');

    // The first two calls hang on gates; the third returns on its own, so
    // the run cannot deadlock waiting for a release nobody will make.
    const gates: Array<() => void> = [];
    let calls = 0;
    translateImageMock.mockImplementation(async () => {
      calls += 1;
      if (calls <= 2) {
        await new Promise<void>(resolve => {
          gates.push(resolve);
        });
      }
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    const run = translatePage();
    await flush(2);
    // Two on the wire, the third not started yet.
    expect(translateImageMock).toHaveBeenCalledTimes(2);

    // A settings change lands while the two requests are on the wire. The
    // handler nulls the translator so the next image rebuilds it.
    handleMessage(
      {
        type: 'CONFIG_UPDATED',
        config: buildContentConfigSnapshot(stored[CONFIG_KEY]),
      },
      makeSender(),
      () => undefined
    );

    // Release the two in-flight requests; the third now starts against a
    // nulled translator and must rebuild rather than fail.
    gates.forEach(gate => gate());
    await run;
    await flush(6);

    const state = lastState();
    if (state.status !== 'complete') {
      throw new Error(`expected complete, got ${state.status}`);
    }
    expect(state.failedCount).toBe(0);
    expect(state.count).toBe(3);
    // The third image really did reach the provider (not silently dropped).
    expect(translateImageMock).toHaveBeenCalledTimes(3);
  });
});

// ================================================================
// The numbers the popup shows before it spends the user's money
//
// The popup's job here is to quote what the *next* click will cost. Every
// number it shows has to be the one the page will actually act on.
//
// This suite has to run before the F10 suite below: that one calls
// `cleanup()`, which throws the HUD away, and the HUD is what carries the
// "will this page keep translating on its own" answer to the reader.
// ================================================================
describe('the facts the popup quotes before it charges the user', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('tells the HUD whether the page will keep translating on its own', async () => {
    // The HUD used to promise every reader that scrolling to the pending
    // images would translate them. That is only true when the page is
    // armed for auto-continue, so the page has to say which case it is in
    // — and it has to say it every time the run completes.
    const mod = await import('./content');
    const { FloatingHud } = await import('./floating-hud');
    const update = vi.spyOn(FloatingHud.prototype, 'update');

    try {
      mod.setState({ status: 'complete', count: 0 });

      const complete = update.mock.calls
        .map(call => call[0])
        .filter(state => state.status === 'complete');
      expect(complete.length).toBeGreaterThan(0);
      expect(complete[complete.length - 1]).toMatchObject({
        autoContinueArmed: mod.autoTranslateMode.enabled,
      });
    } finally {
      update.mockRestore();
    }
  });

  it('reports how many images a retry would really re-request', async () => {
    // The popup used to quote `failedCount` — the failures of the last run.
    // The number that will actually be billed is the retry list: the images
    // that failed, plus the ones a cut-short retry never reached, minus the
    // ones that have since left the page.
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: '模型输出了无法解析的内容',
    });
    const img = makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const state = lastState();
    expect(state.status).toBe('complete');
    expect(state).toMatchObject({ failedCount: 1 });
    expect(state.retryTargetCount).toBe(1);

    // The image leaves the page: a retry cannot reach it any more, so the
    // number the popup shows has to fall with it.
    const mod = await import('./content');
    img.remove();
    mod.setState(mod.currentState);

    expect(lastState().retryTargetCount).toBe(0);
  });

  it('the HUD counts the failures the user still has to act on', async () => {
    // The HUD said "失败 0" after an automatic round came back clean, while
    // the popup one click away offered to retry the image that had failed in
    // the earlier round. Two surfaces, one fact, two numbers.
    await writeConfig({ enabled: true });
    translateImageMock
      .mockResolvedValueOnce({
        success: false,
        textAreas: [],
        error: 'temporary failure',
      })
      .mockResolvedValue({
        success: true,
        textAreas: makeTextAreas('好了'),
      });
    makeComicImage('https://cdn.example.com/fails.webp');

    await translatePage();
    expect(lastState()).toMatchObject({ failedCount: 1 });

    const { FloatingHud } = await import('./floating-hud');
    const update = vi.spyOn(FloatingHud.prototype, 'update');
    try {
      await translatePage(false, 'follow-up');

      const complete = update.mock.calls
        .map(call => call[0])
        .filter(state => state.status === 'complete');
      expect(complete.length).toBeGreaterThan(0);
      expect(complete[complete.length - 1]).toMatchObject({ failedCount: 1 });
    } finally {
      update.mockRestore();
    }
  });

  it('says the reading panel state as a yes or a no', async () => {
    // The report used to leave the answer out on a page that had no panel,
    // and the popup kept the previous page's answer — so it offered "hide
    // the reading panel" for a panel that was never there. The answer has
    // to be a yes or a no, never "I don't know".
    const mod = await import('./content');
    mod.setState({ status: 'idle' });

    const response = await new Promise<ContentResponse>(resolve => {
      void mod.handleMessage({ type: 'GET_STATE' }, makeSender(), resolve);
    });

    const state = response.state;
    expect(typeof state?.readingPanelVisible).toBe('boolean');
  });
});

// ================================================================
// F8 — the reading order was fake
//
// The panel numbered its entries in translation-completion order. The
// translation runs concurrently and viewport-first, so that order is the
// viewport's priority order, not the chapter's reading order.
// ================================================================
describe('F8: the reading order follows the document', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('numbers the panel entries by their position in the page', async () => {
    await writeConfig({ enabled: true });

    // The images are in this order in the document.
    const first = makeComicImage('https://cdn.example.com/1.webp');
    const second = makeComicImage('https://cdn.example.com/2.webp');
    const third = makeComicImage('https://cdn.example.com/3.webp');

    // Answer each image with a distinct translation so the entries can be
    // told apart, and make the *last* image in the document finish first.
    // That is what a concurrent, viewport-first run does: the completion
    // order is not the reading order, and the panel used to inherit it.
    const textBySrc = new Map<string, string>([
      ['https://cdn.example.com/1.webp', 'first'],
      ['https://cdn.example.com/2.webp', 'second'],
      ['https://cdn.example.com/3.webp', 'third'],
    ]);
    const delayBySrc = new Map<string, number>([
      ['https://cdn.example.com/1.webp', 30],
      ['https://cdn.example.com/2.webp', 20],
      ['https://cdn.example.com/3.webp', 0],
    ]);
    translateImageMock.mockImplementation(async (img: HTMLImageElement) => {
      await new Promise(resolve =>
        setTimeout(resolve, delayBySrc.get(img.src) ?? 0)
      );
      return {
        success: true,
        textAreas: makeTextAreas(textBySrc.get(img.src) ?? 'unknown'),
      };
    });

    await translatePage();

    const panelHost = document.querySelector(
      '[data-manga-translator-reading-panel]'
    ) as HTMLElement;
    const shadow = panelHost.shadowRoot;
    const entries = Array.from(shadow?.querySelectorAll('.entry') ?? []);
    expect(entries.length).toBe(3);

    // The first image in the document is entry 1, whatever order the
    // translation finished in.
    const indexByImage = new Map<HTMLImageElement, number>();
    const imageByText = new Map<string, HTMLImageElement>([
      ['first', first],
      ['second', second],
      ['third', third],
    ]);
    entries.forEach(entry => {
      const index = Number(entry.getAttribute('data-index'));
      const preview = entry.querySelector('.entry-preview')?.textContent ?? '';
      const image = imageByText.get(preview);
      expect(image).toBeTruthy();
      if (image) {
        indexByImage.set(image, index);
      }
    });

    expect(indexByImage.get(first)).toBe(1);
    expect(indexByImage.get(second)).toBe(2);
    expect(indexByImage.get(third)).toBe(3);
  });

  it('keeps the anchor badges in sync with the renumbered entries', async () => {
    await writeConfig({ enabled: true });

    // The images are at distinct vertical positions, so a badge can be
    // traced back to the image it is anchored to.
    const first = makeComicImage('https://cdn.example.com/1.webp', 0);
    const second = makeComicImage('https://cdn.example.com/2.webp', 1500);

    // The last image in the document finishes first, so the completion
    // order and the reading order disagree.
    const delayBySrc = new Map<string, number>([
      ['https://cdn.example.com/1.webp', 30],
      ['https://cdn.example.com/2.webp', 0],
    ]);
    translateImageMock.mockImplementation(async (img: HTMLImageElement) => {
      await new Promise(resolve =>
        setTimeout(resolve, delayBySrc.get(img.src) ?? 0)
      );
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    await translatePage();

    const anchorsHost = document.querySelector(
      '[data-manga-translator-reading-anchors]'
    ) as HTMLElement;
    const badges = Array.from(
      anchorsHost.shadowRoot?.querySelectorAll<HTMLElement>('.badge') ?? []
    );
    expect(badges.length).toBe(2);

    // The badge anchored to the first image in the document must carry
    // "1", and the one on the second image "2". A badge that kept its
    // completion-order number would send the user to the wrong entry.
    const badgeFor = (image: HTMLImageElement): string | undefined => {
      const rect = image.getBoundingClientRect();
      const badge = badges.find(
        candidate =>
          Math.abs(parseFloat(candidate.style.top) - (rect.top + 12)) < 1
      );
      return badge?.dataset['index'];
    };

    expect(badgeFor(first)).toBe('1');
    expect(badgeFor(second)).toBe('2');
  });
});

// ================================================================
// F9 — SPA route changes leaked the previous chapter
// ================================================================
describe('F9: SPA route changes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    removeAllMock.mockReset();
    useAppConfigStore.setState({ enabled: true });
    clearAll();
  });

  it('clears the overlays and the processed markers on a route change', async () => {
    const { handleRouteChange } = await import('./content');
    const img = makeComicImage('https://cdn.example.com/a.webp');
    img.classList.add('manga-translator-processed');

    handleRouteChange();

    expect(removeAllMock).toHaveBeenCalled();
    expect(img.classList.contains('manga-translator-processed')).toBe(false);
  });

  it('drops the previous chapter’s panel entries and anchor badges', async () => {
    // The leak was not the host element: it was the strong references to
    // the old chapter's <img> elements held by the panel entries and the
    // anchor badges. A route change has to release them.
    const { handleRouteChange } = await import('./content');
    await writeConfig({ enabled: true });
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const panelHost = document.querySelector(
      '[data-manga-translator-reading-panel]'
    );
    expect(panelHost).not.toBeNull();
    const panelShadow = (panelHost as HTMLElement).shadowRoot;
    expect(panelShadow?.querySelectorAll('.entry').length).toBe(1);

    const anchorsHost = document.querySelector(
      '[data-manga-translator-reading-anchors]'
    );
    const anchorsShadow = (anchorsHost as HTMLElement).shadowRoot;
    expect(anchorsShadow?.querySelectorAll('.badge').length).toBe(1);

    handleRouteChange();

    // The entries and the badges are gone, so nothing holds on to the old
    // chapter's images.
    expect(panelShadow?.querySelectorAll('.entry').length).toBe(0);
    expect(anchorsShadow?.querySelectorAll('.badge').length).toBe(0);
  });

  it('clears the processed markers so the new chapter is translated', async () => {
    const { handleRouteChange } = await import('./content');
    const img = makeComicImage('https://cdn.example.com/a.webp');
    img.classList.add('manga-translator-processed');

    handleRouteChange();

    expect(img.classList.contains('manga-translator-processed')).toBe(false);
  });

  it('detects a URL change that did not reload the document', async () => {
    // A SPA that calls history.pushState changes the URL without
    // reloading the document. The content script has to notice, or the
    // panel keeps pointing at the previous chapter.
    //
    // The check polls location.href rather than wrapping
    // history.pushState: a content script runs in an isolated world with
    // its own History.prototype, so the page's own pushState calls never
    // reach a wrapper installed here.
    const { checkRouteChangeOnce } = await import('./content');
    const img = makeComicImage('https://cdn.example.com/a.webp');
    img.classList.add('manga-translator-processed');

    const before = window.location.href;

    // Simulate the SPA navigating.
    window.history.pushState({}, '', '/chapter/2');
    expect(window.location.href).not.toBe(before);

    checkRouteChangeOnce();

    expect(img.classList.contains('manga-translator-processed')).toBe(false);
  });

  it('does not clear anything when the URL did not change', async () => {
    const { checkRouteChangeOnce } = await import('./content');
    const img = makeComicImage('https://cdn.example.com/a.webp');
    img.classList.add('manga-translator-processed');

    checkRouteChangeOnce();

    // A poll that finds no change must not wipe the page.
    expect(img.classList.contains('manga-translator-processed')).toBe(true);
  });
});

// ================================================================
// Regression guard: a superseded run must not release the new run's mutex
//
// A run that is being torn down (cancelled, cleared, or replaced by a
// route change) still reaches its `finally` block. If that block released
// the mutex unconditionally, it would clear the mutex of the run that had
// already taken over — and a third request could then start a duplicate
// run on top of it.
// ================================================================
describe("a superseded run does not release the new run's mutex", () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('keeps the second run exclusive while the first unwinds', async () => {
    await writeConfig({ enabled: true });

    const gates: Array<{ release: (() => void) | null }> = [];
    translateImageMock.mockImplementation(async () => {
      const gate: { release: (() => void) | null } = { release: null };
      gates.push(gate);
      await new Promise<void>(resolve => {
        gate.release = resolve;
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    // Only the content script's own read of the config key is held back,
    // and only for the second run. The config store reads storage too, so
    // hanging every read would break the run in a different way.
    //
    // The second run therefore stays in its start-up window — before it
    // announces itself as "translating" — and the only thing that can
    // refuse a third request is the mutex itself.
    const getMock = vi.mocked(chrome.storage.local.get) as unknown as {
      getMockImplementation: () =>
        | ((
            keys: string | string[] | null | undefined
          ) => Promise<Record<string, unknown>>)
        | undefined;
      mockImplementation: (
        impl: (
          keys: string | string[] | null | undefined
        ) => Promise<Record<string, unknown>>
      ) => void;
    };
    const realGet = getMock.getMockImplementation();
    let hangConfigRead = false;
    getMock.mockImplementation((keys: string | string[] | null | undefined) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      if (hangConfigRead && keyList.includes(CONFIG_KEY)) {
        return new Promise(() => undefined);
      }
      return realGet?.call(chrome.storage.local, keys) ?? Promise.resolve({});
    });

    // Three images with a concurrency of 2: the first run starts two
    // translations and leaves the third waiting. A third run that is
    // wrongly allowed through would pick that third image up, which makes
    // the difference visible in the call count.
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');
    makeComicImage('https://cdn.example.com/c.webp');

    // First run: hangs on the first two images.
    const firstRun = translatePage();
    await flush(2);
    expect(translateImageMock).toHaveBeenCalledTimes(2);

    // The user clears the page mid-run. That releases the mutex, and the
    // first run is still unwinding.
    clearAll();

    // A new run starts. It is blocked on the storage read, so it has not
    // claimed the "translating" status yet.
    hangConfigRead = true;
    const secondRun = translatePage();
    await flush(2);
    hangConfigRead = false;

    // Now the first run finishes. Its `finally` must not release the
    // second run's mutex.
    gates[0]?.release?.();
    gates[1]?.release?.();
    await firstRun;
    await flush(2);

    // A third request must be refused: the second run still holds the
    // mutex, and it has not announced itself as "translating" yet.
    const thirdRun = translatePage();
    await flush(2);
    // A third run that got through would have translated the third image,
    // which the first run never reached.
    expect(translateImageMock).toHaveBeenCalledTimes(2);

    getMock.mockImplementation(realGet ?? (() => Promise.resolve({})));
    void secondRun;
    void thirdRun;
  });
});

// ================================================================
// F10 — cleanup() left the reading panel and the anchors behind
//
// `cleanup()` destroyed the renderer and the HUD but not the panel or the
// anchors, even though both classes have a `destroy()`. It also left the
// window scroll/resize listeners attached, so every extension reload
// stacked another pair on the page.
// ================================================================
describe('F10: cleanup releases everything the content script injected', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('removes the reading panel and the anchor hosts from the page', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();
    expect(
      document.querySelector('[data-manga-translator-reading-panel]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-manga-translator-reading-anchors]')
    ).not.toBeNull();

    const { cleanup } = await import('./content');
    cleanup();

    expect(
      document.querySelector('[data-manga-translator-reading-panel]')
    ).toBeNull();
    expect(
      document.querySelector('[data-manga-translator-reading-anchors]')
    ).toBeNull();
  });

  it('removes the window scroll and resize listeners', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const added = addSpy.mock.calls
      .filter(call => call[0] === 'scroll' || call[0] === 'resize')
      .map(call => call[1]);

    const { cleanup } = await import('./content');
    cleanup();

    const removed = removeSpy.mock.calls
      .filter(call => call[0] === 'scroll' || call[0] === 'resize')
      .map(call => call[1]);

    // Every listener that was added for the anchors has to be removed
    // again, or each extension reload leaves another pair behind.
    added.forEach(handler => {
      expect(removed).toContain(handler);
    });

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

// ================================================================
// F11 — the master switch had no defence in depth
//
// The popup promises "关闭后不会请求任何模型", but `translatePage` never
// checked the switch, so the context menu or a hand-crafted message
// could still spend money while the extension was off.
// ================================================================
describe('F11: the master switch gates every translation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: false, parallelLimit: 2 });
    clearAll();
  });

  it('does not call the model when the extension is off', async () => {
    await writeConfig({ enabled: false });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    expect(translateImageMock).not.toHaveBeenCalled();
    const state = lastState();
    expect(state.status).toBe('error');
    expect(state.status === 'error' ? state.message : '').toContain(
      '扩展已关闭'
    );
  });

  it('releases the mutex so the next translation can run', async () => {
    // A rejected call that kept `translationRunInFlight` set would block
    // the user's first translation after they switch the extension on.
    await writeConfig({ enabled: false });
    makeComicImage('https://cdn.example.com/a.webp');
    await translatePage();

    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });

    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the "the user asked for this page" fact across a toggle', async () => {
    // Turning the extension off and on again must not force the user to
    // click "translate" a second time.
    await writeConfig({ enabled: false });
    makeComicImage('https://cdn.example.com/a.webp');
    await translatePage();

    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    await translatePage();

    expect(translateImageMock).toHaveBeenCalledTimes(1);
  });
});

// ================================================================
// Regression guard: the state machine still routes every status
// ================================================================
describe('content state machine', () => {
  afterEach(() => {
    setState({ status: 'idle' });
  });

  it('publishes every state it reaches to the background', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const published = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.map(call => {
        const message = call[0] as unknown as { type?: string };
        return message?.type ?? '';
      });
    expect(published).toContain('STATE_UPDATE');
  });
});

// `clearAll` must stay callable from the message handler.
describe('clearAll', () => {
  it('removes the processed markers from the page', async () => {
    document.body.innerHTML = '';
    const img = makeComicImage('https://cdn.example.com/a.webp');
    img.classList.add('manga-translator-processed');

    clearAll();

    expect(img.classList.contains('manga-translator-processed')).toBe(false);
  });
});

// The context menu offers "translate this image", and a keyboard shortcut
// toggles the reading panel. Both messages arrive from the background, and
// both used to be dropped: the content script had no case for them, so the
// menu item and the shortcut did nothing at all.
describe('single-image translation', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('译好的文字'),
      cached: false,
    });
    await writeConfig({});
  });

  it('translates only the image the user pointed at', async () => {
    const target = makeComicImage('https://cdn.example.com/target.webp', 0);
    makeComicImage('https://cdn.example.com/other.webp', 2000);

    await new Promise<void>(resolve => {
      handleMessage(
        { type: 'TRANSLATE_SINGLE_IMAGE', imageUrl: target.src },
        makeSender(),
        () => resolve()
      );
    });
    await flush();

    expect(translateImageMock).toHaveBeenCalledTimes(1);
    expect(translateImageMock.mock.calls[0]?.[0]).toBe(target);
  });

  it('一条长条图会被拆成多片，页面上先说清楚要发几次请求', async () => {
    // 右键翻一张 800×5000 的条漫：图片数是 1，请求数是好几片。HUD 上的
    // 「第 1 张 / 1」关于图片是真的，关于账单一句话都没说 —— 而账是按
    // 请求算的。翻译要跑几十秒，这句话得在钱花出去之前就在屏幕上。
    const target = makeComicImage('https://cdn.example.com/long.webp', 0, 5000);

    await new Promise<void>(resolve => {
      handleMessage(
        { type: 'TRANSLATE_SINGLE_IMAGE', imageUrl: target.src },
        makeSender(),
        () => resolve()
      );
    });
    await flush();

    const published = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.map(
        call =>
          call[0] as unknown as {
            type?: string;
            state?: { costNote?: string };
          }
      )
      .filter(message => message?.type === 'STATE_UPDATE')
      .map(message => message.state);

    const noted = published.find(state => state?.costNote);
    expect(noted?.costNote).toContain('拆成');
    expect(noted?.costNote).toContain('会产生费用');
    // The note must not promise a fixed number of requests. A slice that
    // comes back with no text is asked a second time, and a strip whose
    // slices all fail falls back to one more full-image request — so
    // "10 requests" would be a promise the extension cannot keep.
    expect(noted?.costNote).toContain('可能高于');
    expect(noted?.costNote).not.toMatch(/\d+\s*次调用费用/);
  });

  it('matches an image whose URL carries a different query string', async () => {
    // A CDN that serves the same file under a versioned URL is common, and
    // the context menu reports the URL the browser resolved, not the one in
    // the markup.
    const target = makeComicImage('https://cdn.example.com/page.webp?v=2', 0);

    await new Promise<void>(resolve => {
      handleMessage(
        {
          type: 'TRANSLATE_SINGLE_IMAGE',
          imageUrl: 'https://cdn.example.com/page.webp?v=1',
        },
        makeSender(),
        () => resolve()
      );
    });
    await flush();

    expect(translateImageMock).toHaveBeenCalledTimes(1);
    expect(translateImageMock.mock.calls[0]?.[0]).toBe(target);
  });

  it('reports a clear error when the image is not on the page', async () => {
    makeComicImage('https://cdn.example.com/present.webp', 0);

    await new Promise<void>(resolve => {
      handleMessage(
        {
          type: 'TRANSLATE_SINGLE_IMAGE',
          imageUrl: 'https://cdn.example.com/absent.webp',
        },
        makeSender(),
        () => resolve()
      );
    });
    await flush();

    expect(translateImageMock).not.toHaveBeenCalled();
    expect(lastState()).toMatchObject({ status: 'error' });
    expect((lastState() as { message?: string }).message).toContain('找不到');
  });

  it('does not call the model when the extension is switched off', async () => {
    await writeConfig({ enabled: false });
    const target = makeComicImage('https://cdn.example.com/target.webp', 0);

    await new Promise<void>(resolve => {
      handleMessage(
        { type: 'TRANSLATE_SINGLE_IMAGE', imageUrl: target.src },
        makeSender(),
        () => resolve()
      );
    });
    await flush();

    expect(translateImageMock).not.toHaveBeenCalled();
    expect(lastState()).toMatchObject({ status: 'error' });
  });
});

describe('the reading panel toggle', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    await writeConfig({});
  });

  it('acknowledges the toggle without failing', async () => {
    const response = await new Promise<{ success: boolean }>(resolve => {
      handleMessage({ type: 'TOGGLE_READING_PANEL' }, makeSender(), r =>
        resolve(r)
      );
    });
    expect(response.success).toBe(true);
  });

  it('creates the panel on demand, even before any translation', async () => {
    // The panel is created lazily on the first translation. A user pressing
    // the shortcut before translating anything is exactly the case that
    // would have done nothing.
    await new Promise<void>(resolve => {
      handleMessage({ type: 'TOGGLE_READING_PANEL' }, makeSender(), () =>
        resolve()
      );
    });
    await flush();

    expect(
      document.querySelector('[data-manga-translator-reading-panel]')
    ).toBeTruthy();
  });
});

// A run the user stopped is not a run that failed.
//
// When the user cancels, the abort signal fires and the in-flight workers
// throw. Those throws used to be counted as failures, so the user was told
// "失败 12 张" about images that had never failed — and the "retry the
// failed images" button offered to re-translate them.
describe('a cancelled run is not counted as a failure', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
    await writeConfig({ enabled: true });
  });

  it('reports no failed images when the user cancels mid-run', async () => {
    // Both concurrent workers park on this gate. The second one to arrive
    // would overwrite the first one's release function, so every waiter
    // has to be released at once.
    const gates: Array<() => void> = [];
    translateImageMock.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        gates.push(resolve);
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');

    const run = translatePage();
    await flush(2);
    cancelTranslation();
    gates.forEach(release => release());
    await run;
    await flush(3);

    // The state must not claim any image failed.
    const state = lastState();
    if (state.status === 'complete') {
      expect(state.failedCount ?? 0).toBe(0);
    } else {
      expect(state.status).toBe('idle');
    }
  });
});

// A translation that did not happen must not leave the image looking
// translated.
//
// The processed marker goes on before the request, so a concurrent scan does
// not pick the same image up twice. If it stayed on after a failed or
// cancelled translation, `isTranslatableImage` would reject that image
// forever — the user could only get it back through "force retranslate",
// which re-bills the whole page.
describe('an image that was not translated stays translatable', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
    await writeConfig({ enabled: true });
  });

  it('removes the processed marker when the translation fails', async () => {
    translateImageMock.mockResolvedValue({
      success: false,
      error: 'provider exploded',
    });

    const img = makeComicImage('https://cdn.example.com/fail.webp', 0);
    await translatePage();
    await flush(3);

    expect(img.classList.contains('manga-translator-processed')).toBe(false);
  });

  it('removes the processed marker when the run is cancelled', async () => {
    const gates: Array<() => void> = [];
    translateImageMock.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        gates.push(resolve);
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    const img = makeComicImage('https://cdn.example.com/cancel.webp', 0);
    const run = translatePage();
    await flush(2);
    cancelTranslation();
    gates.forEach(release => release());
    await run;
    await flush(3);

    expect(img.classList.contains('manga-translator-processed')).toBe(false);
  });

  it('keeps the marker on an image that did translate', async () => {
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });

    const img = makeComicImage('https://cdn.example.com/ok.webp', 0);
    await translatePage();
    await flush(3);

    // A successful translation must not be re-done: that would bill the
    // user twice for the same image.
    expect(img.classList.contains('manga-translator-processed')).toBe(true);
  });
});

// ================================================================
// FORCE_RETRANSLATE_FAILED — the popup's "重新翻译失败的 N 张" action
//
// The popup shows a cost confirmation before this runs, so the promise it
// makes has to be exact: only the images that failed are translated again.
// The images that translated fine must not be paid for twice, and the page
// must not be cleared — that would throw away the translations the user
// already has.
// ================================================================
describe('FORCE_RETRANSLATE_FAILED only retries the failed images', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
    // `clearAll()` above removed the overlays, so the recorder starts from
    // zero: the assertion below is about the retry, not about the reset.
    removeAllMock.mockReset();
    await writeConfig({ enabled: true });
  });

  it('re-runs only the failed image and leaves the translated one alone', async () => {
    translateImageMock
      .mockResolvedValueOnce({
        success: true,
        textAreas: makeTextAreas('好'),
      })
      .mockResolvedValueOnce({
        success: false,
        textAreas: [],
        error: 'temporary failure',
      })
      .mockResolvedValue({
        success: true,
        textAreas: makeTextAreas('好了'),
      });

    const ok = makeComicImage('https://cdn.example.com/ok.webp', 0);
    const bad = makeComicImage('https://cdn.example.com/bad.webp', 1200);

    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(2);

    const sendResponse = vi.fn();
    handleMessage(
      { type: 'FORCE_RETRANSLATE_FAILED' },
      makeSender(),
      sendResponse
    );

    // The count is what the popup confirms the cost with, so it has to be
    // the number of images the retry is actually about to bill.
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, count: 1 })
    );

    await flush(6);

    // Three calls in total: the first run translated two images, the retry
    // added exactly one. The image that succeeded was not paid for again.
    expect(translateImageMock).toHaveBeenCalledTimes(3);

    // The failed image was re-translated.
    const retried = translateImageMock.mock.calls[2]?.[0] as HTMLImageElement;
    expect(retried).toBe(bad);

    // The page was not cleared: the successful translation is still there.
    expect(removeAllMock).not.toHaveBeenCalled();
    expect(ok.classList.contains('manga-translator-processed')).toBe(true);
  });

  it('keeps an image on the failure list when it fails again', async () => {
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: 'still broken',
    });

    makeComicImage('https://cdn.example.com/bad.webp', 0);

    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    const sendResponse = vi.fn();
    handleMessage(
      { type: 'FORCE_RETRANSLATE_FAILED' },
      makeSender(),
      sendResponse
    );
    await flush(6);

    // The image was retried…
    expect(translateImageMock).toHaveBeenCalledTimes(2);

    // …and it is still on the failure list, so the popup can offer the
    // action again.
    handleMessage(
      { type: 'FORCE_RETRANSLATE_FAILED' },
      makeSender(),
      sendResponse
    );
    expect(sendResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({ success: true, count: 1 })
    );
  });

  it('answers with a count of zero when nothing failed', async () => {
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好'),
    });

    makeComicImage('https://cdn.example.com/ok.webp', 0);
    await translatePage();

    const sendResponse = vi.fn();
    handleMessage(
      { type: 'FORCE_RETRANSLATE_FAILED' },
      makeSender(),
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, count: 0 })
    );
    await flush(4);
    expect(translateImageMock).toHaveBeenCalledTimes(1);
  });
});

// ================================================================
// CLEAR_ALL must forget the failed images too
//
// The three per-image sets (processed keys, failed keys, failed elements)
// are read as one. `clearAll` used to clear two of them and leave
// `failedImages` populated, so the very list the "重新翻译失败的 N 张"
// button bills for still held the images the user had just cleared — the
// next retry would spend the user's money on images the page no longer
// shows.
//
// The count the popup confirms the cost with comes straight from
// `failedImages`, so "0" here is what the user would see before agreeing
// to pay.
// ================================================================
describe('CLEAR_ALL forgets the failed images', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    removeAllMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
    await writeConfig({ enabled: true });
  });

  it('reports no failed images after the page is cleared', async () => {
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: 'temporary failure',
    });

    makeComicImage('https://cdn.example.com/bad.webp', 0);
    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    // The image is on the failure list…
    const beforeClear = vi.fn();
    handleMessage(
      { type: 'FORCE_RETRANSLATE_FAILED' },
      makeSender(),
      beforeClear
    );
    expect(beforeClear).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, count: 1 })
    );
    await flush(4);
    translateImageMock.mockClear();

    // …and clearing the page has to take it off that list.
    handleMessage({ type: 'CLEAR_ALL' }, makeSender(), vi.fn());

    const afterClear = vi.fn();
    handleMessage(
      { type: 'FORCE_RETRANSLATE_FAILED' },
      makeSender(),
      afterClear
    );
    expect(afterClear).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, count: 0 })
    );

    // And nothing was billed for it.
    await flush(4);
    expect(translateImageMock).not.toHaveBeenCalled();
  });
});

// ================================================================
// V3 产品评审：界面看不到真实状态
//
// 这一组用例锁住内容脚本和弹窗之间的契约：
//   - 页面有几张图、为什么少了几张，必须如实上报；
//   - COUNT_IMAGES 只能看，不能花用户的钱；
//   - 用户在弹窗里关掉开关时，正在跑的翻译必须立刻停下；
//   - 上报的 autoContinueArmed 必须和页面真正的行为一致。
// ================================================================

/**
 * 一张尺寸不合格的图：图标、分割线之类，永远不会被翻译。
 */
function makeSmallImage(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  Object.defineProperty(img, 'naturalWidth', { value: 50 });
  Object.defineProperty(img, 'naturalHeight', { value: 50 });
  Object.defineProperty(img, 'width', { value: 50 });
  Object.defineProperty(img, 'height', { value: 50 });
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top: 0,
      right: 50,
      bottom: 50,
      width: 50,
      height: 50,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(img);
  return img;
}

/**
 * 一张还没加载出来的漫画图。
 *
 * 字节没到的时候，浏览器不知道它有多大——`naturalWidth` 和布局宽度都
 * 是 0。以前这种图被算成"尺寸不合格"，于是懒加载的一章只报了已加载
 * 的那两三张。
 */
function makeLazyImage(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  Object.defineProperty(img, 'naturalWidth', { value: 0 });
  Object.defineProperty(img, 'naturalHeight', { value: 0 });
  Object.defineProperty(img, 'width', { value: 0 });
  Object.defineProperty(img, 'height', { value: 0 });
  Object.defineProperty(img, 'complete', { value: false });
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(img);
  return img;
}

/**
 * 统计到目前为止发布过多少条状态。
 */
function publishedStateCount(): number {
  return vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.filter(
      call =>
        (call[0] as { type?: string } | undefined)?.type === 'STATE_UPDATE'
    ).length;
}

describe('COUNT_IMAGES: 纯只读的图片计数', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
    await writeConfig({ enabled: true });
  });

  it('answers with the number of images that would be translated', async () => {
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');
    makeSmallImage('https://cdn.example.com/icon.png');

    const sendResponse = vi.fn();
    handleMessage({ type: 'COUNT_IMAGES' }, makeSender(), sendResponse);

    // 只有两张漫画图会被翻译，那张 50x50 的图标不算。
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      count: 2,
      pending: 0,
      total: 2,
    });
  });

  it('counts the images that have not loaded yet as pending', async () => {
    // 懒加载的漫画页：浏览器先摆出两张，其余四十张还在路上。以前的
    // 计数把这些"还没到"的图算成"尺寸不合格"，于是弹窗报出来的永远是
    // 两三张——一个系统性偏低的数字，比没有数字更糟。
    makeComicImage('https://cdn.example.com/a.webp');
    makeLazyImage('https://cdn.example.com/b.webp');
    makeLazyImage('https://cdn.example.com/c.webp');

    const sendResponse = vi.fn();
    handleMessage({ type: 'COUNT_IMAGES' }, makeSender(), sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      count: 1,
      pending: 2,
      total: 1,
    });
  });

  it('counts the images it already translated as part of the full price', async () => {
    // "忽略缓存重翻"会把已经翻过的图再翻一遍，所以整页的价钱是"已翻过
    // 的 + 待翻的"，不是只有待翻的那些。
    const image = makeComicImage('https://cdn.example.com/a.webp');
    image.classList.add('manga-translator-processed');

    const sendResponse = vi.fn();
    handleMessage({ type: 'COUNT_IMAGES' }, makeSender(), sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      count: 0,
      pending: 0,
      total: 1,
    });
  });

  it('does not change any state and does not spend anything', async () => {
    makeComicImage('https://cdn.example.com/a.webp');

    const statesBefore = publishedStateCount();
    const sendResponse = vi.fn();
    handleMessage({ type: 'COUNT_IMAGES' }, makeSender(), sendResponse);

    // 看一眼数量不能改变页面上的任何状态。
    expect(publishedStateCount()).toBe(statesBefore);
    // 也不能触发任何一次模型请求。
    expect(translateImageMock).not.toHaveBeenCalled();
    // 状态本身也没有被换掉。
    expect(lastState().status).not.toBe('translating');
  });
});

describe('完成之后的状态带着这一页的真实数字', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('reports the candidate count and both kinds of skipped images', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });

    // 两张漫画图 + 一张尺寸不合格的图
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');
    makeSmallImage('https://cdn.example.com/icon.png');

    await translatePage();

    // 第一轮：两张都翻了，一张图不合格。
    let state = lastState();
    expect(state.status).toBe('complete');
    expect(state.candidateCount).toBe(2);
    expect(state.skippedCount).toBe(1);
    expect(state.skippedDuplicateCount).toBe(0);

    // 再来一张新图，第二轮时前两张已经翻过了。
    makeComicImage('https://cdn.example.com/c.webp');
    await translatePage();

    state = lastState();
    expect(state.status).toBe('complete');
    // 候选只剩新来的那一张。
    expect(state.candidateCount).toBe(1);
    // 尺寸不合格的还是那一张。
    expect(state.skippedCount).toBe(1);
    // 已经翻过的两张单独算，不再混进"不合格"里。
    expect(state.skippedDuplicateCount).toBe(2);
  });
});

describe('关掉"启用扩展"会中止正在跑的翻译', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('stops the run and tells the user what happened to the money', async () => {
    await writeConfig({ enabled: true });

    const gates: Array<() => void> = [];
    translateImageMock.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        gates.push(resolve);
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    makeComicImage('https://cdn.example.com/a.webp');

    const run = translatePage();
    await flush(2);
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    // 用户在弹窗里把"启用扩展"关掉了。
    await writeConfig({ enabled: false });
    handleStorageChange(
      {
        [CONFIG_KEY]: {
          oldValue: undefined,
          newValue: { state: { enabled: false } },
        },
      },
      'local'
    );
    await flush(4);

    // 页面必须立刻停下来，并把情况说清楚。
    const state = lastState();
    expect(state.status).toBe('error');
    expect(state.status === 'error' ? state.message : '').toContain(
      '扩展已关闭'
    );
    // 已经花掉的钱退不了，但剩下的不会再发——这句话要说出来。
    expect(state.status === 'error' ? state.suggestion : '').toBeTruthy();

    gates.forEach(release => release());
    await run;
    await flush(3);

    // 这一轮跑完之后也不能变成"翻译完成"。
    expect(lastState().status).toBe('error');
  });

  it('sends no further request once the switch is off', async () => {
    await writeConfig({ enabled: true });

    const gates: Array<() => void> = [];
    translateImageMock.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        gates.push(resolve);
      });
      return { success: true, textAreas: makeTextAreas('你好') };
    });

    // 并发是 2：三张图里前两张已经发出去了，第三张还没轮到。
    makeComicImage('https://cdn.example.com/a.webp');
    makeComicImage('https://cdn.example.com/b.webp');
    makeComicImage('https://cdn.example.com/c.webp');

    const run = translatePage();
    await flush(2);
    expect(translateImageMock).toHaveBeenCalledTimes(2);

    await writeConfig({ enabled: false });
    gates.forEach(release => release());
    await run;
    await flush(3);

    // 每张图发请求之前都要再问一次开关，所以第三张不会再发出去。
    expect(translateImageMock).toHaveBeenCalledTimes(2);
    const state = lastState();
    expect(state.status).toBe('error');
    expect(state.status === 'error' ? state.message : '').toContain(
      '扩展已关闭'
    );
  });
});

describe('上报的自动续翻状态和页面真正的行为一致', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({
      enabled: true,
      autoContinueEnabled: true,
      autoTranslateHosts: [],
    });
    clearAll();
  });

  it('is off before the user asked for this page', async () => {
    await writeConfig({
      enabled: true,
      autoContinueEnabled: true,
      autoTranslateHosts: [],
    });
    handleStorageChange(
      {
        [CONFIG_KEY]: {
          oldValue: undefined,
          newValue: { state: { enabled: true, autoContinueEnabled: true } },
        },
      },
      'local'
    );
    await flush();

    // 站点不在白名单里，用户也还没让这一页翻译 → 不会自动续翻。
    expect(autoTranslateMode.enabled).toBe(false);

    setState({ status: 'idle' });
    expect(lastState().autoContinueArmed).toBe(false);
  });

  it('is on once the user translated this page, even off the allowlist', async () => {
    await writeConfig({
      enabled: true,
      autoContinueEnabled: true,
      autoTranslateHosts: [],
    });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    // 用户手动翻译了这一页 → 之后新加载的图片会自动跟上并产生费用。
    // 弹窗必须知道这件事，不能只显示白名单开关。
    expect(autoTranslateMode.enabled).toBe(true);
    expect(lastState().autoContinueArmed).toBe(true);
  });

  it('is off again when the extension is switched off', async () => {
    await writeConfig({
      enabled: true,
      autoContinueEnabled: true,
      autoTranslateHosts: [],
    });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');
    await translatePage();
    expect(autoTranslateMode.enabled).toBe(true);

    await writeConfig({
      enabled: false,
      autoContinueEnabled: true,
      autoTranslateHosts: [],
    });
    handleStorageChange(
      {
        [CONFIG_KEY]: {
          oldValue: undefined,
          newValue: { state: { enabled: false, autoContinueEnabled: true } },
        },
      },
      'local'
    );
    await flush(4);

    expect(autoTranslateMode.enabled).toBe(false);
    setState({ status: 'idle' });
    expect(lastState().autoContinueArmed).toBe(false);
  });
});

describe('阅读面板的显示状态会被上报', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('tracks whether the panel is showing', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const before = lastState().readingPanelVisible;
    expect(typeof before).toBe('boolean');

    await new Promise<void>(resolve => {
      handleMessage({ type: 'TOGGLE_READING_PANEL' }, makeSender(), () =>
        resolve()
      );
    });
    await flush();

    // 切换之后上报的值必须跟着变，弹窗显示的按钮状态才和页面一致。
    expect(lastState().readingPanelVisible).toBe(!before);
  });

  it('hides the panel when its own ✕ button is pressed', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const host = document.querySelector(
      '[data-manga-translator-reading-panel]'
    ) as HTMLElement;
    const shadow = host.shadowRoot;
    expect(shadow).toBeTruthy();
    const hideBtn = shadow?.getElementById('hide-btn');
    expect(hideBtn).toBeTruthy();

    hideBtn?.click();
    await flush();

    // 面板自己收起去了，上报给弹窗的状态也得跟着变：
    // 弹窗上那个按钮写的是"显示译文阅读面板"，而面板还挂在页面上，
    // 按钮和现实对不上。
    expect(host.style.display).toBe('none');
    expect(lastState().readingPanelVisible).toBe(false);
  });

  it('stops auto-translating this page on request', async () => {
    // 用户手动翻译过这一页，于是"自动续翻"在这一页上生效了：
    // 之后新加载的图片会自己送去翻译并扣费。
    await writeConfig({ enabled: true, autoContinueEnabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();
    expect(lastState().autoContinueArmed).toBe(true);

    await new Promise<void>(resolve => {
      handleMessage({ type: 'DISARM_PAGE_AUTO_TRANSLATE' }, makeSender(), () =>
        resolve()
      );
    });
    await flush();

    // 关掉之后，上报给弹窗的状态必须立刻跟着变：弹窗上写着
    // "这一页会自动翻译"，而页面已经不翻译了。
    expect(lastState().autoContinueArmed).toBe(false);
  });
});

describe('删除一条译文，三个视图要一起变', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('drops the panel entry and the anchor badge with the overlay', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('你好'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();

    const anchorsHost = document.querySelector(
      '[data-manga-translator-reading-anchors]'
    ) as HTMLElement;
    expect(anchorsHost.shadowRoot?.querySelectorAll('.badge').length ?? 0).toBe(
      1
    );

    // The renderer tells the content script when the user deletes a
    // translation from the image itself.
    const setRemovalListener = rendererMock.setRemovalListener;
    expect(setRemovalListener).toHaveBeenCalled();
    const listener = setRemovalListener.mock.calls[0]?.[0] as (
      image: HTMLImageElement
    ) => void;
    expect(typeof listener).toBe('function');

    const image = document.querySelector(
      'img[src="https://cdn.example.com/a.webp"]'
    ) as HTMLImageElement;
    listener(image);

    // 三个视图说的是同一件事：图上没了，面板里也不能还挂着。
    const panelHost = document.querySelector(
      '[data-manga-translator-reading-panel]'
    ) as HTMLElement;
    expect(panelHost.shadowRoot?.querySelectorAll('.entry').length ?? 0).toBe(
      0
    );
    expect(anchorsHost.shadowRoot?.querySelectorAll('.badge').length ?? 0).toBe(
      0
    );
  });
});

// ================================================================
// The reading-panel toggle
//
// The panel is created lazily, and the first press used to create it and
// immediately hide it: the user pressed the button and the page showed
// nothing at all, while the popup claimed it was hiding the panel.
// ================================================================

describe('TOGGLE_READING_PANEL: 第一次按下必须有反应', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    // The panel is module state: it survives from one test to the next.
    // Tear it down so this test really does see "no panel yet".
    cleanup();
    await writeConfig({ enabled: true });
  });

  it('shows the panel it just created instead of hiding it again', async () => {
    const sendResponse = vi.fn();
    expect(
      handleMessage(
        { type: 'TOGGLE_READING_PANEL' },
        makeSender(),
        sendResponse
      )
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    // 面板现在是可见的，页面也把这件事上报了——弹窗的按钮文字靠它。
    expect(lastState().readingPanelVisible).toBe(true);
  });

  it('hides the panel on the second press', async () => {
    const sendResponse = vi.fn();
    handleMessage({ type: 'TOGGLE_READING_PANEL' }, makeSender(), sendResponse);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(lastState().readingPanelVisible).toBe(true);

    sendResponse.mockClear();
    handleMessage({ type: 'TOGGLE_READING_PANEL' }, makeSender(), sendResponse);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });
    expect(lastState().readingPanelVisible).toBe(false);
  });
});

// ================================================================
// A page that was never translated has no reading panel
//
// The report used to leave the answer out ("undefined") when there was no
// panel at all. The popup then kept whatever the previous page had told
// it, so a fresh page could offer a 「隐藏译文阅读面板」 button for a panel
// that never existed.
//
// This suite runs last because it tears the content script down to get
// back to "no panel yet" — the same trick the toggle suite above uses.
// ================================================================
describe('a page that was never translated', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    cleanup();
    await writeConfig({ enabled: true });
  });

  it('says the reading panel is not showing', async () => {
    const mod = await import('./content');
    mod.setState({ status: 'idle' });

    const response = await new Promise<{ state?: ContentState }>(resolve => {
      void mod.handleMessage({ type: 'GET_STATE' }, makeSender(), resolve);
    });

    // undefined, not false: 「这一页没有面板」和「有面板但没显示」是两件事。
    // 报成 false 的话，弹窗会以为可以显示一个面板——按下去就造出一个空面板
    // 盖在漫画右边，里面什么都没有。
    expect(response.state?.readingPanelVisible).toBeUndefined();
  });
});

// ================================================================
// Round 6 — the observer only spends money the user asked for
//
// The auto-continue observer is the one part of the extension that acts
// without a click. It used to re-pick every image that was not translated
// *successfully*, which includes the ones that failed:
//
//   - `scanImages()` excludes an image only when it carries the processed
//     marker or is in `processedImages`, and a failed image has neither;
//   - every non-retry run cleared the failure list at the start;
//   - so the next observer round found the failed image again and asked the
//     model about it once more.
//
// Twenty follow-up rounds, twenty extra requests, and the user had pressed
// nothing. The failure is also visible to the user as a button —
// 「重新翻译失败的 N 张」 — which the observer was quietly emptying.
//
// The rule now: the observer may only pick up an image it has never asked
// about. Whether a failed image is worth another request is the user's
// decision.
// ================================================================
describe('round 6: the observer never spends money the user did not ask for', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    // The per-image records are module-level, so they survive between
    // tests. Without this the second test in this suite sees every image as
    // "already asked about" and finds nothing to do.
    clearAll();
  });

  it('does not ask about a failed image again on the next observer round', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: 'temporary failure',
    });
    makeComicImage('https://cdn.example.com/fails.webp');

    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    // The observer's round. The image failed, so it is on the user's retry
    // list — but the observer has no business asking about it again.
    await translatePage(false, 'follow-up');

    expect(translateImageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the failure list the user is meant to act on', async () => {
    await writeConfig({ enabled: true });
    // The second attempt succeeds — so an observer round that re-asked
    // about the image would empty the failure list and take the popup's
    // 「重新翻译失败的 N 张」 button with it.
    translateImageMock
      .mockResolvedValueOnce({
        success: false,
        textAreas: [],
        error: 'temporary failure',
      })
      .mockResolvedValue({
        success: true,
        textAreas: makeTextAreas('好了'),
      });
    makeComicImage('https://cdn.example.com/fails.webp');

    await translatePage();
    expect(lastState().retryTargetCount).toBe(1);

    // An automatic round must not empty the list: the popup's
    // 「重新翻译失败的 N 张」 button is built from it, and the user has not
    // dismissed it.
    await translatePage(false, 'follow-up');

    expect(lastState().retryTargetCount).toBe(1);
  });

  it('does not ask again about an image the page swapped the source of', async () => {
    // 页面把缩略图换成大图，是响应式站点的常规做法。地址变了，"问过了"这
    // 条记录就跟着变了——观察器于是又问了一次，同一张图，两次请求。
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: 'temporary failure',
    });
    const img = makeComicImage('https://cdn.example.com/thumb.webp');

    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    // The page swaps the source under the same element.
    img.src = 'https://cdn.example.com/full.webp';

    await translatePage(false, 'follow-up');

    expect(translateImageMock).toHaveBeenCalledTimes(1);
  });

  it('still retries the failed image when the user asks for the page again', async () => {
    await writeConfig({ enabled: true });
    translateImageMock
      .mockResolvedValueOnce({
        success: false,
        textAreas: [],
        error: 'temporary failure',
      })
      .mockResolvedValue({
        success: true,
        textAreas: makeTextAreas('好了'),
      });
    makeComicImage('https://cdn.example.com/fails.webp');

    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    // The user asked for the page again. That is the user spending their
    // own money on purpose, so the failed image gets its turn back.
    await translatePage();

    expect(translateImageMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a run that died early hand the rest of the page to the observer', async () => {
    await writeConfig({ enabled: true });
    // A bad key fails the same way for every image, so the run stops on the
    // first one and the rest of the page is never asked about.
    translateImageMock.mockResolvedValue({
      success: false,
      textAreas: [],
      error: '401 unauthorized',
    });
    makeComicImage('https://cdn.example.com/a.webp', 0);
    makeComicImage('https://cdn.example.com/b.webp', 1300);
    makeComicImage('https://cdn.example.com/c.webp', 2600);

    await translatePage();
    const callsAfterTheRun = translateImageMock.mock.calls.length;
    expect(callsAfterTheRun).toBeGreaterThan(0);

    // The observer's round. The images the aborted run never reached are not
    // "new images that loaded later" — they are the rest of a run the user
    // already stopped.
    await translatePage(false, 'follow-up');

    expect(translateImageMock).toHaveBeenCalledTimes(callsAfterTheRun);
  });

  it('says what a page translation is about to cost, on the page', async () => {
    // The popup writes the cost under the button. The keyboard shortcut and
    // the context menu have no popup to write it in — the money starts
    // moving the moment they are used. So the page says it, while the run
    // is still cancellable.
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好了'),
    });
    makeComicImage('https://cdn.example.com/a.webp', 0);
    // A long strip: one image, several billed calls.
    makeComicImage('https://cdn.example.com/long.webp', 1300, 5000);

    await translatePage();

    const published = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.map(
        call =>
          call[0] as unknown as {
            type?: string;
            state?: { status?: string; costNote?: string };
          }
      )
      .filter(message => message?.type === 'STATE_UPDATE')
      .map(message => message.state);

    const translating = published.filter(
      state => state?.status === 'translating'
    );
    expect(translating.length).toBeGreaterThan(0);
    // The note has to survive the progress updates, not just the first
    // frame: the run updates the state once per image.
    for (const state of translating) {
      expect(state?.costNote).toContain('会产生费用');
    }
    expect(translating[translating.length - 1]?.costNote).toContain('长条');
  });
});

// ================================================================
// Round 11 follow-ups.
//
// Three defects, one shape: the page kept a promise it could not keep, or
// kept a translation that no longer described what was on screen.
//
// Each test here fails without its fix — the fix is the point, not the
// coverage.
// ================================================================
describe('round 11: what the page promises has to be true', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    translateImageMock.mockReset();
    renderMock.mockReset();
    rendererMock.removeTranslation.mockReset();
    providerValidateMock.mockReset();
    providerValidateMock.mockResolvedValue({ valid: true, message: 'ok' });
    useAppConfigStore.setState({ enabled: true, parallelLimit: 2 });
    clearAll();
  });

  it('translates an image that appeared while the page was being translated', async () => {
    // The chapter keeps loading while the first page is still being
    // translated. That image is owed a translation — and the run that was
    // already in flight is the only thing that could have scheduled it.
    await writeConfig({ enabled: true, autoContinueEnabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好了'),
    });

    // The first run is the one the user asked for: it arms the page, so
    // images that appear later follow on their own.
    makeComicImage('https://cdn.example.com/a.webp');
    await translatePage();
    await flush(4);

    // The second run hangs on its image, so the next page of the chapter
    // really does appear *during* a run.
    const gates: Array<() => void> = [];
    translateImageMock.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => {
        gates.push(resolve);
      });
      return { success: true, textAreas: makeTextAreas('好了') };
    });
    makeComicImage('https://cdn.example.com/b.webp', 1300);
    const run = translatePage();
    await flush(2);
    expect(gates.length).toBe(1);

    // The next page arrives, and the observer's debounce fires while the
    // run is still going — the one moment a follow-up cannot happen.
    makeComicImage('https://cdn.example.com/c.webp', 2600);
    await new Promise(resolve => setTimeout(resolve, 900));

    gates.forEach(gate => gate());
    await run;

    // The run is over. Something has to pick the late image up, or it sits
    // there untranslated on a page that says it will carry on by itself.
    await new Promise(resolve => setTimeout(resolve, 900));
    await flush(4);

    // a, b and c — the late one is not left behind.
    expect(translateImageMock).toHaveBeenCalledTimes(3);
  });

  it('stops claiming it will carry on by itself once the budget is spent', async () => {
    await writeConfig({ enabled: true, autoContinueEnabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好了'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();
    await flush(4);
    expect(lastState().autoContinueArmed).toBe(true);

    // Twenty automatic rounds later the budget is gone.
    for (let round = 0; round < 20; round += 1) {
      await translatePage(false, 'follow-up');
    }
    await flush(2);

    // The page does not translate new images any more, so it must not say
    // it will. The reader is told why, instead of being sent to check a
    // switch that was already on.
    const state = lastState();
    expect(state.autoContinueArmed).toBe(false);
    expect(state.autoContinueBudgetExhausted).toBe(true);
  });

  it('starts over when the user asks for the page again', async () => {
    // The budget running out is not a dead end: asking again is the user
    // saying they want this page translated.
    await writeConfig({ enabled: true, autoContinueEnabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好了'),
    });
    makeComicImage('https://cdn.example.com/a.webp');

    await translatePage();
    for (let round = 0; round < 20; round += 1) {
      await translatePage(false, 'follow-up');
    }
    await flush(2);
    expect(lastState().autoContinueArmed).toBe(false);

    await translatePage();
    await flush(2);

    expect(lastState().autoContinueArmed).toBe(true);
    expect(lastState().autoContinueBudgetExhausted).toBe(false);
  });

  it('takes the translation away when the page swaps the artwork', async () => {
    // 页面把缩略图换成大图，是懒加载站点的常规做法。换完之后，屏幕上已经是
    // 另一张画面，而旧译文还盖在上面——它描述的是别的像素。
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好了'),
    });
    const img = makeComicImage('https://cdn.example.com/thumb.webp');

    await translatePage();
    expect(renderMock).toHaveBeenCalledTimes(1);

    img.src = 'https://cdn.example.com/full.webp';
    img.dispatchEvent(new Event('load'));
    await flush(2);

    // The stale translation goes.
    expect(rendererMock.removeTranslation).toHaveBeenCalledWith(img);

    // And the new picture is a candidate again: the popup has to be able to
    // count it and price it. Before the swap it counted as "already
    // translated"; now it counts as a picture waiting to be translated.
    const sendResponse = vi.fn();
    handleMessage({ type: 'COUNT_IMAGES' }, makeSender(), sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      count: 1,
      pending: 0,
      total: 1,
    });
  });

  it('translates the new artwork when the user asks for the page again', async () => {
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好了'),
    });
    const img = makeComicImage('https://cdn.example.com/thumb.webp');

    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    img.src = 'https://cdn.example.com/full.webp';
    img.dispatchEvent(new Event('load'));
    await flush(2);

    // The observer does not spend the user's money on this by itself: it is
    // the same page at another resolution, not a new page of the chapter.
    await translatePage(false, 'follow-up');
    expect(translateImageMock).toHaveBeenCalledTimes(1);

    // The user asked: the new picture is translated, and the reader pays for
    // that one request knowingly.
    await translatePage();
    expect(translateImageMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the translation when only the version in the address changes', async () => {
    // CDN 换一个版本号，画面还是同一张。译文不该被撤掉——撤了读者就得重新
    // 点一次，而图上其实一直有译文。
    await writeConfig({ enabled: true });
    translateImageMock.mockResolvedValue({
      success: true,
      textAreas: makeTextAreas('好了'),
    });
    const img = makeComicImage('https://cdn.example.com/page.webp?v=1');

    await translatePage();
    expect(renderMock).toHaveBeenCalledTimes(1);

    img.src = 'https://cdn.example.com/page.webp?v=2';
    img.dispatchEvent(new Event('load'));
    await flush(2);

    expect(rendererMock.removeTranslation).not.toHaveBeenCalled();
    // And it is not a picture waiting to be translated any more.
    const sendResponse = vi.fn();
    handleMessage({ type: 'COUNT_IMAGES' }, makeSender(), sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      count: 0,
      pending: 0,
      total: 1,
    });
  });
});
