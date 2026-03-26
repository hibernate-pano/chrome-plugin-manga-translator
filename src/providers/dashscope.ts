/**
 * DashScope (阿里云百炼) Vision Provider
 *
 * Uses DashScope's OpenAI-compatible API for manga image analysis and translation.
 * Default model: qwen-vl-max
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
import type { TranslationStylePreset } from '@/utils/translation-style';

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

export class DashScopeProvider implements VisionProvider {
  readonly name = '阿里云百炼';
  readonly type = 'dashscope' as const;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model || DEFAULT_MODELS.DASHSCOPE,
      baseUrl: config.baseUrl || API_URLS.DASHSCOPE,
    };
  }

  async analyzeAndTranslate(
    imageBase64: string,
    targetLanguage: string,
    translationStylePreset?: TranslationStylePreset
  ): Promise<VisionResponse> {
    this.ensureConfigured();

    const prompt = getMangaTranslationPrompt(
      targetLanguage,
      translationStylePreset
    );
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

    const data = httpResponse.data;
    if (!data) {
      throw new Error('DashScope API returned empty payload');
    }

    if (data.error) {
      throw new Error(`DashScope API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('DashScope API returned empty response');
    }

    return parseVisionResponse(content);
  }

  async validateConfig(): Promise<ValidationResult> {
    if (!this.config.apiKey) {
      return {
        valid: false,
        message: '请配置阿里云百炼 API 密钥',
      };
    }

    if (this.config.apiKey.length < 10) {
      return {
        valid: false,
        message: '阿里云百炼 API 密钥格式无效',
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
        message: '阿里云百炼配置有效，连接成功',
      };
    } catch {
      return {
        valid: false,
        message: '无法连接到阿里云百炼服务',
      };
    }
  }

  private ensureConfigured(): void {
    if (!this.config.apiKey) {
      throw new Error('请配置阿里云百炼 API 密钥');
    }
    if (this.config.apiKey.length < 10) {
      throw new Error('阿里云百炼 API 密钥格式无效');
    }
  }
}
