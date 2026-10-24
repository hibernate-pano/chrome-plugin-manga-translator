/**
 * The credential trust boundary, exercised end to end.
 *
 * The service worker is the only context that may hold a plaintext API key.
 * Everything else — the content script, the transport, the job request — is
 * an untrusted caller of the worker.
 *
 * These tests drive the real worker against a recording chrome stub, so they
 * assert the wiring rather than a copy of it. Each one fails if the fix is
 * reverted:
 *
 * - a `JOB_TRANSLATE_IMAGE` that names an attacker endpoint must not make
 *   the provider use that endpoint;
 * - a `JOB_TRANSLATE_IMAGE` that names another provider must not switch the
 *   provider;
 * - another extension's content script must not be able to spend the key;
 * - `GET_CONFIG` must answer with a redacted snapshot, never a credential.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerMock = vi.hoisted(() => ({
  createProvider: vi.fn(),
}));

vi.mock('@/providers', () => ({
  createProvider: providerMock.createProvider,
}));

type Listener = (...args: unknown[]) => unknown;

interface ResponseFields {
  success?: boolean;
  error?: string;
  config?: unknown;
  valid?: boolean;
  unplacedCount?: number;
  message?: string;
}

interface SenderFields {
  id?: string;
  tab?: { id: number; url?: string };
  url?: string;
}

interface ChromeHarness {
  onMessage: Listener[];
  storageChanged: Listener[];
  sendToMessage: (
    request: unknown,
    sender?: SenderFields
  ) => Promise<ResponseFields>;
  localStore: Record<string, unknown>;
}

const EXTENSION_ID = 'test-extension-id';
const CONFIG_STORAGE_KEY = 'manga-translator-config-v2';
const REAL_KEY = 'sk-the-user-real-key';
const REAL_BASE_URL = 'https://api.vendor.example/v1';
const ATTACKER_BASE_URL = 'https://attacker.example/collect';

function installChromeMock(): ChromeHarness {
  const onMessage: Listener[] = [];
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
      onAlarm: { addListener: () => undefined },
    },
    commands: {
      onCommand: { addListener: () => undefined },
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
    storageChanged,
    localStore,
    sendToMessage: (request, sender = {}) =>
      new Promise<ResponseFields>(resolve => {
        expect(onMessage.length).toBeGreaterThan(0);
        for (const listener of onMessage) {
          listener(request, { id: EXTENSION_ID, ...sender }, resolve);
        }
      }),
  };
}

async function loadWorker(): Promise<void> {
  vi.resetModules();
  await import('./background');
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Let the microtask queue drain, so an async handler that has already been
 * entered has finished the work it does before its first `await` resolves.
 */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * The configuration a user actually saved.
 *
 * The key is written in plaintext here on purpose. The store obfuscates it
 * on the way out and the worker deobfuscates it on the way in, so the
 * worker does not care how the key is stored — and a plaintext value makes
 * "did the key leak?" a literal string comparison in the assertions below.
 */
function writeStoredConfig(
  harness: ChromeHarness,
  provider: 'openai-compatible' | 'ollama' | 'lm-studio',
  settings: { apiKey: string; baseUrl: string; model: string },
  extra: Record<string, unknown> = {}
): void {
  harness.localStore[CONFIG_STORAGE_KEY] = {
    state: {
      enabled: true,
      provider,
      providers: {
        [provider]: settings,
      },
      [provider]: settings,
      ...extra,
    },
    version: 3,
  };
}

/**
 * Every string reachable in a value, so "the key is not in here" can be
 * checked by value rather than by shape.
 */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, out);
    }
  }
  return out;
}

function hostileJob(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'JOB_TRANSLATE_IMAGE',
    jobId: 'job-hostile',
    pageKey: 'page-hostile',
    scope: 'page',
    priorityClass: 'visible-now',
    imageBase64: 'base64-data',
    mimeType: 'image/png',
    targetLanguage: 'zh-CN',
    translationStylePreset: 'natural-zh',
    ...extra,
  };
}

