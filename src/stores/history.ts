import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 翻译历史项接口
export interface TranslationHistoryItem {
  id: string;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  timestamp: number;
  provider: string;
  isBatch: boolean;
  context?: string; // 上下文信息，如网页URL或图像URL
  usageCount: number; // 使用次数，用于排序
}

// 历史记录状态接口
export interface HistoryState {
  history: TranslationHistoryItem[];
  searchQuery: string;
  filter: {
    sourceLanguage: string;
    targetLanguage: string;
    provider: string;
    startDate: number;
    endDate: number;
  };
}

// 历史记录操作接口
export interface HistoryActions {
  // 添加历史记录
  addHistoryItem: (item: Omit<TranslationHistoryItem, 'id' | 'timestamp' | 'usageCount'>) => void;
  
  // 获取历史记录
  getHistory: () => TranslationHistoryItem[];
  
  // 根据ID获取历史记录
  getHistoryItem: (id: string) => TranslationHistoryItem | undefined;
  
  // 删除历史记录
  deleteHistoryItem: (id: string) => void;
  
  // 清空历史记录
  clearHistory: () => void;
  
  // 搜索历史记录
  setSearchQuery: (query: string) => void;
  
  // 设置过滤器
  setFilter: (filter: Partial<HistoryState['filter']>) => void;
  
  // 获取过滤后的历史记录
  getFilteredHistory: () => TranslationHistoryItem[];
  
  // 更新历史记录使用次数
  incrementUsageCount: (id: string) => void;
  
  // 导出历史记录
  exportHistory: () => TranslationHistoryItem[];
  
  // 导入历史记录
  importHistory: (items: TranslationHistoryItem[]) => void;
}

// Chrome Storage 适配器（用于持久化）
const chromeStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const result = await chrome.storage.sync.get([name]);
      return result[name] ? JSON.stringify(result[name]) : null;
    } catch (error) {
      console.error('Chrome local storage getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsedValue = JSON.parse(value);
      await chrome.storage.sync.set({ [name]: parsedValue });
    } catch (error) {
      console.error('Chrome local storage setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await chrome.storage.sync.remove([name]);
    } catch (error) {
      console.error('Chrome local storage removeItem error:', error);
    }
  },
};

// 创建历史记录状态store
export const useHistoryStore = create<HistoryState & HistoryActions>()(
  persist(
    (set, get) => ({
      // 初始状态
      history: [],
      searchQuery: '',
      filter: {
        sourceLanguage: '',
        targetLanguage: '',
        provider: '',
        startDate: 0,
        endDate: Date.now() + 86400000, // 明天
      },

      // 添加历史记录
      addHistoryItem: (item) => {
        const id = `history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newItem: TranslationHistoryItem = {
          ...item,
          id,
          timestamp: Date.now(),
          usageCount: 0,
        };
        
        set((state) => ({
          history: [newItem, ...state.history.slice(0, 99)], // 限制历史记录数量为100条
        }));
      },

      // 获取历史记录
      getHistory: () => {
        return get().history;
      },

      // 根据ID获取历史记录
      getHistoryItem: (id) => {
        return get().history.find(item => item.id === id);
      },

      // 删除历史记录
      deleteHistoryItem: (id) => {
        set((state) => ({
          history: state.history.filter(item => item.id !== id),
        }));
      },

      // 清空历史记录
      clearHistory: () => {
        set({ history: [] });
      },

      // 设置搜索查询
      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      // 设置过滤器
      setFilter: (filter) => {
        set((state) => ({
          filter: {
            ...state.filter,
            ...filter,
          },
        }));
      },

      // 获取过滤后的历史记录
      getFilteredHistory: () => {
        const { history, searchQuery, filter } = get();
        
        return history.filter(item => {
          // 搜索查询过滤
          const matchesSearch = !searchQuery || 
            item.originalText.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.translatedText.toLowerCase().includes(searchQuery.toLowerCase());
          
          // 源语言过滤
          const matchesSourceLang = !filter.sourceLanguage || item.sourceLanguage === filter.sourceLanguage;
          
          // 目标语言过滤
          const matchesTargetLang = !filter.targetLanguage || item.targetLanguage === filter.targetLanguage;
          
          // 提供者过滤
          const matchesProvider = !filter.provider || item.provider === filter.provider;
          
          // 日期范围过滤
          const matchesDate = item.timestamp >= filter.startDate && item.timestamp <= filter.endDate;
          
          return matchesSearch && matchesSourceLang && matchesTargetLang && matchesProvider && matchesDate;
        });
      },

      // 更新历史记录使用次数
      incrementUsageCount: (id) => {
        set((state) => ({
          history: state.history.map(item => {
            if (item.id === id) {
              return { ...item, usageCount: item.usageCount + 1 };
            }
            return item;
          }),
        }));
      },

      // 导出历史记录
      exportHistory: () => {
        return get().history;
      },

      // 导入历史记录
      importHistory: (items) => {
        set((state) => {
          // 合并历史记录，去重
          const existingIds = new Set(state.history.map(item => item.id));
          const newItems = items.filter(item => !existingIds.has(item.id));
          return {
            history: [...newItems, ...state.history].slice(0, 100), // 限制数量
          };
        });
      },
    }),
    {
      name: 'manga-translator-history',
      storage: createJSONStorage(() => chromeStorage),
      // 持久化配置
      partialize: (state) => ({
        history: state.history,
      }),
    }
  )
);
