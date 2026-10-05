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
  storageChanged: Listener[];
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
  const storageChanged: Listener[] = [];
  const localStore: Record<string, unknown> = {};

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
        addListener: () => undefined,
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
    contextMenus: {
      create: vi.fn(),
      update: vi.fn(),
      onClicked: { addListener: () => undefined },
      remove: vi.fn(),
      removeAll: vi.fn(),
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => undefined),
      onUpdated: { addListener: () => undefined },
    },
  } as unknown as typeof globalThis.chrome;

  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

  return {
    onMessage,
    onAlarm,
    storageChanged,
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
