/**
 * 批量翻译管理器
 * 提供并发控制、进度跟踪、错误恢复和断点续传功能
 */

export interface BatchTranslationTask {
  id: string;
  imageUrl: string;
  imageHash: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  retryCount: number;
  error?: string;
  result?: any;
  timestamp: number;
}

export interface BatchTranslationState {
  sessionId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  currentIndex: number;
  isPaused: boolean;
  isCancelled: boolean;
  startTime: number;
  lastUpdateTime: number;
  tasks: BatchTranslationTask[];
  failedTaskIds: string[];
  pageUrl: string;
}

export interface BatchTranslationProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  progress: number; // 0-100
  speed: number; // tasks per second
  elapsedTime: number; // seconds
  estimatedTimeRemaining: number; // seconds
  currentTask?: BatchTranslationTask;
}

export interface BatchTranslationConfig {
  maxConcurrency?: number;
  maxRetries?: number;
  retryDelay?: number;
  batchSize?: number;
  enablePersistence?: boolean;
  onProgress?: (progress: BatchTranslationProgress) => void;
  onTaskComplete?: (task: BatchTranslationTask) => void;
  onTaskFailed?: (task: BatchTranslationTask) => void;
}

const STORAGE_KEY = 'batch_translation_state';
const DEFAULT_CONFIG: Required<BatchTranslationConfig> = {
  maxConcurrency: 3,
  maxRetries: 3,
  retryDelay: 1000,
  batchSize: 5,
  enablePersistence: true,
  onProgress: () => {},
  onTaskComplete: () => {},
  onTaskFailed: () => {},
};

export class BatchTranslationManager {
  private state: BatchTranslationState | null = null;
  private config: Required<BatchTranslationConfig>;
  private processingQueue: Set<string> = new Set();
  private isProcessing = false;

