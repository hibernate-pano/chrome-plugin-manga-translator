/**
 * OpenAI GPT-4V Vision Provider
 *
 * Uses OpenAI-compatible Vision API for manga image analysis and translation.
 */

import { OpenAICompatibleProvider } from './openai-compatible-base';
import { DEFAULT_MODELS, API_URLS } from './constants';

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly name = 'OpenAI-Compatible';
  readonly type = 'openai-compatible' as const;

  protected getDefaultModel(): string {
    return DEFAULT_MODELS.OPENAI;
  }

  protected getDefaultBaseUrl(): string {
    return API_URLS.OPENAI;
  }

  protected requiresAuth(): boolean {
    return true;
  }
}
