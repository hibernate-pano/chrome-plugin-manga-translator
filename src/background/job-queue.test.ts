import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackgroundJobQueue, createJobStatus } from './job-queue';

describe('BackgroundJobQueue', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('allows dynamic updates of max concurrent Limit', async () => {
    const queue = new BackgroundJobQueue(1);
    const order: string[] = [];
    let resolveFirst: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'page-1',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        order.push('first');
        await new Promise<void>(resolve => {
          resolveFirst = resolve;
        });
        return 'first';
      },
    });

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(order).toEqual(['first']);

    // 此时并发度为 1 且正在被 first 占用，第二个任务 pending
    const second = queue.enqueue({
      job: createJobStatus({
        jobId: 'second',
        pageKey: 'page-2',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        order.push('second');
        return 'second';
      },
    });

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(order).toEqual(['first']); // second 依然排队中

    // 动态调整并发上限为 2
    queue.updateMaxConcurrent(2);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(order).toEqual(['first', 'second']); // second 应当立刻开工

    if (resolveFirst) {
      resolveFirst();
    }
    await Promise.all([first, second]);
  });

  it('allows high-priority jobs to preempt and run concurrently when all active jobs are low-priority', async () => {
    const queue = new BackgroundJobQueue(1);
    const running: string[] = [];
    let resolveLow: (() => void) | undefined;

    const lowJob = queue.enqueue({
      job: createJobStatus({
        jobId: 'low-1',
        pageKey: 'page-low',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('low-1');
        await new Promise<void>(resolve => {
          resolveLow = resolve;
        });
        return 'low-1';
      },
    });

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(running).toEqual(['low-1']);

    // 高优先级任务
    const highJob = queue.enqueue({
      job: createJobStatus({
        jobId: 'high-1',
        pageKey: 'page-high',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('high-1');
        return 'high-1';
      },
    });

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    // 应当由于 VIP 抢占而同时运行
    expect(running).toEqual(['low-1', 'high-1']);

    if (resolveLow) {
      resolveLow();
    }
    await Promise.all([lowJob, highJob]);
  });

  it('fills available concurrency slots as soon as scheduling allows', async () => {
    vi.useFakeTimers();

    const queue = new BackgroundJobQueue(2, 0);
    const running: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'page-1',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('first');
        await new Promise<void>(resolve => {
          releaseFirst = resolve;
        });
        return 'first';
      },
    });

    const second = queue.enqueue({
      job: createJobStatus({
        jobId: 'second',
        pageKey: 'page-2',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('second');
        await new Promise<void>(resolve => {
          releaseSecond = resolve;
        });
        return 'second';
      },
    });

    await vi.runAllTimersAsync();
    expect(running).toEqual(['first', 'second']);

    if (releaseFirst) {
      releaseFirst();
    }
    if (releaseSecond) {
      releaseSecond();
    }
    await Promise.all([first, second]);
  });

  it('keeps filling concurrency under a request interval throttle', async () => {
    vi.useFakeTimers();

    const queue = new BackgroundJobQueue(2, 100);
    const running: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'page-1',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('first');
        await new Promise<void>(resolve => {
          releaseFirst = resolve;
        });
        return 'first';
      },
    });

    const second = queue.enqueue({
      job: createJobStatus({
        jobId: 'second',
        pageKey: 'page-2',
        priorityClass: 'warm-cache',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('second');
        await new Promise<void>(resolve => {
          releaseSecond = resolve;
        });
        return 'second';
      },
    });

    expect(running).toEqual(['first']);

    await vi.advanceTimersByTimeAsync(100);
    expect(running).toEqual(['first', 'second']);

    if (releaseFirst) {
      releaseFirst();
    }
    if (releaseSecond) {
      releaseSecond();
    }
    await Promise.all([first, second]);
  });
});