  constructor(config: BatchTranslationConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化批量翻译任务
   */
  async initialize(
    tasks: Array<{ id: string; imageUrl: string; imageHash: string }>,
    pageUrl: string = window.location.href
  ): Promise<void> {
    // 尝试恢复之前的状态
    if (this.config.enablePersistence) {
      const savedState = await this.loadState();
      if (savedState && savedState.pageUrl === pageUrl && savedState.tasks.length > 0) {
        // 合并新任务和已保存的任务
        const existingTaskMap = new Map(savedState.tasks.map(t => [t.id, t]));
        const newTasks = tasks.map(task => {
          const existing = existingTaskMap.get(task.id);
          if (existing) {
            // 保留已完成的任务状态
            if (existing.status === 'completed') {
              return existing;
            }
            // 保留失败的任务，但重置为pending以便重试
            if (existing.status === 'failed' && existing.retryCount < this.config.maxRetries) {
              return { ...existing, status: 'pending' as const, error: undefined };
            }
          }
          return {
            id: task.id,
            imageUrl: task.imageUrl,
            imageHash: task.imageHash,
            status: 'pending' as const,
            retryCount: 0,
            timestamp: Date.now(),
          };
        });

        this.state = {
          ...savedState,
          tasks: newTasks,
          pageUrl,
          lastUpdateTime: Date.now(),
        };
      } else {
        this.state = this.createInitialState(tasks, pageUrl);
      }
    } else {
      this.state = this.createInitialState(tasks, pageUrl);
    }

    await this.saveState();
  }

  /**
   * 创建初始状态
   */
  private createInitialState(
    tasks: Array<{ id: string; imageUrl: string; imageHash: string }>,
    pageUrl: string
  ): BatchTranslationState {
    return {
      sessionId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      totalTasks: tasks.length,
      completedTasks: 0,
      failedTasks: 0,
      skippedTasks: 0,
      currentIndex: 0,
      isPaused: false,
      isCancelled: false,
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      tasks: tasks.map(task => ({
        id: task.id,
        imageUrl: task.imageUrl,
        imageHash: task.imageHash,
        status: 'pending' as const,
        retryCount: 0,
        timestamp: Date.now(),
      })),
      failedTaskIds: [],
      pageUrl,
    };
  }

  /**
   * 开始处理批量翻译
   */
  async start(
    processTaskFn: (task: BatchTranslationTask) => Promise<any>
  ): Promise<void> {
    if (!this.state) {
      throw new Error('批量翻译未初始化');
    }

    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.state.isPaused = false;
    this.state.isCancelled = false;

    try {
      await this.processTasks(processTaskFn);
    } finally {
      this.isProcessing = false;
      await this.saveState();
    }
  }

  /**
   * 处理任务队列
   */
  private async processTasks(
    processTaskFn: (task: BatchTranslationTask) => Promise<any>
  ): Promise<void> {
    if (!this.state) return;

    const pendingTasks = this.state.tasks.filter(
      t => t.status === 'pending' && !this.processingQueue.has(t.id)
    );

    if (pendingTasks.length === 0) {
      return;
    }

    // 按批次处理
    const batches: BatchTranslationTask[][] = [];
    for (let i = 0; i < pendingTasks.length; i += this.config.batchSize) {
      batches.push(pendingTasks.slice(i, i + this.config.batchSize));
    }

    for (const batch of batches) {
      if (this.state.isCancelled || this.state.isPaused) {
        break;
      }

      // 并发处理批次中的任务
      const batchPromises = batch.map(task => this.processTask(task, processTaskFn));
      await Promise.allSettled(batchPromises);

      // 更新进度
      this.updateProgress();
      await this.saveState();

      // 如果暂停，等待恢复
      while (this.state.isPaused && !this.state.isCancelled) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * 处理单个任务
   */
  private async processTask(
    task: BatchTranslationTask,
    processTaskFn: (task: BatchTranslationTask) => Promise<any>
  ): Promise<void> {
    if (!this.state) return;

    this.processingQueue.add(task.id);
    task.status = 'processing';
    task.timestamp = Date.now();

    try {
      const result = await processTaskFn(task);
      task.status = 'completed';
      task.result = result;
      this.state.completedTasks++;
      this.config.onTaskComplete(task);
    } catch (error) {
      task.retryCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      task.error = errorMessage;

      if (task.retryCount < this.config.maxRetries) {
        // 重试
        task.status = 'pending';
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * task.retryCount));
        this.processingQueue.delete(task.id);
        await this.processTask(task, processTaskFn);
        return;
      } else {
        // 达到最大重试次数，标记为失败
        task.status = 'failed';
        this.state.failedTasks++;
        this.state.failedTaskIds.push(task.id);
        this.config.onTaskFailed(task);
      }
    } finally {
      this.processingQueue.delete(task.id);
      this.state.currentIndex++;
      this.state.lastUpdateTime = Date.now();
    }
  }

  /**
   * 暂停处理
   */
  pause(): void {
    if (this.state) {
      this.state.isPaused = true;
      this.saveState();
    }
  }

  /**
   * 恢复处理
   */
  async resume(
    processTaskFn: (task: BatchTranslationTask) => Promise<any>
  ): Promise<void> {
    if (!this.state) {
      throw new Error('批量翻译未初始化');
    }

    if (!this.state.isPaused) {
      return;
    }

    this.state.isPaused = false;
    await this.saveState();

    if (!this.isProcessing) {
      await this.start(processTaskFn);
    }
  }

  /**
   * 取消处理
   */
  cancel(): void {
    if (this.state) {
      this.state.isCancelled = true;
      this.state.isPaused = false;
      this.saveState();
    }
  }

  /**
   * 重试失败的任务
   */
  async retryFailedTasks(
    processTaskFn: (task: BatchTranslationTask) => Promise<any>
  ): Promise<void> {
    if (!this.state) return;

    const failedTasks = this.state.tasks.filter(t => t.status === 'failed');
    for (const task of failedTasks) {
      task.status = 'pending';
      task.retryCount = 0;
      task.error = undefined;
    }

    this.state.failedTasks = 0;
    this.state.failedTaskIds = [];
    await this.saveState();

    await this.start(processTaskFn);
  }

  /**
   * 更新进度
   */
  private updateProgress(): void {
    if (!this.state) return;

    const progress: BatchTranslationProgress = {
      total: this.state.totalTasks,
      completed: this.state.completedTasks,
      failed: this.state.failedTasks,
      skipped: this.state.skippedTasks,
      progress: (this.state.completedTasks / this.state.totalTasks) * 100,
      speed: this.calculateSpeed(),
      elapsedTime: (Date.now() - this.state.startTime) / 1000,
      estimatedTimeRemaining: this.calculateEstimatedTime(),
      currentTask: this.state.tasks.find(t => t.status === 'processing'),
    };

    this.config.onProgress(progress);
  }

  /**
   * 计算处理速度
   */
  private calculateSpeed(): number {
    if (!this.state) return 0;
    const elapsed = (Date.now() - this.state.startTime) / 1000;
    return elapsed > 0 ? this.state.completedTasks / elapsed : 0;
  }

  /**
   * 计算预计剩余时间
   */
  private calculateEstimatedTime(): number {
    if (!this.state) return 0;
    const speed = this.calculateSpeed();
    if (speed === 0) return 0;
    const remaining = this.state.totalTasks - this.state.completedTasks;
    return remaining / speed;
  }

  /**
   * 获取当前进度
   */
  getProgress(): BatchTranslationProgress | null {
    if (!this.state) return null;
    this.updateProgress();
    return {
      total: this.state.totalTasks,
      completed: this.state.completedTasks,
      failed: this.state.failedTasks,
      skipped: this.state.skippedTasks,
      progress: (this.state.completedTasks / this.state.totalTasks) * 100,
      speed: this.calculateSpeed(),
      elapsedTime: (Date.now() - this.state.startTime) / 1000,
      estimatedTimeRemaining: this.calculateEstimatedTime(),
      currentTask: this.state.tasks.find(t => t.status === 'processing'),
    };
  }

  /**
   * 获取状态
   */
  getState(): BatchTranslationState | null {
    return this.state ? { ...this.state } : null;
  }

  /**
   * 保存状态到存储
   */
  private async saveState(): Promise<void> {
    if (!this.state || !this.config.enablePersistence) return;

    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          ...this.state,
          tasks: this.state.tasks.map(t => ({
            ...t,
            // 不保存处理中的任务状态，避免状态不一致
            status: t.status === 'processing' ? 'pending' : t.status,
          })),
        },
      });
    } catch (error) {
      console.error('保存批量翻译状态失败:', error);
    }
  }

  /**
   * 从存储加载状态
   */
  private async loadState(): Promise<BatchTranslationState | null> {
    if (!this.config.enablePersistence) return null;

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || null;
    } catch (error) {
      console.error('加载批量翻译状态失败:', error);
      return null;
    }
  }

  /**
   * 清除保存的状态
   */
  async clearState(): Promise<void> {
    if (this.config.enablePersistence) {
      try {
        await chrome.storage.local.remove(STORAGE_KEY);
      } catch (error) {
        console.error('清除批量翻译状态失败:', error);
      }
    }
    this.state = null;
    this.processingQueue.clear();
    this.isProcessing = false;
  }

  /**
   * 获取失败的任务列表
   */
  getFailedTasks(): BatchTranslationTask[] {
    if (!this.state) return [];
    return this.state.tasks.filter(t => t.status === 'failed');
  }

  /**
   * 获取待处理的任务列表
   */
  getPendingTasks(): BatchTranslationTask[] {
    if (!this.state) return [];
    return this.state.tasks.filter(t => t.status === 'pending');
  }
}

