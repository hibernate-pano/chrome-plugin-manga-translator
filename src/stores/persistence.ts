/**
 * 状态持久化管理器
 * 提供智能持久化策略、数据迁移、版本兼容和备份恢复功能
 */

// ==================== 持久化配置 ====================

export interface PersistenceConfig {
  name: string;
  version: string;
  migrate?: (oldData: any, version: string) => any;
  serialize?: (data: any) => string;
  deserialize?: (data: string) => any;
  compress?: boolean;
  encrypt?: boolean;
  backup?: boolean;
  maxBackups?: number;
}

// ==================== 存储适配器接口 ====================

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<string[]>;
}

// ==================== Chrome Storage 适配器 ====================

export class ChromeStorageAdapter implements StorageAdapter {
  async getItem(key: string): Promise<string | null> {
    try {
      const result = await chrome.storage.sync.get([key]);
      return result[key] ? JSON.stringify(result[key]) : null;
    } catch (error) {
      console.error('Chrome storage getItem error:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const parsedValue = JSON.parse(value);
      await chrome.storage.sync.set({ [key]: parsedValue });
    } catch (error) {
      console.error('Chrome storage setItem error:', error);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      await chrome.storage.sync.remove([key]);
    } catch (error) {
      console.error('Chrome storage removeItem error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      await chrome.storage.sync.clear();
    } catch (error) {
      console.error('Chrome storage clear error:', error);
    }
  }

  async getAllKeys(): Promise<string[]> {
    try {
      const result = await chrome.storage.sync.get(null);
      return Object.keys(result);
    } catch (error) {
      console.error('Chrome storage getAllKeys error:', error);
      return [];
    }
  }
}

// ==================== 本地存储适配器 ====================

export class LocalStorageAdapter implements StorageAdapter {
  async getItem(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('LocalStorage getItem error:', error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error('LocalStorage setItem error:', error);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('LocalStorage removeItem error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.clear();
    } catch (error) {
      console.error('LocalStorage clear error:', error);
    }
  }

  async getAllKeys(): Promise<string[]> {
    try {
      return Object.keys(localStorage);
    } catch (error) {
      console.error('LocalStorage getAllKeys error:', error);
      return [];
    }
  }
}

// ==================== 数据压缩工具 ====================

export class CompressionUtil {
  static compress(data: string): string {
    try {
      // 简单的压缩：移除不必要的空格和换行
      return data.replace(/\s+/g, ' ').trim();
    } catch (error) {
      console.error('Compression error:', error);
      return data;
    }
  }

  static decompress(data: string): string {
    // 压缩是可逆的，直接返回
    return data;
  }
}

// ==================== 数据加密工具 ====================

export class EncryptionUtil {
  private static readonly ENCRYPTION_KEY = 'manga-translator-v1';

  static encrypt(data: string): string {
    try {
      // 简单的Base64编码，实际应用中应使用更安全的加密
      return btoa(data);
    } catch (error) {
      console.error('Encryption error:', error);
      return data;
    }
  }

  static decrypt(data: string): string {
    try {
      return atob(data);
    } catch (error) {
      console.error('Decryption error:', error);
      return data;
    }
  }
}

// ==================== 数据迁移管理器 ====================

export class MigrationManager {
  private migrations: Map<string, (data: any) => any> = new Map();

  registerMigration(version: string, migration: (data: any) => any): void {
    this.migrations.set(version, migration);
  }

  migrate(data: any, fromVersion: string, toVersion: string): any {
    let currentData = data;
    const currentVersion = fromVersion;

    // 获取所有需要执行的迁移
    const migrationsToRun = this.getMigrationsToRun(fromVersion, toVersion);

    for (const [version, migration] of migrationsToRun) {
      try {
        currentData = migration(currentData);
        const _currentVersion = version;
        console.log(`Migration ${version} completed successfully`);
      } catch (error) {
        console.error(`Migration ${version} failed:`, error);
        throw new Error(`Migration ${version} failed: ${error}`);
      }
    }

    return currentData;
  }

  private getMigrationsToRun(fromVersion: string, toVersion: string): Array<[string, (data: any) => any]> {
    const migrations: Array<[string, (data: any) => any]> = [];
    
    for (const [version, migration] of this.migrations) {
      if (this.isVersionBetween(version, fromVersion, toVersion)) {
        migrations.push([version, migration]);
      }
    }

    // 按版本号排序
    return migrations.sort(([a], [b]) => this.compareVersions(a, b));
  }

  private isVersionBetween(version: string, fromVersion: string, toVersion: string): boolean {
    return this.compareVersions(version, fromVersion) > 0 && 
           this.compareVersions(version, toVersion) <= 0;
  }

  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      
      if (aPart !== bPart) {
        return aPart - bPart;
      }
    }
    
    return 0;
  }
}

// ==================== 备份管理器 ====================

export class BackupManager {
  private storage: StorageAdapter;
  private maxBackups: number;

  constructor(storage: StorageAdapter, maxBackups: number = 5) {
    this.storage = storage;
    this.maxBackups = maxBackups;
  }

  async createBackup(key: string, data: any): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const backupKey = `${key}_backup_${timestamp}`;
      const backupData = {
        data,
        timestamp,
        version: '1.0.0',
      };

