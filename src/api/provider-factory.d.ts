/**
 * 提供者工厂的TypeScript声明文件
 */

import { AIProvider, ProviderConfig } from './base-provider';

export type ProviderType = 'openai' | 'deepseek' | 'claude' | 'anthropic' | 'openrouter';

/**
 * 提供者工厂类
 */
export class ProviderFactory {
  /**
   * 创建提供者实例
   */
  static createProvider(type: ProviderType, config: ProviderConfig): AIProvider;

  /**
   * 获取所有支持的提供者类型
   */
  static getSupportedProviders(): ProviderType[];

  /**
   * 检查提供者类型是否支持
   */
  static isProviderSupported(type: string): type is ProviderType;

  /**
   * 获取提供者的默认配置
   */
  static getDefaultConfig(type: ProviderType): ProviderConfig;

  /**
   * 验证提供者配置
   */
  static validateProviderConfig(type: ProviderType, config: ProviderConfig): {
    isValid: boolean;
    errors: string[];
  };
}
