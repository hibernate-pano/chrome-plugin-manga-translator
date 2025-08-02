/**
 * API调用相关工具函数
 */

/**
 * 调用OpenAI Vision API进行图像分析
 * @param {string} imageData - Base64编码的图像数据
 * @param {Object} options - API选项
 * @returns {Promise<Object>} - 返回API响应
 */
export async function callVisionAPI(imageData, options = {}) {
  const {
    apiKey,
    model = 'gpt-4-vision-preview',
    maxTokens = 1000,
    apiBaseUrl = 'https://api.openai.com/v1'
  } = options;

  if (!apiKey) {
    throw new Error('未提供API密钥');
  }

  const prompt = options.prompt || '请识别这张漫画图像中的所有文字区域，并提取文字内容。返回JSON格式，包含每个文字区域的坐标(x, y, width, height)和文字内容。';

  // 构建API URL
  const apiUrl = `${apiBaseUrl}/chat/completions`;

  // 检查是否是Qwen模型
  const isQwenModel = model.toLowerCase().includes('qwen');

  // 根据模型类型构建不同的请求体
  let requestBody;

  if (isQwenModel) {
    // Qwen模型的请求格式
    requestBody = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image',
              image_url: {
                url: `data:image/jpeg;base64,${imageData}`
              }
            }
          ]
        }
      ],
      max_tokens: maxTokens
    };
  } else {
    // OpenAI模型的请求格式
    requestBody = {
      model,
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
      max_tokens: maxTokens
    };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Vision API调用失败:', error);
    throw error;
  }
}

/**
 * 调用OpenAI Chat API进行文本翻译
 * @param {string} text - 需要翻译的文本
 * @param {string} targetLang - 目标语言
 * @param {Object} options - API选项
 * @returns {Promise<string>} - 返回翻译结果
 */
export async function callChatAPI(text, targetLang, options = {}) {
  const {
    apiKey,
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    translationPrompt = '',
    apiBaseUrl = 'https://api.openai.com/v1'
  } = options;

  if (!apiKey) {
    throw new Error('未提供API密钥');
  }

  if (!text || text.trim() === '') {
    return '';
  }

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

  let systemPrompt = `你是一个专业的漫画翻译专家，请将以下文本翻译成${targetLanguage}。保持原文的语气和风格，确保翻译自然流畅。`;

  if (translationPrompt) {
    systemPrompt += ` ${translationPrompt}`;
  }

  // 构建API URL
  const apiUrl = `${apiBaseUrl}/chat/completions`;

  // 检查是否是Qwen模型
  const isQwenModel = model.toLowerCase().includes('qwen');

  // 根据模型类型构建不同的请求体
  let requestBody;

  if (isQwenModel) {
    // Qwen模型可能不支持或不需要system消息，将system内容合并到user消息中
    requestBody = {
      model,
      messages: [
        {
          role: 'user',
          content: `${systemPrompt}\n\n${text}`
        }
      ],
      temperature
    };
  } else {
    // OpenAI模型的标准格式
    requestBody = {
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature
    };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Chat API调用失败:', error);
    throw error;
  }
}

/**
 * 批量翻译多个文本
 * @param {Array<string>} texts - 需要翻译的文本数组
 * @param {string} targetLang - 目标语言代码
 * @param {Object} options - 翻译选项
 * @returns {Promise<Array<string>>} - 返回翻译后的文本数组
 */
export async function batchTranslate(texts, targetLang, options = {}) {
  const { maxConcurrentRequests = 3 } = options;

  // 过滤空文本
  const validTexts = texts.filter(text => text && text.trim() !== '');

  if (validTexts.length === 0) {
    return [];
  }

  // 如果文本很少，直接一次性翻译
  if (validTexts.length <= 3) {
    const combinedText = validTexts.join('\n---\n');
    const translatedText = await callChatAPI(combinedText, targetLang, options);
    return translatedText.split('\n---\n');
  }

  // 对于大量文本，使用并发请求
  const results = new Array(validTexts.length);
  const chunks = [];

  // 将文本分组，每组最多3个文本
  for (let i = 0; i < validTexts.length; i += 3) {
    chunks.push(validTexts.slice(i, i + 3));
  }

  // 并发翻译，但限制并发数
  for (let i = 0; i < chunks.length; i += maxConcurrentRequests) {
    const batch = chunks.slice(i, i + maxConcurrentRequests);
    const promises = batch.map(async (chunk, batchIndex) => {
      const combinedText = chunk.join('\n---\n');
      const translatedText = await callChatAPI(combinedText, targetLang, options);
      const translations = translatedText.split('\n---\n');

      // 将结果放入正确的位置
      const startIndex = (i + batchIndex) * 3;
      for (let j = 0; j < translations.length; j++) {
        results[startIndex + j] = translations[j];
      }
    });

    await Promise.all(promises);
  }

  return results;
}

