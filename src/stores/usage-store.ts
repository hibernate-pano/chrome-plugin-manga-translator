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
  /**
   * Whether this call is already counted in an accumulator.
   *
   * The accumulator is what the monthly summary reads, so a record that is
   * counted there must not be counted a second time from the detail list.
   * Records written before the accumulator existed do not carry the flag, and
   * they are exactly the ones the seed entry takes over.
   */
  accumulated?: boolean;
  /**
   * The running totals of the calls this context made.
   *
   * Only the synthetic accumulator records carry it. They are what keeps the
   * monthly total exact once the detail list starts dropping records.
   */
  accumulator?: UsageAccumulator;
}

/**
 * The totals of one day.
 */
export interface DailyUsageSummary {
  date: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  translationCount: number;
  cachedCount: number;
  providers: Partial<Record<ProviderType, number>>;
}

/**
 * The running totals of one context.
 *
 * The accumulator is the reason the monthly bill is a number the user can
 * trust: it counts every call the moment it happens, while the detail list
 * behind it is allowed to forget.
 */
export interface UsageAccumulator {
  /** 每个自然日的用量（YYYY-MM-DD） */
  byDay: Record<string, DailyUsageSummary>;
  /**
   * The clear stamp this accumulator was written at.
   *
   * An accumulator that was last written before the history was cleared
   * carries counts the user asked to forget, so it is dropped when the
   * snapshot is merged.
   */
  clearedAt: number;
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

/**
 * Is this record one of the synthetic accumulator records?
 */
function isAccumulator(record: TranslationUsageRecord): boolean {
  return record.accumulator !== undefined;
}

/**
 * The id prefix every accumulator record carries.
 */
const ACCUMULATOR_ID_PREFIX = 'acc-';

/**
 * The id of the entry that takes over the calls recorded before the
 * accumulator existed.
 *
 * It is deliberately *not* per-context: the calls it covers are the ones
 * every context can see, so exactly one entry may account for them. A
 * per-context id would let two tabs each claim the same history.
 */
const LEGACY_SEED_ID = 'acc-seed';

function createDaySummary(date: string): DailyUsageSummary {
  return {
    date,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    translationCount: 0,
    cachedCount: 0,
    providers: {},
  };
}

/**
 * Fold one call into a day's totals.
 */
function applyRecordToDay(
  day: DailyUsageSummary,
  record: TranslationUsageRecord
): DailyUsageSummary {
  const next: DailyUsageSummary = {
    ...day,
    providers: { ...day.providers },
  };
  next.translationCount += 1;
  if (record.cached) {
    next.cachedCount += 1;
    return next;
  }
  next.totalTokens += record.usage.totalTokens;
  next.promptTokens += record.usage.promptTokens;
  next.completionTokens += record.usage.completionTokens;
  next.providers[record.provider] = (next.providers[record.provider] || 0) + 1;
  return next;
}

/**
 * Add two days' totals together.
 *
 * Two accumulators can cover the same day — the seed entry accounts for the
 * calls made before the accumulator existed, while a context's own
 * accumulator accounts for the ones made after — and the day is the sum of
 * both.
 */
function mergeDaySummaries(
  base: DailyUsageSummary,
  incoming: DailyUsageSummary
): DailyUsageSummary {
  const providers = { ...base.providers };
  for (const [provider, count] of Object.entries(incoming.providers)) {
    const key = provider as ProviderType;
    providers[key] = (providers[key] || 0) + (count || 0);
  }
  return {
    date: base.date,
    totalTokens: base.totalTokens + incoming.totalTokens,
    promptTokens: base.promptTokens + incoming.promptTokens,
    completionTokens: base.completionTokens + incoming.completionTokens,
    translationCount: base.translationCount + incoming.translationCount,
    cachedCount: base.cachedCount + incoming.cachedCount,
    providers,
  };
}

/**
 * The whole history, counted exactly once.
 *
 * The accumulators carry the calls; the detail records that no accumulator
 * covers are counted directly. A record that an accumulator already accounts
 * for is skipped, which is what keeps the two from adding up to twice the
 * calls the user made.
 */
function collectUsage(records: TranslationUsageRecord[]): {
  days: Map<string, DailyUsageSummary>;
  looseRecords: TranslationUsageRecord[];
} {
  const days = new Map<string, DailyUsageSummary>();
  const coveredDays = new Set<string>();

  for (const record of records) {
    if (!isAccumulator(record)) {
      continue;
    }
    const byDay = record.accumulator?.byDay ?? {};
    for (const [day, summary] of Object.entries(byDay)) {
      coveredDays.add(day);
      const existing = days.get(day);
      days.set(
        day,
        existing ? mergeDaySummaries(existing, summary) : { ...summary }
      );
    }
  }

  const looseRecords = records.filter(
    record => !isAccumulator(record) && !coveredDays.has(record.date)
  );

  return { days, looseRecords };
}

/**
 * 本月的用量汇总。
 *
 * 这个数字是用户唯一能看到的账，所以它必须是真的。明细记录只保留最近
 * 500 条，超过的部分由累加器（accumulator）记住：每发生一次调用就立刻
 * 累加一次，因此本月的调用次数和 token 不再被明细条数截断。
 */
export function summarizeUsageForMonth(
  records: TranslationUsageRecord[],
  now: Date = new Date()
): UsageOverview {
  const monthPrefix = formatLocalMonth(now);
  const { days, looseRecords } = collectUsage(records);

  let translations = 0;
  let billableCalls = 0;
  let cachedCalls = 0;
  let tokens = 0;

  for (const [day, summary] of days) {
    if (!day.startsWith(monthPrefix)) {
      continue;
    }
    translations += summary.translationCount;
    cachedCalls += summary.cachedCount;
    billableCalls += summary.translationCount - summary.cachedCount;
    tokens += summary.totalTokens;
  }

  for (const record of looseRecords) {
    if (!record.date.startsWith(monthPrefix)) {
      continue;
    }
    translations += 1;
    if (record.cached) {
      cachedCalls += 1;
    } else {
      billableCalls += 1;
      tokens += record.usage.totalTokens;
    }
  }

  return {
    translations,
    billableCalls,
    tokens,
    cacheHitRate:
      translations > 0 ? Math.round((cachedCalls / translations) * 100) : 0,
  };
}

// ==================== Accumulator ====================

/**
 * The id of the accumulator that holds a month's running totals.
 *
 * It used to carry a per-context id: every extension context counted its
 * own calls, and the summary added the accumulators up. The cost was that
 * the id changed every time a context started — the worker is torn down
 * after half a minute of idle and comes back with a new one, and every
 * page load is a new content script — so the list grew by one accumulator
 * per process start, month after month, and every single call rewrote all
 * of it.
 *
 * One accumulator per month is enough now, because there is exactly one
 * writer: the worker. The content script reports its cache hits to the
 * worker instead of writing them itself, so every count in the month lands
 * in the same record, and the worker reads what is already stored before it
 * writes — the merge keeps the newer copy, which is the one that includes
 * everything counted before it.
 */
function accumulatorId(month: string): string {
  return historyLoaded
    ? `${ACCUMULATOR_ID_PREFIX}${month}`
    : `${ACCUMULATOR_ID_PREFIX}early-${month}`;
}

/**
 * The month before the given one, as `YYYY-MM`.
 */
function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) {
    return month;
  }
  const firstOfPrevious = new Date(year, monthNumber - 2, 1);
  return formatLocalMonth(firstOfPrevious);
}

