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
    this.isInitialized = false;
    this.resources = new Set(); // 跟踪资源
  }

  /**
   * 初始化提供者
   * @returns {Promise<boolean>} - 初始化是否成功
   */
  async initialize() {
    if (this.isInitialized) {
      return true;
    }
    
    try {
      // 子类应该覆盖此方法实现具体初始化逻辑
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error(`初始化${this.name}失败:`, error);
      throw error;
    }
  }

  /**
   * 验证API密钥和配置
   * @returns {Promise<Object>} - 验证结果，包含isValid和message字段
   */
  async validateConfig() {
    try {
      // 基本检查：确保API密钥存在
      if (!this.config.apiKey) {
        return {
          isValid: false,
          message: 'API密钥不能为空'
        };
      }
      
      return {
        isValid: true,
        message: '配置有效'
      };
    } catch (error) {
      console.error(`验证${this.name}配置失败:`, error);
      return {
        isValid: false,
        message: `验证失败: ${error.message}`
      };
    }
  }

  /**
   * 检测图像中的文字区域
   * @param {string} imageData - Base64编码的图像数据
   * @param {Object} options - 检测选项
   * @returns {Promise<Array>} - 文字区域数组
   */
  async detectText(imageData, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
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
    if (!this.isInitialized) {
      await this.initialize();
    }
    
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
    if (!this.isInitialized) {
      await this.initialize();
    }
    
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
      console.error(`${this.name}图像处理失败:`, error);
      // 标准化错误响应
      throw this.normalizeError(error, 'processImage');
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
      apiKey: { 
        type: 'string', 
        required: true, 
        label: 'API密钥', 
        description: '请输入您的API密钥，密钥仅存储在本地' 
      }
    };
  }
  
  /**
   * 注册需要在终止时清理的资源
   * @param {Object} resource - 需要清理的资源
   * @param {Function} cleanupFn - 清理函数
   */
  registerResource(resource, cleanupFn) {
    if (resource && typeof cleanupFn === 'function') {
      this.resources.add({ resource, cleanup: cleanupFn });
    }
  }
  
  /**
   * 取消注册资源
   * @param {Object} resource - 要取消注册的资源
   */
  unregisterResource(resource) {
    for (const entry of this.resources) {
      if (entry.resource === resource) {
        this.resources.delete(entry);
        break;
      }
    }
  }
  
  /**
   * 终止提供者，释放资源
   * @returns {Promise<void>}
   */
  async terminate() {
    try {
      // 清理所有注册的资源
      const cleanupPromises = Array.from(this.resources).map(({ resource, cleanup }) => {
        try {
          return Promise.resolve(cleanup(resource));
        } catch (error) {
          console.error(`清理${this.name}资源失败:`, error);
          return Promise.resolve();
        }
      });
      
      await Promise.all(cleanupPromises);
      
      // 清空资源集合
      this.resources.clear();
      this.isInitialized = false;
      
      console.log(`${this.name}提供者已终止，资源已释放`);
      return true;
    } catch (error) {
      console.error(`终止${this.name}提供者失败:`, error);
      return false;
    }
  }
  
  /**
   * 标准化错误，确保一致的错误格式
   * @param {Error} error - 原始错误
   * @param {string} operation - 产生错误的操作
   * @returns {Error} - 标准化的错误
   */
  normalizeError(error, operation = 'unknown') {
    // 如果错误已经是标准格式，直接返回
    if (error.providerName && error.operation) {
      return error;
    }
    
    // 创建标准化错误
    const normalizedError = new Error(error.message || `${this.name}操作失败`);
    normalizedError.originalError = error;
    normalizedError.providerName = this.name;
    normalizedError.operation = operation;
    normalizedError.timestamp = Date.now();
    
    // 复制原始错误的其他属性
    if (error.statusCode) normalizedError.statusCode = error.statusCode;
    if (error.response) normalizedError.response = error.response;
    if (error.request) normalizedError.request = error.request;
    
    return normalizedError;
  }
} 