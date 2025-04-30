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
      请分析这张漫画图像，识别其中所有的文字区域，特别是对话气泡、旁白框和音效文字。

      要求：
      1. 返回JSON格式，包含每个文字区域的详细信息
      2. 对于每个文字区域，提供以下信息：
         - 坐标(x, y, width, height)：文字区域在图像中的位置和大小
         - 文字内容(text)：区域内的完整文字
         - 区域类型(type)：对话气泡(bubble)、旁白框(narration)、音效(sfx)或其他(other)
         - 阅读顺序(order)：根据漫画阅读习惯（从上到下，从右到左或从左到右）分配的序号
         - 置信度(confidence)：识别的准确度评分(0-1)
      3. 尽可能准确地识别每个文字区域的边界，特别是对话气泡的轮廓
      4. 保持文字的原始顺序和分组，考虑漫画的阅读流向
      5. 如果是对话气泡，尝试识别说话者（如果图像中有明显的角色）

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
            "order": 1,
            "confidence": 0.95,
            "speaker": "角色名（如果能识别）"
          },
          {
            "x": 300,
            "y": 150,
            "width": 150,
            "height": 50,
            "text": "旁白文字",
            "type": "narration",
            "order": 2,
            "confidence": 0.9
          },
          ...
        ],
        "readingDirection": "rtl" // rtl(从右到左)或ltr(从左到右)
      }
    `;

    // 使用传入的模型或默认模型
    const response = await callVisionAPI(imageData, {
      apiKey,
      prompt,
      model: options.model || 'gpt-4-vision-preview',
      maxTokens: 1500,
      apiBaseUrl: options.apiBaseUrl || 'https://api.openai.com/v1'
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

    // 处理和规范化文字区域数据
    const processedTextAreas = textAreas.map(area => {
      // 确保所有必要的字段都存在
      return {
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        text: area.text || '',
        type: area.type || 'bubble', // 默认为对话气泡
        order: area.order || 0,
        confidence: area.confidence || 0.8,
        speaker: area.speaker || '',
        // 添加额外的元数据
        metadata: {
          readingDirection: result.readingDirection || 'rtl', // 默认从右到左
          isProcessed: true,
          detectionMethod: 'vision-api'
        }
      };
    });

    // 按阅读顺序排序
    processedTextAreas.sort((a, b) => a.order - b.order);

    // 过滤掉低置信度的区域
    const filteredTextAreas = processedTextAreas.filter(area =>
      area.confidence > 0.5 && area.text.trim() !== ''
    );

    // 缓存结果
    if (useCache) {
      await cacheTranslation(imageHash, {
        textAreas: filteredTextAreas,
        readingDirection: result.readingDirection || 'rtl'
      });
    }

    if (debugMode) {
      console.log('检测到的文字区域:', filteredTextAreas);
      console.log('阅读方向:', result.readingDirection || 'rtl');
    }

    return filteredTextAreas;
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