/**
 * A provider whose first call blocks until the test releases it, and whose
 * later calls resolve at once.
 *
 * The later calls matter: if the fix regresses, the second job reaches the
 * provider and the test has to fail on an assertion rather than hang on a
 * promise nobody resolves.
 */
function blockingProvider(): {
  analyze: ReturnType<typeof vi.fn>;
  release: () => void;
} {
  let release: (() => void) | undefined;
  let calls = 0;
  const analyze = vi.fn(() => {
    calls += 1;
    if (calls > 1) {
      return Promise.resolve({ textAreas: [] });
    }
    return new Promise<{ textAreas: unknown[] }>(resolve => {
      release = () => resolve({ textAreas: [] });
    });
  });
  return {
    analyze,
    release: () => release?.(),
  };
}

describe('service worker credential boundary', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
    providerMock.createProvider.mockReset();
    providerMock.createProvider.mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({ textAreas: [] }),
    });
  });

  it('ignores a baseUrl carried by the job request', async () => {
    // The regression this whole change exists for: the request used to carry
    // `baseUrl`, and the worker sent the user's real key to whatever endpoint
    // the request named. A hostile content script could therefore aim the
    // key at a collector of its own.
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    await loadWorker();

    await harness.sendToMessage(
      hostileJob({
        provider: 'openai-compatible',
        apiKey: 'sk-attacker-key',
        baseUrl: ATTACKER_BASE_URL,
        model: 'attacker-model',
      }),
      // A content script of this extension: same origin, untrusted input.
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );

    expect(providerMock.createProvider).toHaveBeenCalled();
    const [providerType, settings] = providerMock.createProvider.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(providerType).toBe('openai-compatible');
    expect(settings['baseUrl']).toBe(REAL_BASE_URL);
    expect(settings['baseUrl']).not.toBe(ATTACKER_BASE_URL);
    expect(settings['apiKey']).toBe(REAL_KEY);
    expect(settings['model']).toBe('vendor-model');
  });

  it('ignores a provider named by the job request', async () => {
    // `provider` is the worker's decision, not the caller's: the provider
    // decides which credential set and which endpoint the key is sent to, so
    // a caller that may pick it may aim the key at a different endpoint
    // than the one the user is currently using.
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    await loadWorker();

    await harness.sendToMessage(hostileJob({ provider: 'ollama' }), {
      tab: { id: 7, url: 'https://manga.example/ch1' },
    });

    expect(providerMock.createProvider).toHaveBeenCalledTimes(1);
    const [providerType, settings] = providerMock.createProvider.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(providerType).toBe('openai-compatible');
    expect(settings['baseUrl']).toBe(REAL_BASE_URL);
  });

  it('sends the key to the configured endpoint, not to one the request names', async () => {
    // Belt and braces: the provider is built with the configured settings,
    // so the outbound request itself carries the configured host.
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    await loadWorker();

    await harness.sendToMessage(hostileJob({ baseUrl: ATTACKER_BASE_URL }), {
      tab: { id: 7, url: 'https://manga.example/ch1' },
    });

    const serialized = JSON.stringify(
      providerMock.createProvider.mock.calls[0] as unknown[]
    );
    expect(serialized).not.toContain('attacker.example');
    expect(serialized).not.toContain('sk-attacker-key');
  });

  it('refuses a job request from another extension', async () => {
    // Another extension's content script shares the page but not the
    // origin. It must not be able to spend the user's key.
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      hostileJob({ baseUrl: ATTACKER_BASE_URL }),
      { id: 'some-other-extension', tab: { id: 7, url: 'https://x.example' } }
    );

    expect(response['success']).toBe(false);
    // The rejection now happens at the door: `sender.id` is the extension
    // that sent the message, and a foreign one never gets past the first
    // check. The old gate let it through to the per-message checks,
    // because "the sender has a tab" said nothing about *whose* script it
    // was.
    expect(String(response['error'])).toContain('Unauthorized sender');
    expect(providerMock.createProvider).not.toHaveBeenCalled();
  });

  it('refuses a provider preflight from another extension', async () => {
    // A preflight is a real request to the user's provider with the user's
    // key. It used to be reachable from any sender that had a tab, so a
    // foreign extension could make the extension spend the user's money on
    // demand.
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'PROVIDER_PREFLIGHT' },
      { id: 'some-other-extension', tab: { id: 7, url: 'https://x.example' } }
    );

    expect(response['success']).toBe(false);
    expect(String(response['error'])).toContain('Unauthorized sender');
    expect(providerMock.createProvider).not.toHaveBeenCalled();
  });

  it('does not spend anything while the master switch is off', async () => {
    // The switch has to mean "off" all the way down: the content script can
    // be bypassed, the worker cannot.
    harness.localStore[CONFIG_STORAGE_KEY] = {
      state: {
        enabled: false,
        provider: 'openai-compatible',
        providers: {
          'openai-compatible': {
            apiKey: REAL_KEY,
            baseUrl: REAL_BASE_URL,
            model: 'vendor-model',
          },
        },
      },
      version: 3,
    };
    await loadWorker();

    const response = await harness.sendToMessage(hostileJob({}), {
      tab: { id: 7, url: 'https://manga.example/ch1' },
    });

    expect(response['success']).toBe(false);
    expect(providerMock.createProvider).not.toHaveBeenCalled();
  });

  it('drops a queued job when the master switch goes off', async () => {
    // The switch has to mean "off" all the way down.
    //
    // The content script stops asking for new jobs, but the worker's queue
    // can still be holding one per tile for minutes — and each of those
    // would have become a real, billed request. So turning the switch off
    // has to drop what is waiting, not just stop what is coming.
    writeStoredConfig(
      harness,
      'openai-compatible',
      { apiKey: REAL_KEY, baseUrl: REAL_BASE_URL, model: 'vendor-model' },
      { parallelLimit: 1 }
    );

    const provider = blockingProvider();
    providerMock.createProvider.mockResolvedValue({
      analyzeAndTranslate: provider.analyze,
    });
    await loadWorker();

    // The first job takes the only slot and blocks inside the provider.
    const first = harness.sendToMessage(
      hostileJob({ jobId: 'job-a', pageKey: 'page-a' }),
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    await tick();
    expect(provider.analyze).toHaveBeenCalledTimes(1);

    // The second job waits for a slot.
    const second = harness.sendToMessage(
      hostileJob({ jobId: 'job-b', pageKey: 'page-b' }),
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    await tick();
    expect(provider.analyze).toHaveBeenCalledTimes(1);

    // The user turns the extension off.
    harness.localStore[CONFIG_STORAGE_KEY] = {
      state: { enabled: false, parallelLimit: 1 },
      version: 4,
    };
    for (const listener of harness.storageChanged) {
      listener(
        {
          [CONFIG_STORAGE_KEY]: {
            newValue: { state: { enabled: false, parallelLimit: 1 } },
          },
        },
        'local'
      );
    }

    // The queued job is dropped straight away: it does not wait for the
    // running one to finish. (Without the drop it would still be pending,
    // and the race below would time out.)
    const secondResponse = (await Promise.race([
      second,
      new Promise<{ success?: boolean | string; error?: string }>(resolve =>
        setTimeout(() => resolve({ success: 'still-queued' }), 250)
      ),
    ])) as { success?: boolean | string; error?: string };
    expect(secondResponse['success']).toBe(false);
    expect(String(secondResponse['error'])).toContain('扩展已关闭');
    expect(provider.analyze).toHaveBeenCalledTimes(1);

    // The running job is already on the wire and cannot be recalled.
    provider.release();
    await first;
  });

  it('does not spend anything on a job that starts after the switch went off', async () => {
    // The other half of "off": even if a job does start — because the
    // switch went off without the worker being told, or in the window
    // between the queue handing a job over and the request going out — the
    // request must not be made. The switch is checked again at the last
    // moment before the provider is called.
    writeStoredConfig(
      harness,
      'openai-compatible',
      { apiKey: REAL_KEY, baseUrl: REAL_BASE_URL, model: 'vendor-model' },
      { parallelLimit: 1 }
    );

    const provider = blockingProvider();
    providerMock.createProvider.mockResolvedValue({
      analyzeAndTranslate: provider.analyze,
    });
    await loadWorker();

    const first = harness.sendToMessage(
      hostileJob({ jobId: 'job-a', pageKey: 'page-a' }),
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    await tick();
    expect(provider.analyze).toHaveBeenCalledTimes(1);

    const second = harness.sendToMessage(
      hostileJob({ jobId: 'job-b', pageKey: 'page-b' }),
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    await tick();

    // The switch goes off, and the worker is not told: the value is written
    // straight into storage, so no storage event fires and the queue is not
    // cleared. The job still has to notice before it spends anything.
    harness.localStore[CONFIG_STORAGE_KEY] = {
      state: { enabled: false, parallelLimit: 1 },
      version: 4,
    };

    provider.release();
    await first;

    const secondResponse = await second;
    expect(secondResponse['success']).toBe(false);
    expect(String(secondResponse['error'])).toContain('扩展已关闭');
    // The queued job never reached the provider.
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  });

  it('runs a queued job against the provider that is configured when it runs', async () => {
    // A reader can change the provider while a chapter is still in the
    // queue, and the usual reason for changing it is to stop paying: to
    // move from a cloud endpoint to one that runs on their own machine. A
    // queue that kept the provider it was queued with would keep calling
    // the endpoint the reader had just left, and the extension would bill
    // them for a provider they no longer use.
    writeStoredConfig(
      harness,
      'openai-compatible',
      { apiKey: REAL_KEY, baseUrl: REAL_BASE_URL, model: 'vendor-model' },
      { parallelLimit: 1 }
    );

    const provider = blockingProvider();
    const localAnalyze = vi.fn(async () => ({ textAreas: [] }));
    providerMock.createProvider.mockImplementation(async (type: string) =>
      type === 'openai-compatible'
        ? { analyzeAndTranslate: provider.analyze }
        : { analyzeAndTranslate: localAnalyze }
    );
    await loadWorker();

    // The first job takes the only slot and blocks inside the provider.
    const first = harness.sendToMessage(
      hostileJob({ jobId: 'job-a', pageKey: 'page-a' }),
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    await tick();
    expect(provider.analyze).toHaveBeenCalledTimes(1);

    // The second job waits for a slot.
    const second = harness.sendToMessage(
      hostileJob({ jobId: 'job-b', pageKey: 'page-b' }),
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );
    await tick();
    expect(provider.analyze).toHaveBeenCalledTimes(1);

    // The reader moves to a provider that runs on their own machine. The
    // value goes straight into storage, so the worker is not told — the
    // job has to notice for itself when its turn comes.
    harness.localStore[CONFIG_STORAGE_KEY] = {
      state: {
        enabled: true,
        provider: 'ollama',
        parallelLimit: 1,
        openaiCompatible: {
          apiKey: REAL_KEY,
          baseUrl: REAL_BASE_URL,
          model: 'vendor-model',
        },
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          model: 'llava',
        },
      },
      version: 4,
    };

    provider.release();
    await first;

    const secondResponse = await second;
    expect(secondResponse['success']).toBe(true);
    // The queued job went to the local provider.
    expect(localAnalyze).toHaveBeenCalledTimes(1);
    // And the paid endpoint was called exactly once — for the job that was
    // already on the wire when the reader changed their mind.
    const paidCalls = providerMock.createProvider.mock.calls.filter(
      call => call[0] === 'openai-compatible'
    );
    expect(paidCalls).toHaveLength(1);
  });

  it('carries the count of translations it could not place back to the page', async () => {
    // The model found bubbles and gave no box for some of them: there is
    // nowhere to draw those translations, so the page shows fewer bubbles
    // than the model found, and those bubbles are still in the source
    // language. The difference has to reach the reader — a page that says
    // "translated" while a bubble is still Japanese is a lie.
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    providerMock.createProvider.mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({
        textAreas: [],
        unplacedCount: 3,
      }),
    });
    await loadWorker();

    const response = await harness.sendToMessage(hostileJob({}), {
      tab: { id: 7, url: 'https://manga.example/ch1' },
    });

    expect(response['success']).toBe(true);
    expect(response['unplacedCount']).toBe(3);
  });

  it('never returns a credential to a content script', async () => {
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'GET_CONFIG' },
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );

    expect(response['success']).toBe(true);
    const config = response['config'] as Record<string, unknown>;
    expect(config).toBeDefined();
    const strings = collectStrings(config);
    expect(strings).not.toContain(REAL_KEY);
    expect(strings.join('|')).not.toContain(REAL_KEY);
    // No field anywhere in the snapshot may be named like a credential.
    const keys = Object.keys(config);
    expect(keys).not.toContain('apiKey');
    const providers = config['providers'] as Record<string, unknown>;
    for (const provider of Object.values(providers)) {
      expect(Object.keys(provider as Record<string, unknown>)).not.toContain(
        'apiKey'
      );
    }
  });

  it('tells the content script that a key exists, without saying what it is', async () => {
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'GET_CONFIG' },
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );

    const config = response['config'] as {
      providers: Record<string, { hasApiKey: boolean }>;
    };
    expect(config.providers['openai-compatible']?.hasApiKey).toBe(true);
  });

  it('answers a preflight from the configured endpoint, without the key', async () => {
    // The preflight needs the key, so it runs in the worker; the verdict is
    // all the content script gets.
    writeStoredConfig(harness, 'openai-compatible', {
      apiKey: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      model: 'vendor-model',
    });
    providerMock.createProvider.mockResolvedValue({
      analyzeAndTranslate: vi.fn().mockResolvedValue({ textAreas: [] }),
      validateConfig: vi.fn().mockResolvedValue({ valid: true, message: 'ok' }),
    });
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'PROVIDER_PREFLIGHT' },
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );

    expect(response['success']).toBe(true);
    expect(response['valid']).toBe(true);
    const strings = collectStrings(response);
    expect(strings).not.toContain(REAL_KEY);
    const [providerType, settings] = providerMock.createProvider.mock
      .calls[0] as [string, Record<string, unknown>];
    expect(providerType).toBe('openai-compatible');
    expect(settings['baseUrl']).toBe(REAL_BASE_URL);
    expect(settings['apiKey']).toBe(REAL_KEY);
  });
});

describe('service worker config normalisation keeps the key out of the snapshot', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
    providerMock.createProvider.mockReset();
  });

  it('redacts an obfuscated key to a boolean', async () => {
    // The store writes the key obfuscated. The worker deobfuscates it for
    // its own use, and the snapshot it hands out carries only "yes, there is
    // one".
    harness.localStore[CONFIG_STORAGE_KEY] = {
      state: {
        enabled: true,
        provider: 'openai-compatible',
        providers: {
          'openai-compatible': {
            apiKey: 'obf:736b796861',
            baseUrl: REAL_BASE_URL,
            model: 'vendor-model',
          },
        },
      },
      version: 3,
    };
    await loadWorker();

    const response = await harness.sendToMessage(
      { type: 'GET_CONFIG' },
      { tab: { id: 7, url: 'https://manga.example/ch1' } }
    );

    const config = response['config'] as {
      providers: Record<string, { hasApiKey: boolean; baseUrl: string }>;
    };
    expect(config.providers['openai-compatible']?.hasApiKey).toBe(true);
    expect(config.providers['openai-compatible']?.baseUrl).toBe(REAL_BASE_URL);
    expect(collectStrings(config).join('|')).not.toContain('obf:');
  });
});
