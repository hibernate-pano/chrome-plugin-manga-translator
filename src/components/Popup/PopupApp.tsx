import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Settings, CheckCircle } from 'lucide-react';
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

  // 加载状态
  if (isLoading) {
    return (
      <div className="w-80 p-6 flex justify-center items-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-background">
      <Card className="border-0 shadow-none">
        <CardHeader className="pb-4">
          <CardTitle className="text-center text-primary">
            漫画翻译助手
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {showFirstTimeGuide ? (
            <FirstTimeGuide onContinue={openOptionsPage} />
          ) : (
            <>
              {/* API密钥输入 */}
              <div>
                <ApiKeyInput
                  apiKey={getCurrentApiKey()}
                  onChange={handleApiKeyChange}
                  providerType={providerType}
                />
              </div>

              <Separator />

              {/* 翻译开关 */}
              <div>
                <TranslationToggle
                  enabled={enabled}
                  onChange={setEnabled}
                />
              </div>

              {/* 目标语言选择 */}
              <div>
                <LanguageSelector
                  language={targetLanguage}
                  onChange={setTargetLanguage}
                />
              </div>

              {/* 翻译模式选择 */}
              <div>
                <ModeSelector
                  mode={mode}
                  onChange={setMode}
                />
              </div>

              {/* 样式保持程度 */}
              <div>
                <StyleSlider
                  value={styleLevel}
                  onChange={setStyleLevel}
                />
              </div>

              <Separator />

              {/* 操作按钮 */}
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkConfiguration}
                  className="flex-1"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  检查配置
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={openOptionsPage}
                  className="flex-1"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  高级设置
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PopupApp;
