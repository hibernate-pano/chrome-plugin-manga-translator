/**
 * 简化版设置页面
 * 只包含核心设置：API 配置
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import React from 'react';
import { SimpleApiSettings } from './SimpleApiSettings';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export interface SimpleSettingsPageProps {
  onBack?: () => void;
  showBackButton?: boolean;
}

export const SimpleSettingsPage: React.FC<SimpleSettingsPageProps> = ({
  onBack,
  showBackButton = false,
}) => {
  const handleConfigured = () => {
    // 配置完成后可以关闭页面或返回
    if (onBack) {
      onBack();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 页面头部 */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {showBackButton && onBack && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onBack}
                  aria-label="返回"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div>
                <h1 className="text-xl font-bold">漫画翻译助手</h1>
                <p className="text-sm text-muted-foreground">设置</p>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* 设置内容 */}
      <main className="container mx-auto px-4 py-6 max-w-lg">
        <SimpleApiSettings onConfigured={handleConfigured} />
      </main>

      {/* 页面底部 */}
      <footer className="border-t mt-auto">
        <div className="container mx-auto px-4 py-4">
          <p className="text-center text-sm text-muted-foreground">
            漫画翻译助手 - 简单、方便、易用
          </p>
        </div>
      </footer>
    </div>
  );
};

export default SimpleSettingsPage;
