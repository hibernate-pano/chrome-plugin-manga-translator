/**
 * The service worker is the extension's trust boundary, and until now it had
 * no test at all: it exports nothing, so nothing imported it, and it sat
 * outside the coverage denominator entirely while still deciding which sender
 * may read a deobfuscated API key and which outbound URL the worker may fetch.
 *
 * These tests import the real module against a recording chrome stub and drive
 * the registered listeners, so they assert the wiring rather than a copy of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { obfuscateAllApiKeys } from '@/utils/crypto';
import { APP_CONFIG_STORAGE_KEY } from '@/shared/app-config';
import { PROVIDER_NOT_READY_MESSAGE } from '@/shared/runtime-contracts';

type Listener = (...args: unknown[]) => unknown;

interface ResponseFields {
  success?: boolean;
  error?: string;
  config?: unknown;
  received?: boolean;
}

interface SenderFields {
  id?: string;
  tab?: { id: number; url?: string };
  url?: string;
}

interface ChromeHarness {
  onMessage: Listener[];
  onAlarm: Listener[];
  onCommand: Listener[];
  onContextMenuClicked: Listener[];
  onInstalled: Listener[];
  storageChanged: Listener[];
  tabsQuerySpy: ReturnType<typeof vi.fn>;
  sendMessageSpy: ReturnType<typeof vi.fn>;
  contextMenusCreateSpy: ReturnType<typeof vi.fn>;
  contextMenusRemoveAllSpy: ReturnType<typeof vi.fn>;
  alarmsCreateSpy: ReturnType<typeof vi.fn>;
  alarmsClearSpy: ReturnType<typeof vi.fn>;
  sendToMessage: (
    request: unknown,
    sender: SenderFields
  ) => Promise<ResponseFields>;
  localStore: Record<string, unknown>;
  syncStore: Record<string, unknown>;
}

const EXTENSION_ID = 'test-extension-id';

function installChromeMock(): ChromeHarness {
  const onMessage: Listener[] = [];
  const onAlarm: Listener[] = [];
  const onCommand: Listener[] = [];
  const onContextMenuClicked: Listener[] = [];
  const onInstalled: Listener[] = [];
  const storageChanged: Listener[] = [];
  const localStore: Record<string, unknown> = {};
  const syncStore: Record<string, unknown> = {};
  const tabsQuerySpy = vi.fn(async () => []);
  const sendMessageSpy = vi.fn(async () => undefined);
  const contextMenusCreateSpy = vi.fn();
  const contextMenusRemoveAllSpy = vi.fn();
  const alarmsCreateSpy = vi.fn();
  const alarmsClearSpy = vi.fn();

  const chromeMock = {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
      sendMessage: vi.fn(async () => undefined),
      onMessage: {
        addListener: (l: Listener) => onMessage.push(l),
        removeListener: () => undefined,
      },
      onStartup: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
      onInstalled: {
        addListener: (l: Listener) => onInstalled.push(l),
        removeListener: () => undefined,
      },
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) {
            if (key in localStore) out[key] = localStore[key];
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(localStore, items);
          for (const listener of storageChanged) {
            const changes: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(items)) {
              changes[key] = { newValue: value };
            }
            listener(changes, 'local');
          }
        },
        remove: async () => undefined,
      },
      sync: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) {
            if (key in syncStore) out[key] = syncStore[key];
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(syncStore, items);
        },
        remove: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) delete syncStore[key];
        },
      },
      onChanged: {
        addListener: (l: Listener) => storageChanged.push(l),
        removeListener: () => undefined,
      },
    },
    alarms: {
      create: alarmsCreateSpy,
      clear: alarmsClearSpy,
      onAlarm: { addListener: (l: Listener) => onAlarm.push(l) },
    },
    commands: {
      onCommand: { addListener: (l: Listener) => onCommand.push(l) },
    },
    contextMenus: {
      create: contextMenusCreateSpy,
      update: vi.fn(),
      onClicked: {
        addListener: (l: Listener) => onContextMenuClicked.push(l),
      },
      remove: vi.fn(),
      removeAll: contextMenusRemoveAllSpy,
    },
    tabs: {
      query: tabsQuerySpy,
      sendMessage: sendMessageSpy,
      onUpdated: { addListener: () => undefined },
    },
  } as unknown as typeof globalThis.chrome;

  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

  return {
    onMessage,
    onAlarm,
    onCommand,
    onContextMenuClicked,
    onInstalled,
    storageChanged,
    tabsQuerySpy,
    sendMessageSpy,
    contextMenusCreateSpy,
    contextMenusRemoveAllSpy,
    alarmsCreateSpy,
    alarmsClearSpy,
    localStore,
    syncStore,
    sendToMessage: (request, sender) =>
      new Promise<ResponseFields>(resolve => {
        expect(onMessage.length).toBeGreaterThan(0);
        for (const listener of onMessage) {
          // Default to an extension-page sender: our own id, and a document
          // on our own origin. A test that spreads its own `id` or `url`
          // overrides it, which is how the content-script and the
          // anonymous-sender cases are reached.
          listener(
            request,
            {
              id: EXTENSION_ID,
              url: `chrome-extension://${EXTENSION_ID}/popup.html`,
              ...sender,
            },
            resolve
          );
        }
      }),
  };
}

async function loadWorker(): Promise<void> {
  vi.resetModules();
  await import('./background');
  // The module kicks off a getConfig() chain at import time.
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Poll until `predicate` holds, or fail with what was being waited for.
 *
 * The queue starts jobs from a timer (it spaces request starts), so a test
 * that asserted immediately after sending would be asserting before the work
 * had a chance to start. Polling keeps the test about the outcome rather than
 * about how many ticks the queue happens to need.
 */
