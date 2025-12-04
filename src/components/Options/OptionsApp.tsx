import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Navigation, optionsNavigationItems } from '@/components/ui/navigation';
import {
  LayoutSection,
  LayoutContainer,
  ResponsiveSidebarLayout,
  Breadcrumb,
} from '@/components/ui/layout';
import { PageTransition, FloatingElement, AnimatedContainer } from '@/components/ui/animated-container';
import { useConfigStore } from '@/stores/config';
import { Save, RotateCcw } from 'lucide-react';
import { QueryProvider } from '@/components/providers/QueryProvider';

// 导入历史记录组件
import { HistoryManager } from '../History/HistoryManager';

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

  // 获取标签标题的辅助函数
  const getTabTitle = (tabId: string) => {
    const item = optionsNavigationItems.find(item => {
      if (item.id === tabId) return true;
      return item.children?.some(child => child.id === tabId);
    });

    if (item) {
      if (item.id === tabId) return item.label;
      const child = item.children?.find(child => child.id === tabId);
      return child?.label || item.label;
    }

    return '未知设置';
  };

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





  if (isLoading) {
    return (
      <LayoutContainer maxWidth="full" className="min-h-screen flex items-center justify-center">
        <AnimatedContainer direction="fade">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </AnimatedContainer>
      </LayoutContainer>
    );
  }

  // 面包屑导航数据
  const breadcrumbItems = [
    { label: '设置' },
    { label: getTabTitle(activeTab) },
  ];

  // 侧边栏内容
  const sidebarContent = (
    <div className="p-4">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">设置分类</h2>
        <p className="text-sm text-muted-foreground">
          选择要配置的设置类别
        </p>
      </div>

      <Navigation
        items={optionsNavigationItems}
        activeItem={activeTab}
        onItemClick={setActiveTab}
        orientation="vertical"
        variant="sidebar"
        showTooltips={true}
        collapsible={true}
        defaultCollapsed={false}
      />
    </div>
  );

  return (
    <QueryProvider>
      <ResponsiveSidebarLayout
        sidebar={sidebarContent}
        sidebarWidth="md"
        collapsible={true}
        defaultCollapsed={false}
        className="min-h-screen"
      >
        <div className="flex flex-col h-full">
          {/* 页面头部 */}
          <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">漫画翻译助手</h1>
                  <p className="text-muted-foreground">配置翻译参数、API设置和个性化选项</p>
                </div>
                <FloatingElement intensity="subtle">
                  <ThemeToggle />
                </FloatingElement>
              </div>

              <Breadcrumb items={breadcrumbItems} />
            </div>
          </div>

          {/* 设置内容 */}
          <div className="flex-1 p-6">
            <PageTransition key={activeTab}>
              <Card className="h-full">
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

                  {(activeTab === 'api-openai' || activeTab === 'api-deepseek' || activeTab === 'api-claude') && (
                    <LayoutSection
                      title={`${getTabTitle(activeTab)}配置`}
                      description={`配置${getTabTitle(activeTab)}的API参数`}
                      variant="minimal"
                    >
                      <div className="space-y-4">
                        <p className="text-muted-foreground">
                          {getTabTitle(activeTab)}配置组件正在重构中...
                        </p>
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
                        <FloatingElement intensity="subtle">
                          <Button
                            variant="outline"
                            onClick={() => {
                              // 清除缓存的逻辑
                              console.log('清除缓存');
                            }}
                          >
                            清除所有缓存
                          </Button>
                        </FloatingElement>
                      </div>
                    </LayoutSection>
                  )}

                  {activeTab === 'history' && (
                    <HistoryManager />
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
            </PageTransition>
          </div>

          {/* 底部操作栏 */}
          <div className="border-t bg-card/50 backdrop-blur-sm p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {hasUnsavedChanges && (
                  <span className="text-orange-600">● 有未保存的更改</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <FloatingElement intensity="subtle">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // 重置逻辑
                      console.log('重置设置');
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    重置
                  </Button>
                </FloatingElement>
                <FloatingElement intensity="subtle">
                  <Button
                    size="sm"
                    onClick={saveConfiguration}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    保存设置
                  </Button>
                </FloatingElement>
              </div>
            </div>
          </div>
        </div>
      </ResponsiveSidebarLayout>
    </QueryProvider>
  );
};

export default OptionsApp;
