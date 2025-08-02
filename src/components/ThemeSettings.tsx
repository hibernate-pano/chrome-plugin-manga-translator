/**
 * 主题设置组件
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfigStore } from '@/stores/config';

export interface ThemeSettingsProps {
  className?: string;
}

export const ThemeSettings: React.FC<ThemeSettingsProps> = ({ className }) => {
  const { config, updateConfig } = useConfigStore();

  const handleThemeChange = (theme: 'light' | 'dark' | 'auto') => {
    updateConfig({
      ui: {
        ...config.ui,
        theme,
      },
    });
  };

  const handleAnimationsToggle = (enabled: boolean) => {
    updateConfig({
      ui: {
        ...config.ui,
        animations: enabled,
      },
    });
  };

  const handleCompactModeToggle = (enabled: boolean) => {
    updateConfig({
      ui: {
        ...config.ui,
        compactMode: enabled,
      },
    });
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>主题设置</CardTitle>
        <CardDescription>
          自定义界面外观和主题偏好
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="theme-select">主题模式</Label>
          <Select
            value={config.ui?.theme || 'auto'}
            onValueChange={handleThemeChange}
          >
            <SelectTrigger id="theme-select">
              <SelectValue placeholder="选择主题" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">浅色模式</SelectItem>
              <SelectItem value="dark">深色模式</SelectItem>
              <SelectItem value="auto">跟随系统</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="animations-switch">动画效果</Label>
            <div className="text-sm text-muted-foreground">
              启用界面动画和过渡效果
            </div>
          </div>
          <Switch
            id="animations-switch"
            checked={config.ui?.animations ?? true}
            onCheckedChange={handleAnimationsToggle}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="compact-mode-switch">紧凑模式</Label>
            <div className="text-sm text-muted-foreground">
              减少界面元素间距，显示更多内容
            </div>
          </div>
          <Switch
            id="compact-mode-switch"
            checked={config.ui?.compactMode ?? false}
            onCheckedChange={handleCompactModeToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default ThemeSettings;
