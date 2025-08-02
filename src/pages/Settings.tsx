/**
 * 设置页面
 */

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeSettings } from '@/components/ThemeSettings';
import { AdvancedSettings } from '@/components/AdvancedSettings';
import { CacheManager } from '@/components/CacheManager';
import { DataImportExport } from '@/components/DataImportExport';

export const Settings: React.FC = () => {
  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">设置</h1>
        <p className="text-muted-foreground">
          配置漫画翻译插件的各项设置
        </p>
      </div>

      <Tabs defaultValue="theme" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="theme">主题</TabsTrigger>
          <TabsTrigger value="advanced">高级</TabsTrigger>
          <TabsTrigger value="cache">缓存</TabsTrigger>
          <TabsTrigger value="data">数据</TabsTrigger>
        </TabsList>

        <TabsContent value="theme" className="space-y-6">
          <ThemeSettings />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-6">
          <AdvancedSettings />
        </TabsContent>

        <TabsContent value="cache" className="space-y-6">
          <CacheManager />
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <DataImportExport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