/**
 * 检测API密钥是否有效
 * @param {string} apiKey - API密钥
 * @param {string} apiBaseUrl - API基础URL
 * @param {string} model - 模型名称，用于测试模型可用性
 * @returns {Promise<Object>} - 返回验证结果对象
 */
export async function validateApiKey(apiKey, apiBaseUrl = 'https://api.openai.com/v1', model = '') {
  if (!apiKey) {
    return {
      valid: false,
      error: '未提供API密钥',
      models: [],
      supportsVision: false
    };
  }

  try {
    // 构建API URL
    const apiUrl = `${apiBaseUrl}/models`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        valid: false,
        error: errorData.error?.message || `API错误: ${response.status} ${response.statusText}`,
        models: [],
        supportsVision: false
      };
    }

    // 获取可用模型列表
    const data = await response.json();
    const models = data.data || [];
    const modelIds = models.map(m => m.id);

    // 检查是否支持视觉模型
    const supportsVision = modelIds.some(id =>
      id.includes('vision') ||
      id.includes('gpt-4') ||
      id.toLowerCase().includes('qwen') ||
      id.toLowerCase().includes('claude')
    );

    // 检查指定的模型是否可用
    let modelAvailable = !model || modelIds.includes(model);

    // 对于自定义模型，我们无法确定是否可用，假设它可用
    if (!modelAvailable && !modelIds.includes(model) && apiBaseUrl !== 'https://api.openai.com/v1') {
      modelAvailable = true;
    }

    return {
      valid: true,
      models: modelIds,
      supportsVision,
      modelAvailable,
      error: modelAvailable ? null : `指定的模型 "${model}" 不可用`
    };
  } catch (error) {
    console.error('API密钥验证失败:', error);
    return {
      valid: false,
      error: `连接错误: ${error.message}`,
      models: [],
      supportsVision: false
    };
  }
}

/**
 * 测试API配置是否可用于翻译
 * @param {Object} config - API配置对象
 * @returns {Promise<Object>} - 返回测试结果
 */
export async function testApiConfig(config) {
  try {
    const {
      apiKey,
      apiBaseUrl = 'https://api.openai.com/v1',
      useCustomApiUrl = false,
      model = 'gpt-3.5-turbo',
      customModel = '',
      useCustomModel = false
    } = config;

    if (!apiKey) {
      return {
        success: false,
        message: '请提供API密钥'
      };
    }

    const actualApiUrl = useCustomApiUrl ? apiBaseUrl : 'https://api.openai.com/v1';
    const actualModel = useCustomModel ? customModel : model;

    // 验证API密钥
    const validationResult = await validateApiKey(apiKey, actualApiUrl, actualModel);

    if (!validationResult.valid) {
      return {
        success: false,
        message: `API密钥验证失败: ${validationResult.error}`,
        details: validationResult
      };
    }

    if (!validationResult.modelAvailable) {
      return {
        success: false,
        message: `所选模型不可用: ${actualModel}`,
        details: validationResult
      };
    }

    // 测试简单翻译
    try {
      const testResult = await callChatAPI('Hello, this is a test.', 'zh-CN', {
        apiKey,
        apiBaseUrl: actualApiUrl,
        model: actualModel,
        temperature: 0.3
      });

      return {
        success: true,
        message: 'API配置有效，翻译测试成功',
        testResult,
        details: validationResult
      };
    } catch (translationError) {
      return {
        success: false,
        message: `API密钥有效，但翻译测试失败: ${translationError.message}`,
        details: validationResult
      };
    }
  } catch (error) {
    console.error('API配置测试失败:', error);
    return {
      success: false,
      message: `测试过程中发生错误: ${error.message}`
    };
  }
}

/**
 * API工具模块
 * 提供内容脚本与API提供者之间的通信接口
 */

import ProviderFactory from '../api/providers';
import { getActiveProviderConfig, getConfig } from './storage';
import { APIErrorHandler } from './error-handler';

