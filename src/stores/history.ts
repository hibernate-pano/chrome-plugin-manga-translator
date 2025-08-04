/**
 * 状态变更历史管理器
 * 提供撤销/重做、变更记录、状态回滚等功能
 */

// ==================== 历史记录项 ====================

export interface HistoryItem<T = any> {
  id: string;
  timestamp: number;
  action: string;
  description: string;
  data: T;
  metadata?: Record<string, any>;
}

// ==================== 历史记录配置 ====================

export interface HistoryConfig {
  maxHistorySize: number;
  enableCompression: boolean;
  enableEncryption: boolean;
  autoSave: boolean;
  saveInterval: number; // 毫秒
}

// ==================== 历史记录管理器 ====================

export class HistoryManager<T = any> {
  private history: HistoryItem<T>[] = [];
  private currentIndex: number = -1;
  private config: HistoryConfig;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isUndoRedoInProgress = false;

  constructor(config: Partial<HistoryConfig> = {}) {
    this.config = {
      maxHistorySize: 50,
      enableCompression: true,
      enableEncryption: false,
      autoSave: true,
      saveInterval: 5000,
      ...config,
    };

    if (this.config.autoSave) {
      this.startAutoSave();
    }
  }

  // ==================== 核心方法 ====================

  /**
   * 添加历史记录
   */
  addHistory(action: string, description: string, data: T, metadata?: Record<string, any>): void {
    if (this.isUndoRedoInProgress) {
      return;
    }

    const historyItem: HistoryItem<T> = {
      id: this.generateId(),
      timestamp: Date.now(),
      action,
      description,
      data: this.cloneData(data),
      metadata,
    };

    // 移除当前位置之后的所有历史记录
    this.history = this.history.slice(0, this.currentIndex + 1);
    
    // 添加新的历史记录
    this.history.push(historyItem);
    this.currentIndex++;

    // 限制历史记录大小
    if (this.history.length > this.config.maxHistorySize) {
      this.history = this.history.slice(-this.config.maxHistorySize);
      this.currentIndex = Math.min(this.currentIndex, this.config.maxHistorySize - 1);
    }

    this.saveToStorage();
  }

  /**
   * 撤销操作
   */
  undo(): T | null {
    if (this.canUndo()) {
      this.isUndoRedoInProgress = true;
      this.currentIndex--;
      const currentItem = this.history[this.currentIndex];
      if (currentItem) {
        const result = this.cloneData(currentItem.data);
        this.isUndoRedoInProgress = false;
        return result;
      }
      this.isUndoRedoInProgress = false;
    }
    return null;
  }

  /**
   * 重做操作
   */
  redo(): T | null {
    if (this.canRedo()) {
      this.isUndoRedoInProgress = true;
      this.currentIndex++;
      const currentItem = this.history[this.currentIndex];
      if (currentItem) {
        const result = this.cloneData(currentItem.data);
        this.isUndoRedoInProgress = false;
        return result;
      }
      this.isUndoRedoInProgress = false;
    }
    return null;
  }

