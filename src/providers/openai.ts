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
  getMangaTranslationPrompt,
  parseVisionResponse,
} from './base';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

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
      model: config.model || DEFAULT_MODEL,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
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
    
    // Ensure proper base64 data URL format
    const imageUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const messages: OpenAIMessage[] = [
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
              detail: 'high',
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
      const errorMessage = (errorData as OpenAIResponse).error?.message || response.statusText;
      throw new Error(`OpenAI API error: ${errorMessage}`);
    }

    const data = await response.json() as OpenAIResponse;
    
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
