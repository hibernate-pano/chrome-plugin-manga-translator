import React, { useState, useEffect } from 'react';

const CacheManager = ({ config, onClearCache, onChange }) => {
  const [cacheSize, setCacheSize] = useState(0);
  const [cacheEntries, setCacheEntries] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCacheInfo();
  }, []);

  const loadCacheInfo = () => {
    setIsLoading(true);
    chrome.storage.local.get(['translationCache'], (result) => {
      const cache = result.translationCache || {};
      const entries = Object.keys(cache).length;

      // 计算缓存大小（粗略估计）
      let size = 0;
      try {
        size = new Blob([JSON.stringify(cache)]).size;
      } catch (e) {
        console.error('计算缓存大小时出错:', e);
      }

      setCacheEntries(entries);
      setCacheSize(size);
      setIsLoading(false);
    });
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleClearCache = () => {
    if (window.confirm('确定要清除所有翻译缓存吗？这将导致需要重新翻译已缓存的内容。')) {
      onClearCache();
      setCacheEntries(0);
      setCacheSize(0);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-4">缓存管理</h2>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded border border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-1">缓存条目数</h3>
          {isLoading ? (
            <div className="animate-pulse h-6 bg-gray-200 rounded"></div>
          ) : (
            <p className="text-2xl font-semibold text-blue-600">{cacheEntries}</p>
          )}
          <p className="text-xs text-gray-500 mt-1">已缓存的翻译数量</p>
        </div>

        <div className="bg-white p-4 rounded border border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-1">缓存大小</h3>
          {isLoading ? (
            <div className="animate-pulse h-6 bg-gray-200 rounded"></div>
          ) : (
            <p className="text-2xl font-semibold text-blue-600">{formatSize(cacheSize)}</p>
          )}
          <p className="text-xs text-gray-500 mt-1">缓存占用的存储空间</p>
        </div>
      </div>

      <div className="mb-6">
        <button
          onClick={handleClearCache}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition"
          disabled={isLoading || cacheEntries === 0}
        >
          清除所有缓存
        </button>
        <p className="text-xs text-gray-500 mt-1">
          清除缓存将删除所有已保存的翻译结果，需要时会重新翻译
        </p>
      </div>

      <div className="mb-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={config.advancedSettings?.cacheResults !== false}
            onChange={(e) => {
              const newSettings = {
                ...config.advancedSettings,
                cacheResults: e.target.checked
              };
              onChange({ advancedSettings: newSettings });
            }}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">启用翻译缓存</span>
        </label>
        <p className="text-xs text-gray-500 mt-1 ml-6">
          保存翻译结果以避免重复翻译相同内容，节省API调用
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          最大缓存条目数
        </label>
        <input
          type="number"
          min="10"
          max="1000"
          value={config.advancedSettings?.maxCacheSize || 50}
          onChange={(e) => {
            const newSettings = {
              ...config.advancedSettings,
              maxCacheSize: parseInt(e.target.value, 10) || 50
            };
            onChange({ advancedSettings: newSettings });
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          当缓存达到此数量时，最旧的条目将被删除
        </p>
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded border border-blue-200">
        <h3 className="text-sm font-medium text-blue-800 mb-2">关于缓存</h3>
        <ul className="text-xs text-blue-700 list-disc list-inside">
          <li>缓存可以减少API调用次数，节省费用并提高速度</li>
          <li>缓存基于图像内容的哈希值，相同的图像将使用缓存的翻译</li>
          <li>如果翻译结果不理想，可以尝试清除缓存重新翻译</li>
          <li>缓存存储在浏览器本地，不会占用云存储空间</li>
        </ul>
      </div>
    </div>
  );
};

export default CacheManager;
