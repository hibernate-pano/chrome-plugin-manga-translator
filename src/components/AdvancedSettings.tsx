/**
 * 高级设置组件
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useConfigStore } from '@/stores/config';

export interface AdvancedSettingsProps {
  className?: string;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ className }) => {
  const store = useConfigStore();

  const handleDebugModeToggle = (enabled: boolean) => {
    store.updateAdvancedSettings({
      debugMode: enabled,
    });
  };

  const handlePerformanceMonitoringToggle = (enabled: boolean) => {
    store.updateAdvancedSettings({
      debugMode: enabled, // 使用debugMode作为性能监控的替代
    });
  };

  const handleCacheMaxSizeChange = (value: number[]) => {
    store.updateAdvancedSettings({
      maxCacheSize: value[0],
    });
  };

  const handleMaxConcurrentRequestsChange = (value: number[]) => {
    store.updateAdvancedSettings({
      maxConcurrentRequests: value[0],
    });
  };

  const handleRequestTimeoutChange = (value: string) => {
    const timeout = parseInt(value, 10);
    if (!isNaN(timeout)) {
      store.updateAdvancedSettings({
        apiTimeout: timeout,
      });
    }
  };

  const handleLogLevelChange = (level: string) => {
    // 由于当前配置中没有logLevel，我们暂时使用debugMode
    store.updateAdvancedSettings({
      debugMode: level === 'debug',
    });
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>高级设置</CardTitle>
        <CardDescription>
          配置高级功能和性能参数
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="debug-mode-switch">调试模式</Label>
            <div className="text-sm text-muted-foreground">
              启用详细的调试信息和日志
            </div>
          </div>
          <Switch
            id="debug-mode-switch"
            checked={store.advancedSettings?.debugMode ?? false}
            onCheckedChange={handleDebugModeToggle}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="performance-monitoring-switch">性能监控</Label>
            <div className="text-sm text-muted-foreground">
              监控和记录性能指标
            </div>
          </div>
          <Switch
            id="performance-monitoring-switch"
            checked={store.advancedSettings?.debugMode ?? true}
            onCheckedChange={handlePerformanceMonitoringToggle}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cache-max-size">缓存最大大小 (MB)</Label>
          <div className="px-3">
            <Slider
              id="cache-max-size"
              min={10}
              max={500}
              step={10}
              value={[store.advancedSettings?.maxCacheSize ?? 100]}
              onValueChange={handleCacheMaxSizeChange}
              className="w-full"
            />
          </div>
          <div className="text-sm text-muted-foreground text-center">
            {store.advancedSettings?.maxCacheSize ?? 100} MB
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max-concurrent-requests">最大并发请求数</Label>
          <div className="px-3">
            <Slider
              id="max-concurrent-requests"
              min={1}
              max={10}
              step={1}
              value={[store.advancedSettings?.maxConcurrentRequests ?? 3]}
              onValueChange={handleMaxConcurrentRequestsChange}
              className="w-full"
            />
          </div>
          <div className="text-sm text-muted-foreground text-center">
            {store.advancedSettings?.maxConcurrentRequests ?? 3} 个请求
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="request-timeout">请求超时时间 (秒)</Label>
          <Input
            id="request-timeout"
            type="number"
            min="5"
            max="120"
            value={store.advancedSettings?.apiTimeout ?? 30}
            onChange={(e) => handleRequestTimeoutChange(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="log-level">日志级别</Label>
          <Select
            value={store.advancedSettings?.debugMode ? 'debug' : 'info'}
            onValueChange={handleLogLevelChange}
          >
            <SelectTrigger id="log-level">
              <SelectValue placeholder="选择日志级别" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debug">调试 (Debug)</SelectItem>
              <SelectItem value="info">信息 (Info)</SelectItem>
              <SelectItem value="warn">警告 (Warn)</SelectItem>
              <SelectItem value="error">错误 (Error)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
          <h4 className="font-medium text-orange-800 dark:text-orange-200 mb-2">
            警告
          </h4>
          <p className="text-sm text-orange-700 dark:text-orange-300">
            修改这些高级设置可能会影响插件的性能和稳定性。
            如果遇到问题，请恢复默认设置。
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default AdvancedSettings;
