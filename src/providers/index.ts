/**
 * Vision Providers Index
 *
 * Exports all Vision LLM providers and utilities for manga translation.
 */

// Base types and utilities
export {
  type VisionProvider,
  type ProviderConfig,
  type VisionResponse,
  type ValidationResult,
  type TextArea,
  type ProviderType,
  getMangaTranslationPrompt,
  parseVisionResponse,
} from './base';

// Provider implementations (static imports for Chrome extension compatibility)
import { VisionProvider, ProviderType, ProviderConfig } from './base';
import { OpenAIProvider } from './openai';
import { OllamaProvider } from './ollama';

/**
 * Create a Vision Provider instance by type
 *
 * @param type Provider type identifier
 * @param config Provider configuration
 * @returns Initialized VisionProvider instance
 */
export async function createProvider(
  type: ProviderType,
  config: ProviderConfig
): Promise<VisionProvider> {
  let provider: VisionProvider;

  switch (type) {
    case 'openai-compatible':
      provider = new OpenAIProvider();
      break;
    case 'ollama':
      provider = new OllamaProvider();
      break;
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }

  await provider.initialize(config);
  return provider;
}

/**
 * Get display information for all available providers
 */
export const PROVIDER_INFO: Record<
  ProviderType,
  {
    name: string;
    description: string;
    requiresApiKey: boolean;
    defaultModel: string;
  }
> = {
  'openai-compatible': {
    name: 'OpenAI-Compatible',
    description: '兼容 OpenAI Chat Completions 的视觉模型服务',
    requiresApiKey: true,
    defaultModel: 'gpt-4o',
  },
  ollama: {
    name: 'Ollama',
    description: '本地部署，隐私友好，免费使用',
    requiresApiKey: false,
    defaultModel: 'llava',
  },
};
