import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/hooks/query-client';

interface QueryProviderProps {
  children: React.ReactNode;
}

/**
 * React Query提供者组件
 * 为整个应用提供查询客户端和开发工具
 */
export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* 开发环境下显示React Query开发工具 */}
      {process.env['NODE_ENV'] === 'development' && (
        <ReactQueryDevtools
          initialIsOpen={false}
        />
      )}
    </QueryClientProvider>
  );
}

export default QueryProvider;
