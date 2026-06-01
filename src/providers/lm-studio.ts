/**
 * LM Studio Vision Provider
 *
 * Uses locally running LM Studio server for manga image analysis and translation.
 * Compatible with OpenAI API format.
 */

import { ValidationResult } from './base';
import { OpenAICompatibleProvider } from './openai-compatible-base';

export class LMStudioProvider extends OpenAICompatibleProvider {
  readonly name = 'LM Studio';
  readonly type = 'lm-studio' as const;

  protected getDefaultModel(): string {
    return '';
  }

  protected getDefaultBaseUrl(): string {
    return 'http://localhost:1234/v1';
  }

  protected requiresAuth(): boolean {
    return false;
  }

  override async validateConfig(): Promise<ValidationResult> {
    const health = await this.checkHealth();
    if (!health.healthy) {
      return { valid: false, message: health.message };
    }

    const models = await this.getAvailableModels();
    const activeModel = this.config.model || (models.length > 0 ? models[0] : '');

    if (activeModel) {
      return {
        valid: true,
        message: `LM Studio 连接正常，使用模型: ${activeModel}`,
      };
    }

    return {
      valid: true,
      message: 'LM Studio 连接正常（使用当前加载的模型）',
    };
  }

  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return { healthy: true, message: 'LM Studio 服务运行正常' };
      }

      return {
        healthy: false,
        message: `LM Studio 服务响应异常: ${response.status}`,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          return {
            healthy: false,
            message: 'LM Studio 服务连接超时，请检查服务是否启动及端口配置',
          };
        }
        if (
          error.message.includes('fetch') ||
          error.message.includes('network')
        ) {
          return {
            healthy: false,
            message:
              '无法连接到 LM Studio 服务，请确保已在 LM Studio 中启动 Local Server，且地址正确',
          };
        }
      }
      return { healthy: false, message: '请先启动 LM Studio 服务' };
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`);
      if (!response.ok) return [];

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return (data.data || []).map(m => m.id);
    } catch {
      return [];
    }
  }
}
