/**
 * 翻译模块
 */
import { translateText as apiTranslateText } from '../utils/api';
import { generateImageHash, getCachedTranslation, cacheTranslation, getConfig } from '../utils/storage';
import { imageToBase64 } from '../utils/imageProcess';

/**
 * 翻译文本内容
 * @param {string} text - 需要翻译的文本
 * @param {string} targetLang - 目标语言代码
 * @param {Object} options - 翻译选项
 * @returns {Promise<string>} - 返回翻译后的文本
 */
export async function translateText(text, targetLang, options = {}) {
  try {
    if (!text || text.trim() === '') {
      return '';
    }

    // 使用API工具模块进行翻译
    return await apiTranslateText(text, targetLang);
  } catch (error) {
    console.error('翻译失败:', error);
    throw error;
  }
}

/**
 * 翻译图像中的文字
 * @param {HTMLImageElement} image - 图像元素
 * @param {Array} textAreas - 文字区域信息数组
 * @param {string} targetLang - 目标语言代码
 * @param {Object} options - 翻译选项
 * @returns {Promise<Array<string>>} - 返回翻译后的文本数组
 */
export async function translateImageText(image, textAreas, targetLang, options = {}) {
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

    if (!textAreas || textAreas.length === 0) {
      return [];
    }

    // 提取所有文本
    const texts = textAreas.map(area => area.text || '').filter(text => text.trim() !== '');

    if (texts.length === 0) {
      return [];
    }

    // 生成图像哈希
    const imageBase64 = await imageToBase64(image);
    const imageHash = generateImageHash(imageBase64);

    // 检查缓存
    if (useCache) {
      const cachedResult = await getCachedTranslation(imageHash);
      if (cachedResult && cachedResult.translations &&
        cachedResult.targetLang === targetLang &&
        cachedResult.translations.length === texts.length) {
        if (debugMode) {
          console.log('使用缓存的翻译结果:', cachedResult.translations);
        }
        return cachedResult.translations;
      }
    }

    // 批量翻译
    const translations = await apiTranslateText(texts, targetLang);

    // 缓存结果
    if (useCache) {
      await cacheTranslation(imageHash, {
        translations,
        targetLang,
        timestamp: Date.now()
      });
    }

    if (debugMode) {
      console.log('翻译结果:', translations);
    }

    return translations;
  } catch (error) {
    console.error('图像文字翻译失败:', error);
    throw error;
  }
}
