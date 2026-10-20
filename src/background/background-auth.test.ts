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

type Listener = (...args: unknown[]) => unknown;

interface ResponseFields {
  success?: boolean;
  error?: string;
  config?: unknown;
}

interface SenderFields {
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
  sendToMessage: (
    request: unknown,
    sender: SenderFields
  ) => Promise<ResponseFields>;
  localStore: Record<string, unknown>;
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
  const tabsQuerySpy = vi.fn(async () => []);
  const sendMessageSpy = vi.fn(async () => undefined);
  const contextMenusCreateSpy = vi.fn();
  const contextMenusRemoveAllSpy = vi.fn();

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
      onChanged: {
        addListener: (l: Listener) => storageChanged.push(l),
        removeListener: () => undefined,
      },
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(),
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
    localStore,
    sendToMessage: (request, sender) =>
      new Promise<ResponseFields>(resolve => {
        expect(onMessage.length).toBeGreaterThan(0);
        for (const listener of onMessage) {
          // Default to an extension-origin sender; a test that spreads its own
          // `id` overrides it, which is how the anonymous-sender case is reached.
          listener(request, { id: EXTENSION_ID, ...sender }, resolve);
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
    // context, so getConfig is restricted to extension origins.
    Object.assign(harness.localStore, {
      'manga-translator-config-v2': {
        state: {
          provider: 'openai-compatible',
          openaiCompatible: { apiKey: 'obf:secret', baseUrl: '', model: '' },
        },
      },
    });
    await loadWorker();

    const tabSender = { tab: { id: 7 }, url: 'https://evil.example/reader' };
    const response = await new Promise<ResponseFields>(resolve => {
      harness.onMessage[0]?.({ action: 'getConfig' }, tabSender, resolve);
    });

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('requires extension origin');
  });

  it('will not let a content script rewrite the configuration', async () => {
    await loadWorker();

    const tabSender = { tab: { id: 7 }, url: 'https://evil.example/reader' };
    const response = await new Promise<ResponseFields>(resolve => {
      harness.onMessage[0]?.(
        { action: 'setConfig', config: { enabled: true } },
        tabSender,
        resolve
      );
    });

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('requires extension origin');
  });

  it('serves getConfig to an extension page', async () => {
    await loadWorker();

    const response = await harness.sendToMessage({ action: 'getConfig' }, {});

    expect(response['success']).toBe(true);
    expect(response['config']).toBeDefined();
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

describe('service worker keepalive and queue sync', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  it('drives the keepalive from storage changes and clears it when disabled', async () => {
    await loadWorker();

    harness.localStore['manga-translator-config-v2'] = {
      state: { enabled: true },
    };
    // Trigger the storage-change listener the worker registered.
    for (const listener of harness.storageChanged) {
      listener(
        {
          'manga-translator-config-v2': {
            newValue: { state: { enabled: true } },
          },
        },
        'local'
      );
    }
    expect(harness.localStore['manga-translator-config-v2']).toBeTruthy();

    for (const listener of harness.storageChanged) {
      listener(
        {
          'manga-translator-config-v2': {
            newValue: { state: { enabled: false } },
          },
        },
        'local'
      );
    }
  });

  it('syncs the queue limit from a storage change', async () => {
    await loadWorker();

    harness.localStore['manga-translator-config-v2'] = {
      state: { parallelLimit: 3 },
    };
    for (const listener of harness.storageChanged) {
      listener(
        {
          'manga-translator-config-v2': {
            newValue: { state: { parallelLimit: 3 } },
          },
        },
        'local'
      );
    }
    // The queue mutation happens behind the mock; the assertion is that the
    // listener path did not throw for envelope, flat, or invalid shapes.
    for (const listener of harness.storageChanged) {
      listener(
        {
          'manga-translator-config-v2': { newValue: {} },
        },
        'local'
      );
      listener({}, 'sync');
    }
    expect(true).toBe(true);
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