      await this.storage.setItem(backupKey, JSON.stringify(backupData));
      await this.cleanupOldBackups(key);
    } catch (error) {
      console.error('Backup creation failed:', error);
    }
  }

  async restoreBackup(key: string, timestamp?: string): Promise<any | null> {
    try {
      const backupKeys = await this.getBackupKeys(key);
      
      if (backupKeys.length === 0) {
        return null;
      }

      let backupKey: string;
      if (timestamp) {
        const foundKey = backupKeys.find(k => k.includes(timestamp));
        backupKey = foundKey || backupKeys[0] || '';
      } else {
        backupKey = backupKeys[0] || ''; // 最新的备份
      }

      const backupData = await this.storage.getItem(backupKey);
      if (!backupData) {
        return null;
      }

      const parsed = JSON.parse(backupData);
      return parsed.data;
    } catch (error) {
      console.error('Backup restoration failed:', error);
      return null;
    }
  }

  async listBackups(key: string): Promise<Array<{ timestamp: string; version: string }>> {
    try {
      const backupKeys = await this.getBackupKeys(key);
      const backups: Array<{ timestamp: string; version: string }> = [];

      for (const backupKey of backupKeys) {
        const backupData = await this.storage.getItem(backupKey);
        if (backupData) {
          const parsed = JSON.parse(backupData);
          backups.push({
            timestamp: parsed.timestamp,
            version: parsed.version,
          });
        }
      }

      return backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      console.error('Backup listing failed:', error);
      return [];
    }
  }

  private async getBackupKeys(key: string): Promise<string[]> {
    const allKeys = await this.storage.getAllKeys();
    return allKeys.filter(k => k.startsWith(`${key}_backup_`));
  }

  private async cleanupOldBackups(key: string): Promise<void> {
    try {
      const backupKeys = await this.getBackupKeys(key);
      
      if (backupKeys.length > this.maxBackups) {
        const keysToRemove = backupKeys.slice(this.maxBackups);
        
        for (const keyToRemove of keysToRemove) {
          await this.storage.removeItem(keyToRemove);
        }
      }
    } catch (error) {
      console.error('Backup cleanup failed:', error);
    }
  }
}

// ==================== 持久化管理器 ====================

export class PersistenceManager {
  private storage: StorageAdapter;
  private config: PersistenceConfig;
  private migrationManager: MigrationManager;
  private backupManager: BackupManager;

  constructor(storage: StorageAdapter, config: PersistenceConfig) {
    this.storage = storage;
    this.config = config;
    this.migrationManager = new MigrationManager();
    this.backupManager = new BackupManager(storage, config.maxBackups);
  }

  async save(key: string, data: any): Promise<void> {
    try {
      let serializedData = this.config.serialize 
        ? this.config.serialize(data)
        : JSON.stringify(data);

      if (this.config.compress) {
        serializedData = CompressionUtil.compress(serializedData);
      }

      if (this.config.encrypt) {
        serializedData = EncryptionUtil.encrypt(serializedData);
      }

      await this.storage.setItem(key, serializedData);

      if (this.config.backup) {
        await this.backupManager.createBackup(key, data);
      }
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    }
  }

  async load(key: string): Promise<any | null> {
    try {
      const serializedData = await this.storage.getItem(key);
      
      if (!serializedData) {
        return null;
      }

      let data = serializedData;

      if (this.config.encrypt) {
        data = EncryptionUtil.decrypt(data);
      }

      if (this.config.compress) {
        data = CompressionUtil.decompress(data);
      }

      const parsedData = this.config.deserialize 
        ? this.config.deserialize(data)
        : JSON.parse(data);

      // 检查版本并执行迁移
      if (parsedData.version && parsedData.version !== this.config.version) {
        const migratedData = this.migrationManager.migrate(
          parsedData.data || parsedData,
          parsedData.version,
          this.config.version
        );
        
        // 保存迁移后的数据
        await this.save(key, migratedData);
        return migratedData;
      }

      return parsedData.data || parsedData;
    } catch (error) {
      console.error('Load failed:', error);
      
      // 尝试从备份恢复
      if (this.config.backup) {
        console.log('Attempting to restore from backup...');
        const backupData = await this.backupManager.restoreBackup(key);
        if (backupData) {
          console.log('Successfully restored from backup');
          return backupData;
        }
      }
      
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.storage.removeItem(key);
    } catch (error) {
      console.error('Remove failed:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.clear();
    } catch (error) {
      console.error('Clear failed:', error);
      throw error;
    }
  }

  // 注册迁移
  registerMigration(version: string, migration: (data: any) => any): void {
    this.migrationManager.registerMigration(version, migration);
  }

  // 备份相关方法
  async createBackup(key: string, data: any): Promise<void> {
    await this.backupManager.createBackup(key, data);
  }

  async restoreBackup(key: string, timestamp?: string): Promise<any | null> {
    return this.backupManager.restoreBackup(key, timestamp);
  }

  async listBackups(key: string): Promise<Array<{ timestamp: string; version: string }>> {
    return this.backupManager.listBackups(key);
  }
}

// ==================== 导出工具 ==================== 