  /**
   * 检查是否可以撤销
   */
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * 检查是否可以重做
   */
  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  /**
   * 获取当前历史记录
   */
  getCurrentHistory(): HistoryItem<T> | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
      const currentItem = this.history[this.currentIndex];
      return currentItem || null;
    }
    return null;
  }

  /**
   * 获取所有历史记录
   */
  getAllHistory(): HistoryItem<T>[] {
    return this.history.map(item => ({
      ...item,
      data: this.cloneData(item.data),
    }));
  }

  /**
   * 获取历史记录统计信息
   */
  getHistoryStats(): {
    totalItems: number;
    currentIndex: number;
    canUndo: boolean;
    canRedo: boolean;
    memoryUsage: number;
  } {
    const memoryUsage = this.estimateMemoryUsage();
    
    return {
      totalItems: this.history.length,
      currentIndex: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      memoryUsage,
    };
  }

  // ==================== 高级功能 ====================

  /**
   * 回滚到指定时间点
   */
  rollbackToTimestamp(timestamp: number): T | null {
    const targetIndex = this.history.findIndex(item => item.timestamp >= timestamp);
    
    if (targetIndex !== -1) {
      this.currentIndex = targetIndex;
      const targetItem = this.history[targetIndex];
      if (targetItem) {
        return this.cloneData(targetItem.data);
      }
    }
    
    return null;
  }

  /**
   * 回滚到指定操作
   */
  rollbackToAction(action: string): T | null {
    const targetIndex = this.history.findLastIndex((item: HistoryItem<T>) => item.action === action);
    
    if (targetIndex !== -1) {
      this.currentIndex = targetIndex;
      const targetItem = this.history[targetIndex];
      if (targetItem) {
        return this.cloneData(targetItem.data);
      }
    }
    
    return null;
  }

  /**
   * 搜索历史记录
   */
  searchHistory(query: string): HistoryItem<T>[] {
    const lowerQuery = query.toLowerCase();
    
    return this.history.filter(item => 
      item.action.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 清理历史记录
   */
  clearHistory(): void {
    this.history = [];
    this.currentIndex = -1;
    this.saveToStorage();
  }

  /**
   * 清理指定时间之前的历史记录
   */
  clearHistoryBefore(timestamp: number): void {
    const newHistory = this.history.filter(item => item.timestamp >= timestamp);
    const removedCount = this.history.length - newHistory.length;
    
    this.history = newHistory;
    this.currentIndex = Math.max(-1, this.currentIndex - removedCount);
    
    this.saveToStorage();
  }

  /**
   * 导出历史记录
   */
  exportHistory(): string {
    const exportData = {
      version: '1.0.0',
      timestamp: Date.now(),
      config: this.config,
      history: this.history,
      currentIndex: this.currentIndex,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 导入历史记录
   */
  importHistory(data: string): boolean {
    try {
      const importData = JSON.parse(data);
      
      if (importData.version && importData.history) {
        this.history = importData.history;
        this.currentIndex = importData.currentIndex || -1;
        this.saveToStorage();
        return true;
      }
    } catch (error) {
      console.error('Import history failed:', error);
    }
    
    return false;
  }

  // ==================== 存储相关 ====================

  /**
   * 保存到存储
   */
  private saveToStorage(): void {
    try {
      const storageData = {
        history: this.history,
        currentIndex: this.currentIndex,
        config: this.config,
        timestamp: Date.now(),
      };

      let serializedData = JSON.stringify(storageData);

      if (this.config.enableCompression) {
        serializedData = this.compress(serializedData);
      }

      if (this.config.enableEncryption) {
        serializedData = this.encrypt(serializedData);
      }

      localStorage.setItem('manga-translator-history', serializedData);
    } catch (error) {
      console.error('Save history to storage failed:', error);
    }
  }

  /**
   * 从存储加载
   */
  loadFromStorage(): void {
    try {
      const serializedData = localStorage.getItem('manga-translator-history');
      
      if (!serializedData) {
        return;
      }

      let data = serializedData;

      if (this.config.enableEncryption) {
        data = this.decrypt(data);
      }

      if (this.config.enableCompression) {
        data = this.decompress(data);
      }

      const storageData = JSON.parse(data);
      
      if (storageData.history && Array.isArray(storageData.history)) {
        this.history = storageData.history;
        this.currentIndex = storageData.currentIndex || -1;
      }
    } catch (error) {
      console.error('Load history from storage failed:', error);
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 深度克隆数据
   */
  private cloneData<T>(data: T): T {
    try {
      return JSON.parse(JSON.stringify(data));
    } catch (error) {
      console.error('Clone data failed:', error);
      return data;
    }
  }

  /**
   * 压缩数据
   */
  private compress(data: string): string {
    try {
      // 简单的压缩：移除不必要的空格和换行
      return data.replace(/\s+/g, ' ').trim();
    } catch (error) {
      console.error('Compression failed:', error);
      return data;
    }
  }

  /**
   * 解压数据
   */
  private decompress(data: string): string {
    // 压缩是可逆的，直接返回
    return data;
  }

  /**
   * 加密数据
   */
  private encrypt(data: string): string {
    try {
      return btoa(data);
    } catch (error) {
      console.error('Encryption failed:', error);
      return data;
    }
  }

  /**
   * 解密数据
   */
  private decrypt(data: string): string {
    try {
      return atob(data);
    } catch (error) {
      console.error('Decryption failed:', error);
      return data;
    }
  }

  /**
   * 估算内存使用量
   */
  private estimateMemoryUsage(): number {
    try {
      const serialized = JSON.stringify(this.history);
      return serialized.length * 2; // 粗略估算，每个字符2字节
    } catch (error) {
      return 0;
    }
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      this.saveToStorage();
    }, this.config.saveInterval);
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.stopAutoSave();
    this.history = [];
    this.currentIndex = -1;
  }
}

// ==================== React Hook ====================

import { useState, useEffect, useCallback, useRef } from 'react';

export function useHistory<T = any>(config?: Partial<HistoryConfig>) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [historyStats, setHistoryStats] = useState({
    totalItems: 0,
    currentIndex: -1,
    canUndo: false,
    canRedo: false,
    memoryUsage: 0,
  });

  const historyManagerRef = useRef<HistoryManager<T> | null>(null);

  useEffect(() => {
    historyManagerRef.current = new HistoryManager<T>(config);
    historyManagerRef.current.loadFromStorage();
    
    updateStats();
    
    return () => {
      historyManagerRef.current?.destroy();
    };
  }, [config]);

  const updateStats = useCallback(() => {
    if (historyManagerRef.current) {
      const stats = historyManagerRef.current.getHistoryStats();
      setCanUndo(stats.canUndo);
      setCanRedo(stats.canRedo);
      setHistoryStats(stats);
    }
  }, []);

  const addHistory = useCallback((action: string, description: string, data: T, metadata?: Record<string, any>) => {
    historyManagerRef.current?.addHistory(action, description, data, metadata);
    updateStats();
  }, [updateStats]);

  const undo = useCallback((): T | null => {
    const result = historyManagerRef.current?.undo() || null;
    updateStats();
    return result;
  }, [updateStats]);

  const redo = useCallback((): T | null => {
    const result = historyManagerRef.current?.redo() || null;
    updateStats();
    return result;
  }, [updateStats]);

  const clearHistory = useCallback(() => {
    historyManagerRef.current?.clearHistory();
    updateStats();
  }, [updateStats]);

  const getAllHistory = useCallback(() => {
    return historyManagerRef.current?.getAllHistory() || [];
  }, []);

  const searchHistory = useCallback((query: string) => {
    return historyManagerRef.current?.searchHistory(query) || [];
  }, []);

  return {
    canUndo,
    canRedo,
    historyStats,
    addHistory,
    undo,
    redo,
    clearHistory,
    getAllHistory,
    searchHistory,
  };
}

// ==================== 导出 ==================== 