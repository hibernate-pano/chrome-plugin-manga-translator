/**
 * Regression suite for the cache store.
 *
 * The multi-context cases matter most: every extension context (each tab's
 * content script, the popup, the options page) has its own store instance
 * but they all share one `chrome.storage.local` key. Before v2.0.4 the write
 * path replaced that shared snapshot wholesale, so the last tab to write
 * erased everyone else's entries — which showed up as "the cache never
 * works" and as duplicate API charges.
 *
 * Each test loads the store through `vi.resetModules()`, so every "tab" is a
 * genuinely separate module instance with its own in-memory LRU, exactly like
 * two real tabs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationCacheState, TranslationResult } from './cache-v2';

const CACHE_KEY = 'manga-translator-cache-v2';

interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

interface ChromeHarness {
  chrome: unknown;
  data: Record<string, unknown>;
  writeCount: () => number;
  resetWrites: () => void;
  /** Hold onChanged notifications so a stale tab can write blind. */
  pauseDelivery: () => void;
  /** Flush the notifications that were withheld. */
  resumeDelivery: () => void;
  /**
   * Drop the listeners registered by previously loaded stores.
   *
   * `vi.resetModules()` gives a new module instance, but the old instance's
   * `chrome.storage.onChanged` listener is still registered — a real tab that
   * was closed would not keep answering. Without this, a store from an
   * earlier test keeps merging its old entries back into the shared
   * snapshot.
   */
  clearListeners: () => void;
}

/**
 * The chrome mock has to exist before `src/stores/cache-v2.ts` is imported:
 * the store registers its `chrome.storage.onChanged` listener at module load.
 */
const harness: ChromeHarness = vi.hoisted(() => {
  const data: Record<string, unknown> = {};
  const listeners: Array<
    (changes: Record<string, StorageChange>, areaName: string) => void
  > = [];
  const queued: Array<() => void> = [];
  let writes = 0;
  let deliveryPaused = false;

  const deliver = (fn: () => void) => {
    if (deliveryPaused) {
      queued.push(fn);
      return;
    }
    fn();
  };

  const notify = (changes: Record<string, StorageChange>) => {
    setTimeout(() => {
      deliver(() => {
        for (const listener of listeners) {
          listener(changes, 'local');
        }
      });
    }, 0);
  };

  const chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) {
            if (key in data) {
              out[key] = data[key];
            }
          }
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          writes += 1;
          const changes: Record<string, StorageChange> = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: data[key], newValue: value };
            data[key] = value;
          }
          notify(changes);
        },
        remove: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const changes: Record<string, StorageChange> = {};
          for (const key of list) {
            changes[key] = { oldValue: data[key], newValue: undefined };
            delete data[key];
          }
          notify(changes);
        },
        clear: async () => {
          data['manga-translator-cache-v2'] = undefined;
          delete data['manga-translator-cache-v2'];
        },
      },
      onChanged: {
        addListener: (
          listener: (
            changes: Record<string, StorageChange>,
            areaName: string
          ) => void
        ) => {
          listeners.push(listener);
        },
        removeListener: (
          listener: (
            changes: Record<string, StorageChange>,
            areaName: string
          ) => void
        ) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        },
      },
    },
    runtime: { id: 'cache-v2-test' },
  };

  Object.assign(globalThis, { chrome });

  return {
    chrome,
    data,
    writeCount: () => writes,
    resetWrites: () => {
      writes = 0;
    },
    pauseDelivery: () => {
      deliveryPaused = true;
    },
    resumeDelivery: () => {
      deliveryPaused = false;
      while (queued.length > 0) {
        const fn = queued.shift();
        if (fn) fn();
      }
    },
    clearListeners: () => {
      listeners.length = 0;
    },
  };
});

/**
 * Wait for the pending microtasks and the deferred `onChanged` deliveries.
 */
function settle(ms = 60): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type CacheStore = {
  getState: () => TranslationCacheState & {
    set: (
      hash: string,
      result: TranslationResult,
      provider: 'openai-compatible'
    ) => void;
    get: (hash: string) => TranslationResult | null;
    has: (hash: string) => boolean;
    remove: (hash: string) => void;
    clear: () => void;
    setMaxEntries: (max: number) => void;
    entries: () => [string, unknown][];
    getStats: () => {
      entryCount: number;
      maxEntries: number;
      oldestEntry: number | null;
      newestEntry: number | null;
    };
  };
};

