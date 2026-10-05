/**
 * Usage Statistics Store - Token 使用量追踪
 *
 * 追踪每次翻译的 Token 消耗：
 * - promptTokens：提示词 Token 数
 * - completionTokens：生成 Token 数
 * - totalTokens：总计
 *
 * 数据存储在 chrome.storage.local，按天聚合。
 *
 * There is deliberately no cost estimate: converting tokens to money needs a
 * per-model price list, and any table shipped in the bundle would be invented
 * numbers presented to the user as a bill.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';

// ==================== Types ====================

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TranslationUsageRecord {
  /** 时间戳 */
  timestamp: number;
  /** 日期标识（YYYY-MM-DD） */
  date: string;
  /** 使用的 provider */
  provider: ProviderType;
  /** Token 用量 */
  usage: TokenUsage;
  /** 是否从缓存命中（缓存不消耗 Token） */
  cached: boolean;
}

export interface DailyUsageSummary {
  date: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  translationCount: number;
  cachedCount: number;
  providers: Partial<Record<ProviderType, number>>;
}

export interface UsageStoreState {
  /** 最近记录列表（最多保留 500 条） */
  records: TranslationUsageRecord[];
  /** 当月总 Token 数（快速访问） */
  monthlyTokens: number;
}

export interface UsageStoreActions {
  /** 记录一次翻译的用量 */
  addRecord: (
    record: Omit<TranslationUsageRecord, 'timestamp' | 'date'>
  ) => void;
  /** 获取按日聚合的统计 */
  getDailyStats: (days?: number) => DailyUsageSummary[];
  /** 获取汇总统计 */
  getSummary: () => {
    totalRecords: number;
    totalTokens: number;
    monthlyTokens: number;
    avgTokensPerTranslation: number;
    cacheHitRate: number;
  };
  /** 清除所有记录 */
  clearAll: () => void;
}

export interface UsageOverview {
  translations: number;
  billableCalls: number;
  tokens: number;
  cacheHitRate: number;
}

// ==================== 工具函数 ====================

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function summarizeUsageForMonth(
  records: TranslationUsageRecord[],
  now: Date = new Date()
): UsageOverview {
  const monthPrefix = now.toISOString().slice(0, 7);
  const monthRecords = records.filter(record =>
    record.date.startsWith(monthPrefix)
  );
  const billable = monthRecords.filter(record => !record.cached);
  const cachedCount = monthRecords.length - billable.length;

  return {
    translations: monthRecords.length,
    billableCalls: billable.length,
    tokens: billable.reduce(
      (total, record) => total + record.usage.totalTokens,
      0
    ),
    cacheHitRate:
      monthRecords.length > 0
        ? Math.round((cachedCount / monthRecords.length) * 100)
        : 0,
  };
}

function isCurrentMonth(dateStr: string): boolean {
  const today = new Date().toISOString().slice(0, 7);
  return dateStr.startsWith(today);
}

// ==================== Chrome Local Storage Adapter ====================

const chromeLocalStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get([name]);
        return result[name] ? JSON.stringify(result[name]) : null;
      }
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value);
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [name]: parsed });
      } else {
        localStorage.setItem(name, value);
      }
    } catch {
      /* noop */
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove([name]);
      } else {
        localStorage.removeItem(name);
      }
    } catch {
      /* noop */
    }
  },
};

// ==================== Store ====================

export const useUsageStore = create<UsageStoreState & UsageStoreActions>()(
  persist(
    (set, get) => ({
      records: [],
      monthlyTokens: 0,

      addRecord: partial => {
        const record: TranslationUsageRecord = {
          ...partial,
          timestamp: Date.now(),
          date: todayString(),
        };

        set(state => {
          // 最多保留 500 条记录（LRU 淘汰旧记录）
          const newRecords = [record, ...state.records].slice(0, 500);

          // 重新计算当月统计
          const monthlyRecords = newRecords.filter(
            r => isCurrentMonth(r.date) && !r.cached
          );
          const monthlyTokens = monthlyRecords.reduce(
            (s, r) => s + r.usage.totalTokens,
            0
          );

          return { records: newRecords, monthlyTokens };
        });
      },

      getDailyStats: (days = 30) => {
        const { records } = get();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        // 按日期聚合
        const byDate: Record<string, DailyUsageSummary> = {};

        for (const record of records) {
          if (record.date < cutoffStr) continue;

          if (!byDate[record.date]) {
            byDate[record.date] = {
              date: record.date,
              totalTokens: 0,
              promptTokens: 0,
              completionTokens: 0,
              translationCount: 0,
              cachedCount: 0,
              providers: {},
            };
          }

          const day = byDate[record.date];
          if (!day) {
            continue;
          }
          day.translationCount++;

          if (record.cached) {
            day.cachedCount++;
          } else {
            day.totalTokens += record.usage.totalTokens;
            day.promptTokens += record.usage.promptTokens;
            day.completionTokens += record.usage.completionTokens;
            day.providers[record.provider] =
              (day.providers[record.provider] || 0) + 1;
          }
        }

        return Object.values(byDate).sort((a, b) =>
          b.date.localeCompare(a.date)
        );
      },

      getSummary: () => {
        const { records, monthlyTokens } = get();
        const apiRecords = records.filter(r => !r.cached);
        const totalTokens = apiRecords.reduce(
          (s, r) => s + r.usage.totalTokens,
          0
        );

        return {
          totalRecords: records.length,
          totalTokens,
          monthlyTokens,
          avgTokensPerTranslation:
            apiRecords.length > 0
              ? Math.round(totalTokens / apiRecords.length)
              : 0,
          cacheHitRate:
            records.length > 0
              ? records.filter(r => r.cached).length / records.length
              : 0,
        };
      },

      clearAll: () => set({ records: [], monthlyTokens: 0 }),
    }),
    {
      name: 'manga-translator-usage-v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    }
  )
);

// ==================== 便捷 Selector Hooks ====================
