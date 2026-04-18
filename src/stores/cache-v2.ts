/**
 * Cache Store v2 - Translation result caching for Manga Translator v2
 *
 * Implements image hash → translation result caching to avoid
 * redundant API calls for previously translated images.
 *
 * Requirements: 9.1
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
export interface CacheEntry {
  /** Hash of the original image */
  imageHash: string;
  /** Translation result */
  result: TranslationResult;
  /** Timestamp when the entry was created */
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
}

/**
 * Cache actions
 */
export interface TranslationCacheActions {
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

const DEFAULT_STATE: TranslationCacheState = {
  cache: new LRUCache<string, CacheEntry>(DEFAULT_MAX_ENTRIES),
  maxEntries: DEFAULT_MAX_ENTRIES,
};

// ==================== Chrome Storage Adapter ====================

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
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [name]: parsedValue });
      } else {
        localStorage.setItem(name, value);
      }
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
      ...DEFAULT_STATE,

      // Get cached result
      get: imageHash => {
        const state = get();
        const entry = state.cache.get(imageHash);
        if (!entry) {
          return null;
        }
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
            timestamp: Date.now(),
            provider,
          };

          // Create new LRU cache instance to avoid mutating state
          const newCache = new LRUCache<string, CacheEntry>(state.maxEntries);
          for (const [key, value] of state.cache.entries()) {
            newCache.set(key, value);
          }
          newCache.set(imageHash, newEntry);

          return { ...state, cache: newCache };
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
          const newCache = new LRUCache<string, CacheEntry>(state.maxEntries);
          for (const [key, value] of state.cache.entries()) {
            if (key !== imageHash) {
              newCache.set(key, value);
            }
          }
          return { ...state, cache: newCache };
        });
      },

      // Clear all entries
      clear: () => {
        set(state => ({
          ...state,
          cache: new LRUCache<string, CacheEntry>(state.maxEntries),
        }));
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
          // Create new LRU cache with new size
          const newCache = new LRUCache<string, CacheEntry>(max);

          // Copy existing entries (LRU will handle size limit)
          for (const [key, value] of state.cache.entries()) {
            newCache.set(key, value);
          }

          return {
            ...state,
            cache: newCache,
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
      name: 'manga-translator-cache-v2',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Custom serialization for LRU cache
      partialize: state => {
        // Convert LRU cache to plain object for persistence
        const entries: Record<string, CacheEntry> = {};
        for (const [key, value] of state.cache.entries()) {
          entries[key] = value;
        }
        return {
          entries,
          maxEntries: state.maxEntries,
        };
      },
      // Custom deserialization
      onRehydrateStorage: () => state => {
        if (
          state &&
          'entries' in state &&
          typeof state.entries === 'object' &&
          !Array.isArray(state.entries)
        ) {
          // Reconstruct LRU cache from persisted entries
          const cache = new LRUCache<string, CacheEntry>(state.maxEntries);
          const entries = state.entries as Record<string, CacheEntry>;

          // Sort by timestamp to maintain LRU order
          const sortedEntries = Object.entries(entries).sort(
            ([, a], [, b]) => a.timestamp - b.timestamp
          );

          for (const [key, value] of sortedEntries) {
            cache.set(key, value);
          }

          // Update state with reconstructed cache
          state.cache = cache;
          Reflect.deleteProperty(
            state as unknown as Record<string, unknown>,
            'entries'
          );
        }
      },
    }
  )
);

// ==================== Utility Functions ====================

/**
 * Calculate a simple hash for an image
 * Uses a fast hashing algorithm suitable for cache keys
 *
 * @param imageData Base64 encoded image data or image URL
 * @returns Hash string
 */
export async function calculateImageHash(imageData: string): Promise<string> {
  // Use SubtleCrypto for hashing if available
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(imageData);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple string hash
  let hash = 0;
  for (let i = 0; i < imageData.length; i++) {
    const char = imageData.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

// ==================== Selector Hooks ====================

/**
 * Get cache entry count
 */
export const useCacheEntryCount = () =>
  useTranslationCacheStore(state => state.cache.size);

/**
 * Check if caching is effectively enabled (has entries)
 */
export const useHasCachedEntries = () =>
  useTranslationCacheStore(state => state.cache.size > 0);
