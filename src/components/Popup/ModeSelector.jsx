// import React from 'react';

const ModeSelector = ({ mode, onChange }) => {
  const handleChange = (newMode) => {
    onChange(newMode);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        翻译模式
      </label>
      <div className="flex border border-gray-300 rounded overflow-hidden">
        <button
          className={`flex-1 py-2 text-sm ${
            mode === 'manual'
              ? 'bg-blue-500 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
          onClick={() => handleChange('manual')}
        >
          手动翻译
        </button>
        <button
          className={`flex-1 py-2 text-sm ${
            mode === 'auto'
              ? 'bg-blue-500 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100'
          }`}
          onClick={() => handleChange('auto')}
        >
          自动翻译
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {mode === 'manual' 
          ? '手动模式：点击漫画图像进行翻译' 
          : '自动模式：自动检测并翻译页面上的漫画'}
      </p>
    </div>
  );
};

export default ModeSelector;
