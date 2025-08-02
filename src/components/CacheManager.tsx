/**
 * 缓存管理组件
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useCacheStore } from '@/stores/cache';

export interface CacheManagerProps {
  className?: string;
}

interface CacheStats {
  totalSize: number;
  itemCount: number;
  hitRate: number;
  categories: {
    translation: number;
    ocr: number;
    image: number;
  };
}

export const CacheManager: React.FC<CacheManagerProps> = ({ className }) => {
  const store = useCacheStore();
  const [stats, setStats] = useState<CacheStats>({
    totalSize: 0,
    itemCount: 0,
    hitRate: 0,
    categories: {
      translation: 0,
      ocr: 0,
      image: 0,
    },
  });

  useEffect(() => {
    updateStats();
  }, [store]);

  const updateStats = () => {
    const cacheStats = store.getCacheStats();
    setStats({
      totalSize: cacheStats.totalSize,
      itemCount: cacheStats.translationCount + cacheStats.imageCount + cacheStats.ocrCount,
      hitRate: 0.85, // 模拟命中率
      categories: {
        translation: cacheStats.translationCount,
        ocr: cacheStats.ocrCount,
        image: cacheStats.imageCount,
      },
    });
  };

  const handleClearCache = async () => {
    store.clearAllCache();
    updateStats();
  };

  const handleClearCategory = async (category: string) => {
    switch (category) {
      case 'translation':
        store.clearTranslationCache();
        break;
      case 'ocr':
        store.clearOCRCache();
        break;
      case 'image':
        store.clearImageCache();
        break;
    }
    updateStats();
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>缓存管理</CardTitle>
        <CardDescription>
          查看和管理翻译缓存数据
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">缓存大小</div>
            <div className="text-2xl font-bold">{formatSize(stats.totalSize)}</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">缓存项数</div>
            <div className="text-2xl font-bold">{stats.itemCount}</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>命中率</span>
            <span>{(stats.hitRate * 100).toFixed(1)}%</span>
          </div>
          <Progress value={stats.hitRate * 100} className="h-2" />
        </div>

        <div className="space-y-4">
          <div className="text-sm font-medium">缓存分类</div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">翻译</Badge>
                <span className="text-sm">{stats.categories.translation} 项</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClearCategory('translation')}
              >
                清除
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">OCR</Badge>
                <span className="text-sm">{stats.categories.ocr} 项</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClearCategory('ocr')}
              >
                清除
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">图像</Badge>
                <span className="text-sm">{stats.categories.image} 项</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClearCategory('image')}
              >
                清除
              </Button>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t">
          <Button
            variant="destructive"
            onClick={handleClearCache}
            className="w-full"
          >
            清除所有缓存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CacheManager;
