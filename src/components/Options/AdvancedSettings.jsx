import React, { useEffect, useState } from 'react';

const AdvancedSettings = ({ settings, onChange }) => {
  // 使用内部状态来跟踪设置
  const [localSettings, setLocalSettings] = useState(settings || {});

  // 当 props 中的 settings 变化时更新内部状态
  useEffect(() => {
    console.log('AdvancedSettings 接收到新的 settings:', settings);
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const handleChange = (key, value) => {
    const updatedSettings = {
      ...localSettings,
      [key]: value
    };
    setLocalSettings(updatedSettings);
    onChange(updatedSettings);
  };

  // 当组件卸载时保存配置
  useEffect(() => {
    return () => {
      console.log('AdvancedSettings组件卸载，保存配置');
      // 组件卸载时不需要额外操作，因为每次修改都会调用handleChange
    };
  }, []);

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">高级设置</h2>

      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={localSettings?.useLocalOcr || false}
            onChange={(e) => handleChange('useLocalOcr', e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">使用本地OCR (实验性)</span>
        </label>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          使用Tesseract.js进行本地文字识别，减少API调用但可能降低准确性
        </p>
      </div>

      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={localSettings?.debugMode || false}
            onChange={(e) => handleChange('debugMode', e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">调试模式</span>
        </label>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          显示额外的调试信息，包括文字识别区域和API响应
        </p>
      </div>

      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={localSettings?.showOriginalText || false}
            onChange={(e) => handleChange('showOriginalText', e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">显示原文</span>
        </label>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          在翻译结果下方显示原始文本，便于对比学习
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          悬停切换模式
        </label>
        <select
          value={localSettings?.hoverMode || 'hover'}
          onChange={(e) => handleChange('hoverMode', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="hover">悬停切换 (鼠标悬停时显示翻译)</option>
          <option value="click">点击切换 (点击图像切换原文/译文)</option>
          <option value="fixed">固定显示 (始终显示翻译)</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          设置如何在原文和翻译之间切换，悬停模式更接近沉浸式体验
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API请求超时 (秒)
        </label>
        <input
          type="number"
          min="5"
          max="120"
          value={localSettings?.apiTimeout || 30}
          onChange={(e) => handleChange('apiTimeout', parseInt(e.target.value, 10) || 30)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          API请求的最大等待时间，超时后将取消请求
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          最大并发请求数
        </label>
        <input
          type="number"
          min="1"
          max="10"
          value={localSettings?.maxConcurrentRequests || 3}
          onChange={(e) => handleChange('maxConcurrentRequests', parseInt(e.target.value, 10) || 3)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          同时发送的最大API请求数，较高的值可能加快处理但增加API负载
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          图像预处理
        </label>
        <select
          value={localSettings?.imagePreprocessing || 'none'}
          onChange={(e) => handleChange('imagePreprocessing', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="none">无</option>
          <option value="enhance">增强对比度</option>
          <option value="bw">黑白转换</option>
          <option value="adaptive">自适应处理</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          在识别文字前对图像进行预处理，可能提高某些漫画的识别率
        </p>
      </div>

      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={localSettings?.useCorsProxy || false}
            onChange={(e) => handleChange('useCorsProxy', e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">使用CORS代理服务</span>
        </label>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          使用代理服务处理跨域图像，可能解决某些网站的图像无法翻译的问题。注意：这会将图像URL发送到第三方服务。
        </p>

        {localSettings?.useCorsProxy && (
          <div className="mt-2 ml-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CORS代理服务类型
            </label>
            <select
              value={localSettings?.corsProxyType || 'corsproxy'}
              onChange={(e) => handleChange('corsProxyType', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="corsproxy">corsproxy.io (推荐)</option>
              <option value="allorigins">allorigins.win</option>
              <option value="cors-anywhere">cors-anywhere.herokuapp.com</option>
              <option value="custom">自定义代理</option>
            </select>

            {localSettings?.corsProxyType === 'custom' && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  自定义代理URL
                </label>
                <input
                  type="text"
                  value={localSettings?.customCorsProxy || ''}
                  onChange={(e) => handleChange('customCorsProxy', e.target.value)}
                  placeholder="例如: https://your-proxy.com/?url={url}"
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  使用 {'{url}'} 作为图像URL的占位符。URL将会被自动编码。
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          翻译提示词
        </label>
        <textarea
          value={localSettings?.translationPrompt || ''}
          onChange={(e) => handleChange('translationPrompt', e.target.value)}
          placeholder="输入自定义的翻译提示词，指导AI如何翻译"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
        />
        <p className="text-xs text-gray-500 mt-1">
          自定义提示词可以指导AI如何翻译，例如"保持口语化"或"使用更正式的语言"
        </p>
      </div>

      <div className="mt-6 p-4 bg-yellow-50 rounded border border-yellow-200">
        <h3 className="text-sm font-medium text-yellow-800 mb-2">高级设置警告</h3>
        <ul className="text-xs text-yellow-700 list-disc list-inside">
          <li>这些设置可能影响插件的性能和稳定性</li>
          <li>如果遇到问题，请尝试恢复默认设置</li>
          <li>调试模式会在控制台输出大量信息，可能影响性能</li>
          <li>实验性功能可能在未来版本中更改或移除</li>
        </ul>
      </div>
    </div>
  );
};

export default AdvancedSettings;
