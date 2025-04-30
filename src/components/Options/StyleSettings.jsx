import React, { useState, useEffect } from 'react';

const StyleSettings = ({ config, onChange }) => {
  const [styleLevel, setStyleLevel] = useState(config.styleLevel || 50);
  const [fontFamily, setFontFamily] = useState(config.fontFamily || '');
  const [fontSize, setFontSize] = useState(config.fontSize || 'auto');
  const [fontColor, setFontColor] = useState(config.fontColor || 'auto');
  const [backgroundColor, setBackgroundColor] = useState(config.backgroundColor || 'auto');
  const [customFontFamily, setCustomFontFamily] = useState('');
  const [showCustomFont, setShowCustomFont] = useState(false);

  useEffect(() => {
    if (fontFamily === 'custom') {
      setShowCustomFont(true);
    } else {
      setShowCustomFont(false);
    }
  }, [fontFamily]);

  // 当组件卸载时保存配置
  useEffect(() => {
    return () => {
      console.log('StyleSettings组件卸载，保存配置');
      handleSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    const newFontFamily = fontFamily === 'custom' ? customFontFamily : fontFamily;

    onChange({
      styleLevel,
      fontFamily: newFontFamily,
      fontSize,
      fontColor,
      backgroundColor
    });
  };

  const fontFamilies = [
    { value: '', label: '自动 (推荐)' },
    { value: 'SimSun, serif', label: '宋体' },
    { value: 'Microsoft YaHei, sans-serif', label: '微软雅黑' },
    { value: 'KaiTi, serif', label: '楷体' },
    { value: 'SimHei, sans-serif', label: '黑体' },
    { value: 'FangSong, serif', label: '仿宋' },
    { value: 'Arial, sans-serif', label: 'Arial' },
    { value: 'custom', label: '自定义...' }
  ];

  const fontSizes = [
    { value: 'auto', label: '自动 (推荐)' },
    { value: 'smaller', label: '较小' },
    { value: 'small', label: '小' },
    { value: 'medium', label: '中等' },
    { value: 'large', label: '大' },
    { value: 'larger', label: '较大' }
  ];

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">样式设置</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          样式保持程度: {styleLevel}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={styleLevel}
          onChange={(e) => {
            setStyleLevel(Number(e.target.value));
            handleSave();
          }}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>更清晰</span>
          <span>更美观</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          调整翻译文字的样式与原文的相似程度。较低的值优先保证文字清晰度，较高的值尽量模仿原文样式。
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          字体
        </label>
        <select
          value={fontFamily}
          onChange={(e) => {
            setFontFamily(e.target.value);
            handleSave();
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {fontFamilies.map(font => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
        {showCustomFont && (
          <input
            type="text"
            value={customFontFamily}
            onChange={(e) => {
              setCustomFontFamily(e.target.value);
              handleSave();
            }}
            placeholder="输入自定义字体，例如: 'Comic Sans MS, cursive'"
            className="w-full mt-2 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          字体大小
        </label>
        <select
          value={fontSize}
          onChange={(e) => {
            setFontSize(e.target.value);
            handleSave();
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {fontSizes.map(size => (
            <option key={size.value} value={size.value}>
              {size.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          字体颜色
        </label>
        <div className="flex items-center">
          <select
            value={fontColor}
            onChange={(e) => {
              setFontColor(e.target.value);
              handleSave();
            }}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-l text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="auto">自动 (推荐)</option>
            <option value="black">黑色</option>
            <option value="white">白色</option>
            <option value="custom">自定义...</option>
          </select>
          {fontColor === 'custom' && (
            <input
              type="color"
              value={fontColor === 'custom' ? (fontColor.startsWith('#') ? fontColor : '#000000') : '#000000'}
              onChange={(e) => {
                setFontColor(e.target.value);
                handleSave();
              }}
              className="h-[42px] w-[42px] border border-gray-300 rounded-r border-l-0"
            />
          )}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          背景颜色
        </label>
        <div className="flex items-center">
          <select
            value={backgroundColor}
            onChange={(e) => {
              setBackgroundColor(e.target.value);
              handleSave();
            }}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-l text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="auto">自动 (推荐)</option>
            <option value="transparent">透明</option>
            <option value="white">白色</option>
            <option value="black">黑色</option>
            <option value="custom">自定义...</option>
          </select>
          {backgroundColor === 'custom' && (
            <input
              type="color"
              value={backgroundColor === 'custom' ? (backgroundColor.startsWith('#') ? backgroundColor : '#ffffff') : '#ffffff'}
              onChange={(e) => {
                setBackgroundColor(e.target.value);
                handleSave();
              }}
              className="h-[42px] w-[42px] border border-gray-300 rounded-r border-l-0"
            />
          )}
        </div>
      </div>

      <div className="mt-6 p-4 bg-yellow-50 rounded border border-yellow-200">
        <h3 className="text-sm font-medium text-yellow-800 mb-2">样式提示</h3>
        <ul className="text-xs text-yellow-700 list-disc list-inside">
          <li>推荐使用"自动"设置，让插件根据原文样式自动调整</li>
          <li>如果翻译文字难以阅读，可以降低样式保持程度</li>
          <li>对于特定漫画，可能需要手动调整字体和颜色以获得最佳效果</li>
          <li>背景透明度会根据样式保持程度自动调整</li>
        </ul>
      </div>
    </div>
  );
};

export default StyleSettings;
