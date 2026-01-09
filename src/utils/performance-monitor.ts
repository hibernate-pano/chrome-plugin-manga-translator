/**
 * Performance Monitoring Utilities
 *
 * Provides simple performance monitoring for critical operations.
 */

export interface PerformanceTimer {
  startTime: number;
  endTime?: number;
  duration?: number;
}

/**
 * Start a performance timer
 */
export function startTimer(): PerformanceTimer {
  return {
    startTime: performance.now(),
  };
}

/**
 * End a performance timer and return duration
 */
export function endTimer(timer: PerformanceTimer): number {
  timer.endTime = performance.now();
  timer.duration = timer.endTime - timer.startTime;
  return timer.duration;
}

/**
 * Measure execution time of an async function
 */
export async function measureAsync<T>(
  fn: () => Promise<T>,
  label?: string
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;

  if (label && process.env['NODE_ENV'] === 'development') {
    console.log(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
  }

  return { result, duration };
}

/**
 * Measure execution time of a sync function
 */
export function measureSync<T>(
  fn: () => T,
  label?: string
): { result: T; duration: number } {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;

  if (label && process.env['NODE_ENV'] === 'development') {
    console.log(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
  }

  return { result, duration };
}

// ==================== Performance Monitor Class ====================

export interface PerformanceMetrics {
  operationCount: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  lastOperationTime: number;
}

export class PerformanceMonitor {
  private metrics = new Map<string, PerformanceMetrics>();

  record(operation: string, duration: number): void {
    const existing = this.metrics.get(operation);
    if (existing) {
      existing.operationCount++;
      existing.totalTime += duration;
      existing.averageTime = existing.totalTime / existing.operationCount;
      existing.minTime = Math.min(existing.minTime, duration);
      existing.maxTime = Math.max(existing.maxTime, duration);
      existing.lastOperationTime = duration;
    } else {
      this.metrics.set(operation, {
        operationCount: 1,
        totalTime: duration,
        averageTime: duration,
        minTime: duration,
        maxTime: duration,
        lastOperationTime: duration,
      });
    }
  }

  getMetrics(operation: string): PerformanceMetrics | undefined {
    return this.metrics.get(operation);
  }

  getAllMetrics(): Map<string, PerformanceMetrics> {
    return new Map(this.metrics);
  }

  reset(): void {
    this.metrics.clear();
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();
