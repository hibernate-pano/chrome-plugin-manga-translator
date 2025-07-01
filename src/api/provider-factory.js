/**
 * AI服务提供者工厂
 * 用于创建不同类型的API提供者实例
 */
export class ProviderFactory {
  // 保存已注册的提供者类
  static providers = {};

  /**
   * 注册提供者类
   * @param {string} type - 提供者类型标识
   * @param {Class} providerClass - 提供者类
   */
  static registerProvider(type, providerClass) {
    this.providers[type] = providerClass;
  }

  /**
   * 创建AI提供者实例
   * @param {string} providerType - 提供者类型
   * @param {Object} config - 配置对象
   * @returns {AIProvider} - AI提供者实例
   */
  static createProvider(providerType, config) {
    const ProviderClass = this.providers[providerType];
    
    if (!ProviderClass) {
      throw new Error(`Unsupported provider type: ${providerType}`);
    }
    
    return new ProviderClass(config);
  }

  /**
   * 获取所有支持的提供者类型
   * @returns {Array<Object>} - 提供者类型数组
   */
  static getSupportedProviders() {
    const result = [];
    
    for (const [type, ProviderClass] of Object.entries(this.providers)) {
      // 创建临时实例以获取名称和支持的功能
      const tempInstance = new ProviderClass();
      
      result.push({
        id: type,
        name: tempInstance.name,
        features: Object.entries(tempInstance.supportedFeatures)
          .filter(([_, supported]) => supported)
          .map(([feature]) => feature)
      });
    }
    
    return result;
  }
} 