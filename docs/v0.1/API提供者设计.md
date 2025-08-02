# 漫画翻译插件API提供者模块设计

## 1. 概述

API提供者模块是漫画翻译插件的核心组件，负责与各种AI服务进行交互，提供文字检测和翻译功能。本文档详细描述该模块的设计思路、接口定义和实现方案。

## 2. 设计目标

1. **灵活性**：支持多种AI服务提供商，便于扩展和切换
2. **一致性**：为上层应用提供统一的接口，屏蔽底层实现差异
3. **可靠性**：处理API调用过程中的各种异常情况
4. **可配置**：允许用户配置不同的API参数和选项
5. **成本控制**：优化API调用策略，降低使用成本

## 3. 架构设计

采用抽象工厂模式和策略模式的组合设计：

```
                             ┌───────────────┐
                             │  ProviderFactory  │
                             └───────────────┘
                                     │
                                     │ 创建
                                     ▼
┌───────────────┐          ┌───────────────┐
│  应用核心模块  │ ─── 使用 ─→ │  AIProvider   │ (抽象接口)
└───────────────┘          └───────────────┘
                                     │
                                     │ 实现
                                     │
         ┌─────────────┬─────────────┬─────────────┬─────────────┐
         │             │             │             │             │
         ▼             ▼             ▼             ▼             ▼
┌───────────────┐ ┌───────────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│  OpenAIProvider │ │ DeepSeekProvider │ │ ClaudeProvider │ │ GeminiProvider │ │ OpenRouterProvider │
└───────────────┘ └───────────────┘ └───────────┘ └───────────┘ └───────────┘
```

## 4. 接口设计

### 4.1 AIProvider 抽象接口

```javascript
/**
 * AI服务提供者抽象接口
 */
class AIProvider {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   */
  constructor(config) {
    this.config = config || {};
    this.name = 'BaseProvider';
    this.supportedFeatures = {
      textDetection: false,
      imageTranslation: false,
      textTranslation: false
    };
  }

  /**
   * 初始化提供者
   * @returns {Promise<boolean>} - 初始化是否成功
   */
  async initialize() {
    throw new Error('Method not implemented');
  }

  /**
   * 验证API密钥和配置
   * @returns {Promise<Object>} - 验证结果，包含isValid和message字段
   */
  async validateConfig() {
    throw new Error('Method not implemented');
  }

  /**
   * 检测图像中的文字区域
   * @param {string} imageData - Base64编码的图像数据
   * @param {Object} options - 检测选项
   * @returns {Promise<Array>} - 文字区域数组
   */
  async detectText(imageData, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * 翻译文本
   * @param {string|Array<string>} text - 要翻译的文本或文本数组
   * @param {string} targetLang - 目标语言代码
   * @param {Object} options - 翻译选项
   * @returns {Promise<string|Array<string>>} - 翻译结果
   */
  async translateText(text, targetLang, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * 一站式处理图像翻译（检测+翻译）
   * @param {string} imageData - Base64编码的图像数据
   * @param {string} targetLang - 目标语言代码
   * @param {Object} options - 处理选项
   * @returns {Promise<Object>} - 包含textAreas和translations的对象
   */
  async processImage(imageData, targetLang, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * 获取提供者支持的语言列表
   * @returns {Array<Object>} - 语言对象数组，包含code和name字段
   */
  getSupportedLanguages() {
    throw new Error('Method not implemented');
  }

  /**
   * 获取提供者配置模式
   * @returns {Object} - 配置字段定义
   */
  getConfigurationSchema() {
    throw new Error('Method not implemented');
  }
}
```

### 4.2 ProviderFactory 工厂类

```javascript
/**
 * AI服务提供者工厂
 */
class ProviderFactory {
  /**
   * 创建AI提供者实例
   * @param {string} providerType - 提供者类型
   * @param {Object} config - 配置对象
   * @returns {AIProvider} - AI提供者实例
   */
  static createProvider(providerType, config) {
    switch (providerType) {
      case 'openai':
        return new OpenAIProvider(config);
      case 'deepseek':
        return new DeepSeekProvider(config);
      case 'anthropic':
        return new ClaudeProvider(config);
      case 'gemini':
        return new GeminiProvider(config);
      case 'openrouter':
        return new OpenRouterProvider(config);
      default:
        throw new Error(`Unsupported provider type: ${providerType}`);
    }
  }

  /**
   * 获取所有支持的提供者类型
   * @returns {Array<Object>} - 提供者类型数组
   */
  static getSupportedProviders() {
    return [
      { id: 'openai', name: 'OpenAI (GPT-4V/GPT-3.5)', features: ['textDetection', 'textTranslation'] },
      { id: 'deepseek', name: 'DeepSeek', features: ['textDetection', 'textTranslation'] },
      { id: 'anthropic', name: 'Anthropic Claude', features: ['textDetection', 'textTranslation'] },
      { id: 'gemini', name: 'Google Gemini', features: ['textDetection', 'textTranslation'] },
      { id: 'openrouter', name: 'OpenRouter', features: ['textDetection', 'textTranslation'] }
    ];
  }
}
```

