import { describe, expect, it } from 'vitest';

import { BackgroundJobQueue, createJobStatus } from './job-queue';

describe('BackgroundJobQueue', () => {
  it('prioritizes visible-now over warm-cache', async () => {
    const queue = new BackgroundJobQueue(1);
    const order: string[] = [];
    let releaseBlocker: (() => void) | undefined;

    const blocker = queue.enqueue({
      job: createJobStatus({
        jobId: 'blocker',
        pageKey: 'blocker',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        order.push('blocker');
        await new Promise<void>(resolve => {
          releaseBlocker = resolve;
        });
        return 'blocker';
      },
    });

    const warm = queue.enqueue({
      job: createJobStatus({
        jobId: 'warm',
        pageKey: 'warm',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        order.push('warm');
        return 'warm';
      },
    });

    const visible = queue.enqueue({
      job: createJobStatus({
        jobId: 'visible',
        pageKey: 'visible',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        order.push('visible');
        return 'visible';
      },
    });

    if (releaseBlocker) {
      releaseBlocker();
    }
    await Promise.all([blocker, warm, visible]);
    expect(order).toEqual(['blocker', 'visible', 'warm']);
  });

  it('updates job state as work progresses', async () => {
    const queue = new BackgroundJobQueue(1);

    const result = await queue.enqueue({
      job: createJobStatus({
        jobId: 'job-1',
        pageKey: 'page-1',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'done',
    });

    expect(result).toBe('done');
    expect(queue.getJob('job-1')?.state).toBe('running');
  });
});
