import { beforeEach, describe, expect, it } from 'vitest';

import { useTranslationCacheStore, type TranslationResult } from './cache-v2';

function makeResult(text = 'translated'): TranslationResult {
  return {
    textAreas: [
      {
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.1,
        originalText: 'original',
        translatedText: text,
      },
    ],
    pipeline: 'full-image-vlm',
  } as unknown as TranslationResult;
}

describe('translation cache store', () => {
  beforeEach(() => {
    useTranslationCacheStore.getState().clear();
  });

  it('set and get round-trip a result by image hash', () => {
    const store = useTranslationCacheStore.getState();
    store.set('hash-1', makeResult('hello'), 'openai-compatible');

    expect(store.has('hash-1')).toBe(true);
    expect(store.get('hash-1')?.textAreas[0]?.translatedText).toBe('hello');
  });

  it('get returns null for unknown hashes', () => {
    expect(useTranslationCacheStore.getState().get('missing')).toBeNull();
  });

  it('remove and clear drop entries', () => {
    const store = useTranslationCacheStore.getState();
    store.set('hash-1', makeResult(), 'openai-compatible');
    store.remove('hash-1');
    expect(store.has('hash-1')).toBe(false);

    store.set('hash-2', makeResult(), 'ollama');
    store.clear();
    expect(store.getStats().entryCount).toBe(0);
  });

  it('getStats reports entry counts and timestamps', () => {
    const store = useTranslationCacheStore.getState();
    store.set('hash-1', makeResult(), 'openai-compatible');
    store.set('hash-2', makeResult(), 'openai-compatible');

    const stats = store.getStats();
    expect(stats.entryCount).toBe(2);
    expect(stats.maxEntries).toBe(100);
    expect(stats.oldestEntry).toBeTypeOf('number');
    expect(stats.newestEntry).toBeTypeOf('number');
  });

  it('cleanup keeps the newest entries within maxEntries', () => {
    const store = useTranslationCacheStore.getState();
    store.setMaxEntries(3);
    for (let index = 0; index < 5; index += 1) {
      store.set(`hash-${index}`, makeResult(String(index)), 'ollama');
    }

    const stats = store.getStats();
    expect(stats.entryCount).toBe(3);
    expect(store.has('hash-0')).toBe(false);
    expect(store.has('hash-4')).toBe(true);
  });

  it('entries exposes the raw cache for debugging', () => {
    const store = useTranslationCacheStore.getState();
    store.set('hash-1', makeResult(), 'lm-studio');
    const entries = store.entries();
    expect(entries).toHaveLength(1);
    const first = entries[0];
    expect(first?.[0]).toBe('hash-1');
    expect(first?.[1].provider).toBe('lm-studio');
  });
});
