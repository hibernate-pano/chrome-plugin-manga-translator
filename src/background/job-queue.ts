import type {
  JobPriorityClass,
  JobStatusPayload,
  RequestedExecutionPath,
} from '@/shared/runtime-contracts';

type QueueState = JobStatusPayload['state'];

interface EnqueueJobArgs<T> {
  job: JobStatusPayload;
  run: () => Promise<T>;
}

const PRIORITY_ORDER: Record<JobPriorityClass, number> = {
  'manual-retry': 0,
  'visible-now': 1,
  'next-up': 2,
  'warm-cache': 3,
  'deferred-failure': 4,
};

interface PendingJob<T> extends EnqueueJobArgs<T> {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class BackgroundJobQueue {
  private activeCount = 0;
  private maxConcurrent: number;
  private readonly pending: Array<PendingJob<unknown>> = [];
  private readonly jobs = new Map<string, JobStatusPayload>();
  // Deduplication map: pageKey -> pending job promise resolvers
  private readonly pendingJobs = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      job: JobStatusPayload;
      promise: Promise<unknown>;
    }
  >();

  // Rate limiting variables
  private lastRequestTime = 0;
  private readonly minIntervalMs: number;
  private drainTimeout: NodeJS.Timeout | null = null;
  /**
   * Cap on retained job records.
   *
   * `jobs` is the map `JOB_QUERY_STATUS` reads from. Nothing ever removed
   * entries, so a long browsing session accumulated one record per translated
   * image for the lifetime of the service worker. Terminal jobs are of no use
   * once the caller has its response, so they are dropped oldest-first.
   */
  private readonly maxRetainedJobs = 500;

  constructor(maxConcurrent = 2, minIntervalMs = 0) {
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
  }

  updateMaxConcurrent(limit: number): void {
    this.maxConcurrent = limit;
    this.drain();
  }

  getJob(jobId: string): JobStatusPayload | undefined {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : undefined;
  }

  upsertJob(job: JobStatusPayload): void {
    this.jobs.set(job.jobId, { ...job });
  }

  updateJob(
    jobId: string,
    patch: Partial<JobStatusPayload> & { state?: QueueState }
  ): JobStatusPayload | undefined {
    const current = this.jobs.get(jobId);
    if (!current) {
      return undefined;
    }

    const next = { ...current, ...patch };
    this.jobs.set(jobId, next);
    this.pruneJobs();
    return next;
  }

  /**
   * Drop the oldest terminal jobs once the retention cap is exceeded.
   * Running jobs are never pruned: their record is still meaningful.
   */
  private pruneJobs(): void {
    if (this.jobs.size <= this.maxRetainedJobs) {
      return;
    }
    const terminal: Array<[string, JobStatusPayload]> = [];
    for (const [jobId, job] of this.jobs) {
      if (job.state !== 'running' && job.state !== 'queued') {
        terminal.push([jobId, job]);
      }
    }
    // Oldest first: insertion order approximates completion order.
    const excess = this.jobs.size - this.maxRetainedJobs;
    for (let i = 0; i < Math.min(excess, terminal.length); i += 1) {
      const entry = terminal[i];
      if (entry) {
        this.jobs.delete(entry[0]);
      }
    }
  }

