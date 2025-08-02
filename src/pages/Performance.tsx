/**
 * 性能监控页面
 */

import React from 'react';
import { PerformanceDashboard } from '@/components/Performance/PerformanceDashboard';

export const Performance: React.FC = () => {
  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">性能监控</h1>
        <p className="text-muted-foreground">
          实时监控插件性能指标和系统状态
        </p>
      </div>

      <PerformanceDashboard />
    </div>
  );
};

export default Performance;
