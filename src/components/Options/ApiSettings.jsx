import React, { useState, useEffect } from 'react';

const ApiSettings = ({ config, onChange }) => {
  const [apiKey, setApiKey] = useState(config.apiKey || '');
  const [model, setModel] = useState(config.model || 'gpt-3.5-turbo');
  const [customModel, setCustomModel] = useState(config.customModel || '');
  const [temperature, setTemperature] = useState(config.temperature || 0.7);
  const [showKey, setShowKey] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(config.apiBaseUrl || 'https://api.openai.com/v1');
  const [useCustomModel, setUseCustomModel] = useState(config.useCustomModel || false);
  const [useCustomApiUrl, setUseCustomApiUrl] = useState(config.useCustomApiUrl || false);

  // 当 config props 变化时更新组件状态
  useEffect(() => {
    console.log('ApiSettings 接收到新的 config:', config);
    if (config) {
      if (config.apiKey !== undefined) setApiKey(config.apiKey);
      if (config.model !== undefined) setModel(config.model);
      if (config.customModel !== undefined) setCustomModel(config.customModel);
      if (config.temperature !== undefined) setTemperature(config.temperature);
      if (config.apiBaseUrl !== undefined) setApiBaseUrl(config.apiBaseUrl);
      if (config.useCustomModel !== undefined) setUseCustomModel(config.useCustomModel);
      if (config.useCustomApiUrl !== undefined) setUseCustomApiUrl(config.useCustomApiUrl);
    }
  }, [config]);

  // 创建一个保存配置的函数
  const saveConfig = () => {
    onChange({
      apiKey,
      model: useCustomModel ? customModel : model,
      customModel: customModel,
      temperature,
      apiBaseUrl: useCustomApiUrl ? apiBaseUrl : 'https://api.openai.com/v1',
      useCustomModel,
      useCustomApiUrl
    });
  };

  // 当组件状态更新时保存配置
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // 避免在组件初始化时触发保存
    const timer = setTimeout(saveConfig, 300);
    return () => clearTimeout(timer);
  }, [apiKey, model, customModel, temperature, apiBaseUrl, useCustomModel, useCustomApiUrl]);

  // 当组件卸载时保存配置
  useEffect(() => {
    return () => {
      console.log('ApiSettings组件卸载，保存配置');
      saveConfig();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = saveConfig;

  const toggleShowKey = () => {
    setShowKey(!showKey);
  };

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">API设置</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API 密钥
        </label>
        <div className="flex">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={handleSave}
            placeholder="输入您的API密钥"
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
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={useCustomApiUrl}
            onChange={(e) => {
              setUseCustomApiUrl(e.target.checked);
              handleSave();
            }}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">使用自定义API地址</span>
        </label>

        {useCustomApiUrl && (
          <div className="mt-2">
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              onBlur={handleSave}
              placeholder="例如: https://api.example.com/v1"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              输入兼容OpenAI API的服务地址，用于第三方API服务
            </p>
          </div>
        )}
      </div>

      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={useCustomModel}
            onChange={(e) => {
              setUseCustomModel(e.target.checked);
              handleSave();
            }}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">使用自定义模型名称</span>
        </label>

        {useCustomModel ? (
          <div className="mt-2">
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onBlur={handleSave}
              placeholder="输入自定义模型名称"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              输入第三方API服务支持的模型名称
            </p>
          </div>
        ) : (
          <div className="mt-2">
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
        )}
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
        <h3 className="text-sm font-medium text-blue-800 mb-2">API设置说明</h3>
        <ul className="text-xs text-blue-700 list-disc list-inside">
          <li>默认使用OpenAI官方API，您需要<a href="https://platform.openai.com/signup" target="_blank" rel="noopener noreferrer" className="underline">注册OpenAI账户</a>并获取API密钥</li>
          <li>如果您使用第三方API服务（如国内的API代理），请启用"自定义API地址"并填写相应的URL</li>
          <li>某些第三方服务可能使用不同的模型名称，此时请启用"自定义模型名称"</li>
          <li>确保您的API账户中有足够的余额或配额</li>
        </ul>
      </div>
    </div>
  );
};

export default ApiSettings;
