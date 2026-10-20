/**
 * Vision Providers Index
 *
 * Exports all Vision LLM providers and utilities for manga translation.
 */

// Base types and utilities.
//
// Only the members the rest of the codebase actually imports from this
// barrel are re-exported. The providers themselves import the prompt
// builders straight from `./base`, so re-exporting them here would be a
// second, unused path to the same symbols.
export {
  type TextArea,
  type ProviderType,
  providerRequiresApiKey,
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
