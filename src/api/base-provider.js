/**
 * AI服务提供者抽象基类
 * 所有具体的API提供者实现都应继承此类
 */
export class AIProvider {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   */
  constructor(config = {}) {
    this.config = config;
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
    // 默认实现：先检测文字区域，然后翻译文本
    try {
      // 检测文字区域
      const textAreas = await this.detectText(imageData, options);
      
      if (!textAreas || textAreas.length === 0) {
        return { textAreas: [], translations: [] };
      }
      
      // 提取文本内容
      const texts = textAreas.map(area => area.text).filter(Boolean);
      
      if (texts.length === 0) {
        return { textAreas, translations: [] };
      }
      
      // 翻译文本
      const translations = await this.translateText(texts, targetLang, options);
      
      return { textAreas, translations };
    } catch (error) {
      console.error('Image processing failed:', error);
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
    // 返回基础配置字段
    return {
      apiKey: { type: 'string', required: true, label: 'API密钥' }
    };
  }
} 