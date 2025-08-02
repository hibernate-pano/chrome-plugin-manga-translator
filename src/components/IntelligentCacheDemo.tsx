import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription } from './ui/alert';
import {
  useIntelligentCacheStats,
  useCacheWarmup,
  useCacheCleanup,
  useOfflineSync,
  usePredictivePreload,
  useNetworkStatus,
  useCachePerformance,
  useCacheHealthCheck
} from '../hooks/useIntelligentCache';
import { Loader2, Wifi, WifiOff, TrendingUp, Database, Zap, Shield } from 'lucide-react';

/**
 * 智能缓存管理演示组件
 */
export function IntelligentCacheDemo() {
  const [selectedWarmupType, setSelectedWarmupType] = useState<'translation' | 'ocr' | 'common'>('common');
  const [selectedCleanupType, setSelectedCleanupType] = useState<'expired' | 'all' | 'offline'>('expired');

  // 查询钩子
  const { data: cacheStats, isLoading: statsLoading } = useIntelligentCacheStats();
  const { data: networkStatus } = useNetworkStatus();
  const { data: performance } = useCachePerformance();
  const { data: health } = useCacheHealthCheck();

  // 变更钩子
  const warmupMutation = useCacheWarmup();
  const cleanupMutation = useCacheCleanup();
  const syncMutation = useOfflineSync();
  const { triggerPreload, recordBehavior } = usePredictivePreload();

  const handleWarmup = () => {
    warmupMutation.mutate({ type: selectedWarmupType });
  };

  const handleCleanup = () => {
    cleanupMutation.mutate({
      type: selectedCleanupType,
      aggressive: selectedCleanupType === 'all'
    });
  };

  const handleSync = () => {
    syncMutation.mutate();
  };

  const handlePredictivePreload = () => {
    triggerPreload({
      action: 'demo',
      text: 'Hello World',
      language: 'zh',
    });
  };

  const handleRecordBehavior = () => {
    recordBehavior('demo_action', {
      text: 'Demo text',
      language: 'zh',
    });
  };

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">加载缓存统计信息...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">智能缓存管理</h2>
          <p className="text-muted-foreground">
            管理翻译缓存、离线支持和性能优化
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {networkStatus?.isOnline ? (
            <Badge variant="default" className="flex items-center space-x-1">
              <Wifi className="h-3 w-3" />
              <span>在线</span>
            </Badge>
          ) : (
            <Badge variant="destructive" className="flex items-center space-x-1">
              <WifiOff className="h-3 w-3" />
              <span>离线</span>
            </Badge>
          )}
        </div>
      </div>

      {/* 健康状态警告 */}
      {health && health.overall !== 'good' && (
        <Alert variant={health.overall === 'critical' ? 'destructive' : 'default'}>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-medium">
                缓存健康状态: {health.overall === 'critical' ? '严重' : '警告'}
              </div>
              {health.issues.map((issue, index) => (
                <div key={index} className="text-sm">• {issue}</div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="performance">性能</TabsTrigger>
          <TabsTrigger value="offline">离线数据</TabsTrigger>
          <TabsTrigger value="management">管理操作</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 内存缓存 */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">内存缓存</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {cacheStats?.memory?.currentSize || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  / {cacheStats?.memory?.maxSize || 0} 项
                </p>
                <Progress
                  value={cacheStats?.memory ? (cacheStats.memory.currentSize / cacheStats.memory.maxSize) * 100 : 0}
                  className="mt-2"
                />
              </CardContent>
            </Card>

            {/* 持久化缓存 */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">持久化缓存</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {cacheStats?.persistent?.totalSize || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  翻译: {cacheStats?.persistent?.translationCount || 0} |
                  OCR: {cacheStats?.persistent?.ocrCount || 0}
                </p>
              </CardContent>
            </Card>

            {/* 离线数据 */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">离线数据</CardTitle>
                <WifiOff className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {cacheStats?.offlineStats?.totalItems || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  未同步: {cacheStats?.offlineStats?.unsyncedItems || 0}
                </p>
                {(cacheStats?.offlineStats?.unsyncedItems || 0) > 0 && (
                  <Badge variant="outline" className="mt-1">
                    需要同步
                  </Badge>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 缓存命中率 */}
          <Card>
            <CardHeader>
              <CardTitle>缓存命中率</CardTitle>
              <CardDescription>各类型缓存的命中率统计</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {cacheStats?.hitRates && Object.entries(cacheStats.hitRates).map(([key, stats]) => (
                  <div key={key} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium">{key}</span>
                      <Badge variant="outline">
                        {stats.totalRequests} 次请求
                      </Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Progress value={stats.hitRate * 100} className="w-20" />
                      <span className="text-sm text-muted-foreground">
                        {(stats.hitRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <TrendingUp className="h-5 w-5" />
                <span>性能指标</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">总体命中率</div>
                  <div className="text-2xl font-bold">
                    {performance ? (performance.overallHitRate * 100).toFixed(1) : 0}%
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">总请求数</div>
                  <div className="text-2xl font-bold">
                    {performance?.totalRequests || 0}
                  </div>
                </div>
              </div>

              {performance?.topPerformingKeys && (
                <div className="mt-4">
                  <div className="text-sm font-medium mb-2">性能最佳的缓存键</div>
                  <div className="space-y-1">
                    {performance.topPerformingKeys.slice(0, 5).map(([key, stats]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="truncate">{key}</span>
                        <span>{(stats.hitRate * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="offline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>离线数据管理</CardTitle>
              <CardDescription>管理离线缓存和数据同步</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">
                    {cacheStats?.offlineStats?.totalItems || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">总项目</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {cacheStats?.offlineStats?.unsyncedItems || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">未同步</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {cacheStats?.offlineStats?.totalSize ?
                      (cacheStats.offlineStats.totalSize / 1024).toFixed(1) : 0}KB
                  </div>
                  <div className="text-sm text-muted-foreground">总大小</div>
                </div>
              </div>

              <Button
                onClick={handleSync}
                disabled={syncMutation.isPending || !networkStatus?.isOnline}
                className="w-full"
              >
                {syncMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                同步离线数据
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="management" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 缓存预热 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="h-5 w-5" />
                  <span>缓存预热</span>
                </CardTitle>
                <CardDescription>预加载常用数据以提升性能</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">预热类型</label>
                  <select
                    value={selectedWarmupType}
                    onChange={(e) => setSelectedWarmupType(e.target.value as any)}
                    className="w-full p-2 border rounded"
                  >
                    <option value="common">通用预热</option>
                    <option value="translation">翻译预热</option>
                    <option value="ocr">OCR预热</option>
                  </select>
                </div>
                <Button
                  onClick={handleWarmup}
                  disabled={warmupMutation.isPending}
                  className="w-full"
                >
                  {warmupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  开始预热
                </Button>
              </CardContent>
            </Card>

            {/* 缓存清理 */}
            <Card>
              <CardHeader>
                <CardTitle>缓存清理</CardTitle>
                <CardDescription>清理过期或不需要的缓存数据</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">清理类型</label>
                  <select
                    value={selectedCleanupType}
                    onChange={(e) => setSelectedCleanupType(e.target.value as any)}
                    className="w-full p-2 border rounded"
                  >
                    <option value="expired">清理过期数据</option>
                    <option value="offline">清理离线数据</option>
                    <option value="all">清理所有数据</option>
                  </select>
                </div>
                <Button
                  onClick={handleCleanup}
                  disabled={cleanupMutation.isPending}
                  variant={selectedCleanupType === 'all' ? 'destructive' : 'default'}
                  className="w-full"
                >
                  {cleanupMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  开始清理
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* 预测性功能 */}
          <Card>
            <CardHeader>
              <CardTitle>预测性功能</CardTitle>
              <CardDescription>测试智能预测和行为记录功能</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex space-x-2">
                <Button onClick={handlePredictivePreload} variant="outline">
                  触发预测性预加载
                </Button>
                <Button onClick={handleRecordBehavior} variant="outline">
                  记录用户行为
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                预热统计: {cacheStats?.warmupStats?.totalPatterns || 0} 个模式,
                {cacheStats?.warmupStats?.recentBehaviors || 0} 个最近行为
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
