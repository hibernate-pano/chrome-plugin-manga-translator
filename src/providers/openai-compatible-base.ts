/**
 * OpenAI-Compatible Provider Base
 *
 * 所有兼容 OpenAI Chat Completions API 的 provider 共享基类。
 * 子类只需提供 name/type/defaults 和是否强制要求 auth。
 */

import {
  VisionProvider,
  VisionResponse,
  ValidationResult,
  parseImageData,
  createApiError,
  getMangaTranslationPrompt,
  parseVisionResponse,
  BaseVisionProvider,
} from './base';
import { REQUEST_LIMITS } from './constants';
import { httpRequest } from '@/utils/http-client';
import type { TranslationStylePreset } from '@/utils/translation-style';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface ChatResponse {
  choices: Array<{
    message: { content: string };
  }>;
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

export abstract class OpenAICompatibleProvider
  extends BaseVisionProvider
  implements VisionProvider
{
  override async analyzeAndTranslate(
    imageBase64: string,
    targetLanguage: string,
    translationStylePreset?: TranslationStylePreset
  ): Promise<VisionResponse> {
    this.ensureConfigured();

    const prompt = getMangaTranslationPrompt(targetLanguage, translationStylePreset);
    const imageData = parseImageData(imageBase64);
    const imageUrl = `data:${imageData.mediaType};base64,${imageData.base64}`;

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
        ],
      },
    ];

    const headers: Record<string, string> = {};
    const apiKey = this.config.apiKey;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (this.requiresAuth()) {
      throw new Error(`请配置 ${this.name} API 密钥`);
    }

    const httpResponse = await httpRequest<ChatResponse>(
      `${this.config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers,
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

    const data = httpResponse.data;
    if (!data) {
      throw new Error(`${this.name} API returned no data`);
    }

    if (data.error) {
      throw new Error(`${this.name} API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${this.name} API returned empty response`);
    }

    return parseVisionResponse(content);
  }

  override async validateConfig(): Promise<ValidationResult> {
    if (this.requiresAuth()) {
      if (!this.config.apiKey) {
        return { valid: false, message: `请配置 ${this.name} API 密钥` };
      }
      if (this.config.apiKey.length < 20) {
        return { valid: false, message: `${this.name} API 密钥格式无效` };
      }
    }
    return { valid: true, message: `${this.name} 配置有效` };
  }

  protected ensureConfigured(): void {
    if (this.requiresAuth()) {
      if (!this.config.apiKey) {
        throw new Error(`请配置 ${this.name} API 密钥`);
      }
      if (this.config.apiKey.length < 20) {
        throw new Error(`${this.name} API 密钥格式无效`);
      }
    }
  }

  /** 子类覆写：是否强制要求 apiKey（云端 API=true，本地服务=false） */
  protected abstract requiresAuth(): boolean;
}
