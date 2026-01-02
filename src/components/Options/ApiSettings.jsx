import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useConfigStore } from '@/stores/config';
import { Info, RefreshCw, Loader2 } from 'lucide-react';

// API提供商信息
const providerInfo = {
  openai: {
    name: 'OpenAI',
    description: '使用OpenAI的GPT模型进行翻译',
    baseUrl: 'https://api.openai.com',
    modelPlaceholder: '例如: gpt-4o, gpt-4-turbo',
    needsApiKey: true
  },
  claude: {
    name: 'Claude',
    description: '使用Anthropic的Claude模型进行翻译',
    baseUrl: 'https://api.anthropic.com',
    modelPlaceholder: '例如: claude-3-5-sonnet-20241022',
    needsApiKey: true
  },
  deepseek: {
    name: 'DeepSeek',
    description: '使用深度求索的DeepSeek模型进行翻译',
    baseUrl: 'https://api.deepseek.com',
    modelPlaceholder: '例如: deepseek-chat',
    needsApiKey: true
  },
  qwen: {
    name: 'Qwen',
    description: '使用阿里通义千问模型进行翻译',
    baseUrl: 'https://dashscope.aliyuncs.com',
    modelPlaceholder: '例如: qwen-vl-max',
    needsApiKey: true
  },
  ollama: {
    name: 'Ollama (本地)',
    description: '使用本地部署的Ollama模型进行翻译，隐私友好，免费使用',
    baseUrl: 'http://localhost:11434',
    modelPlaceholder: '例如: llava, bakllava',
    needsApiKey: false
  }
};

const ApiSettings = () => {
  const {
    providerType,
    providerConfig,
    updateProviderConfig,
    setProviderType
  } = useConfigStore();

  // Ollama 模型列表状态
  const [ollamaModels, setOllamaModels] = useState([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);

  // 获取当前提供商的配置
  const currentConfig = providerConfig[providerType] || {};
  const currentProviderInfo = providerInfo[providerType] || providerInfo.openai;

  // 获取 Ollama 模型列表
  const fetchOllamaModels = useCallback(async (baseUrl) => {
    const url = baseUrl || currentConfig.baseUrl || providerInfo.ollama.baseUrl;
    if (!url) return;
    
    setLoadingOllamaModels(true);
    try {
      const response = await fetch(`${url}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        const models = (data.models || [])
          .filter(m => {
            const name = m.name.toLowerCase();
            return name.includes('llava') || name.includes('bakllava') || name.includes('moondream');
          })
          .map(m => m.name);
        setOllamaModels(models);
      }
    } catch {
      setOllamaModels([]);
    } finally {
      setLoadingOllamaModels(false);
    }
  }, [currentConfig.baseUrl]);

  // 当切换到 Ollama 时获取模型列表
  useEffect(() => {
    if (providerType === 'ollama') {
      fetchOllamaModels();
    }
  }, [providerType, fetchOllamaModels]);

  // 处理提供商变更
  const handleProviderChange = (value) => {
    setProviderType(value);
  };

  // 处理API密钥变更
  const handleApiKeyChange = (value) => {
    updateProviderConfig(providerType, { apiKey: value });
  };

  // 处理模型变更
  const handleModelChange = (value) => {
    updateProviderConfig(providerType, { model: value });
  };

  // 处理基础URL变更
  const handleBaseUrlChange = (value) => {
    updateProviderConfig(providerType, { baseUrl: value });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API提供商</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="provider-type">选择翻译服务提供商</Label>
                <div title="选择您要使用的AI翻译服务提供商" className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
              </div>
              <Select value={providerType} onValueChange={handleProviderChange}>
                <SelectTrigger id="provider-type">
                  <SelectValue placeholder="选择翻译服务提供商" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(providerInfo).map(([key, info]) => (
                    <SelectItem key={key} value={key}>
                      {info.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{currentProviderInfo.name}设置</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {currentProviderInfo.needsApiKey && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="api-key">API密钥</Label>
                  <div title={`输入您的${currentProviderInfo.name} API密钥`} className="inline-block">
                    <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                  </div>
                </div>
                <Input
                  id="api-key"
                  type="password"
                  placeholder={`输入${currentProviderInfo.name} API密钥`}
                  value={currentConfig.apiKey || ''}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  API密钥将安全地存储在浏览器的本地存储中，不会被上传到任何服务器。
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="model">模型</Label>
                <div title={`输入要使用的${currentProviderInfo.name}模型名称`} className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
                {providerType === 'ollama' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchOllamaModels()}
                    disabled={loadingOllamaModels}
                    className="h-6 px-2 ml-auto"
                  >
                    {loadingOllamaModels ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
              {providerType === 'ollama' && ollamaModels.length > 0 ? (
                // Ollama: 动态模型选择
                <>
                  <Select
                    value={currentConfig.model || ''}
                    onValueChange={handleModelChange}
                  >
                    <SelectTrigger id="model">
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {ollamaModels.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    已从本地 Ollama 获取 {ollamaModels.length} 个视觉模型
                  </p>
                </>
              ) : (
                // 所有提供商: 文本输入框
                <Input
                  id="model"
                  type="text"
                  placeholder={currentProviderInfo.modelPlaceholder}
                  value={currentConfig.model || ''}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full"
                />
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="base-url">基础URL</Label>
                <div title={`修改${currentProviderInfo.name} API的基础URL`} className="inline-block">
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </div>
              </div>
              <Input
                id="base-url"
                type="text"
                placeholder="API基础URL"
                value={currentConfig.baseUrl || currentProviderInfo.baseUrl}
                onChange={(e) => handleBaseUrlChange(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API测试</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="test-text">测试文本</Label>
            </div>
            <Input
              id="test-text"
              type="text"
              placeholder="输入要测试的文本"
              defaultValue="こんにちは世界"
              className="w-full"
            />
            <div className="flex justify-end">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                onClick={() => {
                  // 这里可以添加API测试逻辑
                  alert('API测试功能正在开发中...');
                }}
              >
                测试API
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ApiSettings;