  /**
   * Binary search to find the insertion index for a job with given priority.
   * Since priority values are small integers (0-4), this is very efficient.
   * Returns the index where the new job should be inserted to maintain sorted order.
   */
  private findInsertionIndex(priorityClass: JobPriorityClass): number {
    const priority = PRIORITY_ORDER[priorityClass];
    let low = 0;
    let high = this.pending.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midEntry = this.pending[mid];
      if (!midEntry) break;
      const midPriority = PRIORITY_ORDER[midEntry.job.priorityClass];
      if (midPriority <= priority) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  enqueue<T>({ job, run }: EnqueueJobArgs<T>): Promise<T> {
    // Deduplication: a repeat request for the SAME translation unit (same
    // key) collapses onto the in-flight job so the provider is not paid
    // twice. The key is the per-image identity (see translator), so distinct
    // images enqueue independently and run in parallel.
    const existing = this.pendingJobs.get(job.pageKey);
    if (existing) {
      return existing.promise as Promise<T>;
    }

    this.upsertJob(job);

    // Entry is created before the promise so the map holds the SAME object
    // we later attach the resolved promise to (no TDZ reference inside the
    // executor). A later same-key enqueue collapses onto entry.promise.
    const entry = {
      resolve: (() => undefined) as (value: unknown) => void,
      reject: (() => undefined) as (error: Error) => void,
      job,
      promise: undefined as unknown as Promise<unknown>,
    };

    const promise = new Promise<T>((resolve, reject) => {
      entry.resolve = resolve as (value: unknown) => void;
      entry.reject = reject;

      const insertIndex = this.findInsertionIndex(job.priorityClass);
      this.pending.splice(insertIndex, 0, {
        job,
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });

    entry.promise = promise;
    this.pendingJobs.set(job.pageKey, entry);
    return promise;
  }

  private getCurrentLimit(): number {
    let currentLimit = this.maxConcurrent;
    const nextJob = this.pending[0];
    if (nextJob) {
      const isNextJobHighPriority =
        nextJob.job.priorityClass === 'manual-retry' ||
        nextJob.job.priorityClass === 'visible-now';

      if (isNextJobHighPriority) {
        // 查找当前运行中的所有任务
        const runningJobs = Array.from(this.jobs.values()).filter(
          j => j.state === 'running'
        );
        // 如果运行中的任务全部是低优先级预载任务，且至少有一个这样的任务在运行
        const allRunningAreLowPriority =
          runningJobs.length > 0 &&
          runningJobs.every(
            j =>
              j.priorityClass === 'warm-cache' ||
              j.priorityClass === 'deferred-failure'
          );

        if (allRunningAreLowPriority) {
          // 临时允许并发上限上调 1 个通道
          currentLimit = this.maxConcurrent + 1;
        }
      }
    }

    return currentLimit;
  }

  private startJob(next: PendingJob<unknown>): void {
    this.lastRequestTime = Date.now();
    this.activeCount += 1;
    this.updateJob(next.job.jobId, { state: 'running' });

    void next
      .run()
      .then(result => {
        next.resolve(result);
      })
      .catch(error => {
        next.reject(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        this.activeCount -= 1;
        // Remove from pendingJobs deduplication map
        this.pendingJobs.delete(next.job.pageKey);
        // If external hasn't set a final state (e.g., in unit tests), auto-set to succeeded
        const job = this.jobs.get(next.job.jobId);
        if (job && job.state === 'running') {
          this.updateJob(next.job.jobId, { state: 'succeeded' });
        }
        this.drain();
      });
  }

  private drain(): void {
    if (this.drainTimeout) {
      clearTimeout(this.drainTimeout);
      this.drainTimeout = null;
    }

    while (this.pending.length > 0) {
      const currentLimit = this.getCurrentLimit();
      if (this.activeCount >= currentLimit) {
        // Retry after the current limit update is applied
        this.drainTimeout = setTimeout(() => {
          this.drainTimeout = null;
          this.drain();
        }, 0);
        return;
      }

      const now = Date.now();
      const timeSinceLast = now - this.lastRequestTime;

      // Enforce minimum interval between request initiations
      if (timeSinceLast < this.minIntervalMs) {
        const delay = this.minIntervalMs - timeSinceLast;
        this.drainTimeout = setTimeout(() => {
          this.drainTimeout = null;
          this.drain();
        }, delay);
        return;
      }

      const next = this.pending.shift();
      if (!next) {
        return;
      }

      this.startJob(next);
    }
  }
}

export function createJobStatus(args: {
  jobId: string;
  pageKey: string;
  priorityClass: JobPriorityClass;
  requestedPath: RequestedExecutionPath;
  scope: JobStatusPayload['scope'];
}): JobStatusPayload {
  return {
    jobId: args.jobId,
    pageKey: args.pageKey,
    priorityClass: args.priorityClass,
    requestedPath: args.requestedPath,
    scope: args.scope,
    state: 'queued',
  };
}