/**
 * 初始化API提供者
 * @returns {Promise<Object>} - 返回初始化后的提供者实例
 */
export async function initializeProvider() {
  try {
    // 获取当前激活的提供者配置
    const { type, config } = await getActiveProviderConfig();
    
    // 创建提供者实例
    const provider = ProviderFactory.createProvider(type, config);
    
    // 初始化提供者
    await provider.initialize();
    
    return provider;
  } catch (error) {
    console.error('初始化API提供者失败:', error);
    throw error;
  }
}

/**
 * 检测图像中的文字区域
 * @param {string} imageData - Base64编码的图像数据
 * @returns {Promise<Array>} - 返回检测到的文字区域数组
 */
export async function detectTextInImage(imageData) {
  try {
    // 获取提供者
    const provider = await initializeProvider();
    
    // 获取当前配置
    const config = await getConfig();
    
    // 创建检测选项
    const options = {
      retryOptions: {
        maxRetries: 3,
        delayMs: 1000
      },
      timeout: config.advancedSettings.apiTimeout * 1000 || 30000,
      preprocessingType: config.advancedSettings.imagePreprocessing || 'none'
    };
    
    // 如果启用了本地OCR，则使用本地OCR
    if (config.advancedSettings.useLocalOcr) {
      // 本地OCR实现（未完成）
      console.log('本地OCR尚未实现');
      // return await detectTextLocally(imageData, options);
    }
    
    // 使用提供者检测文字
    const textAreas = await provider.detectText(imageData, options);
    
    return textAreas;
  } catch (error) {
    console.error('检测图像中的文字失败:', error);
    throw error;
  }
}

/**
 * 翻译文本
 * @param {string|Array<string>} text - 要翻译的文本或文本数组
 * @param {string} targetLang - 目标语言代码
 * @returns {Promise<string|Array<string>>} - 返回翻译结果
 */
export async function translateText(text, targetLang) {
  try {
    // 获取提供者
    const provider = await initializeProvider();
    
    // 获取当前配置
    const config = await getConfig();
    
    // 创建翻译选项
    const options = {
      retryOptions: {
        maxRetries: 3,
        delayMs: 1000
      },
      timeout: config.advancedSettings.apiTimeout * 1000 || 30000,
      translationPrompt: config.advancedSettings.translationPrompt || '',
      batchSize: 5 // 批量翻译的文本数量
    };
    
    // 使用提供者翻译文本
    const translatedText = await provider.translateText(text, targetLang, options);
    
    return translatedText;
  } catch (error) {
    console.error('翻译文本失败:', error);
    throw error;
  }
}

/**
 * 验证API提供者配置
 * @param {string} providerType - 提供者类型
 * @param {Object} providerConfig - 提供者配置
 * @returns {Promise<Object>} - 返回验证结果
 */
export async function validateProviderConfig(providerType, providerConfig) {
  try {
    const provider = ProviderFactory.createProvider(providerType, providerConfig);
    return await provider.validateConfig();
  } catch (error) {
    console.error('验证API提供者配置失败:', error);
    return { isValid: false, message: `验证失败: ${error.message}` };
  }
}

/**
 * 获取可用的API提供者列表
 * @returns {Array<Object>} - 返回提供者对象数组
 */
export function getAvailableProviders() {
  return ProviderFactory.getRegisteredProviders().map(type => {
    const providerClass = ProviderFactory.getProviderClass(type);
    const instance = new providerClass();
    
    return {
      type,
      name: instance.name,
      features: instance.supportedFeatures,
      schema: instance.getConfigurationSchema()
    };
  });
}

/**
 * 获取提供者支持的语言列表
 * @param {string} providerType - 提供者类型
 * @returns {Promise<Array<Object>>} - 返回语言对象数组
 */
export async function getSupportedLanguages(providerType = null) {
  try {
    let type = providerType;
    
    if (!type) {
      const config = await getActiveProviderConfig();
      type = config.type;
    }
    
    const provider = ProviderFactory.createProvider(type);
    return provider.getSupportedLanguages();
  } catch (error) {
    console.error('获取支持的语言列表失败:', error);
    // 返回默认语言列表
    return [
      { code: 'zh-CN', name: '简体中文' },
      { code: 'zh-TW', name: '繁体中文' },
      { code: 'en', name: '英语' },
      { code: 'ja', name: '日语' },
      { code: 'ko', name: '韩语' }
    ];
  }
}
