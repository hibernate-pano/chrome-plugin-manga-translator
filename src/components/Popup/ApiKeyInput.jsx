import React, { useState, useEffect } from 'react';

const ApiKeyInput = ({ apiKey, onChange }) => {
  const [value, setValue] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);

  // 当 apiKey 属性更新时，更新内部状态
  useEffect(() => {
    if (apiKey !== value) {
      setValue(apiKey);
    }
  }, [apiKey, value]);

  const handleChange = (e) => {
    setValue(e.target.value);
  };

  const handleSave = () => {
    onChange(value);
  };

  const toggleShowKey = () => {
    setShowKey(!showKey);
  };

  return (
    <div className="mb-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        API 密钥
      </label>
      <div className="flex">
        <input
          type={showKey ? "text" : "password"}
          value={value}
          onChange={handleChange}
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
  );
};

export default ApiKeyInput;
