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
  private readonly maxConcurrent: number;
  private readonly pending: Array<PendingJob<unknown>> = [];
  private readonly jobs = new Map<string, JobStatusPayload>();

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = maxConcurrent;
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

  enqueue<T>({ job, run }: EnqueueJobArgs<T>): Promise<T> {
    this.upsertJob(job);

    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        job,
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pending.sort(
        (left, right) =>
          PRIORITY_ORDER[left.job.priorityClass] -
          PRIORITY_ORDER[right.job.priorityClass]
      );
      this.drain();
    });
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) {
        return;
      }

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
          this.drain();
        });
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