async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

describe('service worker message authorisation', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  it('refuses a sender that is neither an extension page nor a content script', async () => {
    await loadWorker();

    const response = await new Promise<ResponseFields>(resolve => {
      harness.onMessage[0]?.(
        { action: 'getConfig' },
        // Another extension, or a foreign origin: no matching id, no tab.
        { id: 'some-other-extension' },
        resolve
      );
    });

    expect(response).toEqual({
      success: false,
      error: 'Unauthorized sender',
    });
  });

  it('refuses an anonymous sender outright', async () => {
    await loadWorker();

    const response = await new Promise<ResponseFields>(resolve => {
      harness.onMessage[0]?.({ action: 'getConfig' }, {}, resolve);
    });

    expect(response).toEqual({
      success: false,
      error: 'Unauthorized sender',
    });
  });

  it('will not hand a deobfuscated API key to a content script', async () => {
    // The content script runs inside arbitrary web pages. Reading the
    // deobfuscated key there would put a credential in a page-adjacent
    // context, so getConfig is restricted to extension pages.
    //
    // The sender here is a *real* content script: this extension's own id,
    // and a tab. `sender.id === chrome.runtime.id` is true for it, so an
    // origin check alone would wave it through.
    Object.assign(harness.localStore, {
      'manga-translator-config-v2': {
        state: {
          provider: 'openai-compatible',
          openaiCompatible: { apiKey: 'obf:secret', baseUrl: '', model: '' },
        },
      },
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      { action: 'getConfig' },
      { id: EXTENSION_ID, tab: { id: 42 }, url: 'https://evil.example/reader' }
    );

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('requires extension origin');
    // The key is not in the response in any form.
    expect(JSON.stringify(response)).not.toContain('secret');
  });

  it('will not let a content script rewrite the configuration', async () => {
    await loadWorker();

    const response = await harness.sendToMessage(
      { action: 'setConfig', config: { enabled: true } },
      { id: EXTENSION_ID, tab: { id: 42 }, url: 'https://evil.example/reader' }
    );

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('requires extension origin');
    // Nothing was written.
    expect(harness.localStore['manga-translator-config-v2']).toBeUndefined();
  });

  it('serves getConfig to an extension page', async () => {
    await loadWorker();

    // An extension page has no tab: the popup and the settings page are the
    // only senders allowed to read the deobfuscated configuration.
    const response = await harness.sendToMessage({ action: 'getConfig' }, {});

    expect(response['success']).toBe(true);
    expect(response['config']).toBeDefined();
  });

  it('treats a sender on our own origin as an extension page, tab or not', async () => {
    // The credential gate is a statement about where the message came from,
    // not about whether the sender happens to carry a tab. An extension page
    // that also carries a tab context is still an extension page: refusing
    // it would lock the user out of their own settings the day anything
    // started sending the worker a message with a tab in it.
    Object.assign(harness.localStore, {
      'manga-translator-config-v2': {
        state: {
          provider: 'openai-compatible',
          openaiCompatible: { apiKey: 'obf:secret', baseUrl: '', model: '' },
        },
      },
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      { action: 'getConfig' },
      {
        id: EXTENSION_ID,
        tab: { id: 9 },
        url: `chrome-extension://${EXTENSION_ID}/options.html`,
      }
    );

    expect(response['success']).toBe(true);
    expect(response['config']).toBeDefined();
  });

  it('refuses a sender that is not on our own origin, tab or not', async () => {
    // The mirror. A sender that names our extension but whose document is a
    // web page is not one of our pages, so it does not get the credential —
    // and the old test ("no tab means extension page") would have handed it
    // over.
    Object.assign(harness.localStore, {
      'manga-translator-config-v2': {
        state: {
          provider: 'openai-compatible',
          openaiCompatible: { apiKey: 'obf:secret', baseUrl: '', model: '' },
        },
      },
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      { action: 'getConfig' },
      { id: EXTENSION_ID, url: 'https://evil.example/reader' }
    );

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('requires extension origin');
    // The key is not in the response in any form.
    expect(JSON.stringify(response)).not.toContain('secret');
  });

  it('lets an extension page write the configuration', async () => {
    // The mirror of the two refusals above: the settings page owns the
    // configuration, and its write has to land in the shape the store reads.
    await loadWorker();

    const response = await harness.sendToMessage(
      {
        action: 'setConfig',
        config: {
          enabled: true,
          targetLanguage: 'ja',
          openaiCompatible: {
            apiKey: 'sk-user-secret',
            baseUrl: 'https://api.example.com/v1',
            model: 'gpt-4o',
          },
        },
      },
      {}
    );

    expect(response['success']).toBe(true);

    const stored = harness.localStore['manga-translator-config-v2'] as {
      state?: Record<string, unknown>;
      version?: number;
    };
    expect(stored.version).toBe(4);
    expect(stored.state?.['targetLanguage']).toBe('ja');
    // The key is on disk obfuscated, never in the clear.
    expect(JSON.stringify(stored)).not.toContain('sk-user-secret');
  });
});

describe('service worker image proxy', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  it('rejects a fetch request with no image URL', async () => {
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'FETCH_IMAGE_BYTES' },
      { tab: { id: 3 }, url: 'https://manga.example/chapter-1' }
    );

    expect(response).toEqual({
      success: false,
      error: 'No image URL provided',
    });
  });

  it('refuses to fetch a loopback address on a page’s behalf', async () => {
    // Without this the worker is an SSRF primitive: any page could aim it at
    // a router admin panel or a local service and be handed the bytes.
    await loadWorker();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    const response = await harness.sendToMessage(
      { type: 'FETCH_IMAGE_BYTES', imageUrl: 'http://127.0.0.1:8080/admin' },
      { tab: { id: 3 }, url: 'https://manga.example/chapter-1' }
    );

    expect(response['success']).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.doUnmock('@/shared/preloaded-config');
  });

  it('refuses to fetch a cloud metadata endpoint', async () => {
    await loadWorker();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    const response = await harness.sendToMessage(
      {
        type: 'FETCH_IMAGE_BYTES',
        imageUrl: 'http://169.254.169.254/latest/meta-data/',
      },
      { tab: { id: 3 }, url: 'https://manga.example/chapter-1' }
    );

    expect(response['success']).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('refuses a non-http scheme', async () => {
    await loadWorker();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    const response = await harness.sendToMessage(
      { type: 'FETCH_IMAGE_BYTES', imageUrl: 'file:///etc/passwd' },
      { tab: { id: 3 }, url: 'https://manga.example/chapter-1' }
    );

    expect(response['success']).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('image proxy sender scoping', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  it('refuses a sender with no id and no tab on the type-based branch', async () => {
    // A tab-bearing sender is accepted because Chrome only ever attaches a tab
    // to this extension's own injected content scripts — a foreign extension
    // cannot produce one, and with no `externally_connectable` in the manifest a
    // web page cannot reach onMessage at all. So the reachable failure is an
    // anonymous sender, which must not be served.
    await loadWorker();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    const response = await new Promise<ResponseFields>(resolve => {
      harness.onMessage[0]?.(
        { type: 'FETCH_IMAGE_BYTES', imageUrl: 'https://cdn.example/a.jpg' },
        {},
        resolve
      );
    });

    expect(response['success']).toBe(false);
    expect(response['error']).toBe('Unauthorized sender');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('refuses an extension page asking to proxy an image', async () => {
    // Extension pages never legitimately proxy, so the popup and options page
    // are not handed the fetch primitive.
    await loadWorker();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    const response = await harness.sendToMessage(
      { type: 'FETCH_IMAGE_BYTES', imageUrl: 'https://cdn.example/a.jpg' },
      // A sender with no tab is an extension page.
      {}
    );

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('not allowed for this page');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('allows a content script to fetch its own origin', async () => {
    await loadWorker();
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(bytes, {
        headers: { 'content-type': 'image/png' },
      })
    );

    await harness.sendToMessage(
      {
        type: 'FETCH_IMAGE_BYTES',
        imageUrl: 'https://manga.example/ch1/p1.png',
      },
      { tab: { id: 5 }, url: 'https://manga.example/ch1/' }
    );

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('refuses a cross-origin URL that is not shaped like an image', async () => {
    // Without the image-shape rule the worker is a general fetch proxy for any
    // page the user visits.
    await loadWorker();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    const response = await harness.sendToMessage(
      {
        type: 'FETCH_IMAGE_BYTES',
        imageUrl: 'https://internal-admin.corp/api/export',
      },
      { tab: { id: 5 }, url: 'https://manga.example/ch1/' }
    );

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('not allowed for this page');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('allows a cross-origin image-shaped URL', async () => {
    await loadWorker();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/jpeg' },
      })
    );

    await harness.sendToMessage(
      {
        type: 'FETCH_IMAGE_BYTES',
        imageUrl: 'https://cdn.mangafire.io/1/2.jpg',
      },
      { tab: { id: 5 }, url: 'https://mangafire.io/read/1' }
    );

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('service worker config normalisation', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  it('keeps a valid stored snapshot verbatim through a config round-trip', async () => {
    harness.localStore['manga-translator-config-v2'] = {
      state: {
        enabled: true,
        provider: 'ollama',
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          model: 'llava',
        },
        targetLanguage: 'ko',
      },
      version: 3,
    };

    await loadWorker();

    const response = await harness.sendToMessage({ action: 'getConfig' }, {});
    expect(response['success']).toBe(true);
    const config = response['config'] as Record<string, unknown>;
    expect(config['enabled']).toBe(true);
    expect(config['provider']).toBe('ollama');
    expect(config['targetLanguage']).toBe('ko');
    // Provider surfaces are rebuilt from the normalised runtime settings so
    // a stale/absent providers map cannot reach the content script.
    expect(
      (config['providers'] as Record<string, unknown>)['ollama']
    ).toMatchObject({ model: 'llava', baseUrl: 'http://localhost:11434' });
  });

  it('normalises an absent snapshot to the defaults', async () => {
    await loadWorker();

    const response = await harness.sendToMessage({ action: 'getConfig' }, {});
    expect(response['success']).toBe(true);
    const config = response['config'] as Record<string, unknown>;
    expect(config['enabled']).toBe(false);
    expect(config['provider']).toBe('openai-compatible');
    expect(Object.keys(config['providers'] as object)).toEqual([
      'openai-compatible',
      'ollama',
      'lm-studio',
    ]);
  });

  it('accepts both flat and envelope-shaped stored snapshots', async () => {
    // Flat shape: older writers stored the state without the {state, version}
    // envelope. extractPersistedState must read both.
    harness.localStore['manga-translator-config-v2'] = {
      enabled: true,
      provider: 'lm-studio',
      targetLanguage: 'en',
    };

    await loadWorker();
    const response = await harness.sendToMessage({ action: 'getConfig' }, {});
    const config = response['config'] as Record<string, unknown>;
    expect(config['enabled']).toBe(true);
    expect(config['provider']).toBe('lm-studio');
    expect(config['targetLanguage']).toBe('en');
  });
});

describe('service worker config persistence', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  it('keeps the persisted configuration intact across an extension update', async () => {
    // The bug: on update the worker wrote a *flat* object to the very key
    // zustand reads. Zustand rehydrates from `state`, so a flat object read
    // back as "nothing stored" — the defaults were merged over the user's
    // settings and written straight back to disk. The API key, endpoint,
    // model and auto-translate allowlist were gone after one update.
    const provider = {
      apiKey: 'sk-user-secret',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
    };
    const state: Record<string, unknown> = {
      enabled: true,
      provider: 'openai-compatible',
      targetLanguage: 'ko',
      autoTranslateHosts: ['manga.example'],
      openaiCompatible: { ...provider },
      providers: { 'openai-compatible': { ...provider } },
    };
    obfuscateAllApiKeys(state);

    harness.localStore['manga-translator-config-v2'] = { state, version: 4 };

    await loadWorker();

    for (const listener of harness.onInstalled) {
      listener({ reason: 'update' });
    }
    await new Promise(resolve => setTimeout(resolve, 0));

    const stored = harness.localStore['manga-translator-config-v2'] as {
      state?: Record<string, unknown>;
      version?: number;
    };
    // The envelope is still an envelope — a flat write would have taken
    // `state` and `version` away.
    expect(stored.version).toBe(4);
    expect(stored.state).toBeDefined();

    // And the user's settings are still readable through the worker.
    const response = await harness.sendToMessage({ action: 'getConfig' }, {});
    const config = response['config'] as Record<string, unknown>;
    expect(config['targetLanguage']).toBe('ko');
    expect(config['autoTranslateHosts']).toEqual(['manga.example']);
    const openai = config['openaiCompatible'] as Record<string, string>;
    expect(openai['apiKey']).toBe('sk-user-secret');
    expect(openai['baseUrl']).toBe('https://api.example.com/v1');
    expect(openai['model']).toBe('gpt-4o');
  });

  it('still moves a legacy sync config into local storage on update', async () => {
    // The one thing the update path is still allowed to do: v0.3.5 moved the
    // config out of chrome.storage.sync so the API key stops following the
    // user across devices.
    harness.syncStore['manga-translator-config-v2'] = {
      state: { enabled: true },
      version: 4,
    };

    await loadWorker();

    for (const listener of harness.onInstalled) {
      listener({ reason: 'update' });
    }
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.localStore['manga-translator-config-v2']).toEqual({
      state: { enabled: true },
      version: 4,
    });
    expect(harness.syncStore['manga-translator-config-v2']).toBeUndefined();
  });

  it('never copies an unreadable sync value into the local config key', async () => {
    // The one key holds exactly one shape: the envelope the store reads. A
    // synced value that is not a configuration object at all — a string, a
    // number, an array, something an older version wrote by mistake — used
    // to be copied through verbatim, and the store then read it as "nothing
    // stored", merged the defaults over it and wrote those back.
    harness.syncStore['manga-translator-config-v2'] = 'not-a-config';

    await loadWorker();

    for (const listener of harness.onInstalled) {
      listener({ reason: 'update' });
    }
    await new Promise(resolve => setTimeout(resolve, 0));

    const stored = harness.localStore['manga-translator-config-v2'];
    expect(typeof stored).toBe('object');
    expect(stored).not.toBe('not-a-config');
    const envelope = stored as { state?: unknown; version?: number };
    expect(envelope.state).toBeDefined();
    expect(typeof envelope.version).toBe('number');
    // The unusable copy is not left behind in sync either.
    expect(harness.syncStore['manga-translator-config-v2']).toBeUndefined();
  });
});

describe('service worker keepalive and queue sync', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  /**
   * Fire the storage-change listeners the worker registered.
   *
   * The worker registers three of them (keepalive, queue limit, config
   * broadcast) and the real Chrome fires all three for one write, so a test
   * that fires only one would be testing a shape the browser never produces.
   */
  function fireConfigChange(state: Record<string, unknown>): void {
    for (const listener of harness.storageChanged) {
      listener(
        {
          'manga-translator-config-v2': {
            newValue: { state },
          },
        },
        'local'
      );
    }
  }

  function jobRequest(): Record<string, unknown> {
    return {
      type: 'JOB_TRANSLATE_IMAGE',
      jobId: 'job-1',
      pageKey: 'page-1',
      scope: 'page',
      priorityClass: 'visible-now',
      imageBase64: 'AAAA',
      mimeType: 'image/png',
      imageUrl: 'https://cdn.example/ch1/p01.jpg',
      sourcePageUrl: 'https://manga.example/ch1',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    };
  }

  it('creates the keepalive alarm when translation is switched on and clears it when switched off', async () => {
    await loadWorker();
    // Import time reads the stored config, which starts empty here. Clear the
    // record so the assertions below are about the storage listener alone.
    harness.alarmsCreateSpy.mockClear();
    harness.alarmsClearSpy.mockClear();

    fireConfigChange({ enabled: true });

    // 0.5 is Chrome's documented floor for `periodInMinutes`; anything
    // smaller is silently clamped, so an authored value below it describes a
    // cadence the browser will never deliver.
    expect(harness.alarmsCreateSpy).toHaveBeenCalledWith(
      'manga-translator-keepalive',
      { periodInMinutes: 0.5, delayInMinutes: 0.5 }
    );

    fireConfigChange({ enabled: false });

    expect(harness.alarmsClearSpy).toHaveBeenCalledWith(
      'manga-translator-keepalive'
    );
  });

  it('leaves the alarm alone for a storage write that does not touch the config', async () => {
    // The cache and the usage ledger share `chrome.storage.local` with the
    // config, and a translation writes to them on every image. Re-arming the
    // alarm (or clearing it) on those writes would make the keepalive track
    // the cache rather than the switch.
    await loadWorker();
    harness.alarmsCreateSpy.mockClear();
    harness.alarmsClearSpy.mockClear();

    for (const listener of harness.storageChanged) {
      listener({ 'manga-translator-cache-v2': { newValue: {} } }, 'local');
      // The sync area is not where the config lives any more.
      listener(
        { 'manga-translator-config-v2': { newValue: { state: {} } } },
        'sync'
      );
    }

    expect(harness.alarmsCreateSpy).not.toHaveBeenCalled();
    expect(harness.alarmsClearSpy).not.toHaveBeenCalled();
  });

  it('starts queued work when the concurrency limit is raised in settings', async () => {
    // The queue's limit is read from `chrome.storage` and the reader can
    // change it while a chapter is queued. `updateMaxConcurrent` drains, so
    // raising the limit has to start waiting jobs immediately rather than at
    // the next completion — otherwise the setting only takes effect on the
    // next page, which is not what the settings page says.
    //
    // Observed at the only place that can tell the truth about concurrency:
    // how many provider calls are in flight at once.
    const started: string[] = [];
    const gates: Array<() => void> = [];
    vi.doMock('./provider-direct-client', () => ({
      translateImageViaProviderDirect: vi.fn(
        (job: { imageBase64: string }) =>
          new Promise(resolve => {
            started.push(job.imageBase64);
            gates.push(() => resolve({ success: true, textAreas: [] }));
          })
      ),
    }));

    harness.localStore['manga-translator-config-v2'] = {
      state: {
        enabled: true,
        parallelLimit: 1,
        provider: 'ollama',
        ollama: { baseUrl: 'http://localhost:11434', model: 'llava' },
      },
    };
    await loadWorker();

    const send = (jobId: string, pageKey: string, image: string): void => {
      void harness
        .sendToMessage(
          { ...jobRequest(), jobId, pageKey, imageBase64: image },
          {
            id: EXTENSION_ID,
            tab: { id: 42, url: 'https://manga.example/ch1' },
          }
        )
        .catch(() => undefined);
    };

    send('job-a', 'page-a', 'A');
    await waitFor(() => started.length === 1, 'the first job never started');

    send('job-b', 'page-b', 'B');
    // Long enough for the queue's 500 ms spacing between request starts: if
    // the limit were not being honoured, B would have started by now.
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(started).toEqual(['A']);

    fireConfigChange({
      enabled: true,
      parallelLimit: 2,
      provider: 'ollama',
      ollama: { baseUrl: 'http://localhost:11434', model: 'llava' },
    });
    await waitFor(
      () => started.length === 2,
      'raising the limit did not start the queued job'
    );
    expect(started).toEqual(['A', 'B']);

    for (const release of gates) {
      release();
    }
    vi.doUnmock('./provider-direct-client');
  });

  it('READY from an allowlisted tab requests auto-translation', async () => {
    harness.localStore['manga-translator-config-v2'] = {
      state: {
        enabled: true,
        autoTranslateHosts: ['manga.example'],
      },
    };
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'READY' },
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    expect(response).toMatchObject({ received: true });
    // requestAutoTranslateForTab sends TRANSLATE_PAGE to the tab directly.
    // The chrome stub does not expose tabs.sendMessage on the harness, so we
    // assert the observable response only.
  });

  it('READY from a non-allowlisted tab does not auto-translate', async () => {
    harness.localStore['manga-translator-config-v2'] = {
      state: { enabled: true, autoTranslateHosts: ['other.example'] },
    };
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'READY' },
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    expect(response).toMatchObject({ received: true });
  });
});

describe('keyboard shortcuts', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  async function runCommand(
    command: string,
    tab: { id: number; url?: string } | undefined
  ): Promise<void> {
    harness.tabsQuerySpy.mockResolvedValue(tab ? [tab] : []);
    expect(harness.onCommand.length).toBeGreaterThan(0);
    for (const listener of harness.onCommand) {
      listener(command, tab);
    }
    // The handler awaits tabs.query before sending; give the microtask queue
    // a chance to drain.
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  it('translates the active tab on translate-page', async () => {
    await loadWorker();
    await runCommand('translate-page', {
      id: 7,
      url: 'https://manga.example/ch1',
    });

    expect(harness.sendMessageSpy).toHaveBeenCalledWith(7, {
      type: 'TRANSLATE_PAGE',
    });
  });

  it('ignores the cache on force-retranslate', async () => {
    await loadWorker();
    await runCommand('force-retranslate', {
      id: 7,
      url: 'https://manga.example/ch1',
    });

    expect(harness.sendMessageSpy).toHaveBeenCalledWith(7, {
      type: 'FORCE_RETRANSLATE_PAGE',
    });
  });

  it('clears the overlays on clear-overlays', async () => {
    await loadWorker();
    await runCommand('clear-overlays', {
      id: 7,
      url: 'https://manga.example/ch1',
    });

    expect(harness.sendMessageSpy).toHaveBeenCalledWith(7, {
      type: 'CLEAR_ALL',
    });
  });

  it('asks the content script to toggle the reading panel', async () => {
    await loadWorker();
    await runCommand('toggle-reading-panel', {
      id: 7,
      url: 'https://manga.example/ch1',
    });

    expect(harness.sendMessageSpy).toHaveBeenCalledWith(7, {
      type: 'TOGGLE_READING_PANEL',
    });
  });

  it('targets the active tab of the current window', async () => {
    await loadWorker();
    await runCommand('translate-page', {
      id: 42,
      url: 'https://manga.example/ch1',
    });

    expect(harness.tabsQuerySpy).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(harness.sendMessageSpy).toHaveBeenCalledWith(42, {
      type: 'TRANSLATE_PAGE',
    });
  });

  it('does nothing on a browser internal page', async () => {
    // The content script is never injected into chrome:// pages, so the
    // message would bounce off with "Receiving end does not exist".
    await loadWorker();
    await runCommand('translate-page', {
      id: 7,
      url: 'chrome://extensions',
    });

    expect(harness.sendMessageSpy).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active tab and no event tab', async () => {
    await loadWorker();
    await runCommand('translate-page', undefined);

    expect(harness.sendMessageSpy).not.toHaveBeenCalled();
  });

  it('falls back to the event tab when the query finds nothing', async () => {
    // chrome.commands.onCommand 自带一个 tab 参数。tabs.query 偶尔会返回
    // 空（比如标签页刚被关闭），这时事件里的 tab 仍然是可靠的。
    await loadWorker();
    harness.tabsQuerySpy.mockResolvedValue([]);
    expect(harness.onCommand.length).toBeGreaterThan(0);
    for (const listener of harness.onCommand) {
      listener('translate-page', { id: 9, url: 'https://manga.example/ch1' });
    }
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.sendMessageSpy).toHaveBeenCalledWith(9, {
      type: 'TRANSLATE_PAGE',
    });
  });

  it('ignores an unknown command', async () => {
    await loadWorker();
    await runCommand('not-a-command', {
      id: 7,
      url: 'https://manga.example/ch1',
    });

    expect(harness.sendMessageSpy).not.toHaveBeenCalled();
  });
});

describe('context menu', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  function clickMenu(
    info: { menuItemId: string; srcUrl?: string; pageUrl?: string },
    tab: { id: number; url?: string }
  ): void {
    expect(harness.onContextMenuClicked.length).toBeGreaterThan(0);
    for (const listener of harness.onContextMenuClicked) {
      listener(info, tab);
    }
  }

  it('creates both menu items after removing the old ones', async () => {
    // onInstalled runs on install AND on update. Creating the same id twice
    // makes the second create fail with a duplicate id, so the menu items have
    // to be created inside the removeAll callback.
    await loadWorker();
    expect(harness.onInstalled.length).toBeGreaterThan(0);
    for (const listener of harness.onInstalled) {
      listener({ reason: 'update' });
    }

    expect(harness.contextMenusRemoveAllSpy).toHaveBeenCalledTimes(1);
    // removeAll is async: nothing may be created before its callback runs.
    expect(harness.contextMenusCreateSpy).not.toHaveBeenCalled();

    const callback = harness.contextMenusRemoveAllSpy.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    expect(typeof callback).toBe('function');
    callback?.();

    const created = harness.contextMenusCreateSpy.mock.calls.map(
      call => (call[0] as { id: string; contexts: string[] }).id
    );
    expect(created).toEqual(['translatePage', 'translate-image']);
  });

  it('translates the page from the page context menu', async () => {
    await loadWorker();
    clickMenu(
      { menuItemId: 'translatePage', pageUrl: 'https://manga.example/ch1' },
      { id: 7, url: 'https://manga.example/ch1' }
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.sendMessageSpy).toHaveBeenCalledWith(7, {
      type: 'TRANSLATE_PAGE',
    });
  });

  it('sends the right-clicked image URL for translate-image', async () => {
    await loadWorker();
    clickMenu(
      {
        menuItemId: 'translate-image',
        srcUrl: 'https://cdn.example/ch1/p01.jpg',
        pageUrl: 'https://manga.example/ch1',
      },
      { id: 7, url: 'https://manga.example/ch1' }
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.sendMessageSpy).toHaveBeenCalledWith(7, {
      type: 'TRANSLATE_SINGLE_IMAGE',
      imageUrl: 'https://cdn.example/ch1/p01.jpg',
    });
  });

  it('does nothing when the right-clicked image has no source URL', async () => {
    await loadWorker();
    clickMenu(
      { menuItemId: 'translate-image', pageUrl: 'https://manga.example/ch1' },
      { id: 7, url: 'https://manga.example/ch1' }
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.sendMessageSpy).not.toHaveBeenCalled();
  });

  it('does nothing on a browser internal page', async () => {
    await loadWorker();
    clickMenu(
      { menuItemId: 'translatePage', pageUrl: 'chrome://extensions' },
      { id: 7, url: 'chrome://extensions' }
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(harness.sendMessageSpy).not.toHaveBeenCalled();
  });
});

/**
 * 一个"本地服务商也过不去"的护栏是最常见的回归。
 *
 * 作业排进队列之前会先问一次 `isProviderUsable`（见 enqueueTranslationJob）：
 * 云端服务商没密钥时直接用扩展自己的句子拒绝，而不是发出去、拿到 401、
 * 再告诉读者「API 密钥无效」—— 他手里根本没有密钥可"无效"。这道检查
 * 必须放本地服务商过去：Ollama / LM Studio 本来就不需要密钥，引导页上
 * 写着这句话。
 */
describe('a translation job the extension checks before queuing', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  function jobRequest(): Record<string, unknown> {
    return {
      type: 'JOB_TRANSLATE_IMAGE',
      jobId: 'job-1',
      pageKey: 'page-1',
      scope: 'page',
      priorityClass: 'visible-now',
      imageBase64: 'AAAA',
      mimeType: 'image/png',
      imageUrl: 'https://cdn.example/ch1/p01.jpg',
      sourcePageUrl: 'https://manga.example/ch1',
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
    };
  }

  it('is refused, with the settings sentence, when a cloud key is missing', async () => {
    /*
     * 这个环境里空密钥会被构建时的预置配置补上（个人构建的 .env），所以
     * 要测"真的没有密钥"，得先把构建时预置的密钥换成空的。商店版构建没有
     * 预置密钥，走的正是这条拒绝的路。
     */
    vi.doMock('@/shared/env-credentials', () => ({
      ENV_CREDENTIALS: {
        minimax: { apiKey: '' },
        opencode: { apiKey: '' },
        ollama: { apiKey: '' },
      },
    }));

    harness.localStore[APP_CONFIG_STORAGE_KEY] = {
      state: {
        enabled: true,
        provider: 'openai-compatible',
        openaiCompatible: {
          apiKey: '',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-4o',
        },
      },
      version: 4,
    };
    await loadWorker();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no network in this test'));

    const response = await harness.sendToMessage(jobRequest(), {
      id: EXTENSION_ID,
      tab: { id: 42, url: 'https://manga.example/ch1' },
    });

    expect(response['success']).toBe(false);
    expect(response['error']).toBe(PROVIDER_NOT_READY_MESSAGE);
    // Nothing was sent, so nothing was billed.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.doUnmock('@/shared/env-credentials');
  });

  it('lets a local provider through without a key', async () => {
    // Ollama / LM Studio 本来就不需要密钥 —— 引导页上写着这句话。
    harness.localStore[APP_CONFIG_STORAGE_KEY] = {
      state: {
        enabled: true,
        provider: 'ollama',
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          model: 'llava',
        },
      },
      version: 4,
    };
    await loadWorker();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no network in this test'));

    const response = await harness.sendToMessage(jobRequest(), {
      id: EXTENSION_ID,
      tab: { id: 42, url: 'https://manga.example/ch1' },
    });

    // 作业排进去了（失败的原因会是这台机器上没有 Ollama，而不是"没配密钥"）。
    expect(String(response['error'] ?? '')).not.toBe(
      PROVIDER_NOT_READY_MESSAGE
    );
    fetchSpy.mockRestore();
  });
});

/**
 * 用量由谁记。
 *
 * 每个月的合计只能有一份，否则谁也加不出总数。页面原来自己记一份缓存
 * 命中、worker 再记一份计费调用，两个数字分散在两个地方；而且每个上下文
 * 都攒下自己的一份（worker 空闲半分钟就被回收，页面每次打开都是新的
 * 上下文），列表就永远长下去。
 *
 * 现在只有 worker 记。页面把"这是一次缓存命中"报过来，worker 写进这个
 * 月的合计里。
 */
describe('the worker records the usage', () => {
  let harness: ChromeHarness;

  beforeEach(async () => {
    harness = installChromeMock();
    await loadWorker();
  });

  it('counts the cache hit the page reports', async () => {
    const { summarizeUsageForMonth, useUsageStore } =
      await import('@/stores/usage-store');
    useUsageStore.getState().clearAll();

    const response = await harness.sendToMessage(
      { type: 'RECORD_CACHE_HIT', provider: 'openai-compatible' },
      {
        id: EXTENSION_ID,
        tab: { id: 42, url: 'https://manga.example/ch1' },
      }
    );

    expect(response['received']).toBe(true);

    // 一次缓存命中，零次计费调用。
    const summary = summarizeUsageForMonth(useUsageStore.getState().records);
    expect(summary.translations).toBe(1);
    expect(summary.billableCalls).toBe(0);
    expect(summary.cacheHitRate).toBe(100);
  });

  it('ignores a report that names no provider', async () => {
    const { useUsageStore } = await import('@/stores/usage-store');
    useUsageStore.getState().clearAll();

    await harness.sendToMessage(
      { type: 'RECORD_CACHE_HIT' },
      { id: EXTENSION_ID, tab: { id: 42, url: 'https://manga.example/ch1' } }
    );

    // 说不清是哪个服务商的，就不记 —— 免得账上多出一行来路不明的。
    expect(useUsageStore.getState().records).toHaveLength(0);
  });
});
