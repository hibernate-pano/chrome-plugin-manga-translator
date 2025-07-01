/**
 * OCR服务提供者抽象基类
 * 所有具体的OCR提供者实现都应继承此类
 */
export class BaseOCRProvider {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   */
  constructor(config = {}) {
    this.config = config;
    this.name = 'BaseOCRProvider';
    this.initialized = false;
    this.resources = new Set(); // 跟踪需要清理的资源
  }

  /**
   * 初始化提供者
   * @returns {Promise<boolean>} - 初始化是否成功
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }
    
    try {
      // 子类应该覆盖此方法实现具体初始化逻辑
      this.initialized = true;
      return true;
    } catch (error) {
      console.error(`初始化${this.name}失败:`, error);
      throw error;
    }
  }

  /**
   * 检测图像中的文字区域
   * @param {string} imageData - Base64编码的图像数据或Blob/File对象
   * @param {Object} options - 检测选项
   * @returns {Promise<Array>} - 文字区域数组，每个区域包含坐标和文字内容
   */
  async detectText(imageData, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      // 子类应该覆盖此方法实现具体OCR逻辑
      throw new Error('Method not implemented');
    } catch (error) {
      console.error(`${this.name}文字检测失败:`, error);
      throw this.normalizeError(error, 'detectText');
    }
  }

  /**
   * 预处理图像以提高OCR准确率
   * @param {string|Blob} imageData - 图像数据
   * @param {Object} options - 预处理选项
   * @returns {Promise<string|Blob>} - 预处理后的图像数据
   */
  async preprocessImage(imageData, options = {}) {
    try {
      // 默认实现：不做任何处理，直接返回原始图像
      return imageData;
    } catch (error) {
      console.error(`${this.name}图像预处理失败:`, error);
      // 预处理失败时，返回原始图像
      return imageData;
    }
  }

  /**
   * 获取提供者配置模式
   * @returns {Object} - 配置字段定义
   */
  getConfigSchema() {
    // 返回基础配置字段
    return {
      language: { 
        type: 'string', 
        required: true, 
        label: '识别语言',
        description: '指定OCR识别的目标语言'
      },
      preprocess: { 
        type: 'boolean', 
        required: false, 
        label: '启用图像预处理',
        description: '预处理图像以提高OCR准确率'
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
   * 释放资源
   * @returns {Promise<boolean>} - 是否成功释放资源
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
      this.initialized = false;
      
      console.log(`${this.name}提供者已终止，资源已释放`);
      return true;
    } catch (error) {
      console.error(`终止${this.name}提供者失败:`, error);
      return false;
    }
  }

  /**
   * 获取支持的语言列表
   * @returns {Promise<Array<Object>>} - 语言对象数组，包含code和name字段
   */
  async getSupportedLanguages() {
    return [
      { code: 'jpn', name: '日语' },
      { code: 'eng', name: '英语' },
      { code: 'chi_sim', name: '简体中文' },
      { code: 'chi_tra', name: '繁体中文' },
      { code: 'kor', name: '韩语' }
    ];
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
    
    return normalizedError;
  }
} 