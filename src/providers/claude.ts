/**
 * Claude Vision Provider
 *
 * Uses Anthropic's Claude Vision API for manga image analysis and translation.
 * Claude offers high-quality vision understanding with strong reasoning capabilities.
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
import { DEFAULT_MODELS, API_URLS, API_VERSIONS } from './constants';

interface ClaudeContentPart {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeContentPart[];
}

interface ClaudeResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  error?: {
    type: string;
    message: string;
  };
}

export class ClaudeProvider implements VisionProvider {
  readonly name = 'Claude Vision';
  readonly type = 'claude' as const;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model || DEFAULT_MODELS.CLAUDE,
      baseUrl: config.baseUrl || API_URLS.CLAUDE,
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

    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageData.mediaType,
              data: imageData.base64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ];

    const apiKey = this.config.apiKey ?? '';
    const response = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSIONS.CLAUDE,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as ClaudeResponse).error?.message || response.statusText;
      throw new Error(`Claude API error: ${errorMessage}`);
    }

    const data = (await response.json()) as ClaudeResponse;

    if (data.error) {
      throw new Error(`Claude API error: ${data.error.message}`);
    }

    const textContent = data.content?.find(c => c.type === 'text');
    if (!textContent?.text) {
      throw new Error('Claude API returned empty response');
    }

    return parseVisionResponse(textContent.text);
  }

  async validateConfig(): Promise<ValidationResult> {
    if (!this.config.apiKey) {
      return {
        valid: false,
        message: '请配置 Claude API 密钥',
      };
    }

    // Claude API keys typically start with 'sk-ant-'
    if (this.config.apiKey.length < 20) {
      return {
        valid: false,
        message: 'Claude API 密钥格式无效',
      };
    }

    return {
      valid: true,
      message: 'Claude 配置有效',
    };
  }
}
