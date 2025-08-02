import React from 'react';
import { useTranslationStore, useConfigStore, useCacheStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

/**
 * 展示如何使用新的Zustand stores的示例组件
 */
export const StoreExample: React.FC = () => {
  // 使用翻译store
  const {
    enabled,
    mode,
    targetLanguage,
    processing,
    history,
    setEnabled,
    setMode,
    setTargetLanguage,
    setProcessing,
    addToHistory,
    clearHistory,
  } = useTranslationStore();

  // 使用配置store
  const {
    providerType,
    styleLevel,
    advancedSettings,
    setProviderType,
    setStyleLevel,
    updateAdvancedSettings,
    getActiveProviderConfig,
  } = useConfigStore();

  // 使用缓存store
  const {
    getCacheStats,
    clearAllCache,
  } = useCacheStore();

  const cacheStats = getCacheStats();
  const activeProviderConfig = getActiveProviderConfig();

  const handleAddTestHistory = () => {
    addToHistory({
      imageUrl: 'https://example.com/test-image.jpg',
      originalText: 'テスト',
      translatedText: '测试',
      targetLanguage: targetLanguage,
    });
  };

  const handleTestTranslation = async () => {
    setProcessing(true);
    
    // 模拟翻译过程
    setTimeout(() => {
      handleAddTestHistory();
      setProcessing(false);
    }, 2000);
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Zustand Store 示例</h1>
      
      {/* 翻译状态控制 */}
      <Card>
        <CardHeader>
          <CardTitle>翻译状态管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <label>启用翻译</label>
          </div>
          
          <div className="flex items-center space-x-2">
            <label>模式:</label>
            <Button
              variant={mode === 'manual' ? 'default' : 'outline'}
              onClick={() => setMode('manual')}
            >
              手动
            </Button>
            <Button
              variant={mode === 'auto' ? 'default' : 'outline'}
              onClick={() => setMode('auto')}
            >
              自动
            </Button>
          </div>
          
          <div className="flex items-center space-x-2">
            <label>目标语言:</label>
            <Input
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              placeholder="zh-CN"
              className="w-32"
            />
          </div>
          
          <div className="flex space-x-2">
            <Button
              onClick={handleTestTranslation}
              disabled={processing}
            >
              {processing ? '翻译中...' : '测试翻译'}
            </Button>
            <Button
              variant="outline"
              onClick={handleAddTestHistory}
            >
              添加测试历史
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 配置管理 */}
      <Card>
        <CardHeader>
          <CardTitle>配置管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <label>API提供者:</label>
            <select
              value={providerType}
              onChange={(e) => setProviderType(e.target.value)}
              className="border rounded px-2 py-1"
            >
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="claude">Claude</option>
              <option value="anthropic">Anthropic</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>
          
          <div className="flex items-center space-x-2">
            <label>样式级别:</label>
            <input
              type="range"
              min="0"
              max="100"
              value={styleLevel}
              onChange={(e) => setStyleLevel(Number(e.target.value))}
              className="flex-1"
            />
            <span>{styleLevel}</span>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch
              checked={advancedSettings.debugMode}
              onCheckedChange={(checked) => 
                updateAdvancedSettings({ debugMode: checked })
              }
            />
            <label>调试模式</label>
          </div>
          
          <div className="text-sm text-gray-600">
            <p>当前API配置: {activeProviderConfig.visionModel}</p>
            <p>API密钥: {activeProviderConfig.apiKey ? '已设置' : '未设置'}</p>
          </div>
        </CardContent>
      </Card>

      {/* 历史记录和缓存 */}
      <Card>
        <CardHeader>
          <CardTitle>历史记录和缓存</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex space-x-2">
            <Button
              variant="outline"
              onClick={clearHistory}
            >
              清空历史记录 ({history.length})
            </Button>
            <Button
              variant="outline"
              onClick={clearAllCache}
            >
              清空缓存
            </Button>
          </div>
          
          <div className="text-sm text-gray-600">
            <p>缓存统计:</p>
            <ul className="list-disc list-inside ml-4">
              <li>翻译缓存: {cacheStats.translationCount} 项</li>
              <li>图像缓存: {cacheStats.imageCount} 项</li>
              <li>OCR缓存: {cacheStats.ocrCount} 项</li>
              <li>总计: {cacheStats.totalSize} 项</li>
            </ul>
          </div>
          
          {history.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">最近翻译历史:</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {history.slice(0, 5).map((item) => (
                  <div key={item.id} className="text-sm border rounded p-2">
                    <p><strong>原文:</strong> {item.originalText}</p>
                    <p><strong>译文:</strong> {item.translatedText}</p>
                    <p className="text-gray-500">
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
