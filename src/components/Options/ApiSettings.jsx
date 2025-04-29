import React, { useState } from 'react';

const ApiSettings = ({ config, onChange }) => {
  const [apiKey, setApiKey] = useState(config.apiKey || '');
  const [model, setModel] = useState(config.model || 'gpt-3.5-turbo');
  const [temperature, setTemperature] = useState(config.temperature || 0.7);
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    onChange({
      apiKey,
      model,
      temperature
    });
  };

  const toggleShowKey = () => {
    setShowKey(!showKey);
  };

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">API设置</h2>
      
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          OpenAI API 密钥
        </label>
        <div className="flex">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={handleSave}
            placeholder="输入您的OpenAI API密钥"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-l text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={toggleShowKey}
            className="px-3 py-2 bg-gray-200 rounded-r border border-gray-300 border-l-0"
            title={showKey ? "隐藏密钥" : "显示密钥"}
          >
            {showKey ? "👁️" : "👁️‍🗨️"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          您的API密钥仅存储在本地，不会发送到任何第三方服务器
        </p>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          OpenAI 模型
        </label>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            handleSave();
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="gpt-4">GPT-4 (最高质量，较慢)</option>
          <option value="gpt-4o">GPT-4o (高质量，较快)</option>
          <option value="gpt-3.5-turbo">GPT-3.5 Turbo (快速，经济)</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          选择用于翻译的AI模型。更高级的模型提供更好的翻译质量，但可能更慢且更贵。
        </p>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          温度: {temperature}
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={temperature}
          onChange={(e) => {
            setTemperature(parseFloat(e.target.value));
            handleSave();
          }}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>更准确</span>
          <span>更有创意</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          控制AI生成文本的随机性。较低的值使翻译更准确，较高的值使翻译更有创意。
        </p>
      </div>
      
      <div className="mt-6 p-4 bg-blue-50 rounded border border-blue-200">
        <h3 className="text-sm font-medium text-blue-800 mb-2">如何获取OpenAI API密钥</h3>
        <ol className="text-xs text-blue-700 list-decimal list-inside">
          <li>访问 <a href="https://platform.openai.com/signup" target="_blank" rel="noopener noreferrer" className="underline">OpenAI平台</a> 并创建账户</li>
          <li>登录后，点击右上角的个人资料图标，选择"View API keys"</li>
          <li>点击"Create new secret key"按钮</li>
          <li>复制生成的API密钥并粘贴到上面的输入框中</li>
          <li>确保您的OpenAI账户中有足够的余额</li>
        </ol>
      </div>
    </div>
  );
};

export default ApiSettings;
