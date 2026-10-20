/**
 * Cache Store v2 - Translation result caching for Manga Translator v2
 *
 * Implements image hash → translation result caching to avoid
 * redundant API calls for previously translated images.
 *
 * Requirements: 9.1
 *
 * ## Multi-context (multi-tab) consistency
 *
 * Every context that loads this module — each content script, the popup, the
 * options page — gets its own store instance with its own in-memory LRU, but
 * they all share one `chrome.storage.local` key. A naive "write the whole
 * snapshot" therefore lets the last writer erase everyone else's work:
 * tab A caches image X, tab B (opened earlier, still holding an empty LRU)
 * caches image Y and replaces the shared snapshot, so X is gone and the user
 * is billed for X a second time.
 *
 * The fix has two halves:
 *   - a write merges into the stored snapshot instead of replacing it, with
 *     the newer timestamp winning per entry;
 *   - a `chrome.storage.onChanged` listener folds entries written by other
 *     contexts into the local LRU, so every tab sees what the others cached.
 *
 * Deletions (`remove` / `clear`) travel as tombstones, because "the entry is
 * missing" is indistinguishable from "this tab has never heard of that
 * entry" and would otherwise resurrect deleted entries.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType, TextArea } from '@/providers/base';
import type { ImageReadingResult } from '@/services/reading-result';
import { LRUCache } from '@/utils/lru-cache';

// ==================== Type Definitions ====================

/**
 * Translation result from Vision LLM
 */
export interface TranslationResult {
  /** Whether the translation was successful */
  success: boolean;
  /** Array of detected and translated text areas */
  textAreas: TextArea[];
  /** Structured reading-layer result */
  readingResult?: ImageReadingResult;
  /** Error message if translation failed */
  error?: string;
  /** Whether this result was retrieved from cache */
  cached?: boolean;
}

/**
 * Cache entry for a translated image
 */
interface CacheEntry {
  /** Hash of the original image */
  imageHash: string;
  /** Translation result */
  result: TranslationResult;
  /**
   * Last time this entry was written or read.
   *
   * It doubles as the tie-breaker when two contexts write the same image and
   * as the eviction order (the oldest timestamp is evicted first), so it has
   * to be monotonic per entry.
   */
  timestamp: number;
  /** Provider used for this translation */
  provider: ProviderType;
}

/**
 * Cache state with LRU optimization
 */
export interface TranslationCacheState {
  /** LRU cache instance for efficient memory management */
  cache: LRUCache<string, CacheEntry>;
  /** Maximum number of entries to keep */
  maxEntries: number;
  /**
   * Deleted entries: image hash → deletion timestamp.
   *
   * A tombstone outranks an entry written before it, so a deletion in one tab
   * removes the entry in every tab instead of letting the next writer
   * resurrect it.
   */
  removed: Record<string, number>;
}

/**
 * Cache actions
 */
interface TranslationCacheActions {
  /**
   * Get cached translation result for an image hash
   * @param imageHash Hash of the image
   * @returns Cached result or null if not found
   */
  get: (imageHash: string) => TranslationResult | null;

  /**
   * Store translation result in cache
   * @param imageHash Hash of the image
   * @param result Translation result
   * @param provider Provider used for translation
   */
  set: (
    imageHash: string,
    result: TranslationResult,
    provider: ProviderType
  ) => void;

  /**
   * Check if an image hash exists in cache
   * @param imageHash Hash of the image
   * @returns True if cached
   */
  has: (imageHash: string) => boolean;

  /**
   * Remove a specific entry from cache
   * @param imageHash Hash of the image to remove
   */
  remove: (imageHash: string) => void;

  /**
   * Clear all cache entries
   */
  clear: () => void;

  /**
   * Get cache statistics
   */
  getStats: () => {
    entryCount: number;
    maxEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  };

  /**
   * Set maximum number of cache entries
   * @param max Maximum entries
   */
  setMaxEntries: (max: number) => void;

  /**
   * Clean up old entries to stay within maxEntries limit
   */
  cleanup: () => void;