## 5. 具体实现

### 5.1 OpenAI提供者

```javascript
/**
 * OpenAI服务提供者
 */
class OpenAIProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'OpenAI';
    this.supportedFeatures = {
      textDetection: true,
      imageTranslation: false,
      textTranslation: true
    };
    
    // 默认配置
    this.config = {
      apiKey: '',
      apiBaseUrl: 'https://api.openai.com/v1',
      visionModel: 'gpt-4-vision-preview',
      chatModel: 'gpt-3.5-turbo',
      maxTokens: 1000,
      temperature: 0.3,
      ...config
    };
  }

  async validateConfig() {
    if (!this.config.apiKey) {
      return { isValid: false, message: 'API密钥不能为空' };
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      });

      if (response.ok) {
        return { isValid: true, message: 'API配置有效' };
      } else {
        const error = await response.json();
        return { isValid: false, message: `API错误: ${error.error?.message || response.statusText}` };
      }
    } catch (error) {
      return { isValid: false, message: `验证失败: ${error.message}` };
    }
  }

  async detectText(imageData, options = {}) {
    const prompt = options.prompt || `
      请分析这张漫画图像，识别其中所有的文字区域。
      返回JSON格式，包含每个文字区域的以下信息：
      1. 坐标(x, y, width, height)：文字区域在图像中的位置和大小
      2. 文字内容(text)：区域内的完整文字
      3. 区域类型(type)：对话气泡(bubble)、旁白框(narration)、音效(sfx)或其他(other)
      4. 阅读顺序(order)：根据漫画阅读习惯分配的序号
      
      返回格式示例：
      {
        "textAreas": [
          {
            "x": 100,
            "y": 50,
            "width": 200,
            "height": 100,
            "text": "文字内容",
            "type": "bubble",
            "order": 1
          },
          ...
        ]
      }
    `;

    try {
      const apiUrl = `${this.config.apiBaseUrl}/chat/completions`;
      
      const requestBody = {
        model: this.config.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageData}`
                }
              }
            ]
          }
        ],
        max_tokens: this.config.maxTokens
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
      }

      const result = await response.json();
      const content = result.choices[0].message.content;
      
      // 解析返回的JSON
      let textAreas;
      try {
        // 尝试直接解析JSON
        const parsed = JSON.parse(content);
        textAreas = parsed.textAreas;
      } catch (e) {
        // 尝试从文本中提取JSON部分
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
          content.match(/{[\s\S]*}/);
        
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
          textAreas = parsed.textAreas;
        } else {
          throw new Error('无法解析API响应');
        }
      }

      if (!Array.isArray(textAreas)) {
        throw new Error('API返回的数据格式不正确');
      }

      return textAreas;
    } catch (error) {
      console.error('OpenAI文字检测失败:', error);
      throw error;
    }
  }

  async translateText(text, targetLang, options = {}) {
    try {
      const isArray = Array.isArray(text);
      const textsToTranslate = isArray ? text : [text];
      
      if (textsToTranslate.length === 0 || !textsToTranslate[0]) {
        return isArray ? [] : '';
      }

      const apiUrl = `${this.config.apiBaseUrl}/chat/completions`;
      
      const languageMap = {
        'zh-CN': '简体中文',
        'zh-TW': '繁体中文',
        'en': '英语',
        'ja': '日语',
        'ko': '韩语',
        'fr': '法语',
        'de': '德语',
        'es': '西班牙语',
        'ru': '俄语'
      };
      
      const targetLanguage = languageMap[targetLang] || targetLang;
      const translationPrompt = options.translationPrompt || '';
      
      let systemPrompt = `你是一个专业的漫画翻译专家，请将以下文本翻译成${targetLanguage}。保持原文的语气和风格，确保翻译自然流畅。`;
      
      if (translationPrompt) {
        systemPrompt += ` ${translationPrompt}`;
      }
      
      // 处理单个文本还是批量文本
      const batchSize = options.batchSize || 5;
      const results = [];
      
      // 分批处理文本，避免请求过大
      for (let i = 0; i < textsToTranslate.length; i += batchSize) {
        const batch = textsToTranslate.slice(i, i + batchSize);
        const batchText = batch.join('\n---SPLIT---\n');
        
        const requestBody = {
          model: this.config.chatModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: batchText
            }
          ],
          temperature: this.config.temperature
        };
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
        }
        
        const result = await response.json();
        const translatedText = result.choices[0].message.content.trim();
        
        // 如果是批量翻译，按分隔符拆分
        if (batch.length > 1) {
          const translatedItems = translatedText.split('\n---SPLIT---\n');
          results.push(...translatedItems);
        } else {
          results.push(translatedText);
        }
      }
      
      return isArray ? results : results[0];
    } catch (error) {
      console.error('OpenAI文本翻译失败:', error);
      throw error;
    }
  }

  getSupportedLanguages() {
    return [
      { code: 'zh-CN', name: '简体中文' },
      { code: 'zh-TW', name: '繁体中文' },
      { code: 'en', name: '英语' },
      { code: 'ja', name: '日语' },
      { code: 'ko', name: '韩语' },
      { code: 'fr', name: '法语' },
      { code: 'de', name: '德语' },
      { code: 'es', name: '西班牙语' },
      { code: 'ru', name: '俄语' }
    ];
  }

  getConfigurationSchema() {
    return {
      apiKey: { type: 'string', required: true, label: 'API密钥' },
      apiBaseUrl: { type: 'string', required: true, label: 'API基础URL', default: 'https://api.openai.com/v1' },
      visionModel: { 
        type: 'select', 
        required: true, 
        label: '视觉模型', 
        default: 'gpt-4-vision-preview',
        options: [
          { value: 'gpt-4-vision-preview', label: 'GPT-4 Vision' },
          { value: 'gpt-4o', label: 'GPT-4o' }
        ]
      },
      chatModel: { 
        type: 'select', 
        required: true, 
        label: '翻译模型', 
        default: 'gpt-3.5-turbo',
        options: [
          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-4o', label: 'GPT-4o' }
        ]
      },
      temperature: { type: 'range', required: false, label: '创意度', min: 0, max: 1, step: 0.1, default: 0.3 },
      maxTokens: { type: 'number', required: false, label: '最大Token数', default: 1000, min: 100, max: 4000 }
    };
  }
}
```

### 5.2 DeepSeek提供者

```javascript
/**
 * DeepSeek服务提供者
 */
class DeepSeekProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'DeepSeek';
    this.supportedFeatures = {
      textDetection: true,
      imageTranslation: false,
      textTranslation: true
    };
    
    // 默认配置
    this.config = {
      apiKey: '',
      apiBaseUrl: 'https://api.deepseek.com/v1',
      visionModel: 'deepseek-vl',
      chatModel: 'deepseek-chat',
      maxTokens: 1000,
      temperature: 0.3,
      ...config
    };
  }

  async validateConfig() {
    // 实现类似OpenAI的验证逻辑，但调用DeepSeek API
  }

  async detectText(imageData, options = {}) {
    // 实现使用DeepSeek-VL模型检测文字区域的逻辑
  }

  async translateText(text, targetLang, options = {}) {
    // 实现使用DeepSeek-Chat模型翻译文本的逻辑
  }

  getSupportedLanguages() {
    // 返回DeepSeek支持的语言列表
  }

  getConfigurationSchema() {
    // 返回DeepSeek特定的配置模式
  }
}
```

### 5.3 OpenRouter提供者

```javascript
/**
 * OpenRouter服务提供者
 */
class OpenRouterProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.name = 'OpenRouter';
    this.supportedFeatures = {
      textDetection: true,
      imageTranslation: false,
      textTranslation: true
    };
    
    // 默认配置
    this.config = {
      apiKey: '',
      apiBaseUrl: 'https://openrouter.ai/api/v1',
      visionModel: 'anthropic/claude-3-opus-20240229',
      chatModel: 'anthropic/claude-3-haiku-20240307',
      maxTokens: 1000,
      temperature: 0.3,
      ...config
    };
  }

  // 实现OpenRouter特定的逻辑
}
```

## 6. 异常处理

为确保API调用的可靠性，所有提供者实现应包含完善的异常处理机制：

1. **API错误处理**：捕获并解析API返回的错误信息
2. **网络错误处理**：处理网络连接问题和超时情况
3. **速率限制处理**：实现请求重试和限流控制
4. **配额管理**：监控API使用量，避免超出用户配额

示例错误处理代码：

```javascript
/**
 * API调用错误处理器
 */
