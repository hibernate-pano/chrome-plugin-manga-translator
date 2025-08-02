import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 缓存项接口
export interface CacheItem {
  data: any;
  timestamp: number;
  expiresAt?: number;
}

// 缓存状态接口
export interface CacheState {
  translationCache: Record<string, CacheItem>;
  imageCache: Record<string, CacheItem>;
  ocrCache: Record<string, CacheItem>;
}

// 缓存操作接口
export interface CacheActions {
  // 翻译缓存
  setTranslationCache: (key: string, data: any, ttl?: number) => void;
  getTranslationCache: (key: string) => any | null;
  removeTranslationCache: (key: string) => void;
  clearTranslationCache: () => void;

  // 图像缓存
  setImageCache: (key: string, data: any, ttl?: number) => void;
  getImageCache: (key: string) => any | null;
  removeImageCache: (key: string) => void;
  clearImageCache: () => void;

  // OCR缓存
  setOCRCache: (key: string, data: any, ttl?: number) => void;
  getOCRCache: (key: string) => any | null;
  removeOCRCache: (key: string) => void;
  clearOCRCache: () => void;

  // 通用缓存操作
  clearAllCache: () => void;
  cleanExpiredCache: () => void;
  getCacheStats: () => {
    translationCount: number;
    imageCount: number;
    ocrCount: number;
    totalSize: number;
  };
}

// Chrome Storage 适配器（本地存储，用于缓存）
const chromeLocalStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const result = await chrome.storage.local.get([name]);
      return result[name] ? JSON.stringify(result[name]) : null;
    } catch (error) {
      console.error('Chrome local storage getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsedValue = JSON.parse(value);
      await chrome.storage.local.set({ [name]: parsedValue });
    } catch (error) {
      console.error('Chrome local storage setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await chrome.storage.local.remove([name]);
    } catch (error) {
      console.error('Chrome local storage removeItem error:', error);
    }
  },
};

// 工具函数：检查缓存项是否过期
const isExpired = (item: CacheItem): boolean => {
  if (!item.expiresAt) return false;
  return Date.now() > item.expiresAt;
};

// 工具函数：创建缓存项
const createCacheItem = (data: any, ttl?: number): CacheItem => {
  const timestamp = Date.now();
  return {
    data,
    timestamp,
    expiresAt: ttl ? timestamp + ttl : undefined,
  };
};

// 创建缓存状态store
export const useCacheStore = create<CacheState & CacheActions>()(
  persist(
    (set, get) => ({
      // 初始状态
      translationCache: {},
      imageCache: {},
      ocrCache: {},

      // 翻译缓存操作
      setTranslationCache: (key, data, ttl) =>
        set((state) => ({
          translationCache: {
            ...state.translationCache,
            [key]: createCacheItem(data, ttl),
          },
        })),

      getTranslationCache: (key) => {
        const state = get();
        const item = state.translationCache[key];
        if (!item || isExpired(item)) {
          // 如果过期，自动删除
          if (item && isExpired(item)) {
            set((state) => {
              const newCache = { ...state.translationCache };
              delete newCache[key];
              return { translationCache: newCache };
            });
          }
          return null;
        }
        return item.data;
      },

      removeTranslationCache: (key) =>
        set((state) => {
          const newCache = { ...state.translationCache };
          delete newCache[key];
          return { translationCache: newCache };
        }),

      clearTranslationCache: () => set({ translationCache: {} }),

      // 图像缓存操作
      setImageCache: (key, data, ttl) =>
        set((state) => ({
          imageCache: {
            ...state.imageCache,
            [key]: createCacheItem(data, ttl),
          },
        })),

      getImageCache: (key) => {
        const state = get();
        const item = state.imageCache[key];
        if (!item || isExpired(item)) {
          if (item && isExpired(item)) {
            set((state) => {
              const newCache = { ...state.imageCache };
              delete newCache[key];
              return { imageCache: newCache };
            });
          }
          return null;
        }
        return item.data;
      },

      removeImageCache: (key) =>
        set((state) => {
          const newCache = { ...state.imageCache };
          delete newCache[key];
          return { imageCache: newCache };
        }),

      clearImageCache: () => set({ imageCache: {} }),

      // OCR缓存操作
      setOCRCache: (key, data, ttl) =>
        set((state) => ({
          ocrCache: {
            ...state.ocrCache,
            [key]: createCacheItem(data, ttl),
          },
        })),

      getOCRCache: (key) => {
        const state = get();
        const item = state.ocrCache[key];
        if (!item || isExpired(item)) {
          if (item && isExpired(item)) {
            set((state) => {
              const newCache = { ...state.ocrCache };
              delete newCache[key];
              return { ocrCache: newCache };
            });
          }
          return null;
        }
        return item.data;
      },

      removeOCRCache: (key) =>
        set((state) => {
          const newCache = { ...state.ocrCache };
          delete newCache[key];
          return { ocrCache: newCache };
        }),

      clearOCRCache: () => set({ ocrCache: {} }),

      // 通用缓存操作
      clearAllCache: () =>
        set({
          translationCache: {},
          imageCache: {},
          ocrCache: {},
        }),

      cleanExpiredCache: () =>
        set((state) => {

          const cleanCache = (cache: Record<string, CacheItem>) => {
            const cleaned: Record<string, CacheItem> = {};
            Object.entries(cache).forEach(([key, item]) => {
              if (!isExpired(item)) {
                cleaned[key] = item;
              }
            });
            return cleaned;
          };

          return {
            translationCache: cleanCache(state.translationCache),
            imageCache: cleanCache(state.imageCache),
            ocrCache: cleanCache(state.ocrCache),
          };
        }),

      getCacheStats: () => {
        const state = get();
        return {
          translationCount: Object.keys(state.translationCache).length,
          imageCount: Object.keys(state.imageCache).length,
          ocrCount: Object.keys(state.ocrCache).length,
          totalSize:
            Object.keys(state.translationCache).length +
            Object.keys(state.imageCache).length +
            Object.keys(state.ocrCache).length,
        };
      },
    }),
    {
      name: 'manga-translator-cache',
      storage: createJSONStorage(() => chromeLocalStorage),
      // 缓存数据不需要持久化所有内容，只保留重要的翻译缓存
      partialize: (state) => ({
        translationCache: state.translationCache,
      }),
    }
  )
);
