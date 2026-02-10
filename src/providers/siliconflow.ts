/**
 * SiliconFlow Vision Provider
 *
 * Uses SiliconFlow's OpenAI-compatible API for manga image analysis and translation.
 * Default model: Qwen/Qwen2.5-VL-32B-Instruct
 */

import {
  VisionProvider,
  ProviderConfig,
  VisionResponse,
  ValidationResult,
  parseImageData,
  createApiError,
  getMangaTranslationPrompt,
  parseVisionResponse,
} from './base';
import { DEFAULT_MODELS, API_URLS, REQUEST_LIMITS } from './constants';
import { httpRequest } from '@/utils/http-client';

interface OpenAICompatibleResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

export class SiliconFlowProvider implements VisionProvider {
  readonly name = '硅基流动';
  readonly type = 'siliconflow' as const;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model || DEFAULT_MODELS.SILICONFLOW,
      baseUrl: config.baseUrl || API_URLS.SILICONFLOW,
    };
  }

  async analyzeAndTranslate(
    imageBase64: string,
    targetLanguage: string
  ): Promise<VisionResponse> {
    const validation = await this.validateConfig();
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const prompt = getMangaTranslationPrompt(targetLanguage);
    const imageData = parseImageData(imageBase64);
    const imageUrl = `data:${imageData.mediaType};base64,${imageData.base64}`;

    const httpResponse = await httpRequest<OpenAICompatibleResponse>(
      `${this.config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: {
          model: this.config.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl, detail: 'high' },
                },
              ],
            },
          ],
          max_tokens: REQUEST_LIMITS.MAX_TOKENS,
          temperature: REQUEST_LIMITS.TEMPERATURE,
        },
      }
    );

    if (!httpResponse.ok) {
      throw createApiError(
        httpResponse.error || httpResponse.statusText,
        this.name
      );
    }

    const data = httpResponse.data!;

    if (data.error) {
      throw new Error(`SiliconFlow API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('SiliconFlow API returned empty response');
    }

    return parseVisionResponse(content);
  }

  async validateConfig(): Promise<ValidationResult> {
    if (!this.config.apiKey) {
      return {
        valid: false,
        message: '请配置硅基流动 API 密钥',
      };
    }

    if (this.config.apiKey.length < 10) {
      return {
        valid: false,
        message: '硅基流动 API 密钥格式无效',
      };
    }

    try {
      const httpResponse = await httpRequest<{ data: unknown[] }>(
        `${this.config.baseUrl}/models`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          timeout: 10000,
        }
      );

      if (!httpResponse.ok) {
        return {
          valid: false,
          message: `API 密钥验证失败: ${httpResponse.error || httpResponse.statusText}`,
        };
      }

      return {
        valid: true,
        message: '硅基流动配置有效，连接成功',
      };
    } catch {
      return {
        valid: false,
        message: '无法连接到硅基流动服务',
      };
    }
  }
}
