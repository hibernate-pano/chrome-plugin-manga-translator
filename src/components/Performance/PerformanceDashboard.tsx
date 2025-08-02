import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { performanceMonitor, PerformanceMetrics } from '../../utils/performance-monitor';
import { CacheStrategyManager } from '../../utils/cache-strategy';
import { IntelligentCache } from '../../utils/intelligent-cache';

interface PerformanceDashboardProps {
  cacheManager?: CacheStrategyManager;
  cache?: IntelligentCache;
}

export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({
  cacheManager,
  cache,
}) => {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [strategyReport, setStrategyReport] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      // 获取性能指标
      const performanceMetrics = performanceMonitor.getMetrics();
      setMetrics(performanceMetrics);

      // 获取缓存统计
      if (cache) {
        const stats = cache.getStats();
        setCacheStats(stats);
      }

      // 获取策略报告
      if (cacheManager) {
        const report = cacheManager.getStrategyReport();
        setStrategyReport(report);
      }
    } catch (error) {
      console.error('刷新性能数据失败:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshData();
    
    // 每30秒自动刷新
    const interval = setInterval(refreshData, 30000);
    return () => clearInterval(interval);
  }, [cache, cacheManager]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))  } ${  sizes[i]}`;
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };

  const getStatusBadge = (value: number, thresholds: { good: number; warning: number }) => {
    if (value <= thresholds.good) {
      return <Badge variant="default" className="bg-green-500">良好</Badge>;
    } else if (value <= thresholds.warning) {
      return <Badge variant="secondary">一般</Badge>;
    } else {
      return <Badge variant="destructive">需要优化</Badge>;
    }
  };

  if (!metrics) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
            <p className="text-sm text-gray-500">加载性能数据中...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部操作 */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">性能监控仪表板</h2>
          <p className="text-gray-500">实时监控API调用、缓存性能和系统状态</p>
        </div>
        <Button onClick={refreshData} disabled={isRefreshing}>
          {isRefreshing ? '刷新中...' : '刷新数据'}
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="api">API性能</TabsTrigger>
          <TabsTrigger value="cache">缓存分析</TabsTrigger>
          <TabsTrigger value="errors">错误分析</TabsTrigger>
          <TabsTrigger value="recommendations">优化建议</TabsTrigger>
        </TabsList>

        {/* 概览标签页 */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">总请求数</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.apiCalls.total}</div>
                <p className="text-xs text-gray-500">
                  成功: {metrics.apiCalls.successful} | 失败: {metrics.apiCalls.failed}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">成功率</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {metrics.apiCalls.total > 0 
                    ? ((metrics.apiCalls.successful / metrics.apiCalls.total) * 100).toFixed(1)
                    : '0'
                  }%
                </div>
                {getStatusBadge(
                  metrics.apiCalls.total > 0 ? (metrics.apiCalls.failed / metrics.apiCalls.total) * 100 : 0,
                  { good: 5, warning: 15 }
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">平均响应时间</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatDuration(metrics.apiCalls.averageResponseTime)}
                </div>
                {getStatusBadge(
                  metrics.apiCalls.averageResponseTime,
                  { good: 2000, warning: 5000 }
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">缓存命中率</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(metrics.cache.hitRate * 100).toFixed(1)}%
                </div>
                {getStatusBadge(
                  (1 - metrics.cache.hitRate) * 100,
                  { good: 30, warning: 60 }
                )}
              </CardContent>
            </Card>
          </div>

          {/* 翻译和OCR统计 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>翻译统计</CardTitle>
                <CardDescription>翻译请求和文本处理统计</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span>总文本数:</span>
                  <span className="font-medium">{metrics.translation.totalTexts}</span>
                </div>
                <div className="flex justify-between">
                  <span>总字符数:</span>
                  <span className="font-medium">{metrics.translation.totalCharacters.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>平均文本长度:</span>
                  <span className="font-medium">{metrics.translation.averageTextLength.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>批处理请求:</span>
                  <span className="font-medium">{metrics.translation.batchRequests}</span>
                </div>
                <div className="flex justify-between">
                  <span>单个请求:</span>
                  <span className="font-medium">{metrics.translation.singleRequests}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>OCR统计</CardTitle>
                <CardDescription>图像处理和文字识别统计</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span>处理图像数:</span>
                  <span className="font-medium">{metrics.ocr.totalImages}</span>
                </div>
                <div className="flex justify-between">
                  <span>识别文本区域:</span>
                  <span className="font-medium">{metrics.ocr.totalTextAreas}</span>
                </div>
                <div className="flex justify-between">
                  <span>平均区域/图像:</span>
                  <span className="font-medium">{metrics.ocr.averageAreasPerImage.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>平均处理时间:</span>
                  <span className="font-medium">{formatDuration(metrics.ocr.averageProcessingTime)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* API性能标签页 */}
        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API调用详情</CardTitle>
              <CardDescription>详细的API性能指标和趋势</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{metrics.apiCalls.total}</div>
                  <div className="text-sm text-gray-500">总调用次数</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{metrics.apiCalls.successful}</div>
                  <div className="text-sm text-gray-500">成功调用</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{metrics.apiCalls.failed}</div>
                  <div className="text-sm text-gray-500">失败调用</div>
                </div>
              </div>
              
              <div className="mt-6">
                <h4 className="font-medium mb-2">响应时间分析</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>平均响应时间:</span>
                    <span className="font-medium">{formatDuration(metrics.apiCalls.averageResponseTime)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>总响应时间:</span>
                    <span className="font-medium">{formatDuration(metrics.apiCalls.totalResponseTime)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 缓存分析标签页 */}
        <TabsContent value="cache" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>缓存性能</CardTitle>
                <CardDescription>缓存命中率和存储使用情况</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span>命中次数:</span>
                  <span className="font-medium">{metrics.cache.hits}</span>
                </div>
                <div className="flex justify-between">
                  <span>未命中次数:</span>
                  <span className="font-medium">{metrics.cache.misses}</span>
                </div>
                <div className="flex justify-between">
                  <span>命中率:</span>
                  <span className="font-medium">{(metrics.cache.hitRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>缓存大小:</span>
                  <span className="font-medium">{formatBytes(metrics.cache.totalSize)}</span>
                </div>
              </CardContent>
            </Card>

            {cacheStats && (
              <Card>
                <CardHeader>
                  <CardTitle>缓存详情</CardTitle>
                  <CardDescription>缓存项目和使用统计</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>缓存项数量:</span>
                    <span className="font-medium">{cacheStats.itemCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>平均项大小:</span>
                    <span className="font-medium">{formatBytes(cacheStats.averageItemSize)}</span>
                  </div>
                  
                  {cacheStats.topKeys && cacheStats.topKeys.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">热门缓存项</h4>
                      <div className="space-y-1">
                        {cacheStats.topKeys.slice(0, 5).map((item: any, index: number) => (
                          <div key={index} className="flex justify-between text-sm">
                            <span className="truncate max-w-[200px]">{item.key}</span>
                            <span>{item.accessCount}次</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* 错误分析标签页 */}
        <TabsContent value="errors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>错误统计</CardTitle>
              <CardDescription>错误类型和提供者错误分析</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-3">按错误类型</h4>
                  <div className="space-y-2">
                    {Object.entries(metrics.errors.byType).map(([type, count]) => (
                      <div key={type} className="flex justify-between">
                        <span className="text-sm">{type}:</span>
                        <span className="font-medium">{count as number}</span>
                      </div>
                    ))}
                    {Object.keys(metrics.errors.byType).length === 0 && (
                      <p className="text-sm text-gray-500">暂无错误记录</p>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-3">按提供者</h4>
                  <div className="space-y-2">
                    {Object.entries(metrics.errors.byProvider).map(([provider, count]) => (
                      <div key={provider} className="flex justify-between">
                        <span className="text-sm">{provider}:</span>
                        <span className="font-medium">{count as number}</span>
                      </div>
                    ))}
                    {Object.keys(metrics.errors.byProvider).length === 0 && (
                      <p className="text-sm text-gray-500">暂无错误记录</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{metrics.errors.total}</div>
                  <div className="text-sm text-gray-500">总错误数</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 优化建议标签页 */}
        <TabsContent value="recommendations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>性能优化建议</CardTitle>
              <CardDescription>基于当前性能数据的优化建议</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {(() => {
                  const report = performanceMonitor.getPerformanceReport();
                  return report.recommendations.map((recommendation, index) => (
                    <div key={index} className="p-3 border-l-4 border-blue-500 bg-blue-50">
                      <p className="text-sm">{recommendation}</p>
                    </div>
                  ));
                })()}

                {strategyReport && strategyReport.recommendations && (
                  <>
                    <h4 className="font-medium mt-6 mb-3">缓存策略建议</h4>
                    {strategyReport.recommendations.map((recommendation: string, index: number) => (
                      <div key={index} className="p-3 border-l-4 border-green-500 bg-green-50">
                        <p className="text-sm">{recommendation}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