  /**
   * Get all cache entries for debugging/testing
   * @returns Array of [key, value] pairs
   */
  entries: () => [string, CacheEntry][];
}

// ==================== Default Configuration ====================

const DEFAULT_MAX_ENTRIES = 100;

/**
 * Upper bound for the tombstone map.
 *
 * A tombstone only has to outlive the slowest context that could still hold
 * the deleted entry; a bounded window is enough and stops the map from
 * growing forever.
 */
const MAX_TOMBSTONES = 200;

const CACHE_STORAGE_KEY = 'manga-translator-cache-v2';

const CACHE_STORAGE_VERSION = 2;

// ==================== Timestamps ====================

/**
 * The last timestamp handed out by this context.
 *
 * Two events can land in the same millisecond — writing an entry and then
 * deleting it, for instance — and a tie would make the older event win the
 * merge. Forcing the clock forward keeps the order unambiguous within a
 * context.
 */
let lastTimestamp = 0;

function nextTimestamp(): number {
  const now = Date.now();
  lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1;
  return lastTimestamp;
}

// ==================== Snapshot helpers ====================

/**
 * The persisted shape of the cache: the entries, the tombstones and the
 * capacity. Written and read by every extension context.
 */
interface CacheSnapshot {
  entries: Record<string, CacheEntry>;
  removed: Record<string, number>;
  maxEntries: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Storage is user-writable, so every value read back from it is untrusted.
 * An entry without a usable result would break the render path, so it is
 * dropped instead of being merged in.
 */
function isCacheEntry(value: unknown): value is CacheEntry {
  if (!isRecord(value)) return false;
  const imageHash = value['imageHash'];
  const timestamp = value['timestamp'];
  const provider = value['provider'];
  const result = value['result'];
  if (typeof imageHash !== 'string') return false;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return false;
  }
  if (typeof provider !== 'string') return false;
  if (!isRecord(result)) return false;
  return Array.isArray(result['textAreas']);
}

function toEntries(value: unknown): Record<string, CacheEntry> {
  const entries: Record<string, CacheEntry> = {};
  if (!isRecord(value)) return entries;
  for (const [hash, entry] of Object.entries(value)) {
    if (isCacheEntry(entry)) {
      entries[hash] = entry;
    }
  }
  return entries;
}

function toRemoved(value: unknown): Record<string, number> {
  const removed: Record<string, number> = {};
  if (!isRecord(value)) return removed;
  for (const [hash, timestamp] of Object.entries(value)) {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      removed[hash] = timestamp;
    }
  }
  return removed;
}

/**
 * Read a snapshot out of either the zustand envelope (`{ state, version }`)
 * or the bare partialized state.
 */
function toSnapshot(value: unknown): CacheSnapshot {
  const inner =
    isRecord(value) && isRecord(value['state']) ? value['state'] : value;
  const source = isRecord(inner) ? inner : {};
  const rawMax = source['maxEntries'];
  const maxEntries =
    typeof rawMax === 'number' && rawMax > 0
      ? Math.floor(rawMax)
      : DEFAULT_MAX_ENTRIES;
  return {
    entries: toEntries(source['entries']),
    removed: toRemoved(source['removed']),
    maxEntries,
  };
}

/**
 * Union of two entry maps; the newer timestamp wins for the same hash.
 */
function mergeEntries(
  base: Record<string, CacheEntry>,
  incoming: Record<string, CacheEntry>
): Record<string, CacheEntry> {
  const merged: Record<string, CacheEntry> = { ...base };
  for (const [hash, entry] of Object.entries(incoming)) {
    const existing = merged[hash];
    if (!existing || entry.timestamp >= existing.timestamp) {
      merged[hash] = entry;
    }
  }
  return merged;
}

/**
 * Union of two entry maps, keeping the local entry on a timestamp tie.
 *
 * This is the merge used when a *change notification* arrives. Storage
 * echoes back a snapshot we may have written ourselves, with the same
 * timestamps but freshly parsed objects. Adopting those objects on a tie
 * would make every local entry look "changed", which would trigger a write
 * back, which would trigger another notification — a storage write loop.
 * Keeping the local object on a tie makes the comparison stable.
 */
