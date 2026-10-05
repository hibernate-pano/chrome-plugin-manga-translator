/**
 * `BackgroundJobQueue.jobs` is the status ledger read via `getJob()`. Before
 * v1.4.0 nothing ever removed entries from it, so a session that translated a
 * few thousand images retained one record per image for the lifetime of the
 * service worker.
 */
import { describe, expect, it } from 'vitest';

import { BackgroundJobQueue, createJobStatus } from './job-queue';

function jobArgs(index: number | string) {
  return createJobStatus({
    jobId: `job-${index}`,
    pageKey: `page-${index}`,
    priorityClass: 'visible-now',
    requestedPath: 'plugin-direct',
    scope: 'page',
  });
}

describe('job record retention', () => {
  it('keeps a recently completed job queryable', async () => {
    const queue = new BackgroundJobQueue(4, 0);
    await queue.enqueue({ job: jobArgs(1), run: async () => 'ok' });
    expect(queue.getJob('job-1')).toBeDefined();
  });

  it('does not grow without bound across many translations', async () => {
    const queue = new BackgroundJobQueue(8, 0);
    for (let i = 0; i < 620; i += 1) {
      await queue.enqueue({ job: jobArgs(i), run: async () => i });
    }
    expect(queue.getJob('job-619')).toBeDefined();
    // The oldest records are the ones dropped.
    expect(queue.getJob('job-0')).toBeUndefined();
  }, 30000);

  it('never prunes a job that is still running', async () => {
    const queue = new BackgroundJobQueue(1, 0);
    let release: (value: string) => void = () => undefined;
    const gate = new Promise<string>(resolve => {
      release = resolve;
    });
    const running = queue.enqueue({
      job: jobArgs('running'),
      run: () => gate,
    });
    await Promise.resolve();
    expect(queue.getJob('job-running')?.state).toBe('running');
    // Flood the queue with completed work so pruning kicks in.
    for (let i = 0; i < 600; i += 1) {
      void queue.enqueue({
        job: jobArgs(`filler-${i}`),
        run: async () => i,
      });
    }
    expect(queue.getJob('job-running')?.state).toBe('running');
    release('done');
    await running;
  }, 30000);
});
