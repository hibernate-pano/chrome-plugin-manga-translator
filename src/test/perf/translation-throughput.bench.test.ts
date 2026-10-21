/**
 * P4 perf baseline: translation throughput micro-bench
 *
 * Measures processInParallel throughput with a mock async processor.
 * Goal: establish a stable baseline so subsequent P4 commits can detect
 * regressions in scheduling overhead.
 *
 * These are best-effort micro-benchmarks; thresholds use 2-3x safety
 * margin to avoid CI flakes on slower machines.
 */

import { describe, it, expect } from 'vitest';
import { processInParallel } from '@/utils/image-priority';

function makeItems<T>(n: number, factory: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => factory(i));
}

describe('P4 perf: processInParallel throughput', () => {
  it('processes 30 items with 30ms each @ concurrency 3 within 3x of ideal', async () => {
    // Ideal: ceil(30/3) * 30ms = 300ms
    // Real: scheduling overhead + microtask queue = ~1.2x typical
    const items = makeItems(30, i => i);
    const start = performance.now();
    await processInParallel(
      items,
      async () => {
        await new Promise(r => setTimeout(r, 30));
      },
      { maxConcurrent: 3 }
    );
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(900); // 3x ideal
  });

  it('handles 100 items without dropping or duplicating results', async () => {
    const items = makeItems(100, i => i);
    const results = await processInParallel(
      items,
      async (item: number) => {
        await new Promise(r => setTimeout(r, 1));
        return item * 2;
      },
      { maxConcurrent: 5 }
    );
    expect(results).toHaveLength(100);
    for (let i = 0; i < 100; i++) {
      expect(results[i]).toBe(i * 2);
    }
  });

  it('respects abort signal: cancels mid-flight work', async () => {
    const controller = new AbortController();
    const items = makeItems(50, i => i);
    setTimeout(() => controller.abort(), 30);

    let processed = 0;
    await processInParallel(
      items,
      async () => {
        await new Promise(r => setTimeout(r, 10));
        processed++;
      },
      { maxConcurrent: 5, signal: controller.signal }
    );

    // After abort, no more items should be picked up
    expect(processed).toBeLessThan(50);
  });
});
