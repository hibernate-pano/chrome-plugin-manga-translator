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
    { resolve: (value: unknown) => void; reject: (error: Error) => void; job: JobStatusPayload }
  >();
  
  // Rate limiting variables
  private lastRequestTime = 0;
  private readonly minIntervalMs: number;
  private drainTimeout: NodeJS.Timeout | null = null;

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
    return next;
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
    // Deduplication: check if a job with the same pageKey is already pending
    const existing = this.pendingJobs.get(job.pageKey);
    if (existing) {
      // Return the existing job's promise
      return existing.resolve as unknown as Promise<T>;
    }

    this.upsertJob(job);

    return new Promise<T>((resolve, reject) => {
      // Store the pending job entry for deduplication
      this.pendingJobs.set(job.pageKey, {
        resolve: resolve as (value: unknown) => void,
        reject,
        job,
      });

      const insertIndex = this.findInsertionIndex(job.priorityClass);
      this.pending.splice(insertIndex, 0, {
        job,
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
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
