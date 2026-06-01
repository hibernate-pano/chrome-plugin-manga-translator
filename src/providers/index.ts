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
import { LMStudioProvider } from './lm-studio';

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
    case 'lm-studio':
      provider = new LMStudioProvider();
      break;
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }

  await provider.initialize(config);
  return provider;
}

/**
 * Get display information for all available providers.
 *
 * NOTE: this was previously a single source of truth for provider display
 * metadata, but the Options UI and Popup UI ship their own per-provider
 * display arrays. Until the UI is refactored to consume this, callers
 * should hard-code the metadata where it is rendered. The block is kept
 * here as documentation of supported providers and their default model
 * names — do not import it; it is not part of the public API.
 */
export type ProviderDisplayInfo = {
  name: string;
  description: string;
  requiresApiKey: boolean;
  defaultModel: string;
};

// Unused at the moment but kept as type-only documentation.
export type _ProviderInfoMap = Record<ProviderType, ProviderDisplayInfo>;
