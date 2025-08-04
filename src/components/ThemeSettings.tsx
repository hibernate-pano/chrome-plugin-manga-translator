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
  const configStore = useConfigStore();

  const handleThemeChange = (_theme: 'light' | 'dark' | 'auto') => {
    // 主题设置暂时存储在高级设置中
    configStore.updateAdvancedSettings({
      ...configStore.advancedSettings,
      // 可以添加主题相关的设置
    });
  };

  const handleAnimationsToggle = (_enabled: boolean) => {
    // 动画设置暂时存储在高级设置中
    configStore.updateAdvancedSettings({
      ...configStore.advancedSettings,
      // 可以添加动画相关的设置
    });
  };

  const handleCompactModeToggle = (_enabled: boolean) => {
    // 紧凑模式设置暂时存储在高级设置中
    configStore.updateAdvancedSettings({
      ...configStore.advancedSettings,
      // 可以添加紧凑模式相关的设置
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
            value={'auto'}
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
            checked={true}
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
            checked={false}
            onCheckedChange={handleCompactModeToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default ThemeSettings;
