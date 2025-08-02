import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 翻译历史项接口
export interface TranslationHistoryItem {
  id: string;
  imageUrl: string;
  originalText: string;
  translatedText: string;
  targetLanguage: string;
  timestamp: number;
  imageHash?: string;
}

// 翻译状态接口
export interface TranslationState {
  enabled: boolean;
  mode: 'manual' | 'auto';
  targetLanguage: string;
  processing: boolean;
  currentImage: string | null;
  translatedImages: Map<string, TranslationHistoryItem>;
  history: TranslationHistoryItem[];
}

// 翻译操作接口
export interface TranslationActions {
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: 'manual' | 'auto') => void;
  setTargetLanguage: (targetLanguage: string) => void;
  setProcessing: (processing: boolean) => void;
  setCurrentImage: (currentImage: string | null) => void;
  addTranslatedImage: (imageHash: string, item: TranslationHistoryItem) => void;
  removeTranslatedImage: (imageHash: string) => void;
  clearTranslatedImages: () => void;
  addToHistory: (item: Omit<TranslationHistoryItem, 'id' | 'timestamp'>) => void;
  removeFromHistory: (id: string) => void;
  clearHistory: () => void;
  getTranslatedImage: (imageHash: string) => TranslationHistoryItem | undefined;
}

// Chrome Storage 适配器
const chromeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const result = await chrome.storage.local.get([name]);
      return result[name] ? JSON.stringify(result[name]) : null;
    } catch (error) {
      console.error('Chrome storage getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsedValue = JSON.parse(value);
      await chrome.storage.local.set({ [name]: parsedValue });
    } catch (error) {
      console.error('Chrome storage setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await chrome.storage.local.remove([name]);
    } catch (error) {
      console.error('Chrome storage removeItem error:', error);
    }
  },
};

// 创建翻译状态store
export const useTranslationStore = create<TranslationState & TranslationActions>()(
  persist(
    (set, get) => ({
      // 初始状态
      enabled: false,
      mode: 'manual',
      targetLanguage: 'zh-CN',
      processing: false,
      currentImage: null,
      translatedImages: new Map(),
      history: [],

      // 基本状态操作
      setEnabled: (enabled) => set({ enabled }),
      setMode: (mode) => set({ mode }),
      setTargetLanguage: (targetLanguage) => set({ targetLanguage }),
      setProcessing: (processing) => set({ processing }),
      setCurrentImage: (currentImage) => set({ currentImage }),

      // 翻译图像管理
      addTranslatedImage: (imageHash, item) =>
        set((state) => {
          const newTranslatedImages = new Map(state.translatedImages);
          newTranslatedImages.set(imageHash, item);
          return { translatedImages: newTranslatedImages };
        }),

      removeTranslatedImage: (imageHash) =>
        set((state) => {
          const newTranslatedImages = new Map(state.translatedImages);
          newTranslatedImages.delete(imageHash);
          return { translatedImages: newTranslatedImages };
        }),

      clearTranslatedImages: () =>
        set({ translatedImages: new Map() }),

      getTranslatedImage: (imageHash) => {
        const state = get();
        return state.translatedImages.get(imageHash);
      },

      // 历史记录管理
      addToHistory: (item) =>
        set((state) => {
          const newItem: TranslationHistoryItem = {
            ...item,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
          };

          return {
            history: [newItem, ...state.history.slice(0, 99)], // 保留最近100条
          };
        }),

      removeFromHistory: (id) =>
        set((state) => ({
          history: state.history.filter((item) => item.id !== id),
        })),

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'manga-translator-translation',
      storage: createJSONStorage(() => chromeStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        mode: state.mode,
        targetLanguage: state.targetLanguage,
        history: state.history,
        // translatedImages 不持久化，因为它是运行时状态
      }),
    }
  )
);
