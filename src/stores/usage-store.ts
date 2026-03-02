/**
 * Usage Statistics Store - Token 使用量追踪
 *
 * 追踪每次翻译的 Token 消耗：
 * - promptTokens：提示词 Token 数
 * - completionTokens：生成 Token 数
 * - totalTokens：总计
 * - cost：估算费用（基于 provider 定价）
 *
 * 数据存储在 chrome.storage.local，按天聚合。
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
    /** 估算费用（USD） */
    estimatedCost?: number;
}

export interface DailyUsageSummary {
    date: string;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    translationCount: number;
    cachedCount: number;
    estimatedCost: number;
    providers: Partial<Record<ProviderType, number>>;
}

export interface UsageStoreState {
    /** 最近记录列表（最多保留 500 条） */
    records: TranslationUsageRecord[];
    /** 当月总 Token 数（快速访问） */
    monthlyTokens: number;
    /** 当月估算费用 */
    monthlyCost: number;
}

export interface UsageStoreActions {
    /** 记录一次翻译的用量 */
    addRecord: (record: Omit<TranslationUsageRecord, 'timestamp' | 'date'>) => void;
    /** 获取按日聚合的统计 */
    getDailyStats: (days?: number) => DailyUsageSummary[];
    /** 获取汇总统计 */
    getSummary: () => {
        totalRecords: number;
        totalTokens: number;
        monthlyTokens: number;
        monthlyCost: number;
        avgTokensPerTranslation: number;
        cacheHitRate: number;
    };
    /** 清除所有记录 */
    clearAll: () => void;
}

// ==================== Provider Token 估算定价 (USD/1K tokens) ====================

const PROVIDER_PRICING: Partial<Record<ProviderType, { input: number; output: number }>> = {
    siliconflow: { input: 0.001, output: 0.002 },
    dashscope: { input: 0.0015, output: 0.002 },
    openai: { input: 0.005, output: 0.015 },
    claude: { input: 0.003, output: 0.015 },
    deepseek: { input: 0.00027, output: 0.0011 },
    ollama: { input: 0, output: 0 },
};

function estimateCost(usage: TokenUsage, provider: ProviderType): number {
    const pricing = PROVIDER_PRICING[provider];
    if (!pricing) return 0;
    return (usage.promptTokens / 1000) * pricing.input +
        (usage.completionTokens / 1000) * pricing.output;
}

// ==================== 工具函数 ====================

function todayString(): string {
    return new Date().toISOString().slice(0, 10);
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
        } catch { return null; }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        try {
            const parsed = JSON.parse(value);
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                await chrome.storage.local.set({ [name]: parsed });
            } else {
                localStorage.setItem(name, value);
            }
        } catch { /* noop */ }
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                await chrome.storage.local.remove([name]);
            } else {
                localStorage.removeItem(name);
            }
        } catch { /* noop */ }
    },
};

// ==================== Store ====================

export const useUsageStore = create<UsageStoreState & UsageStoreActions>()(
    persist(
        (set, get) => ({
            records: [],
            monthlyTokens: 0,
            monthlyCost: 0,

            addRecord: (partial) => {
                const record: TranslationUsageRecord = {
                    ...partial,
                    timestamp: Date.now(),
                    date: todayString(),
                    estimatedCost: partial.cached ? 0 : estimateCost(partial.usage, partial.provider),
                };

                set(state => {
                    // 最多保留 500 条记录（LRU 淘汰旧记录）
                    const newRecords = [record, ...state.records].slice(0, 500);

                    // 重新计算当月统计
                    const monthlyRecords = newRecords.filter(r => isCurrentMonth(r.date) && !r.cached);
                    const monthlyTokens = monthlyRecords.reduce((s, r) => s + r.usage.totalTokens, 0);
                    const monthlyCost = monthlyRecords.reduce((s, r) => s + (r.estimatedCost || 0), 0);

                    return { records: newRecords, monthlyTokens, monthlyCost };
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
                            estimatedCost: 0,
                            providers: {},
                        };
                    }

                    const day = byDate[record.date]!;
                    day.translationCount++;

                    if (record.cached) {
                        day.cachedCount++;
                    } else {
                        day.totalTokens += record.usage.totalTokens;
                        day.promptTokens += record.usage.promptTokens;
                        day.completionTokens += record.usage.completionTokens;
                        day.estimatedCost += record.estimatedCost || 0;
                        day.providers[record.provider] = (day.providers[record.provider] || 0) + 1;
                    }
                }

                return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
            },

            getSummary: () => {
                const { records, monthlyTokens, monthlyCost } = get();
                const apiRecords = records.filter(r => !r.cached);
                const totalTokens = apiRecords.reduce((s, r) => s + r.usage.totalTokens, 0);

                return {
                    totalRecords: records.length,
                    totalTokens,
                    monthlyTokens,
                    monthlyCost,
                    avgTokensPerTranslation: apiRecords.length > 0
                        ? Math.round(totalTokens / apiRecords.length)
                        : 0,
                    cacheHitRate: records.length > 0
                        ? records.filter(r => r.cached).length / records.length
                        : 0,
                };
            },

            clearAll: () => set({ records: [], monthlyTokens: 0, monthlyCost: 0 }),
        }),
        {
            name: 'manga-translator-usage-v1',
            storage: createJSONStorage(() => chromeLocalStorage),
        }
    )
);

// ==================== 便捷 Selector Hooks ====================

export const useMonthlyTokens = () =>
    useUsageStore(state => state.monthlyTokens);

export const useMonthlyCost = () =>
    useUsageStore(state => state.monthlyCost);
