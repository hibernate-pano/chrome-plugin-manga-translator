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

  it('borrows a slot for the image the reader is looking at', async () => {
    /*
     * 一个通道被「页面底下那张图」占着的时候，读者正盯着的那张图不该排在
     * 它后面 —— 借一个通道出来，它现在就能翻。
     *
     * 以前这条规则只认 `warm-cache` 和 `deferred-failure` 两个标记，而没有
     * 任何地方会产出它们，于是这个借通道的判断一次也没有成立过。
     */
    const queue = new BackgroundJobQueue(1);
    const running: string[] = [];
    let releaseLow: (() => void) | undefined;
    let releaseHigh: (() => void) | undefined;

    const low = queue.enqueue({
      job: createJobStatus({
        jobId: 'low',
        pageKey: 'low',
        priorityClass: 'next-up',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('low');
        await new Promise<void>(resolve => {
          releaseLow = resolve;
        });
        return 'low';
      },
    });

    const high = queue.enqueue({
      job: createJobStatus({
        jobId: 'high',
        pageKey: 'high',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        running.push('high');
        await new Promise<void>(resolve => {
          releaseHigh = resolve;
        });
        return 'high';
      },
    });

    // 两个任务都已经在跑了：底下那张还没翻完，眼前这张已经开始了。
    expect(running).toEqual(['low', 'high']);

    if (releaseLow) {
      releaseLow();
    }
    if (releaseHigh) {
      releaseHigh();
    }
    await Promise.all([low, high]);
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

  it('keeps dedup coverage when a forced retry finishes before the original', async () => {
    // Both jobs share a pageKey. If the retry resolving first left the
    // still-running original unmapped, a duplicate arriving in that window
    // started a third paid request for the same image.
    const queue = new BackgroundJobQueue(2);
    let releaseOriginal: (() => void) | undefined;
    let releaseRetry: (() => void) | undefined;

    const original = queue.enqueue({
      job: createJobStatus({
        jobId: 'original',
        pageKey: 'same-img',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        await new Promise<void>(r => {
          releaseOriginal = r;
        });
        return 'original';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));

    const retry = queue.enqueue({
      job: createJobStatus({
        jobId: 'retry',
        pageKey: 'same-img',
        priorityClass: 'manual-retry',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      forceRefresh: true,
      run: async () => {
        await new Promise<void>(r => {
          releaseRetry = r;
        });
        return 'retry';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));
    // The retry completes while the original is still in flight.
    releaseRetry?.();
    expect(await retry).toBe('retry');
    // The retry releases its dedup entry in a `finally` that runs a microtask
    // after its promise settles, so let that land before enqueuing again.
    await new Promise<void>(r => setTimeout(r, 0));

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

    releaseOriginal?.();
    // Must collapse onto the live original rather than pay for a third call.
    expect(await original).toBe('original');
    expect(await duplicate).toBe('original');
  });

  it('does not spin on a timer while the queue is at capacity', async () => {
    // The old drain() re-armed `setTimeout(drain, 0)` whenever the queue was
    // full, which turned a chapter-long queue into a ~250 Hz spin: the
    // worker burned CPU doing nothing while the user waited. Nothing
    // changes the capacity from inside the loop — a job finishing calls
    // drain() in its finally, and updateMaxConcurrent calls it too — so the
    // queue should have no timer pending at all while it waits.
    vi.useFakeTimers();

    const queue = new BackgroundJobQueue(1, 0);
    let release: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'first',
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

    const second = queue.enqueue({
      job: createJobStatus({
        jobId: 'second',
        pageKey: 'second',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'second',
    });

    expect(vi.getTimerCount()).toBe(0);

    release?.();
    expect(await first).toBe('first');
    expect(await second).toBe('second');
  });

  it('drops queued jobs when the queue is cleared, and leaves the running one alone', async () => {
    // The master switch was turned off while the queue still held work.
    // Every queued job would have become a real, billed request, so it is
    // dropped rather than started. The running job is already on the wire
    // and cannot be recalled, so it is left to finish.
    const queue = new BackgroundJobQueue(1);
    let release: (() => void) | undefined;

    const first = queue.enqueue({
      job: createJobStatus({
        jobId: 'first',
        pageKey: 'first',
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
        pageKey: 'second',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'second',
    });

    expect(queue.cancelAll('扩展已关闭')).toBe(1);
    // The caller waiting on the dropped job learns why instead of hanging.
    await expect(second).rejects.toThrow('扩展已关闭');
    expect(queue.getJob('second')?.state).toBe('cancelled');
    // Nothing left to drop.
    expect(queue.cancelAll('扩展已关闭')).toBe(0);

    // The running job is untouched.
    release?.();
    expect(await first).toBe('first');

    // And the dropped job's dedup entry was released, so a later request
    // for the same image starts a real job instead of collapsing onto a
    // promise that has already been rejected.
    const third = queue.enqueue({
      job: createJobStatus({
        jobId: 'third',
        pageKey: 'second',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'third',
    });
    expect(await third).toBe('third');
  });

  /*
   * 取消要按"这一页"来，不按"整个扩展"来。
   *
   * 读者在第一章点了取消，队列里排着的还有第二章 —— 那是另一个标签页的
   * 活儿。`cancelAll` 会把它一起扔掉，读者会发现自己刚点的"下一章"也没
   * 了。队列是所有标签页共用的，所以取消必须带着"我是哪一轮"这个身份。
   */
  it('drops only the jobs of the cancelled run', async () => {
    const queue = new BackgroundJobQueue(1);
    let release: (() => void) | undefined;

    // 第一个 job 已经在跑（在路上收不回来），它不属于被取消的那一轮。
    const running = queue.enqueue({
      job: createJobStatus({
        jobId: 'running',
        pageKey: 'running',
        runScope: 'run-other',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        await new Promise<void>(r => {
          release = r;
        });
        return 'running';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));

    const mine = queue.enqueue({
      job: createJobStatus({
        jobId: 'mine',
        pageKey: 'mine',
        runScope: 'run-mine',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'mine',
    });

    const theirs = queue.enqueue({
      job: createJobStatus({
        jobId: 'theirs',
        pageKey: 'theirs',
        runScope: 'run-other',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'theirs',
    });

    expect(queue.cancelByRunScope('run-mine')).toBe(1);

    // The reader who pressed cancel learns why instead of hanging.
    await expect(mine).rejects.toThrow('Translation cancelled');
    expect(queue.getJob('mine')?.state).toBe('cancelled');

    // The other tab's job is untouched — it is still a real request that
    // will be paid for and translated.
    release?.();
    expect(await running).toBe('running');
    expect(await theirs).toBe('theirs');
  });

  it('cancelling a run that queued nothing changes nothing', () => {
    const queue = new BackgroundJobQueue(1);
    expect(queue.cancelByRunScope('run-mine')).toBe(0);
  });

  it('releases the dedup entry of a dropped job', async () => {
    // 丢了的 job 原来占着这个 imageKey 的去重名额。不放掉的话，下一次请求
    // 同一张图会折叠到一个已经 reject 过的 promise 上，再也不会真的发出去。
    const queue = new BackgroundJobQueue(1);
    let release: (() => void) | undefined;

    const blocker = queue.enqueue({
      job: createJobStatus({
        jobId: 'blocker',
        pageKey: 'blocker',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => {
        await new Promise<void>(r => {
          release = r;
        });
        return 'blocker';
      },
    });

    await new Promise<void>(r => setTimeout(r, 0));

    const dropped = queue.enqueue({
      job: createJobStatus({
        jobId: 'dropped',
        pageKey: 'same-image',
        runScope: 'run-mine',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'dropped',
    });

    const collapsed = queue.enqueue({
      job: createJobStatus({
        jobId: 'collapsed',
        pageKey: 'same-image',
        runScope: 'run-mine',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'collapsed',
    });

    // The second request for the same image collapsed onto the first one —
    // one pending job, one promise, two callers waiting on it.
    expect(queue.cancelByRunScope('run-mine')).toBe(1);
    await expect(dropped).rejects.toThrow('Translation cancelled');
    await expect(collapsed).rejects.toThrow('Translation cancelled');

    release?.();
    await blocker;

    // The dedup entry is free again: the same image can start a real job.
    const later = queue.enqueue({
      job: createJobStatus({
        jobId: 'later',
        pageKey: 'same-image',
        runScope: 'run-mine',
        priorityClass: 'visible-now',
        requestedPath: 'plugin-direct',
        scope: 'page',
      }),
      run: async () => 'later',
    });
    expect(await later).toBe('later');
  });
});
