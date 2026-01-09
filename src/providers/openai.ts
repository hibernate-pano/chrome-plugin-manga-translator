/**
 * OpenAI GPT-4V Vision Provider
 *
 * Uses OpenAI's GPT-4 Vision API for manga image analysis and translation.
 */

import {
  VisionProvider,
  ProviderConfig,
  VisionResponse,
  ValidationResult,
  ApiResponse,
  parseImageData,
  createApiError,
  getMangaTranslationPrompt,
  parseVisionResponse,
} from './base';
import { DEFAULT_MODELS, API_URLS, REQUEST_LIMITS } from './constants';
import { httpRequest } from '@/utils/http-client';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[];
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface OpenAIResponse {
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

export class OpenAIProvider implements VisionProvider {
  readonly name = 'OpenAI GPT-4V';
  readonly type = 'openai' as const;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model || DEFAULT_MODELS.OPENAI,
      baseUrl: config.baseUrl || API_URLS.OPENAI,
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

    const messages: OpenAIMessage[] = [
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
    ];

    const httpResponse = await httpRequest<OpenAIResponse>(
      `${this.config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: {
          model: this.config.model,
          messages,
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
      throw new Error(`OpenAI API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI API returned empty response');
    }

    return parseVisionResponse(content);
  }

  async validateConfig(): Promise<ValidationResult> {
    if (!this.config.apiKey) {
      return {
        valid: false,
        message: '请配置 OpenAI API 密钥',
      };
    }

    if (this.config.apiKey.length < 20) {
      return {
        valid: false,
        message: 'OpenAI API 密钥格式无效',
      };
    }

    return {
      valid: true,
      message: 'OpenAI 配置有效',
    };
  }
}
