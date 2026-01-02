import { AIProvider } from '../base-provider';
import { APIErrorHandler } from '../../utils/error-handler';

/**
 * Anthropic Claude服务提供者
 */
export class ClaudeProvider extends AIProvider {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   */
  constructor(config = {}) {
    super(config);
    this.name = 'Claude';
    this.supportedFeatures = {
      textDetection: true,
      imageTranslation: false,
      textTranslation: true
    };
    
    // 默认配置
    this.config = {
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com',
      model: 'claude-3-opus-20240229',
      maxTokens: 1000,
      temperature: 0.3,
      ...config
    };
  }

  /**
   * 初始化提供者
   * @returns {Promise<boolean>} - 初始化是否成功
   */
  async initialize() {
    return true;
  }

  /**
   * 验证API密钥和配置
   * @returns {Promise<Object>} - 验证结果，包含isValid和message字段
   */
  async validateConfig() {
    if (!this.config.apiKey) {
      return { isValid: false, message: 'API密钥不能为空' };
    }

    try {
      // Claude API 没有专门的验证端点，尝试发送简单消息
      const response = await fetch(`${this.config.apiBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 10,
          messages: [
            { role: 'user', content: 'Hello' }
          ]
        })
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

  /**
   * 检测图像中的文字区域
   * @param {string} imageData - Base64编码的图像数据
   * @param {Object} options - 检测选项
   * @returns {Promise<Array>} - 文字区域数组
   */
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
      return await APIErrorHandler.withRetry(async () => {
        const apiUrl = `${this.config.apiBaseUrl}/v1/messages`;
        
        const requestBody = {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: imageData
                  }
                }
              ]
            }
          ]
        };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(requestBody)
        });

        const result = await APIErrorHandler.handleResponse(response);
        const content = result.content[0].text;
        
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
      }, options.retryOptions);
    } catch (error) {
      console.error('Claude文字检测失败:', error);
      throw error;
    }
  }

  /**
   * 翻译文本 - 实现统一接口
   * @param {Object} request - 翻译请求对象
   * @param {string} request.text - 要翻译的文本
   * @param {string} request.targetLanguage - 目标语言代码
   * @param {string} [request.sourceLanguage] - 源语言代码
   * @param {string} [request.translationPrompt] - 自定义翻译提示词
   * @returns {Promise<Object>} - 翻译响应 { translatedText, sourceLanguage? }
   */
  async translateText(request) {
    // 支持旧的调用方式（向后兼容）
    let text, targetLang, options;
    if (typeof request === 'string' || Array.isArray(request)) {
      text = request;
      targetLang = arguments[1];
      options = arguments[2] || {};
      console.warn('[ClaudeProvider] 使用了旧的 translateText 调用方式，建议使用新的请求对象格式');
    } else {
      text = request.text;
      targetLang = request.targetLanguage;
      options = {
        sourceLanguage: request.sourceLanguage,
        translationPrompt: request.translationPrompt,
        context: request.context,
      };
    }

    try {
      const isArray = Array.isArray(text);
      const textsToTranslate = isArray ? text : [text];
      
      if (textsToTranslate.length === 0 || !textsToTranslate[0]) {
        return { translatedText: isArray ? [] : '' };
      }

      console.log('[ClaudeProvider] 开始翻译:', {
        textCount: textsToTranslate.length,
        targetLang,
        apiBaseUrl: this.config.apiBaseUrl,
        model: this.config.model
      });

      const apiUrl = `${this.config.apiBaseUrl}/v1/messages`;
      
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
      
      let systemPrompt;
      if (translationPrompt && translationPrompt.length > 100) {
        systemPrompt = translationPrompt;
      } else {
        systemPrompt = `你是一个专业的漫画翻译专家，请将以下文本翻译成${targetLanguage}。保持原文的语气和风格，确保翻译自然流畅。只返回翻译结果，不要添加任何解释。`;
        if (translationPrompt) {
          systemPrompt += ` ${translationPrompt}`;
        }
      }
      
      const batchSize = 5;
      const results = [];
      
      for (let i = 0; i < textsToTranslate.length; i += batchSize) {
        const batch = textsToTranslate.slice(i, i + batchSize);
        const batchText = batch.length > 1 ? batch.join('\n---SPLIT---\n') : batch[0];
        
        const result = await APIErrorHandler.withRetry(async () => {
          console.log('[ClaudeProvider] 发送 API 请求:', {
            url: apiUrl,
            model: this.config.model,
            textLength: batchText.length
          });

          const requestBody = {
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `${systemPrompt}\n\n要翻译的文本:\n${batchText}`
                  }
                ]
              }
            ]
          };
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.config.apiKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(requestBody)
          });
          
          console.log('[ClaudeProvider] API 响应状态:', response.status);
          
          const responseData = await APIErrorHandler.handleResponse(response);
          const translatedText = responseData.content[0].text.trim();
          
          console.log('[ClaudeProvider] 翻译成功:', {
            inputLength: batchText.length,
            outputLength: translatedText.length
          });
          
          if (batch.length > 1) {
            const translatedItems = translatedText.split('\n---SPLIT---\n');
            if (translatedItems.length !== batch.length) {
              return translatedText.split('\n\n').slice(0, batch.length);
            }
            return translatedItems;
          } else {
            return [translatedText];
          }
        }, options.retryOptions);
        
        results.push(...result);
      }
      
      const translatedText = isArray ? results : results[0];
      return {
        translatedText,
        sourceLanguage: options.sourceLanguage || 'auto'
      };
    } catch (error) {
      console.error('[ClaudeProvider] 翻译失败:', error);
      throw error;
    }
  }

  /**
   * 获取提供者支持的语言列表
   * @returns {Array<Object>} - 语言对象数组，包含code和name字段
   */
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

  /**
   * 获取提供者配置模式
   * @returns {Object} - 配置字段定义
   */
  getConfigurationSchema() {
    return {
      apiKey: { type: 'string', required: true, label: 'API密钥' },
      apiBaseUrl: { type: 'string', required: true, label: 'API基础URL', default: 'https://api.anthropic.com' },
      model: { 
        type: 'select', 
        required: true, 
        label: '模型', 
        default: 'claude-3-opus-20240229',
        options: [
          { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
          { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet' },
          { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
          { value: 'claude-2.1', label: 'Claude 2.1' },
          { value: 'claude-2.0', label: 'Claude 2.0' }
        ]
      },
      temperature: { type: 'range', required: false, label: '创意度', min: 0, max: 1, step: 0.1, default: 0.3 },
      maxTokens: { type: 'number', required: false, label: '最大Token数', default: 1000, min: 100, max: 4000 }
    };
  }
} 