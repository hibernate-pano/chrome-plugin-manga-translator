import React from 'react';

const AdvancedSettings = ({ settings, onChange }) => {
  const handleChange = (key, value) => {
    onChange({
      ...settings,
      [key]: value
    });
  };

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">高级设置</h2>
      
      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={settings?.useLocalOcr || false}
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
            checked={settings?.debugMode || false}
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
            checked={settings?.showOriginalText || false}
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
          API请求超时 (秒)
        </label>
        <input
          type="number"
          min="5"
          max="120"
          value={settings?.apiTimeout || 30}
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
          value={settings?.maxConcurrentRequests || 3}
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
          value={settings?.imagePreprocessing || 'none'}
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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          翻译提示词
        </label>
        <textarea
          value={settings?.translationPrompt || ''}
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
