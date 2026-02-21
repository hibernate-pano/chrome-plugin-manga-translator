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
import { ClaudeProvider } from './claude';
import { DeepSeekProvider } from './deepseek';
import { OllamaProvider } from './ollama';
import { SiliconFlowProvider } from './siliconflow';
import { DashScopeProvider } from './dashscope';

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
    case 'openai':
      provider = new OpenAIProvider();
      break;
    case 'claude':
      provider = new ClaudeProvider();
      break;
    case 'deepseek':
      provider = new DeepSeekProvider();
      break;
    case 'ollama':
      provider = new OllamaProvider();
      break;
    case 'siliconflow':
      provider = new SiliconFlowProvider();
      break;
    case 'dashscope':
      provider = new DashScopeProvider();
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
export const PROVIDER_INFO: Record<ProviderType, {
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultModel: string;
}> = {
  siliconflow: {
    name: '硅基流动',
    description: '国内首选，支持 Qwen VL 系列，性价比高',
    requiresApiKey: true,
    defaultModel: 'Qwen/Qwen2.5-VL-32B-Instruct',
  },
  dashscope: {
    name: '阿里云百炼',
    description: '阿里云官方，支持通义千问 VL 系列',
    requiresApiKey: true,
    defaultModel: 'qwen-vl-max',
  },
  openai: {
    name: 'OpenAI GPT-4V',
    description: '高质量云端服务，需要 API 密钥',
    requiresApiKey: true,
    defaultModel: 'gpt-4o',
  },
  claude: {
    name: 'Claude Vision',
    description: '高质量云端服务，需要 API 密钥',
    requiresApiKey: true,
    defaultModel: 'claude-sonnet-4-20250514',
  },
  deepseek: {
    name: 'DeepSeek VL',
    description: '性价比高的云端服务，需要 API 密钥',
    requiresApiKey: true,
    defaultModel: 'deepseek-chat',
  },
  ollama: {
    name: 'Ollama',
    description: '本地部署，隐私友好，免费使用',
    requiresApiKey: false,
    defaultModel: 'llava',
  },
};
