/**
 * Regression suite for the v1.3.x config storage feedback loop.
 *
 * All three of these were broken before v1.4.0:
 *   1. one user action produced an unbounded stream of storage writes,
 *   2. the in-memory API key was replaced by its `obf:`-obfuscated form,
 *   3. consequently the provider layer sent garbage and every cloud call
 *      failed auth.
 *
 * Each test gets a freshly evaluated store module via `vi.resetModules()`, so
 * cases cannot contaminate each other through the module singleton.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG_VERSION } from '@/shared/app-config';
import { obfuscateAllApiKeys } from '@/utils/crypto';

const CONFIG_KEY = 'manga-translator-config-v2';

interface Harness {
  store: Record<string, unknown>;
  writeCount: () => number;
  resetWrites: () => void;
  setConfigSnapshot: (snapshot: unknown) => Promise<void>;
  /** Hold onChanged notifications so a stale echo can be queued on purpose. */
  pauseDelivery: () => void;
  /**
   * Flush withheld notifications. `newestFirst` models the hazard: Chrome
   * writes asynchronously, so a notification for an older write can be
   * delivered after a newer one.
   */
  resumeDelivery: (options?: { newestFirst?: boolean }) => void;
}

function installChromeMock(): Harness {
  const data: Record<string, unknown> = {};
  const listeners: Array<
    (changes: Record<string, unknown>, areaName: string) => void
  > = [];
  let writes = 0;
  const queued: Array<() => void> = [];
  let deliveryPaused = false;

  const deliver = (fn: () => void) => {
    if (deliveryPaused) {
      queued.push(fn);
      return;
    }
    fn();
  };

  const mock = {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in data) {
              out[key] = data[key];
            }
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          writes += 1;
          const changes: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(items)) {
            // Chrome serialises what it stores, so the value that comes back
            // through `onChanged` is a *copy*, not the object that was
            // handed over. The mock has to do the same: handing the store
            // back its own object graph makes every in-place rewrite
            // invisible, and bugs that only exist in the browser pass here.
            const stored = structuredClone(value);
            changes[key] = { oldValue: data[key], newValue: stored };
            data[key] = stored;
          }
          // Chrome delivers onChanged asynchronously, and the writing context
          // receives it as well.
          setTimeout(() => {
            deliver(() => {
              for (const listener of listeners) {
                listener(changes, 'local');
              }
            });
          }, 0);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete data[key];
          }
        },
      },
      onChanged: {
        addListener: (
          listener: (changes: Record<string, unknown>, area: string) => void
        ) => {
          listeners.push(listener);
        },
        removeListener: () => undefined,
      },
    },
    runtime: { id: 'config-storage-sync-test' },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = mock;

  return {
    store: data,
    writeCount: () => writes,
    resetWrites: () => {
      writes = 0;
    },
    setConfigSnapshot: async snapshot => {
      await mock.storage.local.set({ [CONFIG_KEY]: snapshot });
    },
    pauseDelivery: () => {
      deliveryPaused = true;
    },
    resumeDelivery: options => {
      deliveryPaused = false;
      const pending = options?.newestFirst
        ? queued.splice(0).reverse()
        : queued.splice(0);
      for (const fn of pending) {
        fn();
      }
    },
  };
}

function settle(ms = 200): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadStore() {
  vi.resetModules();
  const mod = await import('./config-v2');
  // Let the initial hydration write settle before assertions start.
  await settle(80);
  return mod;
}