class APIErrorHandler {
  /**
   * 处理API响应
   * @param {Response} response - Fetch API响应对象
   * @returns {Promise} - 处理后的结果
   */
  static async handleResponse(response) {
    if (response.ok) {
      return await response.json();
    }
    
    const statusCode = response.status;
    let errorData;
    
    try {
      errorData = await response.json();
    } catch (e) {
      errorData = { error: { message: response.statusText } };
    }
    
    const errorMessage = errorData.error?.message || response.statusText;
    
    // 根据状态码分类处理错误
    switch (true) {
      case statusCode === 401:
        throw new APIAuthError('API密钥无效或已过期', statusCode, errorData);
      case statusCode === 429:
        throw new APIRateLimitError('API请求频率超限', statusCode, errorData);
      case statusCode >= 500:
        throw new APIServerError('服务器错误', statusCode, errorData);
      default:
        throw new APIError(`API错误: ${errorMessage}`, statusCode, errorData);
    }
  }
  
  /**
   * 实现请求重试逻辑
   * @param {Function} requestFn - 请求函数
   * @param {Object} options - 重试选项
   * @returns {Promise} - 请求结果
   */
  static async withRetry(requestFn, options = {}) {
    const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000 } = options;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        return await requestFn();
      } catch (error) {
        attempt++;
        
        // 如果不是可重试的错误或已达到最大重试次数，则抛出
        if (!(error instanceof APIRateLimitError) || attempt >= maxRetries) {
          throw error;
        }
        
        // 计算退避延迟
        const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
        console.log(`API请求失败，${delay}毫秒后重试 (${attempt}/${maxRetries})`);
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

// 自定义错误类
class APIError extends Error {
  constructor(message, statusCode, data) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

class APIAuthError extends APIError {
  constructor(message, statusCode, data) {
    super(message, statusCode, data);
    this.name = 'APIAuthError';
  }
}

class APIRateLimitError extends APIError {
  constructor(message, statusCode, data) {
    super(message, statusCode, data);
    this.name = 'APIRateLimitError';
  }
}

class APIServerError extends APIError {
  constructor(message, statusCode, data) {
    super(message, statusCode, data);
    this.name = 'APIServerError';
  }
}
```

## 7. 使用实例

以下是使用API提供者模块的示例代码：

```javascript
/**
 * 使用示例
 */
async function translateManga(imageData, targetLang) {
  try {
    // 获取用户配置
    const config = await getConfig();
    
    // 创建提供者实例
    const provider = ProviderFactory.createProvider(config.providerType, {
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
      temperature: config.temperature,
      // 其他配置...
    });
    
    // 验证API配置
    const validation = await provider.validateConfig();
    if (!validation.isValid) {
      throw new Error(`API配置无效: ${validation.message}`);
    }
    
    // 检测文字区域
    const textAreas = await provider.detectText(imageData);
    
    // 提取需要翻译的文本
    const texts = textAreas.map(area => area.text).filter(Boolean);
    
    // 翻译文本
    const translatedTexts = await provider.translateText(texts, targetLang, {
      translationPrompt: config.translationPrompt
    });
    
    return {
      textAreas,
      translations: translatedTexts
    };
  } catch (error) {
    console.error('翻译失败:', error);
    throw error;
  }
}
```

## 8. 性能与优化

为提高API调用的效率和降低成本，可实施以下优化策略：

1. **请求合并**：将多个小型请求合并为一个请求，减少API调用次数
2. **智能批处理**：根据文本长度动态调整批量翻译的大小
3. **缓存机制**：对相同的图像和文本实施缓存策略
4. **并发控制**：限制并发API请求数量，避免触发速率限制
5. **图像预处理**：在发送到API之前，对图像进行适当的压缩和处理

## 9. 安全考量

API密钥保护是安全的核心考量：

1. **安全存储**：使用Chrome的安全存储API存储API密钥
2. **最小权限**：只请求必要的API权限
3. **避免泄露**：不将API密钥发送到非目标服务器
4. **监控使用**：提供API使用量监控和异常检测

## 10. 后续扩展

API提供者模块的未来扩展方向：

1. **支持更多服务提供商**：如百度、讯飞等
2. **一体化处理**：实现一次API调用同时完成检测和翻译
3. **离线支持**：集成本地轻量级模型，提供基本的离线功能
4. **高级特性**：支持更复杂的翻译任务，如保留格式、识别语气等

## 11. 结论

API提供者模块通过抽象接口和工厂模式，为漫画翻译插件提供了灵活、可扩展的AI服务集成方案。多种AI服务提供商的支持不仅增强了用户选择的自由度，也提高了插件的可靠性和适应性。 