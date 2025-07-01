/**
 * OCR提供者索引文件
 * 导出所有OCR提供者类和工厂
 */
import { OCRFactory } from './ocr-factory';
import { BaseOCRProvider } from './base-ocr-provider';
import { TesseractProvider } from './tesseract-provider';

// 注册OCR提供者
OCRFactory.registerProvider('tesseract', TesseractProvider);

// 导出OCR提供者工厂和基类
export {
  OCRFactory,
  BaseOCRProvider,
  TesseractProvider
};

/**
 * 初始化默认OCR提供者
 * @param {Object} config - 配置对象
 * @returns {Promise<BaseOCRProvider>} - 初始化后的OCR提供者实例
 */
export async function initializeDefaultOCRProvider(config = {}) {
  try {
    // 从配置或存储中获取OCR提供者类型
    const providerType = config.ocrProvider || 'tesseract';
    
    // 创建提供者实例
    const provider = OCRFactory.createProvider(providerType, config[providerType] || {});
    
    // 初始化提供者
    await provider.initialize();
    
    return provider;
  } catch (error) {
    console.error('初始化OCR提供者失败:', error);
    throw error;
  }
}

/**
 * 获取支持的OCR提供者列表
 * @returns {Array<Object>} - 提供者信息数组
 */
export function getSupportedOCRProviders() {
  return OCRFactory.getSupportedProviders();
}

/**
 * 使用回退策略进行OCR文字识别
 * 当主要OCR方法失败时，自动使用备选方法
 * @param {string|Blob} imageData - 图像数据
 * @param {BaseOCRProvider} primaryProvider - 主要OCR提供者
 * @param {BaseOCRProvider} fallbackProvider - 备选OCR提供者
 * @param {Object} options - 检测选项
 * @returns {Promise<Array>} - 文字区域数组
 */
export async function detectWithFallback(imageData, primaryProvider, fallbackProvider, options = {}) {
  try {
    // 尝试使用主要OCR提供者
    const result = await primaryProvider.detectText(imageData, options);
    
    // 检查结果是否有效（至少有一个文本区域）
    if (result && result.length > 0) {
      return result;
    }
    
    console.log('主OCR方法未检测到文本，尝试备选方法');
    
    // 主要方法未检测到文本，使用备选方法
    return await fallbackProvider.detectText(imageData, options);
  } catch (error) {
    console.error('主OCR方法失败，使用备选方法:', error);
    
    // 主要方法失败，使用备选方法
    return await fallbackProvider.detectText(imageData, options);
  }
} 