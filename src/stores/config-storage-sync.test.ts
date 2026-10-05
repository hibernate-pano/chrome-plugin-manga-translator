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
            changes[key] = { oldValue: data[key], newValue: value };
            data[key] = value;
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
    const { createTranslatorFromConfig } =
      await import('@/services/translator');

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
    expect(createTranslatorFromConfig().getConfig().apiKey).toBe(
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
});
