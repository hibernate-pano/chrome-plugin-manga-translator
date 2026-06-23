import { TranslationErrorCode } from '@/utils/error-handler';

const STORAGE_KEY = 'manga-translator-error-stats';

export type ErrorStats = Partial<Record<TranslationErrorCode, number>>;

export async function incrementErrorStats(
  code: TranslationErrorCode
): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const counts: ErrorStats =
    (result[STORAGE_KEY] as ErrorStats | undefined) ?? {};
  counts[code] = (counts[code] ?? 0) + 1;
  await chrome.storage.local.set({ [STORAGE_KEY]: counts });
}

export async function getErrorStats(): Promise<ErrorStats> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ErrorStats | undefined) ?? {};
}

export async function clearErrorStats(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