/**
 * Load a fresh store instance — a fresh tab.
 */
async function loadTab(): Promise<CacheStore> {
  vi.resetModules();
  const mod = await import('./cache-v2');
  await settle();
  return mod.useTranslationCacheStore as unknown as CacheStore;
}

function makeResult(text = 'translated'): TranslationResult {
  return {
    textAreas: [
      {
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.1,
        originalText: 'original',
        translatedText: text,
      },
    ],
    pipeline: 'full-image-vlm',
  } as unknown as TranslationResult;
}

/**
 * Read the entries currently stored under the shared cache key.
 */
function storedEntries(): Record<string, unknown> {
  const raw = harness.data[CACHE_KEY] as
    | { state?: { entries?: Record<string, unknown> } }
    | undefined;
  return raw?.state?.entries ?? {};
}

beforeEach(async () => {
  // Drain the writes the previous test left in flight, otherwise they land
  // after the storage was cleared and leak that test's entries into this one.
  await settle();
  harness.clearListeners();
  for (const key of Object.keys(harness.data)) {
    delete harness.data[key];
  }
  harness.resetWrites();
});

afterEach(async () => {
  await settle();
});

describe('translation cache store', () => {
  it('set and get round-trip a result by image hash', async () => {
    const store = await loadTab();
    const state = store.getState();
    state.set('hash-1', makeResult('hello'), 'openai-compatible');

    expect(state.has('hash-1')).toBe(true);
    expect(state.get('hash-1')?.textAreas[0]?.translatedText).toBe('hello');
  });

  it('get returns null for unknown hashes', async () => {
    const store = await loadTab();
    expect(store.getState().get('missing')).toBeNull();
  });

  it('remove and clear drop entries', async () => {
    const store = await loadTab();
    const state = store.getState();
    state.set('hash-1', makeResult(), 'openai-compatible');
    state.remove('hash-1');
    expect(state.has('hash-1')).toBe(false);

    state.set('hash-2', makeResult(), 'openai-compatible');
    state.clear();
    expect(state.getStats().entryCount).toBe(0);
  });

  it('getStats reports entry counts and timestamps', async () => {
    const store = await loadTab();
    const state = store.getState();
    state.set('hash-1', makeResult(), 'openai-compatible');
    state.set('hash-2', makeResult(), 'openai-compatible');

    const stats = state.getStats();
    expect(stats.entryCount).toBe(2);
    expect(stats.maxEntries).toBe(100);
    expect(stats.oldestEntry).toBeTypeOf('number');
    expect(stats.newestEntry).toBeTypeOf('number');
  });

  it('cleanup keeps the newest entries within maxEntries', async () => {
    const store = await loadTab();
    const state = store.getState();
    state.setMaxEntries(3);
    for (let index = 0; index < 5; index += 1) {
      state.set(
        `hash-${index}`,
        makeResult(String(index)),
        'openai-compatible'
      );
    }

    const stats = state.getStats();
    expect(stats.entryCount).toBe(3);
    expect(state.has('hash-0')).toBe(false);
    expect(state.has('hash-4')).toBe(true);
  });

  it('entries exposes the raw cache for debugging', async () => {
    const store = await loadTab();
    const state = store.getState();
    state.set('hash-1', makeResult(), 'openai-compatible');
    const entries = state.entries();
    expect(entries).toHaveLength(1);
    const first = entries[0];
    expect(first?.[0]).toBe('hash-1');
    expect((first?.[1] as { provider: string }).provider).toBe(
      'openai-compatible'
    );
  });
});