/**
 * Whether the stored history has been read into this context yet.
 *
 * A call can be recorded before the first read comes back — the worker
 * starts, a translation finishes, and the record is written while the
 * history is still on its way. The counts that are already stored are not
 * known at that point, so the accumulator gets its own id: the merge keeps
 * both and the summary adds them up, exactly as the old per-context ids
 * did. Once the history is in, everything lands in the month's own
 * accumulator.
 */
let historyLoaded = false;

/**
 * Drop the accumulators of the months nobody looks at any more.
 *
 * The summary reports the current month and the daily chart covers the
 * last thirty days, so the month before this one is the oldest one that can
 * still be read. Everything older is dead weight — and dead weight that
 * grows, because a record is never dropped on its own.
 */
function dropStaleAccumulators(
  records: TranslationUsageRecord[],
  now: Date = new Date()
): TranslationUsageRecord[] {
  const oldest = previousMonth(formatLocalMonth(now));
  return records.filter(
    record => !isAccumulator(record) || record.date.slice(0, 7) >= oldest
  );
}

function createAccumulatorRecord(args: {
  id: string;
  month: string;
  byDay: Record<string, DailyUsageSummary>;
  clearedAt: number;
  timestamp: number;
  provider: ProviderType;
}): TranslationUsageRecord {
  return {
    id: args.id,
    timestamp: args.timestamp,
    date: args.month,
    provider: args.provider,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cached: false,
    accumulator: { byDay: args.byDay, clearedAt: args.clearedAt },
  };
}

/**
 * Fold a call into the accumulator of the month it belongs to.
 *
 * The detail record is kept as well: it is what the user sees in the
 * history, and what the daily chart falls back to. The accumulator is what
 * survives the detail list being capped.
 */
