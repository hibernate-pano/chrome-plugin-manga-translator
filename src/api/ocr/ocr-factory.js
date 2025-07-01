/**
 * OCR服务提供者工厂
 * 用于创建不同类型的OCR提供者实例
 */
export class OCRFactory {
  // 保存已注册的OCR提供者类
  static providers = {};

  /**
   * 注册OCR提供者类
   * @param {string} type - 提供者类型标识
   * @param {Class} providerClass - 提供者类
   */
  static registerProvider(type, providerClass) {
    this.providers[type] = providerClass;
  }

  /**
   * 创建OCR提供者实例
   * @param {string} type - 提供者类型
   * @param {Object} config - 配置对象
   * @returns {BaseOCRProvider} - OCR提供者实例
   */
  static createProvider(type, config) {
    const ProviderClass = this.providers[type];
    
    if (!ProviderClass) {
      throw new Error(`不支持的OCR提供者类型: ${type}`);
    }
    
    return new ProviderClass(config);
  }

  /**
   * 获取所有注册的提供者类型
   * @returns {Array<string>} - 提供者类型数组
   */
  static getRegisteredProviders() {
    return Object.keys(this.providers);
  }

  /**
   * 获取指定类型的提供者类
   * @param {string} type - 提供者类型
   * @returns {Class} - 提供者类
   */
  static getProviderClass(type) {
    const ProviderClass = this.providers[type];
    
    if (!ProviderClass) {
      throw new Error(`不支持的OCR提供者类型: ${type}`);
    }
    
    return ProviderClass;
  }

  /**
   * 获取所有支持的OCR提供者信息
   * @returns {Array<Object>} - 提供者信息数组
   */
  static getSupportedProviders() {
    const result = [];
    
    for (const [type, ProviderClass] of Object.entries(this.providers)) {
      // 创建临时实例以获取名称
      const tempInstance = new ProviderClass();
      
      result.push({
        id: type,
        name: tempInstance.name,
        configSchema: tempInstance.getConfigSchema()
      });
    }
    
    return result;
  }
} 