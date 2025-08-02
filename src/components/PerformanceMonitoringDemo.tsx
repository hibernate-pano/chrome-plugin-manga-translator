import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription } from './ui/alert';
import {
  usePerformanceStats,
  useRecentMetrics,
  usePerformanceAlerts,
  usePerformanceTimer,
  usePerformanceExport,
  useRealTimePerformanceMonitoring
} from '../hooks/usePerformanceMonitoring';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  AlertCircle,
  Activity,
  Clock,
  Zap,
  Download
} from 'lucide-react';

/**
 * 性能监控演示组件
 */
export function PerformanceMonitoringDemo() {
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('1h');

  // 计算时间范围
  const getTimeRange = () => {
    const now = Date.now();
    const ranges = {
      '1h': { start: now - 60 * 60 * 1000, end: now },
      '24h': { start: now - 24 * 60 * 60 * 1000, end: now },
      '7d': { start: now - 7 * 24 * 60 * 60 * 1000, end: now },
      '30d': { start: now - 30 * 24 * 60 * 60 * 1000, end: now },
    };
    return ranges[timeRange];
  };

  // 查询钩子
  const { data: stats, isLoading: statsLoading } = usePerformanceStats(
    selectedCategory || undefined,
    getTimeRange()
  );
  const { data: recentMetrics } = useRecentMetrics(50, selectedCategory || undefined);
  const { data: alerts } = usePerformanceAlerts();

  // 功能钩子
  const { startTimer, endTimer, measureAsync } = usePerformanceTimer();
  const exportMutation = usePerformanceExport();
  useRealTimePerformanceMonitoring();

  // 测试功能
  const handleTestAPICall = async () => {
    await measureAsync(
      'test_api_call',
      'api',
      () => new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500)),
      { provider: 'test', endpoint: '/test', method: 'GET' }
    );
  };

  const handleTestTranslation = async () => {
    await measureAsync(
      'test_translation',
      'translation',
      () => new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000)),
      {
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        textLength: 50,
        provider: 'test',
        cacheHit: Math.random() > 0.5,
        qualityScore: 0.8 + Math.random() * 0.2,
      }
    );
  };

  const handleTestUIAction = () => {
    const timerId = 'ui_test';
    startTimer(timerId);
    setTimeout(() => {
      endTimer(timerId, 'test_ui_render', 'ui', {
        component: 'TestComponent',
        action: 'render',
      });
    }, Math.random() * 200 + 50);
  };

  const handleExport = (format: 'json' | 'csv') => {
    exportMutation.mutate({
      format,
      category: selectedCategory || undefined,
      timeRange: getTimeRange(),
    });
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'improving':
        return <TrendingDown className="h-4 w-4 text-green-500" />;
      case 'degrading':
        return <TrendingUp className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  const getAlertIcon = (level: string) => {
    return level === 'critical' ?
      <AlertCircle className="h-4 w-4 text-red-500" /> :
      <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  };

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">加载性能数据...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">性能监控系统</h2>
          <p className="text-muted-foreground">
            实时监控API响应时间、翻译质量和用户体验指标
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="flex items-center space-x-1">
            <Activity className="h-3 w-3" />
            <span>实时监控</span>
          </Badge>
        </div>
      </div>

      {/* 性能警报 */}
      {alerts && alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.slice(0, 3).map((alert) => (
            <Alert key={alert.id} variant={alert.level === 'critical' ? 'destructive' : 'default'}>
              {getAlertIcon(alert.level)}
              <AlertDescription>
                <div className="flex items-center justify-between">
                  <span>{alert.message}</span>
                  <Badge variant={alert.level === 'critical' ? 'destructive' : 'secondary'}>
                    {alert.level === 'critical' ? '严重' : '警告'}
                  </Badge>
                </div>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* 控制面板 */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium">类别:</label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1 border rounded text-sm"
          >
            <option value="">全部</option>
            <option value="api">API</option>
            <option value="translation">翻译</option>
            <option value="ui">UI</option>
            <option value="cache">缓存</option>
            <option value="ocr">OCR</option>
          </select>
        </div>

        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium">时间范围:</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
            className="px-3 py-1 border rounded text-sm"
          >
            <option value="1h">最近1小时</option>
            <option value="24h">最近24小时</option>
            <option value="7d">最近7天</option>
            <option value="30d">最近30天</option>
          </select>
        </div>

        <div className="flex space-x-2">
          <Button onClick={() => handleExport('json')} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            导出JSON
          </Button>
          <Button onClick={() => handleExport('csv')} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            导出CSV
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="metrics">详细指标</TabsTrigger>
          <TabsTrigger value="alerts">警报管理</TabsTrigger>
          <TabsTrigger value="testing">性能测试</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* 关键指标卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">平均响应时间</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats ? Object.values(stats).reduce((sum, stat) => sum + stat.average, 0) / Object.keys(stats).length || 0 : 0}ms
                </div>
                <p className="text-xs text-muted-foreground">
                  过去{timeRange}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">总请求数</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats ? Object.values(stats).reduce((sum, stat) => sum + stat.count, 0) : 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  过去{timeRange}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">活跃警报</CardTitle>
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {alerts?.length || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {alerts?.filter(a => a.level === 'critical').length || 0} 严重, {alerts?.filter(a => a.level === 'warning').length || 0} 警告
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">性能趋势</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2">
                  <div className="text-2xl font-bold">
                    {stats ? Object.values(stats).filter(s => s.trend === 'improving').length : 0}
                  </div>
                  <span className="text-sm text-green-500">改善</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {stats ? Object.values(stats).filter(s => s.trend === 'degrading').length : 0} 下降, {stats ? Object.values(stats).filter(s => s.trend === 'stable').length : 0} 稳定
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 性能指标列表 */}
          <Card>
            <CardHeader>
              <CardTitle>性能指标概览</CardTitle>
              <CardDescription>各类型性能指标的统计信息</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats && Object.entries(stats).map(([name, stat]) => (
                  <div key={name} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center space-x-1">
                        {getTrendIcon(stat.trend)}
                        <span className="font-medium">{name}</span>
                      </div>
                      <Badge variant="outline">{stat.category}</Badge>
                    </div>
                    <div className="flex items-center space-x-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">平均: </span>
                        <span className="font-medium">{stat.average.toFixed(1)}ms</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">P95: </span>
                        <span className="font-medium">{stat.p95.toFixed(1)}ms</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">次数: </span>
                        <span className="font-medium">{stat.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>详细性能指标</CardTitle>
              <CardDescription>最近的性能指标记录</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {recentMetrics?.map((metric) => (
                  <div key={metric.id} className="flex items-center justify-between p-2 border rounded text-sm">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline">{metric.category}</Badge>
                      <span className="font-medium">{metric.name}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span>{metric.value.toFixed(1)}{metric.unit}</span>
                      <span className="text-muted-foreground">
                        {new Date(metric.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>性能警报</CardTitle>
              <CardDescription>当前活跃的性能警报和阈值设置</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alerts?.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex items-center space-x-3">
                      {getAlertIcon(alert.level)}
                      <div>
                        <div className="font-medium">{alert.metric}</div>
                        <div className="text-sm text-muted-foreground">{alert.message}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={alert.level === 'critical' ? 'destructive' : 'secondary'}>
                        {alert.level === 'critical' ? '严重' : '警告'}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}

                {(!alerts || alerts.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Zap className="h-8 w-8 mx-auto mb-2" />
                    <p>当前没有性能警报</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="testing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>性能测试</CardTitle>
              <CardDescription>测试各种性能指标的记录功能</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Button onClick={handleTestAPICall} variant="outline">
                  测试API调用
                </Button>
                <Button onClick={handleTestTranslation} variant="outline">
                  测试翻译性能
                </Button>
                <Button onClick={handleTestUIAction} variant="outline">
                  测试UI响应
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                点击按钮将生成模拟的性能指标数据，用于测试监控系统的功能。
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
