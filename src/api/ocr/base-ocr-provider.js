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
  }

  /**
   * 初始化提供者
   * @returns {Promise<boolean>} - 初始化是否成功
   */
  async initialize() {
    throw new Error('Method not implemented');
  }

  /**
   * 检测图像中的文字区域
   * @param {string} imageData - Base64编码的图像数据或Blob/File对象
   * @param {Object} options - 检测选项
   * @returns {Promise<Array>} - 文字区域数组，每个区域包含坐标和文字内容
   */
  async detectText(imageData, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * 预处理图像以提高OCR准确率
   * @param {string|Blob} imageData - 图像数据
   * @param {Object} options - 预处理选项
   * @returns {Promise<string|Blob>} - 预处理后的图像数据
   */
  async preprocessImage(imageData, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * 获取提供者配置模式
   * @returns {Object} - 配置字段定义
   */
  getConfigSchema() {
    // 返回基础配置字段
    return {
      language: { type: 'string', required: true, label: '识别语言' },
      preprocess: { type: 'boolean', required: false, label: '启用图像预处理' }
    };
  }

  /**
   * 释放资源
   * @returns {Promise<void>}
   */
  async terminate() {
    throw new Error('Method not implemented');
  }

  /**
   * 获取支持的语言列表
   * @returns {Promise<Array<Object>>} - 语言对象数组，包含code和name字段
   */
  async getSupportedLanguages() {
    throw new Error('Method not implemented');
  }
} 