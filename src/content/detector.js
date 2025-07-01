/**
 * 文字检测模块
 */
import { detectTextInImage } from '../utils/api';
import { imageToBase64, preprocessImage } from '../utils/imageProcess';
import { generateImageHash, getCachedTranslation, cacheTranslation, getConfig } from '../utils/storage';

/**
 * 检测图像中的文字区域
 * @param {HTMLImageElement} image - 需要处理的图像元素
 * @param {Object} options - 检测选项
 * @returns {Promise<Array>} - 返回检测到的文字区域信息数组
 */
export async function detectTextAreas(image, options = {}) {
  try {
    // 获取当前配置
    const config = await getConfig();
    const {
      advancedSettings = {}
    } = config;

    const {
      useCache = advancedSettings.cacheResults !== false,
      debugMode = advancedSettings.debugMode || false
    } = options;

    // 预处理图像
    const imagePreprocessing = advancedSettings.imagePreprocessing || 'none';
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

    // 调用API检测文字
    const textAreas = await detectTextInImage(imageData);

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
          readingDirection: area.readingDirection || 'rtl', // 默认从右到左
          isProcessed: true,
          detectionMethod: 'vision-api'
        }
      };
    });

    // 按阅读顺序排序
    processedTextAreas.sort((a, b) => a.order - b.order);

    // 过滤掉低置信度的区域
    const filteredTextAreas = processedTextAreas.filter(area =>
      area.text && area.text.trim() !== ''
    );

    // 缓存结果
    if (useCache) {
      await cacheTranslation(imageHash, {
        textAreas: filteredTextAreas,
        timestamp: Date.now()
      });
    }

    if (debugMode) {
      console.log('检测到的文字区域:', filteredTextAreas);
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

  // 使用detectTextInImage API提取文字
  const imageData = await imageToBase64(canvas);
  const textAreas = await detectTextInImage(imageData);
  
  // 返回提取的文字
  if (textAreas && textAreas.length > 0) {
    return textAreas[0].text || '';
  }
  
  return '';
}
