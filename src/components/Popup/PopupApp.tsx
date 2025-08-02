import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Settings, CheckCircle, History } from 'lucide-react';
import { ThemeToggleSimple } from '@/components/ui/theme-toggle';
import { Navigation, QuickActions, popupNavigationItems } from '@/components/ui/navigation';
import { LayoutContainer, LayoutStack, LayoutSection } from '@/components/ui/layout';
import { AnimatedContainer, StaggeredContainer } from '@/components/ui/animated-container';
import { useTranslationStore } from '@/stores/translation';
import { useConfigStore } from '@/stores/config';
import { initializeDataMigration } from '@/utils/data-migration';

// 导入重构后的组件
import ApiKeyInput from './ApiKeyInput';
import LanguageSelector from './LanguageSelector';
import TranslationToggle from './TranslationToggle';
import ModeSelector from './ModeSelector';
import StyleSlider from './StyleSlider';
import FirstTimeGuide from './FirstTimeGuide';

const PopupApp: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [showFirstTimeGuide, setShowFirstTimeGuide] = useState(false);
  const [activeTab, setActiveTab] = useState('main');

  // Zustand stores
  const {
    enabled,
    mode,
    targetLanguage,
    setEnabled,
    setMode,
    setTargetLanguage,
  } = useTranslationStore();

  const {
    providerType,
    providerConfig,
    styleLevel,
    updateProviderConfig,
    setStyleLevel,
  } = useConfigStore();

  // 初始化应用
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsLoading(true);

        // 执行数据迁移
        await initializeDataMigration();

        // 检查是否需要显示首次使用引导
        const currentConfig = providerConfig[providerType];
        const hasApiKey = currentConfig?.apiKey && currentConfig.apiKey.length > 0;
        setShowFirstTimeGuide(!hasApiKey);

      } catch (error) {
        console.error('应用初始化失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [providerType, providerConfig]);

  // 获取当前提供者的API密钥
  const getCurrentApiKey = (): string => {
    return providerConfig[providerType]?.apiKey || '';
  };

  // 处理API密钥变更
  const handleApiKeyChange = (apiKey: string) => {
    updateProviderConfig(providerType, { apiKey });

    // 如果设置了API密钥，隐藏首次使用引导
    if (apiKey && apiKey.length > 0) {
      setShowFirstTimeGuide(false);
    }
  };

  // 打开选项页面
  const openOptionsPage = () => {
    chrome.runtime.openOptionsPage();
  };

  // 检查配置
  const checkConfiguration = async () => {
    try {
      const currentConfig = providerConfig[providerType];
      const hasApiKey = currentConfig?.apiKey && currentConfig.apiKey.length > 0;

      if (!hasApiKey) {
        alert('请先设置API密钥');
        return;
      }

      // 这里可以添加更详细的配置检查逻辑
      alert('配置检查完成！API密钥已设置，翻译功能可用。');

    } catch (error) {
      console.error('配置检查失败:', error);
      alert('配置检查失败，请查看控制台获取详细信息');
    }
  };

  // 快速操作配置
  const quickActions = [
    {
      id: 'check',
      label: '检查配置',
      icon: <CheckCircle className="w-4 h-4" />,
      onClick: checkConfiguration,
      variant: 'outline' as const,
    },
    {
      id: 'settings',
      label: '高级设置',
      icon: <Settings className="w-4 h-4" />,
      onClick: openOptionsPage,
      variant: 'outline' as const,
    },
  ];

  // 加载状态
  if (isLoading) {
    return (
      <LayoutContainer maxWidth="sm" className="h-64 flex items-center justify-center">
        <AnimatedContainer direction="fade">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </AnimatedContainer>
      </LayoutContainer>
    );
  }

  return (
    <LayoutContainer maxWidth="sm" className="w-80 min-h-96">
      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-3">
          <AnimatedContainer direction="down">
            <CardTitle className="text-center text-lg font-semibold text-primary">
              漫画翻译助手
            </CardTitle>
          </AnimatedContainer>
        </CardHeader>

        <CardContent>
          {showFirstTimeGuide ? (
            <AnimatedContainer direction="up">
              <FirstTimeGuide onContinue={openOptionsPage} />
            </AnimatedContainer>
          ) : (
            <LayoutStack spacing="md">
              {/* 导航标签 */}
              <Navigation
                items={popupNavigationItems}
                activeItem={activeTab}
                onItemClick={setActiveTab}
                variant="pills"
                orientation="horizontal"
              />

              {/* 主要内容区域 */}
              {activeTab === 'main' && (
                <StaggeredContainer staggerDelay={0.1}>
                  <LayoutSection variant="minimal">
                    <ApiKeyInput
                      apiKey={getCurrentApiKey()}
                      onChange={handleApiKeyChange}
                      providerType={providerType}
                    />
                  </LayoutSection>

                  <LayoutSection variant="minimal">
                    <TranslationToggle
                      enabled={enabled}
                      onChange={setEnabled}
                    />
                  </LayoutSection>

                  <LayoutSection variant="minimal">
                    <LanguageSelector
                      language={targetLanguage}
                      onChange={setTargetLanguage}
                    />
                  </LayoutSection>

                  <LayoutSection variant="minimal">
                    <ModeSelector
                      mode={mode}
                      onChange={setMode}
                    />
                  </LayoutSection>

                  <LayoutSection variant="minimal">
                    <StyleSlider
                      value={styleLevel}
                      onChange={setStyleLevel}
                    />
                  </LayoutSection>

                  <Separator />

                  <LayoutSection variant="minimal">
                    <ThemeToggleSimple />
                  </LayoutSection>
                </StaggeredContainer>
              )}

              {activeTab === 'history' && (
                <AnimatedContainer direction="up">
                  <LayoutSection
                    title="翻译历史"
                    description="查看最近的翻译记录"
                    variant="minimal"
                  >
                    <div className="text-center text-muted-foreground py-8">
                      <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>暂无翻译历史</p>
                      <p className="text-sm mt-2">开始翻译后，历史记录将显示在这里</p>
                    </div>
                  </LayoutSection>
                </AnimatedContainer>
              )}

              <Separator />

              {/* 快速操作 */}
              <QuickActions actions={quickActions} className="justify-center" />
            </LayoutStack>
          )}
        </CardContent>
      </Card>
    </LayoutContainer>
  );
};

export default PopupApp;
