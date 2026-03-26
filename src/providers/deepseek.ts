/**
 * DeepSeek VL Vision Provider
 * 
 * Uses DeepSeek's Vision Language Model API for manga image analysis and translation.
 * DeepSeek VL offers good quality at a competitive price point.
 */

import {
  VisionProvider,
  ProviderConfig,
  VisionResponse,
  ValidationResult,
  getMangaTranslationPrompt,
  parseVisionResponse,
} from './base';
import type { TranslationStylePreset } from '@/utils/translation-style';

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | DeepSeekContentPart[];
}

interface DeepSeekContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

interface DeepSeekResponse {
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

export class DeepSeekProvider implements VisionProvider {
  readonly name = 'DeepSeek VL';
  readonly type = 'deepseek' as const;
  
  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = {
      ...config,
      model: config.model || DEFAULT_MODEL,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
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
    
    // Ensure proper base64 data URL format
    const imageUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const messages: DeepSeekMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          },
        ],
      },
    ];

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as DeepSeekResponse).error?.message || response.statusText;
      throw new Error(`DeepSeek API error: ${errorMessage}`);
    }

    const data = await response.json() as DeepSeekResponse;
    
    if (data.error) {
      throw new Error(`DeepSeek API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('DeepSeek API returned empty response');
    }

    return parseVisionResponse(content);
  }

  async validateConfig(): Promise<ValidationResult> {
    if (!this.config.apiKey) {
      return {
        valid: false,
        message: '请配置 DeepSeek API 密钥',
      };
    }

    if (this.config.apiKey.length < 10) {
      return {
        valid: false,
        message: 'DeepSeek API 密钥格式无效',
      };
    }

    return {
      valid: true,
      message: 'DeepSeek 配置有效',
    };
  }

  private ensureConfigured(): void {
    if (!this.config.apiKey) {
      throw new Error('请配置 DeepSeek API 密钥');
    }
    if (this.config.apiKey.length < 10) {
      throw new Error('DeepSeek API 密钥格式无效');
    }
  }
}
