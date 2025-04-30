import React, { useState, useEffect } from 'react';

const KeyboardShortcuts = ({ shortcuts, onChange }) => {
  const [toggleTranslation, setToggleTranslation] = useState(shortcuts.toggleTranslation || 'Alt+T');
  const [translateSelected, setTranslateSelected] = useState(shortcuts.translateSelected || 'Alt+S');
  const [recording, setRecording] = useState(null);

  // 当组件卸载时保存配置
  useEffect(() => {
    return () => {
      console.log('KeyboardShortcuts组件卸载，保存配置');
      onChange({
        toggleTranslation,
        translateSelected
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (e, shortcutType) => {
    if (recording !== shortcutType) return;

    e.preventDefault();

    const keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');

    // 只添加非修饰键
    if (!['Control', 'Alt', 'Shift'].includes(e.key)) {
      keys.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }

    if (keys.length > 0) {
      const shortcut = keys.join('+');

      if (shortcutType === 'toggleTranslation') {
        setToggleTranslation(shortcut);
      } else if (shortcutType === 'translateSelected') {
        setTranslateSelected(shortcut);
      }

      setRecording(null);

      onChange({
        ...shortcuts,
        [shortcutType]: shortcut
      });
    }
  };

  const startRecording = (shortcutType) => {
    setRecording(shortcutType);
  };

  const resetToDefault = () => {
    const defaultShortcuts = {
      toggleTranslation: 'Alt+T',
      translateSelected: 'Alt+S'
    };

    setToggleTranslation(defaultShortcuts.toggleTranslation);
    setTranslateSelected(defaultShortcuts.translateSelected);

    onChange(defaultShortcuts);
  };

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">快捷键设置</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          启用/禁用翻译
        </label>
        <div className="flex">
          <input
            type="text"
            value={recording === 'toggleTranslation' ? '按下快捷键...' : toggleTranslation}
            readOnly
            className="flex-1 px-3 py-2 border border-gray-300 rounded-l text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            onKeyDown={(e) => handleKeyDown(e, 'toggleTranslation')}
          />
          <button
            onClick={() => startRecording('toggleTranslation')}
            className="px-3 py-2 bg-blue-500 text-white rounded-r"
          >
            {recording === 'toggleTranslation' ? '录制中...' : '更改'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          快速启用或禁用翻译功能
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          翻译选中区域
        </label>
        <div className="flex">
          <input
            type="text"
            value={recording === 'translateSelected' ? '按下快捷键...' : translateSelected}
            readOnly
            className="flex-1 px-3 py-2 border border-gray-300 rounded-l text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            onKeyDown={(e) => handleKeyDown(e, 'translateSelected')}
          />
          <button
            onClick={() => startRecording('translateSelected')}
            className="px-3 py-2 bg-blue-500 text-white rounded-r"
          >
            {recording === 'translateSelected' ? '录制中...' : '更改'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          翻译页面上选中的图像区域
        </p>
      </div>

      <div className="mt-6">
        <button
          onClick={resetToDefault}
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition"
        >
          恢复默认快捷键
        </button>
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded border border-gray-200">
        <h3 className="text-sm font-medium text-gray-700 mb-2">使用说明</h3>
        <ul className="text-xs text-gray-600 list-disc list-inside">
          <li>点击"更改"按钮，然后按下您想要的快捷键组合</li>
          <li>支持组合键，如 Ctrl+Alt+T</li>
          <li>某些快捷键可能与浏览器或其他扩展冲突</li>
          <li>如果快捷键不起作用，请尝试使用不同的组合</li>
        </ul>
      </div>
    </div>
  );
};

export default KeyboardShortcuts;
