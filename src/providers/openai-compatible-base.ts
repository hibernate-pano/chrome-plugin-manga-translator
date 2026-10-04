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

const MINIMAX_M3_MODEL_PATTERN = /^minimax-m3(?:$|[-.:/])/i;

export function isMiniMaxM3Model(model: string | undefined): boolean {
  return Boolean(model && MINIMAX_M3_MODEL_PATTERN.test(model.trim()));
}

export abstract class OpenAICompatibleProvider
  extends BaseVisionProvider
  implements VisionProvider
{
  override async analyzeAndTranslate(
    imageBase64: string,
    targetLanguage: string,
    translationStylePreset?: TranslationStylePreset,
    isHybridRegions?: boolean
  ): Promise<VisionResponse> {
    this.ensureConfigured();

    const prompt = getMangaTranslationPrompt(
      targetLanguage,
      translationStylePreset,
      isHybridRegions
    );
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

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: REQUEST_LIMITS.TEMPERATURE,
    };

    if (isMiniMaxM3Model(this.config.model)) {
      // Manga translation is structured extraction, not open-ended reasoning.
      // M3's default thinking mode can spend the whole completion budget on
      // <think> text without returning the required JSON.
      body['max_completion_tokens'] = REQUEST_LIMITS.MAX_TOKENS;
      body['reasoning_split'] = true;
      body['thinking'] = { type: 'disabled' };
    } else {
      body['max_tokens'] = REQUEST_LIMITS.MAX_TOKENS;
    }

    const httpResponse = await httpRequest<ChatResponse>(
      `${this.config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers,
        body,
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

  /**
   * Probe the endpoint for real.
   *
   * `validateConfig` can only inspect strings, so the Settings "test
   * connection" button used to report success for a wrong base URL, a revoked
   * key, or a model that does not exist. That is worse than no button: it
   * sends the user looking for the fault somewhere else.
   *
   * This asks the OpenAI-compatible `/models` endpoint, which every
   * implementation of this API is expected to expose. Only call it from an
   * extension page: a content script's request would be blocked by the page's
   * CORS rules.
   */
  async testConnection(): Promise<ValidationResult> {
    const local = await this.validateConfig();
    if (!local.valid) {
      return local;
    }

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await httpRequest<unknown>(
      `${this.config.baseUrl}/models`,
      { method: 'GET', headers, timeout: 10_000 }
    );

    if (response.ok) {
      return { valid: true, message: `已连接 ${this.name}` };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: `${this.name} 拒绝了该 API 密钥（${response.status}）`,
      };
    }

    // Some gateways implement chat completions but not `/models`. A 404 there
    // says nothing about whether translation works, so fall back to a minimal
    // completion before reporting a problem — a false "wrong base URL" would
    // send the user chasing a working endpoint.
    if (response.status === 404 || response.status === 405) {
      return this.probeChatCompletion(headers);
    }

    if (response.status === 408 || response.status === 0) {
      return {
        valid: false,
        message: `无法连接 ${this.config.baseUrl}：${response.error ?? '网络错误'}`,
      };
    }
    return {
      valid: false,
      message: `${this.name} 返回 ${response.status}: ${
        response.error ?? response.statusText
      }`,
    };
  }

  /**
   * Last-resort probe: the smallest possible chat completion.
   *
   * Costs one request with a one-token reply. Used only when the endpoint does
   * not expose `/models`.
   */
  private async probeChatCompletion(
    headers: Record<string, string>
  ): Promise<ValidationResult> {
    const response = await httpRequest<{
      error?: { message?: string };
    }>(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      timeout: 20_000,
      body: {
        model: this.config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: `已连接 ${this.name}（模型 ${this.config.model} 可用）`,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: `${this.name} 拒绝了该 API 密钥（${response.status}）`,
      };
    }
    if (response.status === 404) {
      return {
        valid: false,
        message: `${this.name} 未找到 Base URL：${this.config.baseUrl}（404）`,
      };
    }
    if (response.status === 408 || response.status === 0) {
      return {
        valid: false,
        message: `无法连接 ${this.config.baseUrl}：${response.error ?? '网络错误'}`,
      };
    }

    // A 400 here usually means the model name is wrong, which is exactly the
    // kind of mistake this button should surface.
    const detail = response.data?.error?.message ?? response.error;
    return {
      valid: false,
      message: `${this.name} 返回 ${response.status}${
        detail ? `：${detail}` : ''
      }`,
    };
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
