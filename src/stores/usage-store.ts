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
 *
 * ## Multi-context (multi-tab) consistency
 *
 * Every context that loads this module — each content script, the popup, the
 * options page — has its own store instance, but they all share one
 * `chrome.storage.local` key. A naive "write the whole array" therefore lets
 * the last writer erase everyone else's records: two tabs translating at the
 * same time make the later write drop the earlier one's entries, and the
 * monthly token total silently under-counts what the user was charged.
 *
 * The fix mirrors the translation cache:
 * - a write merges into the stored snapshot instead of replacing it;
 * - a `chrome.storage.onChanged` listener folds in what the other contexts
 *   recorded;
 * - every record carries an id, so two tabs can record a translation in the
 *   same millisecond without one erasing the other;
 * - a "cleared" timestamp travels with the snapshot, so a deletion in one tab
 *   is not undone by the next write from another.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';

// ==================== Types ====================

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TranslationUsageRecord {
  /**
   * A unique id for this record.
   *
   * Two tabs can record a translation in the same millisecond, so the
   * timestamp alone cannot tell two records apart when the histories are
   * merged. The id is what makes that merge exact.
   */
  id: string;
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

interface DailyUsageSummary {
  date: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  translationCount: number;
  cachedCount: number;
  providers: Partial<Record<ProviderType, number>>;
}

interface UsageStoreState {
  /** 最近记录列表（最多保留 500 条） */
  records: TranslationUsageRecord[];
  /** 当月总 Token 数（快速访问） */
  monthlyTokens: number;
  /**
   * The moment the history was last cleared.
   *
   * Records at or before this moment are gone. The stamp travels with the
   * snapshot so that a tab which still holds the old history cannot write it
   * back and resurrect what the user deleted.
   */
  clearedAt: number;
}

interface UsageStoreActions {
  /** 记录一次翻译的用量 */
  addRecord: (
    record: Omit<TranslationUsageRecord, 'id' | 'timestamp' | 'date'>
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

interface UsageOverview {
  translations: number;
  billableCalls: number;
  tokens: number;
  cacheHitRate: number;
}

// ==================== 工具函数 ====================

/**
 * 把本地时间格式化成 `YYYY-MM-DD`。
 *
 * 不能用 `toISOString()`：那是 UTC 日期。中国用户（UTC+8）的"今天"在 UTC
 * 意义上要到早上 08:00 才开始，所以本地 00:00-08:00 的用量会被算到前一天，
 * "今日用量"看起来会莫名其妙地少一截。
 */
export function formatLocalDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 把本地时间格式化成 `YYYY-MM`（本地月份）。
 *
 * 同样不能用 `toISOString()`：UTC+8 的用户在每月 1 日 00:00-08:00 会被算进
 * 上一个月，月初的用量统计会整个消失。
 */
export function formatLocalMonth(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function todayString(): string {
  return formatLocalDate();
}

export function summarizeUsageForMonth(
  records: TranslationUsageRecord[],
  now: Date = new Date()
): UsageOverview {
  const monthPrefix = formatLocalMonth(now);
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
  return dateStr.startsWith(formatLocalMonth());
}

// ==================== Record identity ====================

/**
 * A prefix that makes this context's record ids unique.
 *
 * Every extension context — each tab, the popup, the options page — loads
 * this module separately, so each one needs its own ids. The prefix tells
 * the contexts apart; the counter tells the records apart within one.
 */
const CONTEXT_ID = Math.random().toString(36).slice(2, 10);

let recordSequence = 0;

function nextRecordId(): string {
  recordSequence += 1;
  return `${CONTEXT_ID}-${recordSequence}`;
}

/**
 * The last timestamp handed out by this context.
 *
 * Two events can land in the same millisecond, and a tie would make the
 * merge order ambiguous. Forcing the clock forward keeps the order
 * unambiguous within a context, and keeps every record newer than the
 * "cleared" stamp that was derived from it.
 */
let lastTimestamp = 0;

function nextTimestamp(): number {
  const now = Date.now();
  lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1;
  return lastTimestamp;
}

/**
 * The id of a record that was written before ids existed.
 *
 * It is derived from the record's content, which is identical in every
 * context, so the same old record does not turn into two copies when two
 * tabs merge their histories.
 */
function legacyRecordId(
  timestamp: number,
  provider: string,
  totalTokens: number,
  cached: boolean
): string {
  return `legacy-${timestamp}-${provider}-${totalTokens}-${cached ? 1 : 0}`;
}

/**
 * The id a record is known by.
 *
 * Records that were set in memory without an id (tests, or a snapshot from
 * an older version) get the content-derived legacy id, so the merge stays
 * exact instead of treating them as unknown entries.
 */
function recordId(record: TranslationUsageRecord): string {
  if (record.id) {
    return record.id;
  }
  return legacyRecordId(
    record.timestamp,
    record.provider,
    record.usage.totalTokens,
    record.cached
  );
}

// ==================== Snapshot helpers ====================

/**
 * The persisted shape of the history: the records and the moment the
 * history was last cleared. Written and read by every extension context.
 */
interface UsageSnapshot {
  records: TranslationUsageRecord[];
  clearedAt: number;
}

const MAX_RECORDS = 500;
const USAGE_STORAGE_KEY = 'manga-translator-usage-v1';
const USAGE_STORAGE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderType(value: unknown): value is ProviderType {
  return (
    value === 'openai-compatible' || value === 'ollama' || value === 'lm-studio'
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Turn an untrusted stored entry into a usable record.
 *
 * Storage is user-writable, so every value read back from it is untrusted.
 * An entry without usable numbers would make the totals wrong, so it is
 * dropped rather than merged in. An entry that is valid but has no id comes
 * from an older version: it is kept and given a content-derived id, so the
 * user's history survives the upgrade instead of being silently dropped.
 */
function normalizeRecord(value: unknown): TranslationUsageRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const timestamp = value['timestamp'];
  if (!isFiniteNumber(timestamp)) {
    return null;
  }
  const usage = value['usage'];
  if (!isRecord(usage)) {
    return null;
  }
  const promptTokens = usage['promptTokens'];
  const completionTokens = usage['completionTokens'];
  const totalTokens = usage['totalTokens'];
  if (
    !isFiniteNumber(promptTokens) ||
    !isFiniteNumber(completionTokens) ||
    !isFiniteNumber(totalTokens)
  ) {
    return null;
  }
  const rawProvider = value['provider'];
  const provider: ProviderType = isProviderType(rawProvider)
    ? rawProvider
    : 'openai-compatible';
  const rawDate = value['date'];
  const date =
    typeof rawDate === 'string' && rawDate
      ? rawDate
      : formatLocalDate(new Date(timestamp));
  const cached = value['cached'] === true;
  const rawId = value['id'];
  const id =
    typeof rawId === 'string' && rawId
      ? rawId
      : legacyRecordId(timestamp, provider, totalTokens, cached);

  return {
    id,
    timestamp,
    date,
    provider,
    usage: { promptTokens, completionTokens, totalTokens },
    cached,
  };
}

/**
 * Read a snapshot out of either the zustand envelope (`{ state, version }`)
 * or the bare partialized state.
 */
function toSnapshot(value: unknown): UsageSnapshot {
  const inner =
    isRecord(value) && isRecord(value['state']) ? value['state'] : value;
  const source = isRecord(inner) ? inner : {};

  const rawRecords = source['records'];
  const records: TranslationUsageRecord[] = [];
  if (Array.isArray(rawRecords)) {
    for (const entry of rawRecords) {
      const normalized = normalizeRecord(entry);
      if (normalized) {
        records.push(normalized);
      }
    }
  }

  const rawClearedAt = source['clearedAt'];
  const clearedAt = isFiniteNumber(rawClearedAt) ? rawClearedAt : 0;

  return { records, clearedAt };
}

/**
 * The union of two record lists, keyed by id.
 *
 * The records already in `base` keep their object, so a change notification
 * that echoes back what this context just wrote is recognised as "nothing
 * new" instead of triggering another write.
 */
function unionRecords(
  base: TranslationUsageRecord[],
  incoming: TranslationUsageRecord[]
): TranslationUsageRecord[] {
  const byId = new Map<string, TranslationUsageRecord>();
  for (const record of base) {
    byId.set(recordId(record), record);
  }
  for (const record of incoming) {
    const id = recordId(record);
    if (!byId.has(id)) {
      byId.set(id, record);
    }
  }
  return [...byId.values()];
}

/**
 * Newest first, with the id as the tie-breaker.
 *
 * The order has to be the same in every context, or two tabs would disagree
 * about which records survive the cap. Timestamps come from the same
 * machine clock, and the id is unique, so the order is deterministic.
 */
function sortRecords(
  records: TranslationUsageRecord[]
): TranslationUsageRecord[] {
  return [...records].sort(
    (a, b) =>
      b.timestamp - a.timestamp || recordId(a).localeCompare(recordId(b))
  );
}

/**
 * Keep the newest `MAX_RECORDS` records.
 */
function capRecords(
  records: TranslationUsageRecord[]
): TranslationUsageRecord[] {
  if (records.length <= MAX_RECORDS) {
    return records;
  }
  return sortRecords(records).slice(0, MAX_RECORDS);
}

/**
 * The month total, recomputed whenever the records change.
 */
function computeMonthlyTokens(records: TranslationUsageRecord[]): number {
  return records
    .filter(record => isCurrentMonth(record.date) && !record.cached)
    .reduce((total, record) => total + record.usage.totalTokens, 0);
}

/**
 * Whether two lists hold the same records in the same order.
 */
function sameRecords(
  a: TranslationUsageRecord[],
  b: TranslationUsageRecord[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((record, index) => record === b[index]);
}

/**
 * Drop the records that the history was cleared of.
 *
 * The comparison is strict: a record recorded at the very moment of the
 * clear is treated as cleared too. The user's intent — "erase my history" —
 * wins the tie, and a record from another context that lands in the same
 * millisecond is one the user never saw anyway.
 */
function applyClearStamp(
  records: TranslationUsageRecord[],
  clearedAt: number
): TranslationUsageRecord[] {
  if (clearedAt <= 0) {
    return records;
  }
  return records.filter(record => record.timestamp > clearedAt);
}

// ==================== Chrome Local Storage Adapter ====================

/**
 * Read the snapshot currently stored under `name`.
 */
async function readStoredSnapshot(name: string): Promise<UsageSnapshot> {
  const empty: UsageSnapshot = { records: [], clearedAt: 0 };
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get([name]);
      return toSnapshot(result[name]);
    }
    const raw = localStorage.getItem(name);
    return raw ? toSnapshot(JSON.parse(raw)) : empty;
  } catch (error) {
    console.error('[UsageStore] read snapshot error:', error);
    return empty;
  }
}

/**
 * Serializes the read-modify-write cycle inside this context.
 *
 * Two translations can finish at nearly the same time, and each one writes
 * the history. Without a queue both would read the same stored snapshot and
 * the second write would drop the first one's record.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Write a snapshot by merging it into whatever is already stored.
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
  const version = isRecord(parsedValue)
    ? parsedValue['version']
    : USAGE_STORAGE_VERSION;

  const payload = {
    state: {
      records: merged.records,
      clearedAt: merged.clearedAt,
    },
    version: isFiniteNumber(version) ? version : USAGE_STORAGE_VERSION,
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [name]: payload });
    return;
  }
  localStorage.setItem(name, JSON.stringify(payload));
}

/**
 * Merge a freshly written snapshot into the stored one.
 *
 * The union of both, minus everything the history was cleared of.
 */
function mergeSnapshots(
  base: UsageSnapshot,
  incoming: UsageSnapshot
): UsageSnapshot {
  const clearedAt = Math.max(base.clearedAt, incoming.clearedAt);
  const records = applyClearStamp(
    unionRecords(base.records, incoming.records),
    clearedAt
  );
  return { records: capRecords(sortRecords(records)), clearedAt };
}

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
      await writeMergedSnapshot(name, parsed);
    } catch (error) {
      console.error('[UsageStore] setItem error:', error);
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
      clearedAt: 0,

      addRecord: partial => {
        const record: TranslationUsageRecord = {
          ...partial,
          id: nextRecordId(),
          timestamp: nextTimestamp(),
          date: todayString(),
        };

        set(state => {
          // 最多保留 500 条记录（LRU 淘汰旧记录）
          const newRecords = capRecords(
            sortRecords(unionRecords(state.records, [record]))
          );

          return {
            records: newRecords,
            monthlyTokens: computeMonthlyTokens(newRecords),
          };
        });
      },

      getDailyStats: (days = 30) => {
        const { records } = get();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = formatLocalDate(cutoff);

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

      clearAll: () => {
        set(state => {
          const clearedAt = nextClearStamp(state.clearedAt, state.records);
          return { records: [], clearedAt, monthlyTokens: 0 };
        });
        // Records this context never saw still live in storage; sweep them
        // separately so "clear" really clears.
        void clearStoredRecords();
      },
    }),
    {
      name: USAGE_STORAGE_KEY,
      storage: createJSONStorage(() => chromeLocalStorage),
      version: USAGE_STORAGE_VERSION,
      // The persisted shape is the records plus the clear stamp, so the
      // month total is recomputed from them instead of being stored twice.
      partialize: state => ({
        records: state.records,
        clearedAt: state.clearedAt,
      }),
      merge: (persistedState, currentState) => {
        const snapshot = toSnapshot(persistedState);
        const records = applyClearStamp(snapshot.records, snapshot.clearedAt);
        return {
          ...currentState,
          records,
          clearedAt: snapshot.clearedAt,
          monthlyTokens: computeMonthlyTokens(records),
        };
      },
    }
  )
);

/**
 * The moment the history was cleared.
 *
 * The stamp has to be newer than every record the user can see, so that the
 * deletion also covers the ones another tab wrote after this context last
 * looked.
 */
function nextClearStamp(
  previousClearedAt: number,
  records: TranslationUsageRecord[]
): number {
  let clearedAt = Math.max(previousClearedAt, nextTimestamp());
  for (const record of records) {
    if (record.timestamp >= clearedAt) {
      clearedAt = record.timestamp + 1;
    }
  }
  // Keep this context's clock ahead of the stamp, so the next record it
  // writes is not treated as part of the deleted history.
  lastTimestamp = Math.max(lastTimestamp, clearedAt);
  return clearedAt;
}

// ==================== External Storage Change Listener ====================

/**
 * Clear every record currently in storage.
 *
 * Runs after `clearAll()`: the local store only knows about the records
 * this context has seen, so the rest has to be swept explicitly.
 */
async function clearStoredRecords(): Promise<void> {
  try {
    const current = await readStoredSnapshot(USAGE_STORAGE_KEY);
    // The stamp has to cover the records this context has not seen yet —
    // another tab may have written some after the local clear.
    const clearedAt = nextClearStamp(current.clearedAt, current.records);
    await writeMergedSnapshot(USAGE_STORAGE_KEY, {
      state: { records: [], clearedAt },
      version: USAGE_STORAGE_VERSION,
    });
    // Keep the local stamp in step with the stored one. If the two disagree,
    // the store keeps re-writing the difference and the two contexts end
    // up with different ideas about what has been deleted.
    const local = useUsageStore.getState();
    if (local.clearedAt < clearedAt) {
      useUsageStore.setState({ clearedAt });
    }
  } catch (error) {
    console.error('[UsageStore] clear stored records error:', error);
  }
}

/**
 * Guards against re-entering the listener while an external snapshot is
 * being applied.
 */
let isApplyingExternal = false;

function applyExternalSnapshot(snapshot: UsageSnapshot): void {
  if (isApplyingExternal) {
    return;
  }
  isApplyingExternal = true;
  try {
    const state = useUsageStore.getState();
    const clearedAt = Math.max(state.clearedAt, snapshot.clearedAt);
    const merged = capRecords(
      sortRecords(
        applyClearStamp(
          unionRecords(state.records, snapshot.records),
          clearedAt
        )
      )
    );

    // Nothing new arrived: do not touch the state, and therefore do not
    // write back. Writing back on every echo is what turns a merge into a
    // storage write loop.
    if (sameRecords(state.records, merged) && state.clearedAt === clearedAt) {
      return;
    }

    useUsageStore.setState({
      records: merged,
      clearedAt,
      monthlyTokens: computeMonthlyTokens(merged),
    });
  } finally {
    isApplyingExternal = false;
  }
}

type StorageChange = {
  [key: string]: { newValue?: unknown };
};

let storageListener:
  | ((changes: StorageChange, areaName: string) => void)
  | null = null;

/**
 * Fold in what the other extension contexts recorded.
 *
 * Called when the module loads. It is exported so a context that installs
 * its storage listener later — a test harness, for instance — can arm it
 * afterwards; calling it twice is harmless.
 */
export function startUsageStoreSync(): void {
  if (storageListener) {
    return;
  }
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return;
  }
  storageListener = (changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    const usageChange = changes[USAGE_STORAGE_KEY];
    if (!usageChange) {
      return;
    }
    const newValue = usageChange.newValue;
    if (!newValue) {
      // The whole key was removed; nothing to merge.
      return;
    }
    applyExternalSnapshot(toSnapshot(newValue));
  };
  chrome.storage.onChanged.addListener(storageListener);
}

// Initialize listener on module load (once)
startUsageStoreSync();

// ==================== 便捷 Selector Hooks ====================
