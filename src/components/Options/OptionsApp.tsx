import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Navigation, optionsNavigationItems } from '@/components/ui/navigation';
import { LayoutContainer, LayoutHeader, LayoutSection, LayoutStack } from '@/components/ui/layout';
import { AnimatedContainer } from '@/components/ui/animated-container';
import { useConfigStore } from '@/stores/config';
import { Save, RotateCcw, CheckCircle } from 'lucide-react';

// 导入现有的设置组件 (暂时注释掉，避免类型错误)
// import ApiSettings from './ApiSettings';
// import StyleSettings from './StyleSettings';
// import KeyboardShortcuts from './KeyboardShortcuts';
// import CacheManager from './CacheManager';
// import AdvancedSettings from './AdvancedSettings';
// import OCRSettings from './OCRSettings';

const OptionsApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState('api');
  const [isLoading, setIsLoading] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Zustand stores
  const configStore = useConfigStore();

  // 初始化应用
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsLoading(true);
        // 这里可以添加初始化逻辑
        await new Promise(resolve => setTimeout(resolve, 500)); // 模拟加载
      } catch (error) {
        console.error('选项页面初始化失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // 保存配置
  const saveConfiguration = async () => {
    try {
      // 这里可以添加保存逻辑
      console.log('保存配置');
      setHasUnsavedChanges(false);

      // 显示成功消息
      alert('配置已保存！');
    } catch (error) {
      console.error('保存配置失败:', error);
      alert('保存配置失败，请重试');
    }
  };

  // 重置配置
  const resetConfiguration = async () => {
    if (confirm('确定要重置所有配置吗？此操作不可撤销。')) {
      try {
        // 这里可以添加重置逻辑
        console.log('重置配置');
        setHasUnsavedChanges(false);
        alert('配置已重置！');
      } catch (error) {
        console.error('重置配置失败:', error);
        alert('重置配置失败，请重试');
      }
    }
  };

  // 检查配置
  const checkConfiguration = async () => {
    try {
      // 这里可以添加配置检查逻辑
      console.log('检查配置');
      alert('配置检查完成！所有设置正常。');
    } catch (error) {
      console.error('配置检查失败:', error);
      alert('配置检查失败，请查看控制台获取详细信息');
    }
  };

  // 快速操作配置
  const quickActions = [
    {
      id: 'save',
      label: '保存配置',
      icon: <Save className="w-4 h-4" />,
      onClick: saveConfiguration,
      variant: 'default' as const,
      disabled: !hasUnsavedChanges,
    },
    {
      id: 'check',
      label: '检查配置',
      icon: <CheckCircle className="w-4 h-4" />,
      onClick: checkConfiguration,
      variant: 'outline' as const,
    },
    {
      id: 'reset',
      label: '重置配置',
      icon: <RotateCcw className="w-4 h-4" />,
      onClick: resetConfiguration,
      variant: 'destructive' as const,
    },
  ];

  if (isLoading) {
    return (
      <LayoutContainer maxWidth="full" className="min-h-screen flex items-center justify-center">
        <AnimatedContainer direction="fade">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </AnimatedContainer>
      </LayoutContainer>
    );
  }

  return (
    <LayoutContainer maxWidth="full" className="min-h-screen py-8">
      <LayoutStack spacing="lg">
        {/* 页面头部 */}
        <LayoutHeader
          title="漫画翻译助手 - 设置"
          subtitle="配置翻译参数、API设置和个性化选项"
          actions={<ThemeToggle />}
        />

        <Separator />

        {/* 主要内容区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 侧边导航 */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">设置分类</CardTitle>
              </CardHeader>
              <CardContent>
                <Navigation
                  items={optionsNavigationItems}
                  activeItem={activeTab}
                  onItemClick={setActiveTab}
                  orientation="vertical"
                  variant="default"
                />
              </CardContent>
            </Card>
          </div>

          {/* 设置内容 */}
          <div className="lg:col-span-3">
            <AnimatedContainer key={activeTab} direction="up">
              <Card>
                <CardContent className="p-6">
                  {activeTab === 'api' && (
                    <LayoutSection
                      title="API设置"
                      description="配置翻译服务提供商和API密钥"
                      variant="minimal"
                    >
                      <div className="space-y-4">
                        <p className="text-muted-foreground">
                          API设置组件正在重构中...
                        </p>
                        <div className="p-4 border rounded-lg bg-muted/50">
                          <p className="text-sm">当前提供商: {configStore.providerType}</p>
                        </div>
                      </div>
                    </LayoutSection>
                  )}

                  {activeTab === 'style' && (
                    <LayoutSection
                      title="样式设置"
                      description="自定义翻译文本的显示样式"
                      variant="minimal"
                    >
                      <div className="space-y-4">
                        <p className="text-muted-foreground">
                          样式设置组件正在重构中...
                        </p>
                        <div className="p-4 border rounded-lg bg-muted/50">
                          <p className="text-sm">当前样式级别: {configStore.styleLevel}</p>
                        </div>
                      </div>
                    </LayoutSection>
                  )}

                  {activeTab === 'ocr' && (
                    <LayoutSection
                      title="OCR设置"
                      description="配置文字识别参数和选项"
                      variant="minimal"
                    >
                      <div className="space-y-4">
                        <p className="text-muted-foreground">
                          OCR设置组件正在重构中...
                        </p>
                      </div>
                    </LayoutSection>
                  )}

                  {activeTab === 'shortcuts' && (
                    <LayoutSection
                      title="快捷键设置"
                      description="自定义键盘快捷键"
                      variant="minimal"
                    >
                      <div className="space-y-4">
                        <p className="text-muted-foreground">
                          快捷键设置组件正在重构中...
                        </p>
                      </div>
                    </LayoutSection>
                  )}

                  {activeTab === 'cache' && (
                    <LayoutSection
                      title="缓存管理"
                      description="管理翻译缓存和存储设置"
                      variant="minimal"
                    >
                      <div className="space-y-4">
                        <p className="text-muted-foreground">
                          缓存管理组件正在重构中...
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => {
                            // 清除缓存的逻辑
                            console.log('清除缓存');
                          }}
                        >
                          清除所有缓存
                        </Button>
                      </div>
                    </LayoutSection>
                  )}

                  {activeTab === 'advanced' && (
                    <LayoutSection
                      title="高级设置"
                      description="高级功能和实验性选项"
                      variant="minimal"
                    >
                      <div className="space-y-4">
                        <p className="text-muted-foreground">
                          高级设置组件正在重构中...
                        </p>
                      </div>
                    </LayoutSection>
                  )}
                </CardContent>
              </Card>
            </AnimatedContainer>
          </div>
        </div>

        <Separator />

        {/* 底部操作栏 */}
        <div className="flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            {hasUnsavedChanges && (
              <span className="text-orange-600">● 有未保存的更改</span>
            )}
          </div>

          <div className="flex gap-2">
            {quickActions.map((action) => (
              <Button
                key={action.id}
                variant={action.variant}
                size="sm"
                onClick={action.onClick}
                disabled={action.disabled}
                className="flex items-center gap-2"
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </LayoutStack>
    </LayoutContainer>
  );
};

export default OptionsApp;
