/**
 * 数据导入导出组件
 */

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useConfigStore } from '@/stores/config';
import { useTranslationStore } from '@/stores/translation';
import { useCacheStore } from '@/stores/cache';

export interface DataImportExportProps {
  className?: string;
}

interface ExportData {
  config: any;
  translations: any;
  cache: any;
  version: string;
  timestamp: number;
}

export const DataImportExport: React.FC<DataImportExportProps> = ({ className }) => {
  const configStore = useConfigStore();
  const { history } = useTranslationStore();
  const cacheStore = useCacheStore();
  const [importData, setImportData] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const exportData: ExportData = {
        config: configStore,
        translations: history,
        cache: cacheStore ? cacheStore.getCacheStats() : {},
        version: '0.2.0',
        timestamp: Date.now(),
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `manga-translator-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出失败:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importData.trim()) return;

    setIsImporting(true);
    try {
      const data: ExportData = JSON.parse(importData);

      // 验证数据格式
      if (!data.version || !data.config) {
        throw new Error('无效的备份文件格式');
      }

      // 导入配置
      if (data.config) {
        useConfigStore.getState().updateConfig(data.config);
      }

      // 导入翻译历史
      if (data.translations && Array.isArray(data.translations)) {
        // 清空现有历史并添加新的历史记录
        useTranslationStore.getState().clearHistory();
        data.translations.forEach((item: any) => {
          useTranslationStore.getState().addToHistory(item);
        });
      }

      // 导入缓存
      if (data.cache && cacheStore) {
        // 缓存导入逻辑（CacheStore 没有 importData 方法，这里只是记录）
        console.log('缓存数据导入:', data.cache);
      }

      setImportData('');
      alert('数据导入成功！');
    } catch (error) {
      console.error('导入失败:', error);
      alert('导入失败：' + (error as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportData(content);
    };
    reader.readAsText(file);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>数据导入导出</CardTitle>
        <CardDescription>
          备份和恢复您的设置、翻译历史和缓存数据
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium mb-2">导出数据</h3>
            <p className="text-sm text-muted-foreground mb-4">
              将您的所有设置和数据导出为JSON文件
            </p>
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="w-full"
            >
              {isExporting ? '导出中...' : '导出数据'}
            </Button>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-lg font-medium mb-2">导入数据</h3>
            <p className="text-sm text-muted-foreground mb-4">
              从备份文件恢复您的设置和数据
            </p>

            <div className="space-y-4">
              <div>
                <Label htmlFor="file-import">选择备份文件</Label>
                <Input
                  id="file-import"
                  type="file"
                  accept=".json"
                  onChange={handleFileImport}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="data-textarea">或粘贴备份数据</Label>
                <Textarea
                  id="data-textarea"
                  placeholder="粘贴JSON格式的备份数据..."
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  rows={8}
                  className="mt-1 font-mono text-sm"
                />
              </div>

              <Button
                onClick={handleImport}
                disabled={isImporting || !importData.trim()}
                className="w-full"
              >
                {isImporting ? '导入中...' : '导入数据'}
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
          <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">
            注意事项
          </h4>
          <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
            <li>• 导入数据将覆盖当前的所有设置</li>
            <li>• 建议在导入前先导出当前数据作为备份</li>
            <li>• 只导入来自可信来源的备份文件</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default DataImportExport;