describe('config store <-> chrome.storage sync', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = installChromeMock();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('settles storage writes after a single user action', async () => {
    const { useAppConfigStore } = await loadStore();
    harness.resetWrites();

    useAppConfigStore.getState().setEnabled(true);
    await settle();

    const writesAfterFirst = harness.writeCount();
    await settle(200);
    const writesLater = harness.writeCount();

    // The loop is what matters: writes must stop growing.
    expect(writesLater).toBe(writesAfterFirst);
    // A single action costs at most its own persist write.
    expect(writesAfterFirst).toBeLessThanOrEqual(2);
  });

  it('keeps a user-entered API key plaintext in memory', async () => {
    const { useAppConfigStore } = await loadStore();

    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-plaintext-must-survive',
    });
    await settle();

    expect(
      useAppConfigStore.getState().providers['openai-compatible'].apiKey
    ).toBe('sk-plaintext-must-survive');
    expect(useAppConfigStore.getState().openaiCompatible.apiKey).toBe(
      'sk-plaintext-must-survive'
    );
  });

  it('hands the provider layer the user key, not the obfuscated value', async () => {
    // The store and the translator must come from the SAME module graph:
    // `translator.ts` captures `useAppConfigStore` at import time, so a
    // reset in between would hand back a translator bound to a different
    // store instance and assert against the wrong object.
    const { useAppConfigStore } = await loadStore();
    // The trusted factory: it is the only one that carries the key, and it
    // lives in its own module so a content script cannot reach it by
    // accident.
    const { createTrustedTranslatorFromConfig } =
      await import('@/services/translator-trusted');

    useAppConfigStore.getState().setProvider('openai-compatible');
    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-what-the-provider-sees-1234567890',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
    });
    await settle();

    const live =
      useAppConfigStore.getState().providers['openai-compatible'].apiKey;
    expect(live).toBe('sk-what-the-provider-sees-1234567890');
    expect(live.startsWith('obf:')).toBe(false);
    expect(createTrustedTranslatorFromConfig().getConfig().apiKey).toBe(
      'sk-what-the-provider-sees-1234567890'
    );
  });

  it('a late echo of our own earlier write cannot revert a newer edit', async () => {
    // Real ordering: the store hydrates and persists a snapshot, the user
    // edits before that write's onChanged notification is delivered, and the
    // stale snapshot arrives last. Value comparison cannot detect this — the
    // stale snapshot legitimately differs from current state — so the payload
    // we wrote has to be recognised as ours.
    //
    // Delivery is suspended BEFORE the module loads, so the hydration write's
    // echo is still in flight when the edit happens.
    harness.pauseDelivery();
    const { useAppConfigStore } = await loadStore();

    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-newer-edit-1234567890',
    });
    await settle(50);
    expect(
      useAppConfigStore.getState().providers['openai-compatible'].apiKey
    ).toBe('sk-newer-edit-1234567890');

    // Deliver the withheld notifications newest-first. Chrome performs
    // storage writes asynchronously, and this ordering — an older write's
    // notification arriving after a newer one's — is what reverted the edit.
    // That ordering used to fail roughly 4 runs in 10.
    harness.resumeDelivery({ newestFirst: true });
    await settle(250);

    expect(
      useAppConfigStore.getState().providers['openai-compatible'].apiKey
    ).toBe('sk-newer-edit-1234567890');
  });

  it('drops the echo of our own older write instead of rolling back a fresh key', async () => {
    // 真实的顺序：store 先写下了一份快照（带着旧 Key），用户在这条写入的
    // onChanged 通知送达之前改掉了 Key，而旧写入的通知反而最后才到。
    //
    // 值比较抓不住这种情况——旧快照确实和当前状态不同。唯一的证据是
    // 「这条是我们自己写的」。以前这条证据是死的：记住的那份快照被就地
    // 混淆成了 obf:，而回声是解混淆之后才拿来比的，两者永远不相等，
    // 于是旧值被当成别的上下文写来的值采用了，用户的 Key 被悄悄回滚。
    harness.pauseDelivery();
    const { useAppConfigStore } = await loadStore();

    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-old-value',
    });
    await settle(50);

    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-new-value',
    });
    await settle(50);

    // Chrome 的存储写入是异步的，通知的到达顺序可能和写入顺序相反：
    // 旧写入的通知最后到。
    harness.resumeDelivery({ newestFirst: true });
    await settle(250);

    expect(
      useAppConfigStore.getState().providers['openai-compatible'].apiKey
    ).toBe('sk-new-value');
  });

  it('applies a genuine external write from the background worker', async () => {
    const { useAppConfigStore } = await loadStore();
    const { obfuscateAllApiKeys } = await import('@/utils/crypto');

    const providers = {
      'openai-compatible': {
        apiKey: 'sk-written-by-background-1234567890',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o',
      },
      ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llava' },
      'lm-studio': {
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        model: '',
      },
    };
    const state: Record<string, unknown> = {
      enabled: true,
      provider: 'openai-compatible',
      targetLanguage: 'ja',
      providers,
      openaiCompatible: providers['openai-compatible'],
      ollama: providers.ollama,
      lmStudio: providers['lm-studio'],
    };
    obfuscateAllApiKeys(state);

    await harness.setConfigSnapshot({ state, version: 3 });
    await settle();

    expect(useAppConfigStore.getState().targetLanguage).toBe('ja');
    expect(
      useAppConfigStore.getState().providers['openai-compatible'].apiKey
    ).toBe('sk-written-by-background-1234567890');
  });

  it('never lets storage inject non-config fields into the store', async () => {
    const { useAppConfigStore } = await loadStore();

    await harness.setConfigSnapshot({
      state: {
        targetLanguage: 'ko',
        somethingInjected: 'must not become state',
        resetToDefaults: 'not a function',
      },
      version: 3,
    });
    await settle();

    const state = useAppConfigStore.getState() as unknown as Record<
      string,
      unknown
    >;
    expect(state['targetLanguage']).toBe('ko');
    expect('somethingInjected' in state).toBe(false);
    expect(typeof state['resetToDefaults']).toBe('function');
  });

  it('recovers a config left on disk in the flat shape', async () => {
    // The worker used to write a *flat* object to the same key zustand
    // reads. Zustand rehydrates from `state`, so a flat object read back as
    // "nothing stored": the defaults were merged over the user's settings
    // and written straight back. The API key, endpoint, model and
    // auto-translate allowlist were gone for good.
    //
    // Users who hit that still have the flat value on disk, so the store has
    // to be able to read it — and to heal it into the current shape.
    const provider = {
      apiKey: 'sk-flat-user-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
    };
    const flat: Record<string, unknown> = {
      enabled: true,
      provider: 'openai-compatible',
      targetLanguage: 'ko',
      autoTranslateHosts: ['manga.example'],
      openaiCompatible: { ...provider },
      providers: { 'openai-compatible': { ...provider } },
    };
    obfuscateAllApiKeys(flat);
    // Written before the store module loads, so this is the hydration path.
    harness.store[CONFIG_KEY] = flat;

    const { useAppConfigStore } = await loadStore();
    const state = useAppConfigStore.getState();

    expect(state.enabled).toBe(true);
    expect(state.targetLanguage).toBe('ko');
    expect(state.autoTranslateHosts).toEqual(['manga.example']);
    // The key is deobfuscated on the way in, and it is the user's key.
    expect(state.providers['openai-compatible'].apiKey).toBe(
      'sk-flat-user-key'
    );
    expect(state.openaiCompatible.baseUrl).toBe('https://api.example.com/v1');

    // The file heals into the shape the store reads.
    const stored = harness.store[CONFIG_KEY] as {
      state?: Record<string, unknown>;
      version?: number;
    };
    expect(stored.version).toBe(4);
    expect(stored.state?.['targetLanguage']).toBe('ko');
  });

  it('does not re-run the first-run wizard on a recovered flat config', async () => {
    // The flat object on disk is a snapshot of the config the worker read,
    // so it carries the fields of that version. Treating it as "version 0"
    // replays the whole legacy migration over a modern config, and the
    // v2→v3 step — the one that adds `onboardingCompleted` — never runs:
    // the user who had already been through the wizard is asked to do it
    // again, and the wizard is the screen that turns the extension on.
    const provider = {
      apiKey: 'sk-flat-user-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
    };
    const flat: Record<string, unknown> = {
      enabled: true,
      provider: 'openai-compatible',
      targetLanguage: 'zh-CN',
      onboardingCompleted: true,
      openaiCompatible: { ...provider },
      providers: { 'openai-compatible': { ...provider } },
    };
    obfuscateAllApiKeys(flat);
    harness.store[CONFIG_KEY] = flat;

    const { useAppConfigStore } = await loadStore();

    expect(useAppConfigStore.getState().onboardingCompleted).toBe(true);
  });

  it('ignores writes to other storage areas and other keys', async () => {
    const { useAppConfigStore } = await loadStore();

    await chrome.storage.local.set({ 'some-other-key': { enabled: false } });
    await settle();

    expect(useAppConfigStore.getState().targetLanguage).toBe('zh-CN');
  });

  it('survives a persisted provider field that is not a string', async () => {
    // `mergeProvider` called `.trim()` straight on the stored value, so a
    // corrupted or hand-edited `apiKey: 12345` threw inside zustand's merge
    // and aborted hydration — every later field in the snapshot was dropped
    // and the store silently ran on defaults.
    await harness.setConfigSnapshot({
      state: {
        openaiCompatible: {
          apiKey: 12345,
          baseUrl: { not: 'a string' },
          model: 'vision-model',
        },
        ollama: { apiKey: null, baseUrl: 'http://localhost:11434', model: 7 },
        targetLanguage: 'fr-FR',
        parallelLimit: 5,
        enabled: true,
      },
      version: 3,
    });

    const { useAppConfigStore } = await loadStore();
    const state = useAppConfigStore.getState();

    // Hydration must have continued past the malformed fields.
    expect(state.targetLanguage).toBe('fr-FR');
    expect(state.parallelLimit).toBe(5);
    expect(state.enabled).toBe(true);
    // The unusable values fall back rather than poisoning state.
    expect(typeof state.openaiCompatible.apiKey).toBe('string');
    expect(typeof state.openaiCompatible.baseUrl).toBe('string');
    expect(typeof state.ollama.model).toBe('string');
  });

  it('writes the envelope version the shared constant names', async () => {
    // The store used to hard-code `version: 4` while the shared constant
    // said `APP_CONFIG_VERSION = 4`. The two agreed by luck. The worker
    // stamps the constant into the same key, and zustand refuses to
    // rehydrate a version it does not recognise — so the next bump would
    // have split the two writers, and the user's stored configuration would
    // have been replaced by defaults.
    const { useAppConfigStore } = await loadStore();

    useAppConfigStore.getState().setEnabled(true);
    await settle();

    const stored = harness.store[CONFIG_KEY] as { version?: number };
    expect(stored.version).toBe(APP_CONFIG_VERSION);
  });

  it('rehydrates what the worker wrote, because both writers use one version', async () => {
    // The worker writes `{ state, version: APP_CONFIG_VERSION }`. If the
    // store's own version ever drifts from the constant, zustand treats the
    // worker's envelope as a version it cannot read, migrates it as a
    // legacy shape and the user's settings are replaced by defaults.
    const provider = {
      apiKey: 'sk-worker-written-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
    };
    const state: Record<string, unknown> = {
      enabled: true,
      provider: 'openai-compatible',
      targetLanguage: 'ja',
      providers: { 'openai-compatible': provider },
      openaiCompatible: provider,
    };
    obfuscateAllApiKeys(state);

    await harness.setConfigSnapshot({
      state,
      version: APP_CONFIG_VERSION,
    });
    await settle();

    const { useAppConfigStore } = await loadStore();

    expect(useAppConfigStore.getState().targetLanguage).toBe('ja');
    expect(useAppConfigStore.getState().enabled).toBe(true);
    expect(
      useAppConfigStore.getState().providers['openai-compatible'].apiKey
    ).toBe('sk-worker-written-key');
  });
});