function mergeExternalEntries(
  local: Record<string, CacheEntry>,
  incoming: Record<string, CacheEntry>
): Record<string, CacheEntry> {
  const merged: Record<string, CacheEntry> = { ...local };
  for (const [hash, entry] of Object.entries(incoming)) {
    const existing = merged[hash];
    if (!existing || entry.timestamp > existing.timestamp) {
      merged[hash] = entry;
    }
  }
  return merged;
}

/**
 * Union of two tombstone maps; the newer deletion timestamp wins.
 */
function mergeRemoved(
  base: Record<string, number>,
  incoming: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...base };
  for (const [hash, timestamp] of Object.entries(incoming)) {
    const existing = merged[hash];
    if (existing === undefined || timestamp > existing) {
      merged[hash] = timestamp;
    }
  }
  return merged;
}

/**
 * Drop entries that were deleted after they were written.
 */
function applyRemovals(
  entries: Record<string, CacheEntry>,
  removed: Record<string, number>
): Record<string, CacheEntry> {
  const result: Record<string, CacheEntry> = {};
  for (const [hash, entry] of Object.entries(entries)) {
    const deletion = removed[hash];
    if (deletion !== undefined && deletion >= entry.timestamp) {
      continue;
    }
    result[hash] = entry;
  }
  return result;
}

/**
 * Drop tombstones that have been overtaken by a newer write of the same
 * entry, and keep the map bounded.
 */
function pruneRemoved(
  entries: Record<string, CacheEntry>,
  removed: Record<string, number>
): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [hash, timestamp] of Object.entries(removed)) {
    const entry = entries[hash];
    if (entry && entry.timestamp > timestamp) {
      // The entry was rewritten after the deletion; the tombstone is stale.
      continue;
    }
    kept[hash] = timestamp;
  }
  const overflow = Object.keys(kept).length - MAX_TOMBSTONES;
  if (overflow <= 0) {
    return kept;
  }
  const oldestFirst = Object.entries(kept).sort(([, a], [, b]) => a - b);
  const survivors: Record<string, number> = {};
  for (const [hash, timestamp] of oldestFirst.slice(overflow)) {
    survivors[hash] = timestamp;
  }
  return survivors;
}

/**
 * Keep the newest `maxEntries` entries.
 *
 * The cap is by timestamp, not by access order, because the access order is
 * per-context: only a rule every context computes the same way keeps the
 * stored snapshot and each tab's LRU in agreement.
 */
function capEntries(
  entries: Record<string, CacheEntry>,
  maxEntries: number
): Record<string, CacheEntry> {
  const values = Object.values(entries);
  if (values.length <= maxEntries) {
    return entries;
  }
  const newestFirst = Object.entries(entries).sort(
    ([, a], [, b]) => b.timestamp - a.timestamp
  );
  const capped: Record<string, CacheEntry> = {};
  for (const [hash, entry] of newestFirst.slice(0, maxEntries)) {
    capped[hash] = entry;
  }
  return capped;
}

/**
 * Merge a freshly written snapshot into the stored one.
 *
 * The result is the union of both, with the newer timestamp winning per
 * entry and deletions applied.
 */
function mergeSnapshots(
  base: CacheSnapshot,
  incoming: CacheSnapshot
): CacheSnapshot {
  const removed = mergeRemoved(base.removed, incoming.removed);
  const entries = applyRemovals(
    mergeEntries(base.entries, incoming.entries),
    removed
  );
  // The writer's capacity wins: it is the context that just acted, and the
  // stored snapshot has to agree with what that context holds in memory.
  // Taking the maximum instead would let a tab that lowered the limit keep
  // stale entries alive in storage forever, and the next writer would
  // resurrect them.
  const maxEntries = incoming.maxEntries;
  return {
    entries: capEntries(entries, maxEntries),
    removed: pruneRemoved(entries, removed),
    maxEntries,
  };
}

