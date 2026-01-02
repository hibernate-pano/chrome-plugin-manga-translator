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
  getMangaTranslationPrompt,
  parseVisionResponse,
} from './base';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

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
    
    // Extract base64 data and media type
    let base64Data = imageBase64;
    let mediaType = 'image/jpeg';
    
    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match && match[1] && match[2]) {
        mediaType = match[1];
        base64Data = match[2];
      }
    }

    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data,
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
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as ClaudeResponse).error?.message || response.statusText;
      throw new Error(`Claude API error: ${errorMessage}`);
    }

    const data = await response.json() as ClaudeResponse;
    
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
