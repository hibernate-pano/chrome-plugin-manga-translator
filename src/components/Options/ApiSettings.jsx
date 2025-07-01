import React, { useState, useEffect } from 'react';
import { validateProviderConfig, getAvailableProviders } from '../../utils/api';

const ApiSettings = ({ config, onChange }) => {
  const [providerType, setProviderType] = useState(config.providerType || 'openai');
  const [providerConfig, setProviderConfig] = useState(config.providerConfig || {});
  const [availableProviders, setAvailableProviders] = useState([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [currentSchema, setCurrentSchema] = useState({});

  // 加载可用的API提供者
  useEffect(() => {
    const providers = getAvailableProviders();
    setAvailableProviders(providers);
    
    // 设置当前提供者的配置模式
    if (providers.length > 0) {
      const currentProvider = providers.find(p => p.type === providerType) || providers[0];
      setCurrentSchema(currentProvider.schema);
    }
  }, [providerType]);

  // 当 config props 变化时更新组件状态
  useEffect(() => {
    if (config) {
      if (config.providerType !== undefined) {
        setProviderType(config.providerType);
      }
      
      if (config.providerConfig !== undefined) {
        setProviderConfig(config.providerConfig);
      }
    }
  }, [config]);

  // 保存配置
  const saveConfig = () => {
    onChange({
      providerType,
      providerConfig
    });
  };

  // 当组件状态更新时保存配置
  useEffect(() => {
    // 避免在组件初始化时触发保存
    const timer = setTimeout(saveConfig, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerType, providerConfig]);

  // 处理提供者类型变更
  const handleProviderTypeChange = (e) => {
    const newType = e.target.value;
    setProviderType(newType);
    
    // 更新配置模式
    const provider = availableProviders.find(p => p.type === newType);
    if (provider) {
      setCurrentSchema(provider.schema);
    }
    
    // 如果没有该提供者的配置，创建默认配置
    if (!providerConfig[newType]) {
      const newProviderConfig = { ...providerConfig };
      newProviderConfig[newType] = {};
      setProviderConfig(newProviderConfig);
    }
  };

  // 处理配置项变更
  const handleConfigChange = (key, value) => {
    const newConfig = { 
      ...providerConfig,
      [providerType]: {
        ...providerConfig[providerType],
        [key]: value
      }
    };
    
    setProviderConfig(newConfig);
  };

  // 验证API配置
  const validateApiConfig = async () => {
    setValidating(true);
    setValidationResult(null);

    try {
      // 获取当前提供者配置
      const currentConfig = providerConfig[providerType] || {};
      
      // 验证配置
      const result = await validateProviderConfig(providerType, currentConfig);
      setValidationResult(result);
    } catch (error) {
      setValidationResult({
        isValid: false,
        message: `验证过程中发生错误: ${error.message}`
      });
    } finally {
      setValidating(false);
    }
  };

  // 渲染验证结果
  const renderValidationResult = () => {
    if (!validationResult) return null;

    const { isValid, message } = validationResult;

    return (
      <div className={`mt-4 p-3 rounded ${isValid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <div className={`text-sm font-medium ${isValid ? 'text-green-800' : 'text-red-800'}`}>
          {isValid ? '✅ ' : '❌ '}{message}
        </div>
      </div>
    );
  };

  // 渲染配置字段
  const renderConfigField = (key, fieldSchema) => {
    const value = providerConfig[providerType]?.[key] || fieldSchema.default || '';
    const fieldId = `provider-${providerType}-${key}`;
    
    switch (fieldSchema.type) {
      case 'string':
        return (
          <div className="mb-4" key={key}>
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {fieldSchema.label}
              {fieldSchema.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              id={fieldId}
              type={key.toLowerCase().includes('key') && !showApiKey ? 'password' : 'text'}
              value={value}
              onChange={(e) => handleConfigChange(key, e.target.value)}
              placeholder={fieldSchema.placeholder || `输入${fieldSchema.label}`}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={fieldSchema.required}
            />
            {fieldSchema.description && (
              <p className="text-xs text-gray-500 mt-1">{fieldSchema.description}</p>
            )}
          </div>
        );
        
      case 'select':
        return (
          <div className="mb-4" key={key}>
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {fieldSchema.label}
              {fieldSchema.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              id={fieldId}
              value={value}
              onChange={(e) => handleConfigChange(key, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={fieldSchema.required}
            >
              {fieldSchema.options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldSchema.description && (
              <p className="text-xs text-gray-500 mt-1">{fieldSchema.description}</p>
            )}
          </div>
        );
        
      case 'number':
        return (
          <div className="mb-4" key={key}>
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {fieldSchema.label}
              {fieldSchema.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              id={fieldId}
              type="number"
              value={value}
              onChange={(e) => handleConfigChange(key, parseInt(e.target.value))}
              min={fieldSchema.min}
              max={fieldSchema.max}
              step={fieldSchema.step || 1}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={fieldSchema.required}
            />
            {fieldSchema.description && (
              <p className="text-xs text-gray-500 mt-1">{fieldSchema.description}</p>
            )}
          </div>
        );
        
      case 'range':
        return (
          <div className="mb-4" key={key}>
            <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1">
              {fieldSchema.label}: {value}
              {fieldSchema.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              id={fieldId}
              type="range"
              value={value}
              onChange={(e) => handleConfigChange(key, parseFloat(e.target.value))}
              min={fieldSchema.min}
              max={fieldSchema.max}
              step={fieldSchema.step || 0.1}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              required={fieldSchema.required}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{fieldSchema.min}</span>
              <span>{fieldSchema.max}</span>
            </div>
            {fieldSchema.description && (
              <p className="text-xs text-gray-500 mt-1">{fieldSchema.description}</p>
            )}
          </div>
        );
        
      default:
        return null;
    }
  };

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">API设置</h2>
      
      <div className="mb-6">
        <label htmlFor="provider-type" className="block text-sm font-medium text-gray-700 mb-1">
          API提供者
        </label>
        <select
          id="provider-type"
          value={providerType}
          onChange={handleProviderTypeChange}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {availableProviders.map(provider => (
            <option key={provider.type} value={provider.type}>
              {provider.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          选择您要使用的AI服务提供者。不同提供者可能支持不同的功能和语言。
        </p>
      </div>
      
      {/* 提供者特定配置 */}
      <div className="mb-6 border-t border-gray-200 pt-4">
        <h3 className="text-md font-medium text-gray-800 mb-3">提供者配置</h3>
        
        {Object.keys(currentSchema).map(key => renderConfigField(key, currentSchema[key]))}
        
        {/* API密钥显示切换 */}
        {Object.keys(currentSchema).some(key => key.toLowerCase().includes('key')) && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {showApiKey ? '隐藏密钥' : '显示密钥'}
            </button>
          </div>
        )}
      </div>
      
      {/* 验证按钮 */}
      <div className="mt-6">
        <button
          type="button"
          onClick={validateApiConfig}
          disabled={validating}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {validating ? '验证中...' : '验证API配置'}
        </button>
        
        {renderValidationResult()}
      </div>
    </div>
  );
};

export default ApiSettings;
