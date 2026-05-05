/**
 * NVIDIA NIM Vision Provider
 *
 * Uses NVIDIA's OpenAI-compatible API for manga image analysis and translation.
 * Default model: nvidia/llama-3.1-nemotron-nano-vl-8b-v1
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

export class NVIDIAProvider implements VisionProvider {
  readonly name = 'NVIDIA NIM';
  readonly type = 'nvidia' as const;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model || DEFAULT_MODELS.NVIDIA,
      baseUrl: config.baseUrl || API_URLS.NVIDIA,
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

    const data = httpResponse.data;
    if (!data) {
      throw new Error('NVIDIA API returned no data');
    }

    if (data.error) {
      throw new Error(`NVIDIA API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('NVIDIA API returned empty response');
    }

    return parseVisionResponse(content);
  }

  async validateConfig(): Promise<ValidationResult> {
    if (!this.config.apiKey) {
      return {
        valid: false,
        message: '请配置 NVIDIA API 密钥',
      };
    }

    if (this.config.apiKey.length < 10) {
      return {
        valid: false,
        message: 'NVIDIA API 密钥格式无效',
      };
    }

    return {
      valid: true,
      message: 'NVIDIA 配置有效',
    };
  }
}