/**
 * Rebuild an LRU from a plain entry map.
 *
 * Entries are inserted oldest-first so the LRU evicts the oldest timestamp
 * when it overflows. The per-context access order cannot drive that decision
 * (it would make the stored snapshot depend on which tab happened to write),
 * so the timestamp does — and reading an entry refreshes it, which keeps the
 * "least recently used" behaviour the cache had before.
 */
function buildCache(
  entries: Record<string, CacheEntry>,
  maxEntries: number
): LRUCache<string, CacheEntry> {
  const cache = new LRUCache<string, CacheEntry>(Math.max(1, maxEntries));
  const oldestFirst = Object.entries(entries).sort(
    ([, a], [, b]) => a.timestamp - b.timestamp
  );
  for (const [hash, entry] of oldestFirst) {
    cache.set(hash, entry);
  }
  return cache;
}

/**
 * Structural equality for two entry maps.
 *
 * Merging keeps the *same object* for entries that did not change, so a
 * reference comparison is enough to tell "nothing new arrived" from "an
 * entry was replaced".
 */
function sameEntries(
  a: Record<string, CacheEntry>,
  b: Record<string, CacheEntry>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => a[key] === b[key]);
}

function sameRemoved(
  a: Record<string, number>,
  b: Record<string, number>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => a[key] === b[key]);
}

/**
 * Flatten the LRU into a plain entry map.
 */
function toEntryMap(
  cache: LRUCache<string, CacheEntry>
): Record<string, CacheEntry> {
  const entries: Record<string, CacheEntry> = {};
  for (const [key, value] of cache.entries()) {
    entries[key] = value;
  }
  return entries;
}

// ==================== Chrome Storage Adapter ====================

/**
 * Read the snapshot currently stored under `name`.
 */
async function readStoredSnapshot(name: string): Promise<CacheSnapshot> {
  const empty: CacheSnapshot = {
    entries: {},
    removed: {},
    maxEntries: DEFAULT_MAX_ENTRIES,
  };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get([name]);
      return toSnapshot(result[name]);
    }
    const raw = localStorage.getItem(name);
    return raw ? toSnapshot(JSON.parse(raw)) : empty;
  } catch (error) {
    console.error('[CacheStore] read snapshot error:', error);
    return empty;
  }
}

/**
 * Serializes the read-modify-write cycle inside this context.
 *
 * Two translations can finish at nearly the same time (the translator runs
 * several images in parallel), and each one writes the cache. Without a
 * queue both would read the same stored snapshot and the second write would
 * drop the first one's entry — the very bug this file exists to fix, just
 * within a single tab.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Write a snapshot by merging it into whatever is already stored.
 *
 * This is the fix for the multi-tab wipe: the writer contributes its own
 * entries and everything another tab wrote stays. Entries written later
 * (higher timestamp) win.
 */
function writeMergedSnapshot(
  name: string,
  parsedValue: unknown
): Promise<void> {
  const run = writeQueue.then(() => performWrite(name, parsedValue));
  // Keep the chain alive even if one write fails, otherwise every later
  // write would be rejected with the first error.
  writeQueue = run.catch(() => undefined);
  return run;
}

async function performWrite(name: string, parsedValue: unknown): Promise<void> {
  const current = await readStoredSnapshot(name);
  const incoming = toSnapshot(parsedValue);
  const merged = mergeSnapshots(current, incoming);
  const version =
    isRecord(parsedValue) && typeof parsedValue['version'] === 'number'
      ? parsedValue['version']
      : CACHE_STORAGE_VERSION;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({
      [name]: { state: merged, version },
    });
    return;
  }
  localStorage.setItem(name, JSON.stringify({ state: merged, version }));
}

/**
 * Chrome Local Storage adapter for cache persistence
 * Uses chrome.storage.local for larger storage capacity
 */
const chromeLocalStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get([name]);
        return result[name] ? JSON.stringify(result[name]) : null;
      }
      return localStorage.getItem(name);
    } catch (error) {
      console.error('[CacheStore] getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsedValue = JSON.parse(value);
      await writeMergedSnapshot(name, parsedValue);
    } catch (error) {
      console.error('[CacheStore] setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove([name]);
      } else {
        localStorage.removeItem(name);
      }
    } catch (error) {
      console.error('[CacheStore] removeItem error:', error);
    }
  },
};

// ==================== Store Creation ====================

/**
 * Translation Cache Store (v2) with LRU optimization
 *
 * Stores translation results keyed by image hash to avoid
 * redundant API calls. Uses LRU cache for efficient memory management.
 */
export const useTranslationCacheStore = create<
  TranslationCacheState & TranslationCacheActions
>()(
  persist(
    (set, get) => ({
      // Initial state
      cache: new LRUCache<string, CacheEntry>(DEFAULT_MAX_ENTRIES),
      maxEntries: DEFAULT_MAX_ENTRIES,
      removed: {},

      // Get cached result
      get: imageHash => {
        const state = get();
        const entry = state.cache.get(imageHash);
        if (!entry) {
          return null;
        }
        // Refresh the access time so the entry survives the next eviction.
        // The refreshed timestamp is persisted with the next write, which is
        // also what keeps the eviction order identical in every context.
        state.cache.set(imageHash, {
          ...entry,
          timestamp: nextTimestamp(),
        });
        // Return result with cached flag set
        return {
          ...entry.result,
          cached: true,
        };
      },

      // Store result in cache
      set: (imageHash, result, provider) => {
        set(state => {
          const newEntry: CacheEntry = {
            imageHash,
            result: {
              ...result,
              cached: false, // Original result is not from cache
            },
            timestamp: nextTimestamp(),
            provider,
          };

          const entries = toEntryMap(state.cache);
          entries[imageHash] = newEntry;

          // A fresh write supersedes an earlier deletion of the same hash.
          const removed = { ...state.removed };
          delete removed[imageHash];

          return {
            ...state,
            cache: buildCache(entries, state.maxEntries),
            removed: pruneRemoved(entries, removed),
          };
        });
      },

      // Check if hash exists in cache
      has: imageHash => {
        const state = get();
        return state.cache.has(imageHash);
      },

      // Remove specific entry
      remove: imageHash => {
        set(state => {
          const entries = toEntryMap(state.cache);
          delete entries[imageHash];
          // Record the deletion so other contexts drop the entry too.
          const removed = { ...state.removed, [imageHash]: nextTimestamp() };
          return {
            ...state,
            cache: buildCache(entries, state.maxEntries),
            removed: pruneRemoved(entries, removed),
          };
        });
      },

      // Clear all entries
      clear: () => {
        set(state => {
          const entries = toEntryMap(state.cache);
          const removed = { ...state.removed };
          const deletedAt = nextTimestamp();
          for (const key of Object.keys(entries)) {
            removed[key] = deletedAt;
          }
          return {
            ...state,
            cache: buildCache({}, state.maxEntries),
            removed: pruneRemoved({}, removed),
          };
        });
        // Entries this context never saw (written by another tab) still live
        // in storage; sweep them separately so "clear cache" really clears.
        void clearStoredEntries();
      },

      // Get cache statistics
      getStats: () => {
        const state = get();
        const entries = Array.from(state.cache.values());
        const timestamps = entries.map(e => e.timestamp);

        return {
          entryCount: state.cache.size,
          maxEntries: state.maxEntries,
          oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
          newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
        };
      },

      // Set max entries
      setMaxEntries: max => {
        set(state => {
          const entries = toEntryMap(state.cache);
          return {
            ...state,
            cache: buildCache(entries, max),
            maxEntries: max,
          };
        });
      },

      // Cleanup is handled automatically by LRU cache
      cleanup: () => {
        // No-op: LRU cache handles cleanup automatically
      },

      // Get all cache entries for debugging/testing
      entries: () => {
        const state = get();
        return Array.from(state.cache.entries());
      },
    }),
    {
      name: CACHE_STORAGE_KEY,
      storage: createJSONStorage(() => chromeLocalStorage),
      version: CACHE_STORAGE_VERSION,
      // A snapshot written by an older version has no `removed` map; rebuild
      // it from the entries so the merge always sees a consistent shape.
      migrate: persistedState => {
        const snapshot = toSnapshot(persistedState);
        return {
          entries: snapshot.entries,
          removed: snapshot.removed,
          maxEntries: snapshot.maxEntries,
        };
      },
      // The persisted shape is a plain entry map, so the LRU is rebuilt
      // here instead of in `onRehydrateStorage`.
      merge: (persistedState, currentState) => {
        const snapshot = toSnapshot(persistedState);
        return {
          ...currentState,
          cache: buildCache(snapshot.entries, snapshot.maxEntries),
          removed: snapshot.removed,
          maxEntries: snapshot.maxEntries,
        };
      },
      // Custom serialization for LRU cache
      partialize: state => {
        // Convert LRU cache to plain object for persistence
        return {
          entries: toEntryMap(state.cache),
          removed: state.removed,
          maxEntries: state.maxEntries,
        };
      },
    }
  )
);