describe('multi-tab cache consistency', () => {
  it('keeps both entries when a stale tab writes over a newer one', async () => {
    // Tab A writes X, then tab B — which has not heard of X yet — writes Y.
    // The write path must merge instead of replacing the shared snapshot,
    // otherwise X is erased and the user pays for it twice.
    harness.pauseDelivery();

    const tabA = await loadTab();
    const tabB = await loadTab();

    tabA.getState().set('hash-X', makeResult('from A'), 'openai-compatible');
    await settle();
    tabB.getState().set('hash-Y', makeResult('from B'), 'openai-compatible');
    await settle();

    const entries = storedEntries();
    expect(Object.keys(entries).sort()).toEqual(['hash-X', 'hash-Y']);

    harness.resumeDelivery();
    await settle();
  });

  it('propagates another tab’s entries through storage.onChanged', async () => {
    const tabA = await loadTab();
    const tabB = await loadTab();

    tabA.getState().set('hash-X', makeResult('from A'), 'openai-compatible');
    await settle();

    // Tab B never asked for X, but it learned about it.
    expect(tabB.getState().has('hash-X')).toBe(true);
    expect(tabB.getState().get('hash-X')?.textAreas[0]?.translatedText).toBe(
      'from A'
    );

    tabB.getState().set('hash-Y', makeResult('from B'), 'openai-compatible');
    await settle();

    // ...and tab A learns about Y the same way.
    expect(tabA.getState().has('hash-Y')).toBe(true);
    expect(Object.keys(storedEntries()).sort()).toEqual(['hash-X', 'hash-Y']);
  });

  it('settles instead of looping writes forever', async () => {
    const tabA = await loadTab();
    const tabB = await loadTab();

    tabA.getState().set('hash-X', makeResult('from A'), 'openai-compatible');
    await settle();
    tabB.getState().set('hash-Y', makeResult('from B'), 'openai-compatible');
    await settle();

    // Everything has converged; no further writes may happen.
    const writesAfterConvergence = harness.writeCount();
    await settle(150);
    expect(harness.writeCount()).toBe(writesAfterConvergence);
  });

  it('lets the newer write win when both tabs translate the same image', async () => {
    const tabA = await loadTab();
    const tabB = await loadTab();

    tabA.getState().set('hash-X', makeResult('older'), 'openai-compatible');
    await settle();
    tabB.getState().set('hash-X', makeResult('newer'), 'openai-compatible');
    await settle();

    const stored = storedEntries()['hash-X'] as
      | { result: { textAreas: { translatedText: string }[] } }
      | undefined;
    expect(stored?.result.textAreas[0]?.translatedText).toBe('newer');
    expect(tabA.getState().get('hash-X')?.textAreas[0]?.translatedText).toBe(
      'newer'
    );
  });

  it('propagates a deletion to the other tabs', async () => {
    const tabA = await loadTab();
    const tabB = await loadTab();

    tabA.getState().set('hash-X', makeResult('from A'), 'openai-compatible');
    await settle();
    expect(tabB.getState().has('hash-X')).toBe(true);

    tabA.getState().remove('hash-X');
    await settle();

    expect(tabB.getState().has('hash-X')).toBe(false);
    expect(Object.keys(storedEntries())).toEqual([]);
  });

  it('propagates a clear to the other tabs', async () => {
    const tabA = await loadTab();
    const tabB = await loadTab();

    tabA.getState().set('hash-X', makeResult('from A'), 'openai-compatible');
    tabB.getState().set('hash-Y', makeResult('from B'), 'openai-compatible');
    await settle();
    expect(Object.keys(storedEntries()).sort()).toEqual(['hash-X', 'hash-Y']);

    tabA.getState().clear();
    await settle();

    expect(tabB.getState().has('hash-X')).toBe(false);
    expect(tabB.getState().has('hash-Y')).toBe(false);
    expect(Object.keys(storedEntries())).toEqual([]);
  });

  it('rehydrates a stored snapshot into a freshly opened tab', async () => {
    const tabA = await loadTab();
    tabA.getState().set('hash-X', makeResult('from A'), 'openai-compatible');
    await settle();

    const tabB = await loadTab();
    expect(tabB.getState().has('hash-X')).toBe(true);
  });

  it('keeps both entries when one tab writes two images at once', async () => {
    // The translator runs images in parallel, so two writes can be in
    // flight inside a single tab. Without serializing them the second
    // write reads the snapshot the first one had not written yet and drops
    // its entry.
    const tabA = await loadTab();
    const state = tabA.getState();

    state.set('hash-1', makeResult('one'), 'openai-compatible');
    state.set('hash-2', makeResult('two'), 'openai-compatible');
    await settle();

    expect(Object.keys(storedEntries()).sort()).toEqual(['hash-1', 'hash-2']);
  });
});