function withAccumulator(
  records: TranslationUsageRecord[],
  record: TranslationUsageRecord,
  clearedAt: number
): TranslationUsageRecord[] {
  const month = record.date.slice(0, 7);
  const id = accumulatorId(month);
  const existing = records.find(entry => entry.id === id);
  const byDay = { ...(existing?.accumulator?.byDay ?? {}) };
  byDay[record.date] = applyRecordToDay(
    byDay[record.date] ?? createDaySummary(record.date),
    record
  );

  const accumulator = createAccumulatorRecord({
    id,
    month,
    byDay,
    clearedAt,
    timestamp: record.timestamp,
    provider: record.provider,
  });

  return [...records.filter(entry => entry.id !== id), accumulator];
}

/**
 * Account for the calls that were recorded before the accumulator existed.
 *
 * The seed entry is created once, from the history that is on disk, and it
 * is not per-context: those calls are the same calls for every tab, so
 * exactly one entry may claim them. Without it, a user who upgrades
 * mid-month would see the calls they made before the upgrade disappear from
 * the bill as soon as the accumulator for that month exists.
 */
function withLegacySeed(
  records: TranslationUsageRecord[],
  clearedAt: number
): TranslationUsageRecord[] {
  const legacy = records.filter(
    record => !isAccumulator(record) && record.accumulated !== true
  );
  if (legacy.length === 0) {
    return records;
  }

  const byMonth = new Map<string, Record<string, DailyUsageSummary>>();
  for (const record of legacy) {
    const month = record.date.slice(0, 7);
    const days = byMonth.get(month) ?? {};
    days[record.date] = applyRecordToDay(
      days[record.date] ?? createDaySummary(record.date),
      record
    );
    byMonth.set(month, days);
  }

  const seeds = [...byMonth.entries()]
    .filter(
      ([month]) =>
        !records.some(entry => entry.id === `${LEGACY_SEED_ID}-${month}`)
    )
    .map(([month, byDay]) =>
      createAccumulatorRecord({
        id: `${LEGACY_SEED_ID}-${month}`,
        month,
        byDay,
        clearedAt,
        timestamp: nextTimestamp(),
        provider: 'openai-compatible',
      })
    );

  return [...records, ...seeds];
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

  const accumulated = value['accumulated'] === true;
  const accumulator = normalizeAccumulator(value['accumulator']);

  return {
    id,
    timestamp,
    date,
    provider,
    usage: { promptTokens, completionTokens, totalTokens },
    cached,
    ...(accumulated ? { accumulated: true } : {}),
    ...(accumulator ? { accumulator } : {}),
  };
}

function toProviderCounts(
  value: unknown
): Partial<Record<ProviderType, number>> {
  const counts: Partial<Record<ProviderType, number>> = {};
  if (!isRecord(value)) {
    return counts;
  }
  for (const [provider, count] of Object.entries(value)) {
    if (isProviderType(provider) && isFiniteNumber(count)) {
      counts[provider] = count;
    }
  }
  return counts;
}

/**
 * Turn an untrusted stored accumulator into a usable one.
 *
 * A malformed accumulator is dropped rather than repaired: half a month of
 * totals is worse than none, because the summary would then under-report
 * the bill.
 */
