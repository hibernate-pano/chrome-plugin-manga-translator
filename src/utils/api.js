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
  const { apiKey, model = 'gpt-4-vision-preview', maxTokens = 1000 } = options;
  
  if (!apiKey) {
    throw new Error('未提供API密钥');
  }
  
  const prompt = options.prompt || '请识别这张漫画图像中的所有文字区域，并提取文字内容。返回JSON格式，包含每个文字区域的坐标(x, y, width, height)和文字内容。';
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
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
      })
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
    translationPrompt = ''
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
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
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
        temperature: temperature
      })
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
 * @param {string} apiKey - OpenAI API密钥
 * @returns {Promise<boolean>} - 返回密钥是否有效
 */
export async function validateApiKey(apiKey) {
  if (!apiKey) return false;
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    return response.ok;
  } catch (error) {
    console.error('API密钥验证失败:', error);
    return false;
  }
}
