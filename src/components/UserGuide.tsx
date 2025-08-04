import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, X, HelpCircle, Keyboard, Zap } from 'lucide-react';

// ==================== 引导步骤类型 ====================

interface GuideStep {
  id: string;
  title: string;
  description: string;
  content: React.ReactNode;
  target?: string; // CSS选择器，用于高亮目标元素
  position?: 'top' | 'bottom' | 'left' | 'right';
}

interface UserGuideProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  className?: string;
}

// ==================== 引导步骤数据 ====================

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: '欢迎使用漫画翻译助手',
    description: '让我们开始您的翻译之旅',
    content: (
      <div className="text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Zap className="w-8 h-8 text-blue-600" />
        </div>
        <h3 className="text-lg font-semibold mb-2">欢迎使用漫画翻译助手</h3>
        <p className="text-gray-600 mb-4">
          这款插件可以帮助您翻译外文漫画，保持原有文字样式，提供沉浸式阅读体验。
        </p>
        <div className="bg-blue-50 p-3 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>主要功能：</strong>
          </p>
          <ul className="text-sm text-blue-700 mt-2 space-y-1">
            <li>• 自动检测漫画页面中的文字区域</li>
            <li>• 智能OCR文字识别</li>
            <li>• 多语言翻译支持</li>
            <li>• 保持原有文字样式</li>
            <li>• 缓存翻译结果，提高效率</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: 'setup',
    title: '初始设置',
    description: '配置API密钥和基本设置',
    content: (
      <div>
        <h3 className="text-lg font-semibold mb-3">初始设置</h3>
        <div className="space-y-4">
          <div className="bg-yellow-50 p-3 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>重要：</strong> 您需要配置API密钥才能使用翻译功能。
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-gray-700">
              <strong>支持的AI服务：</strong>
            </p>
            <ul className="text-sm text-gray-600 space-y-1 ml-4">
              <li>• OpenAI GPT-4 Vision</li>
              <li>• DeepSeek VL</li>
              <li>• Claude 3 Opus</li>
              <li>• Qwen VL</li>
            </ul>
          </div>
          <div className="bg-green-50 p-3 rounded-lg">
            <p className="text-sm text-green-800">
              <strong>安全提示：</strong> 您的API密钥仅存储在本地浏览器中，不会发送到任何第三方服务器。
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'modes',
    title: '翻译模式',
    description: '了解手动和自动翻译模式',
    content: (
      <div>
        <h3 className="text-lg font-semibold mb-3">翻译模式</h3>
        <div className="space-y-4">
          <div className="border rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">手动模式</h4>
            <p className="text-sm text-gray-600 mb-2">
              点击需要翻译的图像，插件会自动检测文字区域并进行翻译。
            </p>
            <div className="flex items-center text-xs text-gray-500">
              <Keyboard className="w-3 h-3 mr-1" />
              快捷键：Alt + S
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">自动模式</h4>
            <p className="text-sm text-gray-600 mb-2">
              浏览漫画页面时，插件会自动检测并翻译页面上的所有漫画图像。
            </p>
            <div className="flex items-center text-xs text-gray-500">
              <Keyboard className="w-3 h-3 mr-1" />
              快捷键：Alt + T
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'shortcuts',
    title: '快捷键',
    description: '掌握常用快捷键',
    content: (
      <div>
        <h3 className="text-lg font-semibold mb-3">快捷键</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span className="text-sm text-gray-700">启用/禁用翻译</span>
            <kbd className="px-2 py-1 text-xs bg-white border rounded">Alt + T</kbd>
          </div>
          <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span className="text-sm text-gray-700">翻译选中图像</span>
            <kbd className="px-2 py-1 text-xs bg-white border rounded">Alt + S</kbd>
          </div>
          <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span className="text-sm text-gray-700">打开设置</span>
            <kbd className="px-2 py-1 text-xs bg-white border rounded">Alt + O</kbd>
          </div>
          <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span className="text-sm text-gray-700">清除翻译</span>
            <kbd className="px-2 py-1 text-xs bg-white border rounded">Alt + C</kbd>
          </div>
        </div>
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-xs text-blue-800">
            <strong>提示：</strong> 您可以在设置中自定义这些快捷键。
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'settings',
    title: '高级设置',
    description: '个性化您的翻译体验',
    content: (
      <div>
        <h3 className="text-lg font-semibold mb-3">高级设置</h3>
        <div className="space-y-3">
          <div className="border rounded-lg p-3">
            <h4 className="font-medium text-gray-900 mb-1">样式设置</h4>
            <p className="text-xs text-gray-600">
              自定义字体、大小、颜色等，让翻译结果更符合您的阅读习惯。
            </p>
          </div>
          <div className="border rounded-lg p-3">
            <h4 className="font-medium text-gray-900 mb-1">缓存管理</h4>
            <p className="text-xs text-gray-600">
              管理翻译缓存，提高翻译速度，节省API调用次数。
            </p>
          </div>
          <div className="border rounded-lg p-3">
            <h4 className="font-medium text-gray-900 mb-1">性能监控</h4>
            <p className="text-xs text-gray-600">
              查看翻译性能指标，优化使用体验。
            </p>
          </div>
        </div>
        <div className="mt-4 p-3 bg-green-50 rounded-lg">
          <p className="text-xs text-green-800">
            <strong>建议：</strong> 首次使用建议保持默认设置，熟悉后再进行个性化调整。
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'complete',
    title: '开始使用',
    description: '您已经准备好开始翻译了',
    content: (
      <div className="text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <HelpCircle className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-lg font-semibold mb-2">准备就绪！</h3>
        <p className="text-gray-600 mb-4">
          您已经了解了漫画翻译助手的基本功能，现在可以开始使用了。
        </p>
        <div className="bg-blue-50 p-3 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>下一步：</strong>
          </p>
          <ol className="text-sm text-blue-700 mt-2 space-y-1 text-left">
            <li>1. 配置您的API密钥</li>
            <li>2. 选择目标翻译语言</li>
            <li>3. 访问您喜欢的漫画网站</li>
            <li>4. 开始享受翻译体验！</li>
          </ol>
        </div>
        <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
          <p className="text-xs text-yellow-800">
            <strong>需要帮助？</strong> 随时点击插件图标中的帮助按钮。
          </p>
        </div>
      </div>
    ),
  },
];

// ==================== 用户引导组件 ====================

export const UserGuide: React.FC<UserGuideProps> = ({
  isOpen,
  onClose,
  onComplete,
  className,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [_hasSeenGuide, setHasSeenGuide] = useState(false);

  // 检查是否已经看过引导
  useEffect(() => {
    const seen = localStorage.getItem('manga-translator-guide-seen');
    setHasSeenGuide(seen === 'true');
  }, []);

  // 标记引导已完成
  const markGuideComplete = () => {
    localStorage.setItem('manga-translator-guide-seen', 'true');
    setHasSeenGuide(true);
  };

  const handleNext = () => {
    if (currentStep < GUIDE_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      markGuideComplete();
      onComplete?.();
      onClose();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    markGuideComplete();
    onClose();
  };

  const currentStepData = GUIDE_STEPS[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === GUIDE_STEPS.length - 1;

  if (!isOpen || !currentStepData) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={cn('bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-hidden', className)}>
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-2">
            <HelpCircle className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium text-gray-900">
              使用指南 ({currentStep + 1}/{GUIDE_STEPS.length})
            </span>
          </div>
          <button
            onClick={handleSkip}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {currentStepData.title}
            </h2>
            <p className="text-sm text-gray-600">
              {currentStepData.description}
            </p>
          </div>
          
          <div className="mb-6">
            {currentStepData.content}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <button
            onClick={handlePrevious}
            disabled={isFirstStep}
            className={cn(
              'flex items-center space-x-1 px-3 py-2 text-sm font-medium rounded-md',
              isFirstStep
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
            )}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>上一步</span>
          </button>

          <div className="flex space-x-2">
            {!isLastStep && (
              <button
                onClick={handleSkip}
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                跳过
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              {isLastStep ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== 引导触发器组件 ====================

interface GuideTriggerProps {
  onStart: () => void;
  className?: string;
}

export const GuideTrigger: React.FC<GuideTriggerProps> = ({ onStart, className }) => {
  return (
    <button
      onClick={onStart}
      className={cn(
        'flex items-center space-x-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500',
        className
      )}
    >
      <HelpCircle className="w-4 h-4" />
      <span>使用指南</span>
    </button>
  );
};

// ==================== 引导Hook ====================

export const useUserGuide = () => {
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [hasSeenGuide, setHasSeenGuide] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem('manga-translator-guide-seen');
    setHasSeenGuide(seen === 'true');
  }, []);

  const openGuide = () => setIsGuideOpen(true);
  const closeGuide = () => setIsGuideOpen(false);

  const shouldShowGuide = !hasSeenGuide;

  return {
    isGuideOpen,
    hasSeenGuide,
    shouldShowGuide,
    openGuide,
    closeGuide,
  };
};

// 所有组件已经在上面导出，这里不需要重复导出 