function normalizeAccumulator(value: unknown): UsageAccumulator | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rawByDay = value['byDay'];
  if (!isRecord(rawByDay)) {
    return undefined;
  }
  const byDay: Record<string, DailyUsageSummary> = {};
  for (const [day, summary] of Object.entries(rawByDay)) {
    if (!isRecord(summary)) {
      continue;
    }
    const translationCount = summary['translationCount'];
    const cachedCount = summary['cachedCount'];
    const totalTokens = summary['totalTokens'];
    if (
      !isFiniteNumber(translationCount) ||
      !isFiniteNumber(cachedCount) ||
      !isFiniteNumber(totalTokens)
    ) {
      continue;
    }
    byDay[day] = {
      date: day,
      totalTokens,
      promptTokens: isFiniteNumber(summary['promptTokens'])
        ? (summary['promptTokens'] as number)
        : 0,
      providers: toProviderCounts(summary['providers']),
      completionTokens: isFiniteNumber(summary['completionTokens'])
        ? (summary['completionTokens'] as number)
        : 0,
      translationCount,
      cachedCount,
    };
  }
  const rawClearedAt = value['clearedAt'];
  return {
    byDay,
    clearedAt: isFiniteNumber(rawClearedAt) ? rawClearedAt : 0,
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
 *
 * An accumulator is the exception: its id is stable for the life of a
 * context, and every call adds to it, so the newer version is the one with
 * the larger total. Keeping the older one would drop calls that were
 * already counted.
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
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, record);
      continue;
    }
    if (isAccumulator(record) && record.timestamp > existing.timestamp) {
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
 * Keep the newest `MAX_RECORDS` detail records.
 *
 * The accumulators are not detail records and are never dropped here: they
 * are the running totals, and the whole point of them is that they outlive
 * the list they were counted from. They sit behind the details, so the
 * newest call is still the first entry of the list.
 *
 * The months nobody reads any more are dropped, though: an accumulator is
 * the one record that is never evicted, so without this the list would
 * grow by one entry per month, forever, and every call would rewrite all
 * of them.
 */
function capRecords(
  records: TranslationUsageRecord[],
  now: Date = new Date()
): TranslationUsageRecord[] {
  const accumulators = records.filter(record => isAccumulator(record));
  const details = records.filter(record => !isAccumulator(record));
  const cappedDetails =
    details.length <= MAX_RECORDS
      ? details
      : sortRecords(details).slice(0, MAX_RECORDS);
  return [
    ...sortRecords(cappedDetails),
    ...dropStaleAccumulators(accumulators, now),
  ];
}

/**
 * The month total, recomputed whenever the records change.
 */
function computeMonthlyTokens(records: TranslationUsageRecord[]): number {
  return summarizeUsageForMonth(records).tokens;
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
 *
 * An accumulator carries the clear stamp it was written at instead of its
 * timestamp: it is dropped when it was last written before the clear, which
 * is the same intent applied to the running totals.
 */
function applyClearStamp(
  records: TranslationUsageRecord[],
  clearedAt: number
): TranslationUsageRecord[] {
  if (clearedAt <= 0) {
    return records;
  }
  return records.filter(record => {
    if (isAccumulator(record)) {
      return (record.accumulator?.clearedAt ?? 0) >= clearedAt;
    }
    return record.timestamp > clearedAt;
  });
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
  return { records: capRecords(records), clearedAt };
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
          // The accumulator counts this call from now on, so the detail
          // record must not be counted a second time.
          accumulated: true,
        };

        set(state => {
          // 最多保留 500 条明细记录（LRU 淘汰旧记录）
          const merged = unionRecords(state.records, [record]);
          const withTotals = withAccumulator(merged, record, state.clearedAt);
          const newRecords = capRecords(withTotals);

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

        const addDay = (date: string, summary: DailyUsageSummary): void => {
          if (date < cutoffStr) return;
          const existing = byDate[date];
          byDate[date] = existing
            ? mergeDaySummaries(existing, summary)
            : { ...summary, date };
        };

        // 累加器里的每日合计
        const { days: accumulated, looseRecords } = collectUsage(records);
        for (const [date, summary] of accumulated) {
          addDay(date, summary);
        }

        // 没有被累加器覆盖的明细（升级前的历史）
        for (const record of looseRecords) {
          addDay(
            record.date,
            applyRecordToDay(createDaySummary(record.date), record)
          );
        }

        return Object.values(byDate).sort((a, b) =>
          b.date.localeCompare(a.date)
        );
      },

      getSummary: () => {
        const { records, monthlyTokens } = get();
        const { days, looseRecords } = collectUsage(records);

        let totalRecords = 0;
        let billableRecords = 0;
        let cachedRecords = 0;
        let totalTokens = 0;

        for (const summary of days.values()) {
          totalRecords += summary.translationCount;
          cachedRecords += summary.cachedCount;
          billableRecords += summary.translationCount - summary.cachedCount;
          totalTokens += summary.totalTokens;
        }

        for (const record of looseRecords) {
          totalRecords += 1;
          if (record.cached) {
            cachedRecords += 1;
          } else {
            billableRecords += 1;
            totalTokens += record.usage.totalTokens;
          }
        }

        return {
          totalRecords,
          totalTokens,
          monthlyTokens,
          avgTokensPerTranslation:
            billableRecords > 0 ? Math.round(totalTokens / billableRecords) : 0,
          cacheHitRate: totalRecords > 0 ? cachedRecords / totalRecords : 0,
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
      onRehydrateStorage: () => () => {
        // The stored history is in: from here on the counts of the month go
        // into the month's own accumulator.
        historyLoaded = true;
      },
      merge: (persistedState, currentState) => {
        const snapshot = toSnapshot(persistedState);
        // A call recorded before the history finished loading must not be
        // lost, so the two histories are merged instead of replaced.
        const merged = unionRecords(
          applyClearStamp(snapshot.records, snapshot.clearedAt),
          applyClearStamp(currentState.records, snapshot.clearedAt)
        );
        // The calls that were recorded before the accumulator existed are
        // taken over by the seed entry, so that dropping their details from
        // the list does not drop them from the bill.
        const records = capRecords(withLegacySeed(merged, snapshot.clearedAt));
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
      applyClearStamp(unionRecords(state.records, snapshot.records), clearedAt)
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
