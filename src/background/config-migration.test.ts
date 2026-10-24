/**
 * 搬家不能把用户的东西弄丢。
 *
 * 配置在 `chrome.storage.local` 里必须是 store 读得懂的信封
 * `{ state, version }`——zustand 只认 `state`，读到别的形状就等于"什么都没
 * 存"，于是默认值被合并到用户的设置上再写回去，API key、端点、模型和自
 * 动翻译白名单全没了。
 *
 * 这些测试钉住三件事：
 *
 * 1. 从 `chrome.storage.sync`（老版本会把 API key 跟着 Google 账户同步出去）
 *    搬过来的配置，落到 local 时必须是信封；
 * 2. 信封的版本号要保留——那是 store 自己那套迁移能往前走的起点；
 * 3. local 里本来就躺着一个旧格式的对象时，就地纠正，而不是把它覆盖成默认
 *    值。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG_STORAGE_KEY } from '@/shared/app-config';
import { deobfuscateAllApiKeys, obfuscateAllApiKeys } from '@/utils/crypto';

type Listener = (...args: unknown[]) => unknown;

interface ChromeHarness {
  onInstalled: Listener[];
  localStore: Record<string, unknown>;
  syncStore: Record<string, unknown>;
}

const EXTENSION_ID = 'test-extension-id';

function installChromeMock(): ChromeHarness {
  const onInstalled: Listener[] = [];
  const localStore: Record<string, unknown> = {};
  const syncStore: Record<string, unknown> = {};

  const chromeMock = {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
      sendMessage: vi.fn(async () => undefined),
      onMessage: {
        addListener: () => undefined,
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
      onChanged: { addListener: () => undefined },
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(),
      onAlarm: { addListener: () => undefined },
    },
    commands: { onCommand: { addListener: () => undefined } },
    contextMenus: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeAll: (cb?: () => void) => cb?.(),
      onClicked: { addListener: () => undefined },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => undefined),
      onUpdated: { addListener: () => undefined },
    },
  } as unknown as typeof globalThis.chrome;

  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

  return { onInstalled, localStore, syncStore };
}

/**
 * 触发一次"扩展被更新"，那是迁移真正会发生的地方。
 */
async function runUpdate(harness: ChromeHarness): Promise<void> {
  for (const listener of harness.onInstalled) {
    listener({ reason: 'update' });
  }
  // 迁移是异步的（读存储 → 写存储 → 删 sync），让它跑完。
  for (let i = 0; i < 10; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function loadWorker(): Promise<void> {
  vi.resetModules();
  await import('./background');
  await new Promise(resolve => setTimeout(resolve, 0));
}

function flatConfig(): Record<string, unknown> {
  return {
    enabled: true,
    targetLanguage: 'zh-CN',
    onboardingCompleted: true,
    providers: {
      'openai-compatible': {
        apiKey: 'sk-plaintext-secret',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
      },
    },
  };
}

function storedKey(value: unknown): string {
  const state = (value as { state: Record<string, unknown> }).state;
  const providers = state['providers'] as Record<string, { apiKey: string }>;
  const copy = JSON.parse(JSON.stringify(providers)) as Record<
    string,
    { apiKey: string }
  >;
  deobfuscateAllApiKeys(copy);
  return copy['openai-compatible']?.apiKey ?? '';
}

describe('configuration migration', () => {
  let harness: ChromeHarness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  it('moves a flat configuration out of sync into an envelope the store can read', async () => {
    const flat = flatConfig();
    obfuscateAllApiKeys(flat);
    harness.syncStore[APP_CONFIG_STORAGE_KEY] = flat;

    await loadWorker();
    await runUpdate(harness);

    const stored = harness.localStore[APP_CONFIG_STORAGE_KEY] as {
      state: Record<string, unknown>;
      version: number;
    };
    expect(stored).toBeDefined();
    // 没有 `state` 键，zustand 就读不出任何设置。
    expect(stored.state).toBeDefined();
    expect(stored.state['targetLanguage']).toBe('zh-CN');
    expect(storedKey(stored)).toBe('sk-plaintext-secret');
  });

  it('keeps the version of an envelope it moves, so the store can migrate from there', async () => {
    harness.syncStore[APP_CONFIG_STORAGE_KEY] = {
      state: { enabled: true, targetLanguage: 'ja' },
      version: 2,
    };

    await loadWorker();
    await runUpdate(harness);

    const stored = harness.localStore[APP_CONFIG_STORAGE_KEY] as {
      state: Record<string, unknown>;
      version: number;
    };
    expect(stored.version).toBe(2);
    expect(stored.state['targetLanguage']).toBe('ja');
  });

  it('removes the copy from sync, so the key stops following the Google account', async () => {
    const flat = flatConfig();
    obfuscateAllApiKeys(flat);
    harness.syncStore[APP_CONFIG_STORAGE_KEY] = flat;

    await loadWorker();
    await runUpdate(harness);

    expect(harness.syncStore[APP_CONFIG_STORAGE_KEY]).toBeUndefined();
  });

  it('normalises a flat configuration that is already in local', async () => {
    const flat = flatConfig();
    obfuscateAllApiKeys(flat);
    harness.localStore[APP_CONFIG_STORAGE_KEY] = flat;

    await loadWorker();
    await runUpdate(harness);

    const stored = harness.localStore[APP_CONFIG_STORAGE_KEY] as {
      state: Record<string, unknown>;
      version: number;
    };
    expect(stored.state).toBeDefined();
    expect(stored.state['targetLanguage']).toBe('zh-CN');
    expect(storedKey(stored)).toBe('sk-plaintext-secret');
  });

  it('leaves an envelope in local exactly as it was', async () => {
    const envelope = {
      state: { enabled: true, targetLanguage: 'ko' },
      version: 4,
    };
    harness.localStore[APP_CONFIG_STORAGE_KEY] = envelope;

    await loadWorker();
    await runUpdate(harness);

    expect(harness.localStore[APP_CONFIG_STORAGE_KEY]).toBe(envelope);
  });

  it('does not let the sync copy overwrite an existing local configuration', async () => {
    const flat = flatConfig();
    obfuscateAllApiKeys(flat);
    harness.localStore[APP_CONFIG_STORAGE_KEY] = {
      state: { enabled: true, targetLanguage: 'en' },
      version: 4,
    };
    harness.syncStore[APP_CONFIG_STORAGE_KEY] = flat;

    await loadWorker();
    await runUpdate(harness);

    const stored = harness.localStore[APP_CONFIG_STORAGE_KEY] as {
      state: Record<string, unknown>;
    };
    expect(stored.state['targetLanguage']).toBe('en');
  });
});
