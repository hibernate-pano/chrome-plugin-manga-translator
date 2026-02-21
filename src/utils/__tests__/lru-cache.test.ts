/**
 * LRU Cache Tests
 */

import { LRUCache } from '../lru-cache';

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache<string, number>(3);
  });

  test('should store and retrieve values', () => {
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBeUndefined();
  });

  test('should evict least recently used items when full', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // Should evict 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  test('should update LRU order on access', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to make it most recently used
    cache.get('a');

    // Add new item, should evict 'b' (least recently used)
    cache.set('d', 4);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  test('should handle has() correctly', () => {
    cache.set('a', 1);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  test('should handle delete() correctly', () => {
    cache.set('a', 1);
    cache.set('b', 2);

    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('c')).toBe(false);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  test('should clear all items', () => {
    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  test('should provide correct statistics', () => {
    cache.set('a', 1);
    cache.set('b', 2);

    const stats = cache.getStats();

    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(3);
    expect(stats.utilizationPercent).toBe((2 / 3) * 100);
  });

  test('should iterate over entries in LRU order', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Access 'a' to make it most recently used
    cache.get('a');

    const entries = Array.from(cache.entries());

    // Should be in order: b (oldest), c, a (newest)
    expect(entries).toEqual([
      ['b', 2],
      ['c', 3],
      ['a', 1],
    ]);
  });
});