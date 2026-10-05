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
    const statesDuringRun: Array<string | undefined> = [];

    const result = await queue.enqueue({
      job: createJobStatus({
        jobId: 'job-1',
        pageKey: 'page-1',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        // Sampled from inside the work, because the old assertion read the
        // state after the promise had already settled — which said nothing
        // about transitions and passed even if the queue never marked a job
        // queued or running at all.
        statesDuringRun.push(queue.getJob('job-1')?.state);
        await new Promise<void>(r => setTimeout(r, 0));
        statesDuringRun.push(queue.getJob('job-1')?.state);
        return 'done';
      },
    });

    expect(result).toBe('done');
    expect(statesDuringRun).toEqual(['running', 'running']);
    // The terminal state is written in the run's `finally`, which runs after
    // the promise resolves, so it needs a tick before it is observable.
    await new Promise<void>(r => setTimeout(r, 0));
    expect(queue.getJob('job-1')?.state).toBe('succeeded');
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

  it('runs jobs with distinct pageKeys independently without collapsing', async () => {
    // Guarantees the translator's per-image pageKey fix: concurrent Korean
    // webtoon images (distinct imageKeys) must NOT collapse into one job.
    const queue = new BackgroundJobQueue(2);

    const results = await Promise.all([
      queue.enqueue({
        job: createJobStatus({
          jobId: 'img-a',
          pageKey: 'img-a',
          priorityClass: 'visible-now',
          requestedPath: 'plugin-direct',
          scope: 'page',
        }),
        run: async () => 'result-a',
      }),
      queue.enqueue({
        job: createJobStatus({
          jobId: 'img-b',
          pageKey: 'img-b',
          priorityClass: 'visible-now',
          requestedPath: 'plugin-direct',
          scope: 'page',
        }),
        run: async () => 'result-b',
      }),
    ]);

    expect(results).toEqual(['result-a', 'result-b']);
  });

  it('collapses a queued job sharing the same pageKey as a running one', async () => {
    // The dedup guard: a repeat request for the SAME translation unit
    // (same key) double-pays the provider, so it collapses onto the running
    // job. Distinct keys must never collapse.
    const queue = new BackgroundJobQueue(1);
    let release: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'same-img',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        await new Promise<void>(r => {
          release = r;
        });
        return 'first';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));

    const second = queue.enqueue({
      job: createJobStatus({
        jobId: 'second',
        pageKey: 'same-img',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'second',
    });

    release?.();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe('first');
    expect(b).toBe('first'); // collapsed onto the running job; 'second' never ran
  });

  it('does not collapse a forced job onto an in-flight same-key job', async () => {
    // A retry the user asked for must actually re-run. Collapsing it onto the
    // in-flight job would hand back the stale result and make retry a no-op.
    const queue = new BackgroundJobQueue(2);
    let release: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'same-img',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        await new Promise<void>(r => {
          release = r;
        });
        return 'first';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));

    const forced = queue.enqueue({
      job: createJobStatus({
        jobId: 'forced',
        pageKey: 'same-img',
        priorityClass: 'manual-retry',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      forceRefresh: true,
      run: async () => 'forced',
    });

    release?.();
    expect(await first).toBe('first');
    expect(await forced).toBe('forced');
  });

  it('still runs queued jobs when the concurrency limit is not a positive number', async () => {
    // A corrupt parallelLimit of 0 made `activeCount >= limit` permanently
    // true, so drain() re-armed setTimeout(0) forever and nothing progressed.
    const queue = new BackgroundJobQueue(0);
    queue.updateMaxConcurrent(0);

    const ran: string[] = [];
    const jobs = ['a', 'b', 'c'].map(key =>
      queue.enqueue({
        job: createJobStatus({
          jobId: key,
          pageKey: key,
          priorityClass: 'visible-now',
          requestedPath: 'plugin-direct',
          scope: 'page',
        }),
        run: async () => {
          ran.push(key);
          return key;
        },
      })
    );

    await expect(Promise.all(jobs)).resolves.toEqual(['a', 'b', 'c']);
    expect(ran).toEqual(['a', 'b', 'c']);
  });

  it('a completed forced job does not unmap the dedup entry it superseded', async () => {
    // The forced job and the original share a pageKey. When the original
    // settles it must clear only its own entry: an unconditional delete would
    // strip the still-running forced job and let a later duplicate re-pay.
    const queue = new BackgroundJobQueue(2);
    let releaseFirst: (() => void) | undefined;
    let releaseForced: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'same-img',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        await new Promise<void>(r => {
          releaseFirst = r;
        });
        return 'first';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));

    const forced = queue.enqueue({
      job: createJobStatus({
        jobId: 'forced',
        pageKey: 'same-img',
        priorityClass: 'manual-retry',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      forceRefresh: true,
      run: async () => {
        await new Promise<void>(r => {
          releaseForced = r;
        });
        return 'forced';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));
    releaseFirst?.();
    expect(await first).toBe('first');

    // The original is done but the forced job is still in flight, so a
    // duplicate must collapse onto it rather than start a third call.
    const duplicate = queue.enqueue({
      job: createJobStatus({
        jobId: 'duplicate',
        pageKey: 'same-img',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'duplicate',
    });

    releaseForced?.();
    expect(await Promise.all([forced, duplicate])).toEqual([
      'forced',
      'forced',
    ]);
  });
});
