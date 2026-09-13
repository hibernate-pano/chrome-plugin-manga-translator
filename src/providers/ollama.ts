/**
 * Ollama Vision Provider
 *
 * Uses locally deployed Ollama service for manga image analysis and translation.
 * Supports vision models like llava, bakllava, etc.
 *
 * Benefits:
 * - Privacy-friendly: data stays local
 * - No API costs
 * - Works offline once model is downloaded
 */

import {
  VisionProvider,
  ProviderConfig,
  VisionResponse,
  ValidationResult,
  getMangaTranslationPrompt,
  parseVisionResponse,
  TranslationStylePreset,
} from './base';

const DEFAULT_MODEL = 'llava';
const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  images?: string[];
  stream?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
  error?: string;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
  }>;
}

export class OllamaProvider implements VisionProvider {
  readonly name = 'Ollama';
  readonly type = 'ollama' as const;

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
    translationStylePreset?: TranslationStylePreset,
    isHybridRegions?: boolean
  ): Promise<VisionResponse> {
    const validation = await this.validateConfig();
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    const prompt = getMangaTranslationPrompt(
      targetLanguage,
      translationStylePreset,
      isHybridRegions
    );

    // Extract pure base64 data (remove data URL prefix if present)
    let base64Data = imageBase64;
    if (imageBase64.startsWith('data:')) {
      const match = imageBase64.match(/^data:[^;]+;base64,(.+)$/);
      if (match && match[1]) {
        base64Data = match[1];
      }
    }

    const modelName = this.config.model ?? DEFAULT_MODEL;
    const requestBody: OllamaGenerateRequest = {
      model: modelName,
      prompt,
      images: [base64Data],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 4096,
      },
    };

    const response = await fetch(`${this.config.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(
          'Ollama rejected the extension origin. Set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.'
        );
      }
      if (response.status === 404) {
        throw new Error(
          `模型 ${this.config.model} 未安装，请先运行: ollama pull ${this.config.model}`
        );
      }
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Ollama API error: ${errorText}`);
    }

    const data = (await response.json()) as OllamaGenerateResponse;

    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    if (!data.response) {
      throw new Error('Ollama returned empty response');
    }

    return parseVisionResponse(data.response);
  }

  async validateConfig(): Promise<ValidationResult> {
    // Check if Ollama service is running
    const healthCheck = await this.checkHealth();
    if (!healthCheck.healthy) {
      return {
        valid: false,
        message: healthCheck.message,
      };
    }

    // Check if the model is available
    const modelCheck = await this.checkModel();
    if (!modelCheck.available) {
      return {
        valid: false,
        message: modelCheck.message,
      };
    }

    return {
      valid: true,
      message: `Ollama 服务正常，使用模型: ${this.config.model}`,
    };
  }

  /**
   * Check if Ollama service is running and accessible
   */
  async checkHealth(): Promise<{ healthy: boolean; message: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return {
          healthy: true,
          message: 'Ollama 服务运行正常',
        };
      }

      // v1.1.1: 403 from Ollama almost always means the browser extension
      // origin isn't in OLLAMA_ORIGINS. Surface that explicitly so
      // error-handler maps to OLLAMA_ORIGIN_NOT_ALLOWED (with the
      // "复制启动命令" action) instead of generic OLLAMA_NOT_RUNNING.
      if (response.status === 403) {
        return {
          healthy: false,
          message:
            'Ollama 拒绝了当前扩展的访问 (403 Forbidden)，请设置 OLLAMA_ORIGINS 后重启 Ollama 服务',
        };
      }

      return {
        healthy: false,
        message: `Ollama 服务响应异常: ${response.status}`,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          return {
            healthy: false,
            message: 'Ollama 服务连接超时，请检查服务是否启动',
          };
        }
        // CORS-rejected fetch lands here too with a generic "Failed to
        // fetch" message. If the URL is the configured ollama host,
        // it's almost always an origin-not-allowed problem rather than
        // a connection-refused one (the latter would surface as
        // net::ERR_CONNECTION_REFUSED with no "fetch" message body).
        if (error.message.includes('fetch')) {
          const baseUrl = this.config.baseUrl ?? '';
          const isOllamaHost =
            baseUrl.includes('11434') || baseUrl.includes('ollama');
          if (isOllamaHost) {
            return {
              healthy: false,
              message:
                'Ollama 拒绝了当前扩展的访问 (CORS / OLLAMA_ORIGINS 未放行)',
            };
          }
          return {
            healthy: false,
            message: '无法连接到 Ollama 服务，请先启动 Ollama',
          };
        }
      }
      return {
        healthy: false,
        message: '请先启动 Ollama 服务',
      };
    }
  }

  /**
   * Check if the configured model is available
   */
  async checkModel(): Promise<{ available: boolean; message: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`);

      if (!response.ok) {
        return {
          available: false,
          message: '无法获取模型列表',
        };
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const models = data.models || [];

      // Check if the model exists (handle both 'llava' and 'llava:latest' formats)
      const configModelName = this.config.model ?? DEFAULT_MODEL;
      const modelExists = models.some(
        m =>
          m.name === configModelName ||
          m.name === `${configModelName}:latest` ||
          m.name.startsWith(`${configModelName}:`)
      );

      if (!modelExists) {
        const availableVisionModels = models
          .filter(m => this.isVisionModel(m.name))
          .map(m => m.name)
          .slice(0, 5);

        let suggestion = `模型 ${configModelName} 未安装，请运行: ollama pull ${configModelName}`;
        if (availableVisionModels.length > 0) {
          suggestion += `\n可用的视觉模型: ${availableVisionModels.join(', ')}`;
        }

        return {
          available: false,
          message: suggestion,
        };
      }

      return {
        available: true,
        message: `模型 ${configModelName} 可用`,
      };
    } catch {
      return {
        available: false,
        message: '无法检查模型状态',
      };
    }
  }

  /**
   * Check if a model name indicates a vision-capable model
   */
  private isVisionModel(modelName: string): boolean {
    const visionModels = ['llava', 'bakllava', 'llava-llama3', 'moondream'];
    return visionModels.some(vm => modelName.toLowerCase().includes(vm));
  }

  /**
   * Get list of available vision models
   */
  async getAvailableVisionModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = (await response.json()) as OllamaTagsResponse;
      return (data.models || [])
        .filter(m => this.isVisionModel(m.name))
        .map(m => m.name);
    } catch {
      return [];
    }
  }
}
