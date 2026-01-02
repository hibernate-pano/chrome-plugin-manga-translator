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

// ==================== Type Definitions ====================

/**
 * Translation result from Vision LLM
 */
export interface TranslationResult {
  /** Whether the translation was successful */
  success: boolean;
  /** Array of detected and translated text areas */
  textAreas: TextArea[];
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
 * Cache state
 */
export interface TranslationCacheState {
  /** Map of image hash to cache entry */
  entries: Record<string, CacheEntry>;
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
  set: (imageHash: string, result: TranslationResult, provider: ProviderType) => void;
  
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
}

// ==================== Default Configuration ====================

const DEFAULT_MAX_ENTRIES = 100;

const DEFAULT_STATE: TranslationCacheState = {
  entries: {},
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
 * Translation Cache Store (v2)
 * 
 * Stores translation results keyed by image hash to avoid
 * redundant API calls. Uses LRU-like eviction when cache
 * exceeds maxEntries.
 */
export const useTranslationCacheStore = create<TranslationCacheState & TranslationCacheActions>()(
  persist(
    (set, get) => ({
      // Initial state
      ...DEFAULT_STATE,

      // Get cached result
      get: (imageHash) => {
        const state = get();
        const entry = state.entries[imageHash];
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
        set((state) => {
          const newEntries = { ...state.entries };
          
          // Add new entry
          newEntries[imageHash] = {
            imageHash,
            result: {
              ...result,
              cached: false, // Original result is not from cache
            },
            timestamp: Date.now(),
            provider,
          };
          
          // Check if we need to evict old entries
          const entryCount = Object.keys(newEntries).length;
          if (entryCount > state.maxEntries) {
            // Find and remove oldest entries
            const sortedEntries = Object.entries(newEntries)
              .sort(([, a], [, b]) => a.timestamp - b.timestamp);
            
            const entriesToRemove = entryCount - state.maxEntries;
            for (let i = 0; i < entriesToRemove; i++) {
              const entry = sortedEntries[i];
              if (entry) {
                const [hashToRemove] = entry;
                delete newEntries[hashToRemove];
              }
            }
          }
          
          return { entries: newEntries };
        });
      },

      // Check if hash exists in cache
      has: (imageHash) => {
        const state = get();
        return imageHash in state.entries;
      },

      // Remove specific entry
      remove: (imageHash) => {
        set((state) => {
          const newEntries = { ...state.entries };
          delete newEntries[imageHash];
          return { entries: newEntries };
        });
      },

      // Clear all entries
      clear: () => {
        set({ entries: {} });
      },

      // Get cache statistics
      getStats: () => {
        const state = get();
        const entries = Object.values(state.entries);
        const timestamps = entries.map((e) => e.timestamp);
        
        return {
          entryCount: entries.length,
          maxEntries: state.maxEntries,
          oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
          newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
        };
      },

      // Set max entries
      setMaxEntries: (max) => {
        set({ maxEntries: max });
        // Trigger cleanup if needed
        get().cleanup();
      },

      // Cleanup old entries
      cleanup: () => {
        set((state) => {
          const entryCount = Object.keys(state.entries).length;
          if (entryCount <= state.maxEntries) {
            return state;
          }
          
          const newEntries = { ...state.entries };
          const sortedEntries = Object.entries(newEntries)
            .sort(([, a], [, b]) => a.timestamp - b.timestamp);
          
          const entriesToRemove = entryCount - state.maxEntries;
          for (let i = 0; i < entriesToRemove; i++) {
            const entry = sortedEntries[i];
            if (entry) {
              const [hashToRemove] = entry;
              delete newEntries[hashToRemove];
            }
          }
          
          return { entries: newEntries };
        });
      },
    }),
    {
      name: 'manga-translator-cache-v2',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Only persist entries and maxEntries
      partialize: (state) => ({
        entries: state.entries,
        maxEntries: state.maxEntries,
      }),
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
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  
  // Fallback: simple string hash
  let hash = 0;
  for (let i = 0; i < imageData.length; i++) {
    const char = imageData.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

// ==================== Selector Hooks ====================

/**
 * Get cache entry count
 */
export const useCacheEntryCount = () => 
  useTranslationCacheStore((state) => Object.keys(state.entries).length);

/**
 * Check if caching is effectively enabled (has entries)
 */
export const useHasCachedEntries = () =>
  useTranslationCacheStore((state) => Object.keys(state.entries).length > 0);
