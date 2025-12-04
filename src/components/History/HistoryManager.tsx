import React, { useState, useMemo } from 'react';
import { useHistoryStore, TranslationHistoryItem } from '../../stores/history';
import { Search, Trash2, Download, Upload, X, Filter, Clock, Languages, RefreshCw } from 'lucide-react';

// 历史记录管理器组件
export const HistoryManager: React.FC = () => {
  const {
    history,
    searchQuery,
    filter,
    setSearchQuery,
    setFilter,
    getFilteredHistory,
    deleteHistoryItem,
    clearHistory,
    exportHistory,
    importHistory,
    incrementUsageCount,
  } = useHistoryStore();
  
  const [showFilter, setShowFilter] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  
  // 获取过滤后的历史记录
  const filteredHistory = useMemo(() => getFilteredHistory(), [history, searchQuery, filter]);
  
  // 处理搜索查询
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };
  
  // 处理过滤条件变化
  const handleFilterChange = (key: string, value: any) => {
    setFilter({ [key]: value });
  };
  
  // 处理删除历史记录
  const handleDeleteItem = (id: string) => {
    deleteHistoryItem(id);
  };
  
  // 处理清空历史记录
  const handleClearHistory = () => {
    if (confirm('确定要清空所有历史记录吗？')) {
      clearHistory();
    }
  };
  
  // 处理导出历史记录
  const handleExportHistory = () => {
    const data = exportHistory();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manga-translator-history-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  // 处理导入历史记录
  const handleImportHistory = async () => {
    if (!importFile) return;
    
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      importHistory(data);
      setImportFile(null);
      alert('历史记录导入成功');
    } catch (error) {
      console.error('导入失败:', error);
      alert('导入失败，请检查文件格式');
    }
  };
  
  // 处理文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setImportFile(e.target.files[0] || null);
    }
  };
  
  // 格式化日期
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };
  
  return (
    <div className="history-manager container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">翻译历史记录</h2>
      
      {/* 搜索和控制栏 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
        {/* 搜索框 */}
        <div className="relative flex-1 w-full md:w-64">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="搜索历史记录..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        {/* 控制按钮 */}
        <div className="flex gap-2">
          {/* 过滤按钮 */}
          <button
            onClick={() => setShowFilter(!showFilter)}
            className="flex items-center gap-1 px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
          >
            <Filter size={16} />
            <span>过滤</span>
          </button>
          
          {/* 导出按钮 */}
          <button
            onClick={handleExportHistory}
            className="flex items-center gap-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            title="导出历史记录"
          >
            <Download size={16} />
            <span>导出</span>
          </button>
          
          {/* 导入按钮 */}
          <div className="relative">
            <input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <button
              className="flex items-center gap-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
              title="导入历史记录"
            >
              <Upload size={16} />
              <span>导入</span>
            </button>
          </div>
          
          {/* 清空按钮 */}
          <button
            onClick={handleClearHistory}
            className="flex items-center gap-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
            title="清空历史记录"
          >
            <Trash2 size={16} />
            <span>清空</span>
          </button>
        </div>
      </div>
      
      {/* 过滤面板 */}
      {showFilter && (
        <div className="bg-white p-4 rounded-lg shadow-md mb-4 border border-gray-200">
          <div className="flex flex-col md:flex-row gap-4">
            {/* 源语言过滤 */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">源语言</label>
              <select
                value={filter.sourceLanguage}
                onChange={(e) => handleFilterChange('sourceLanguage', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部</option>
                <option value="auto">自动检测</option>
                <option value="ja">日语</option>
                <option value="zh-CN">中文</option>
                <option value="en">英语</option>
                <option value="ko">韩语</option>
              </select>
            </div>
            
            {/* 目标语言过滤 */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">目标语言</label>
              <select
                value={filter.targetLanguage}
                onChange={(e) => handleFilterChange('targetLanguage', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部</option>
                <option value="zh-CN">中文</option>
                <option value="en">英语</option>
                <option value="ja">日语</option>
                <option value="ko">韩语</option>
              </select>
            </div>
            
            {/* 提供者过滤 */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">翻译引擎</label>
              <select
                value={filter.provider}
                onChange={(e) => handleFilterChange('provider', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部</option>
                <option value="openai">OpenAI</option>
                <option value="deepseek">DeepSeek</option>
                <option value="claude">Claude</option>
                <option value="qwen">Qwen</option>
              </select>
            </div>
          </div>
        </div>
      )}
      
      {/* 历史记录统计 */}
      <div className="bg-gray-100 p-3 rounded-lg mb-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-1 text-gray-600">
          <span className="font-medium">总计:</span>
          <span>{history.length} 条记录</span>
        </div>
        <div className="flex items-center gap-1 text-gray-600">
          <span className="font-medium">显示:</span>
          <span>{filteredHistory.length} 条记录</span>
        </div>
        {searchQuery && (
          <div className="flex items-center gap-1 text-gray-600">
            <span className="font-medium">搜索:</span>
            <span>{searchQuery}</span>
            <button
              onClick={() => setSearchQuery('')}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
      
      {/* 历史记录列表 */}
      {filteredHistory.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="text-gray-400 mb-2">
            <Clock size={48} />
          </div>
          <p className="text-gray-500 mb-4">暂无翻译历史记录</p>
          <p className="text-gray-400 text-sm">开始使用插件翻译漫画，历史记录将自动保存</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  原始文本
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  翻译结果
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  语言
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  时间
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  使用次数
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredHistory.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 max-w-xs overflow-hidden text-ellipsis whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {item.originalText}
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-xs overflow-hidden text-ellipsis whitespace-nowrap">
                    <div className="text-sm text-gray-700">
                      {item.translatedText}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <Languages size={14} />
                      <span>{item.sourceLanguage} → {item.targetLanguage}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-500">
                      {formatDate(item.timestamp)}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <RefreshCw size={14} />
                      <span>{item.usageCount}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => deleteHistoryItem(item.id)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* 导入文件选择 */}
      {importFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">导入历史记录</h3>
            <p className="mb-4">即将导入文件: {importFile.name}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setImportFile(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImportHistory}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
