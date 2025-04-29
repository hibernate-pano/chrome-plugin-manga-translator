/**
 * 文字检测模块
 */
import { callVisionAPI } from '../utils/api';
import { imageToBase64, preprocessImage } from '../utils/imageProcess';
import { generateImageHash, getCachedTranslation, cacheTranslation } from '../utils/storage';

/**
 * 检测图像中的文字区域
 * @param {HTMLImageElement} image - 需要处理的图像元素
 * @param {Object} options - 检测选项
 * @returns {Promise<Array>} - 返回检测到的文字区域信息数组
 */
export async function detectTextAreas(image, options = {}) {
  try {
    const {
      apiKey,
      useCache = true,
      imagePreprocessing = 'none',
      debugMode = false
    } = options;
    
    if (!apiKey) {
      throw new Error('未提供API密钥');
    }
    
    // 预处理图像
    const processedImage = await preprocessImage(image, imagePreprocessing);
    
    // 转换为Base64
    const imageData = await imageToBase64(processedImage);
    
    // 生成图像哈希
    const imageHash = generateImageHash(imageData);
    
    // 检查缓存
    if (useCache) {
      const cachedResult = await getCachedTranslation(imageHash);
      if (cachedResult && cachedResult.textAreas) {
        if (debugMode) {
          console.log('使用缓存的文字检测结果:', cachedResult.textAreas);
        }
        return cachedResult.textAreas;
      }
    }
    
    // 调用Vision API
    const prompt = `
      请分析这张漫画图像，识别其中所有的文字区域。
      
      要求：
      1. 返回JSON格式，包含每个文字区域的坐标(x, y, width, height)和文字内容
      2. 只识别图像中的文字，忽略其他元素
      3. 尽可能准确地提取每个文字气泡或文本框中的内容
      4. 保持文字的原始顺序和分组
      
      返回格式示例：
      {
        "textAreas": [
          {
            "x": 100,
            "y": 50,
            "width": 200,
            "height": 100,
            "text": "文字内容"
          },
          ...
        ]
      }
    `;
    
    const response = await callVisionAPI(imageData, {
      apiKey,
      prompt,
      model: 'gpt-4-vision-preview',
      maxTokens: 1500
    });
    
    // 解析API响应
    const content = response.choices[0].message.content;
    let result;
    
    try {
      // 尝试直接解析JSON
      result = JSON.parse(content);
    } catch (e) {
      // 如果直接解析失败，尝试从文本中提取JSON部分
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                        content.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (e2) {
          console.error('解析JSON失败:', e2);
          throw new Error('无法解析API响应');
        }
      } else {
        throw new Error('API响应中未找到有效的JSON数据');
      }
    }
    
    // 验证结果格式
    if (!result || !result.textAreas || !Array.isArray(result.textAreas)) {
      throw new Error('API返回的数据格式不正确');
    }
    
    const textAreas = result.textAreas;
    
    // 缓存结果
    if (useCache) {
      await cacheTranslation(imageHash, { textAreas });
    }
    
    if (debugMode) {
      console.log('检测到的文字区域:', textAreas);
    }
    
    return textAreas;
  } catch (error) {
    console.error('文字区域检测失败:', error);
    throw error;
  }
}

/**
 * 提取文字区域的内容
 * @param {HTMLImageElement} image - 图像元素
 * @param {Object} textArea - 文字区域信息
 * @returns {Promise<string>} - 返回提取的文字内容
 */
export async function extractText(image, textArea) {
  // 在大多数情况下，文字内容已经包含在textArea对象中
  if (textArea.text) {
    return textArea.text;
  }
  
  // 如果没有文字内容，可以尝试单独提取
  const { x, y, width, height } = textArea;
  
  // 创建Canvas来提取区域
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  
  // 转换为Base64
  const imageData = await imageToBase64(canvas);
  
  // 调用Vision API进行OCR
  const response = await callVisionAPI(imageData, {
    prompt: '请提取这个图像中的所有文字内容，只返回文字，不要添加任何解释或格式。',
    maxTokens: 300
  });
  
  return response.choices[0].message.content.trim();
}
