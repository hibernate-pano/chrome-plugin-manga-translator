import React, { useState, useEffect } from 'react';
import { getConfig, saveProviderConfig } from '../../utils/storage';
import ProviderFactory from '../../api/providers';

/**
 * API设置组件
 */
const ApiSettings = () => {
  // 状态
  const [loading, setLoading] = useState(true);
  const [providerType, setProviderType] = useState('openai');
  const [providerConfig, setProviderConfig] = useState({});
  const [validationMessage, setValidationMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [providers, setProviders] = useState([]);
  const [currentProvider, setCurrentProvider] = useState(null);
  const [configSchema, setConfigSchema] = useState({});

  // 加载配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        const config = await getConfig();
        
        // 获取所有注册的提供者
        const registeredProviders = ProviderFactory.getRegisteredProviders();
        const providerList = Object.entries(registeredProviders).map(([key, Provider]) => {
          const instance = new Provider();
          return {
            id: key,
            name: instance.name,
            instance
          };
        });
        
        setProviders(providerList);
        setProviderType(config.providerType || 'openai');
        setProviderConfig(config.providerConfig || {});
        
        // 设置当前提供者
        const currentProviderInstance = providerList.find(p => p.id === config.providerType)?.instance;
        if (currentProviderInstance) {
          setCurrentProvider(currentProviderInstance);
          setConfigSchema(currentProviderInstance.getConfigurationSchema());
        }
        
        setLoading(false);
      } catch (error) {
        console.error('加载配置失败:', error);
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  // 当提供者类型更改时更新当前提供者
  useEffect(() => {
    const provider = providers.find(p => p.id === providerType);
    if (provider) {
      setCurrentProvider(provider.instance);
      setConfigSchema(provider.instance.getConfigurationSchema());
    }
  }, [providerType, providers]);

  // 更改提供者类型
  const handleProviderChange = (e) => {
    const newType = e.target.value;
    setProviderType(newType);
  };

  // 更新配置字段
  const handleConfigChange = (key, value) => {
    setProviderConfig(prev => ({
      ...prev,
      [providerType]: {
        ...(prev[providerType] || {}),
        [key]: value
      }
    }));
  };

  // 验证API配置
  const validateConfig = async () => {
    if (!currentProvider) return;

    try {
      setValidating(true);
      setValidationMessage('正在验证...');

      // 创建一个临时提供者实例进行验证
      const tempProvider = new (ProviderFactory.getProvider(providerType))();
      tempProvider.config = providerConfig[providerType] || {};

      const result = await tempProvider.validateConfig();
      
      if (result.isValid) {
        setValidationMessage(`✅ ${result.message || '验证成功'}`);
      } else {
        setValidationMessage(`❌ ${result.message || '验证失败'}`);
      }
    } catch (error) {
      console.error('验证失败:', error);
      setValidationMessage(`❌ 验证出错: ${error.message}`);
    } finally {
      setValidating(false);
    }
  };

  // 保存配置
  const saveConfig = async () => {
    try {
      await saveProviderConfig(providerType, providerConfig[providerType] || {});
      setValidationMessage('✅ 配置已保存');
    } catch (error) {
      console.error('保存配置失败:', error);
      setValidationMessage(`❌ 保存失败: ${error.message}`);
    }
  };

  // 渲染配置字段
  const renderConfigFields = () => {
    if (!configSchema || !providerConfig[providerType]) {
      return <p>加载配置中...</p>;
    }

    return Object.entries(configSchema).map(([key, field]) => {
      const value = providerConfig[providerType]?.[key] ?? field.default;
      
      // 根据字段类型渲染不同的表单控件
      switch (field.type) {
        case 'string':
          return (
            <div key={key} className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label || key}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                type={key.toLowerCase().includes('key') ? 'password' : 'text'}
                value={value || ''}
                onChange={(e) => handleConfigChange(key, e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required={field.required}
              />
              {field.description && (
                <p className="mt-1 text-xs text-gray-500">{field.description}</p>
              )}
            </div>
          );
          
        case 'number':
          return (
            <div key={key} className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label || key}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                type="number"
                value={value || field.default || 0}
                onChange={(e) => handleConfigChange(key, Number(e.target.value))}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                min={field.min}
                max={field.max}
                step={field.step || 1}
                required={field.required}
              />
              {field.description && (
                <p className="mt-1 text-xs text-gray-500">{field.description}</p>
              )}
            </div>
          );
          
        case 'boolean':
          return (
            <div key={key} className="mb-4 flex items-start">
              <div className="flex items-center h-5">
                <input
                  type="checkbox"
                  checked={value || false}
                  onChange={(e) => handleConfigChange(key, e.target.checked)}
                  className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label className="font-medium text-gray-700">
                  {field.label || key}
                </label>
                {field.description && (
                  <p className="text-gray-500">{field.description}</p>
                )}
              </div>
            </div>
          );
          
        case 'select':
          return (
            <div key={key} className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label || key}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              <select
                value={value || field.default || ''}
                onChange={(e) => handleConfigChange(key, e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required={field.required}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {field.description && (
                <p className="mt-1 text-xs text-gray-500">{field.description}</p>
              )}
            </div>
          );
          
        case 'range':
          return (
            <div key={key} className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label || key}: {value || field.default || 0}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                type="range"
                value={value || field.default || 0}
                onChange={(e) => handleConfigChange(key, Number(e.target.value))}
                className="mt-1 block w-full"
                min={field.min || 0}
                max={field.max || 1}
                step={field.step || 0.1}
                required={field.required}
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>{field.min || 0}</span>
                <span>{field.max || 1}</span>
              </div>
              {field.description && (
                <p className="mt-1 text-xs text-gray-500">{field.description}</p>
              )}
            </div>
          );
          
        default:
          return (
            <div key={key} className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label || key}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                type="text"
                value={value || ''}
                onChange={(e) => handleConfigChange(key, e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required={field.required}
              />
            </div>
          );
      }
    });
  };

  // 加载中显示
  if (loading) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-4">API设置</h2>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-4">API设置</h2>
      
      {/* 提供者选择 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API提供者
        </label>
        <select
          value={providerType}
          onChange={handleProviderChange}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          选择您要使用的AI服务提供者
        </p>
      </div>
      
      {/* 提供者配置 */}
      <div className="bg-gray-50 p-4 rounded-md mb-4">
        <h3 className="text-md font-medium mb-3">{currentProvider?.name} 配置</h3>
        {renderConfigFields()}
      </div>
      
      {/* 验证结果 */}
      {validationMessage && (
        <div className={`mb-4 p-3 rounded ${validationMessage.includes('✅') ? 'bg-green-100' : 'bg-red-100'}`}>
          <p>{validationMessage}</p>
        </div>
      )}
      
      {/* 操作按钮 */}
      <div className="flex space-x-4">
        <button
          onClick={validateConfig}
          disabled={validating}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {validating ? '验证中...' : '验证配置'}
        </button>
        
        <button
          onClick={saveConfig}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
        >
          保存配置
        </button>
      </div>
    </div>
  );
};

export default ApiSettings;
