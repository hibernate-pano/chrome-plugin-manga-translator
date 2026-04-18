/**
 * Cache Store v2 Tests
 *
 * Tests for translation result caching
 * Validates: Requirements 9.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTranslationCacheStore, calculateImageHash } from './cache-v2';
import type { TranslationResult } from './cache-v2';

describe('TranslationCacheStore', () => {
  beforeEach(() => {
    // Clear cache and reset maxEntries before each test
    const store = useTranslationCacheStore.getState();
    store.clear();
    store.setMaxEntries(100); // Reset to default
  });

  describe('Basic Operations', () => {
    it('should start with empty cache', () => {
      const stats = useTranslationCacheStore.getState().getStats();
      expect(stats.entryCount).toBe(0);
    });

    it('should store and retrieve translation result', () => {
      const store = useTranslationCacheStore.getState();
      const hash = 'test-hash-123';
      const result: TranslationResult = {
        success: true,
        textAreas: [
          {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.1,
            originalText: '原文',
            translatedText: '翻译',
          },
        ],
      };

      store.set(hash, result, 'openai');

      const cached = useTranslationCacheStore.getState().get(hash);
      expect(cached).not.toBeNull();
      expect(cached?.success).toBe(true);
      expect(cached?.textAreas).toHaveLength(1);
      expect(cached?.cached).toBe(true); // Should be marked as cached
    });

    it('should return null for non-existent hash', () => {
      const store = useTranslationCacheStore.getState();
      const cached = store.get('non-existent-hash');
      expect(cached).toBeNull();
    });

    it('should check if hash exists', () => {
      const store = useTranslationCacheStore.getState();
      const hash = 'test-hash-456';

      expect(store.has(hash)).toBe(false);

      store.set(hash, { success: true, textAreas: [] }, 'claude');

      expect(useTranslationCacheStore.getState().has(hash)).toBe(true);
    });

    it('should remove specific entry', () => {
      const store = useTranslationCacheStore.getState();
      const hash = 'test-hash-789';

      store.set(hash, { success: true, textAreas: [] }, 'deepseek');
      expect(useTranslationCacheStore.getState().has(hash)).toBe(true);

      store.remove(hash);
      expect(useTranslationCacheStore.getState().has(hash)).toBe(false);
    });

    it('should clear all entries', () => {
      const store = useTranslationCacheStore.getState();

      store.set('hash1', { success: true, textAreas: [] }, 'openai');
      store.set('hash2', { success: true, textAreas: [] }, 'claude');
      store.set('hash3', { success: true, textAreas: [] }, 'deepseek');

      expect(useTranslationCacheStore.getState().getStats().entryCount).toBe(3);

      store.clear();

      expect(useTranslationCacheStore.getState().getStats().entryCount).toBe(0);
    });
  });

  describe('Cache Statistics', () => {
    it('should track entry count', () => {
      const store = useTranslationCacheStore.getState();

      store.set('hash1', { success: true, textAreas: [] }, 'openai');
      store.set('hash2', { success: true, textAreas: [] }, 'claude');

      const stats = useTranslationCacheStore.getState().getStats();
      expect(stats.entryCount).toBe(2);
    });

    it('should track oldest and newest entries', () => {
      const store = useTranslationCacheStore.getState();

      store.set('hash1', { success: true, textAreas: [] }, 'openai');

      // Small delay to ensure different timestamps
      const stats = useTranslationCacheStore.getState().getStats();
      expect(stats.oldestEntry).not.toBeNull();
      expect(stats.newestEntry).not.toBeNull();
      if (stats.newestEntry === null) {
        throw new Error('Expected newestEntry to be available');
      }
      expect(stats.oldestEntry).toBeLessThanOrEqual(stats.newestEntry);
    });
  });

  describe('Cache Eviction', () => {
    it('should evict oldest entries when exceeding maxEntries', () => {
      const store = useTranslationCacheStore.getState();

      // Set a small max for testing
      store.setMaxEntries(3);

      // Add 5 entries
      for (let i = 0; i < 5; i++) {
        store.set(`hash-${i}`, { success: true, textAreas: [] }, 'openai');
      }

      const stats = useTranslationCacheStore.getState().getStats();
      expect(stats.entryCount).toBe(3);

      // Oldest entries should be evicted
      expect(useTranslationCacheStore.getState().has('hash-0')).toBe(false);
      expect(useTranslationCacheStore.getState().has('hash-1')).toBe(false);

      // Newest entries should remain
      expect(useTranslationCacheStore.getState().has('hash-4')).toBe(true);
    });

    it('should cleanup when maxEntries is reduced', () => {
      const store = useTranslationCacheStore.getState();

      // Add entries with default max
      for (let i = 0; i < 10; i++) {
        store.set(`hash-${i}`, { success: true, textAreas: [] }, 'openai');
      }

      expect(useTranslationCacheStore.getState().getStats().entryCount).toBe(
        10
      );

      // Reduce max entries
      store.setMaxEntries(5);

      expect(useTranslationCacheStore.getState().getStats().entryCount).toBe(5);
    });
  });

  describe('Provider Tracking', () => {
    it('should store provider information with cache entry', () => {
      const store = useTranslationCacheStore.getState();
      const hash = 'provider-test-hash';

      store.set(hash, { success: true, textAreas: [] }, 'claude');

      // Access internal state to verify provider is stored
      const state = useTranslationCacheStore.getState();
      const entries = state.entries();
      const entry = entries.find(([key]) => key === hash)?.[1];
      expect(entry?.provider).toBe('claude');
    });
  });
});

describe('calculateImageHash', () => {
  it('should generate consistent hash for same input', async () => {
    const imageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

    const hash1 = await calculateImageHash(imageData);
    const hash2 = await calculateImageHash(imageData);

    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different inputs', async () => {
    const hash1 = await calculateImageHash('image-data-1');
    const hash2 = await calculateImageHash('image-data-2');

    expect(hash1).not.toBe(hash2);
  });

  it('should return non-empty hash', async () => {
    const hash = await calculateImageHash('test-image-data');

    expect(hash).toBeTruthy();
    expect(hash.length).toBeGreaterThan(0);
  });
});