// ==================== External Storage Change Listener ====================

/**
 * Tombstone every entry currently in storage.
 *
 * Runs after `clear()`: the local store only knows about the entries this
 * context has seen, so the rest has to be swept explicitly.
 */
async function clearStoredEntries(): Promise<void> {
  try {
    const current = await readStoredSnapshot(CACHE_STORAGE_KEY);
    const removed = { ...current.removed };
    const deletedAt = nextTimestamp();
    for (const hash of Object.keys(current.entries)) {
      removed[hash] = deletedAt;
    }
    await writeMergedSnapshot(CACHE_STORAGE_KEY, {
      state: { entries: {}, removed, maxEntries: current.maxEntries },
      version: CACHE_STORAGE_VERSION,
    });
  } catch (error) {
    console.error('[CacheStore] clear stored entries error:', error);
  }
}

let storageChangeListenerInitialized = false;

/**
 * Guards against re-entering the listener while an external snapshot is
 * being applied.
 *
 * Applying a snapshot updates the store, which makes zustand persist it
 * again, which produces another notification. Two guards break that cycle:
 * this flag (an apply already in flight is not started a second time) and
 * the reference comparison in {@link applyExternalSnapshot} (a notification
 * that carries nothing new is dropped without touching the state).
 */
let isApplyingExternal = false;

function applyExternalSnapshot(snapshot: CacheSnapshot): void {
  if (isApplyingExternal) {
    return;
  }
  isApplyingExternal = true;
  try {
    const state = useTranslationCacheStore.getState();
    const localEntries = toEntryMap(state.cache);

    const removed = mergeRemoved(state.removed, snapshot.removed);
    const merged = applyRemovals(
      mergeExternalEntries(localEntries, snapshot.entries),
      removed
    );
    const prunedRemoved = pruneRemoved(merged, removed);

    // Nothing new arrived: do not touch the state, and therefore do not
    // write back. Writing back on every echo is what turns a merge into a
    // storage write loop.
    if (
      sameEntries(localEntries, merged) &&
      sameRemoved(state.removed, prunedRemoved)
    ) {
      return;
    }

    useTranslationCacheStore.setState({
      cache: buildCache(merged, state.maxEntries),
      removed: prunedRemoved,
    });
  } finally {
    isApplyingExternal = false;
  }
}

function setupStorageChangeListener(): void {
  if (storageChangeListenerInitialized) {
    return;
  }
  storageChangeListenerInitialized = true;

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }
      const cacheChange = changes[CACHE_STORAGE_KEY];
      if (!cacheChange) {
        return;
      }
      const newValue = cacheChange.newValue;
      if (!newValue) {
        // The whole key was removed; nothing to merge.
        return;
      }
      applyExternalSnapshot(toSnapshot(newValue));
    });
  }
}

// Initialize listener on module load (once)
setupStorageChangeListener();

// ==================== Selector Hooks ====================
