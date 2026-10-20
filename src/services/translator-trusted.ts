/**
 * A translator built from the persisted configuration.
 *
 * Trusted contexts only: an extension page or the service worker. The
 * persisted store holds the API key in plaintext memory, so a content script
 * must never import this module — the content script builds its translator
 * from the redacted snapshot instead (see `@/services/translator`).
 *
 * The split exists so the two are impossible to confuse at the import site:
 * `@/services/translator` has no dependency on `@/stores/config-v2` at all,
 * and this module is the only place that pairs the two.
 */
import { TranslatorService } from './translator';
import { useAppConfigStore } from '@/stores/config-v2';

/**
 * Create a translator service from the persisted app configuration.
 *
 * The API key travels with it, so the result must stay inside the context
 * that created it.
 */
export function createTrustedTranslatorFromConfig(): TranslatorService {
  const config = useAppConfigStore.getState();
  const providerSettings = config.providers[config.provider];

  return new TranslatorService({
    provider: config.provider,
    apiKey: providerSettings.apiKey,
    baseUrl: providerSettings.baseUrl,
    model: providerSettings.model,
    targetLanguage: config.targetLanguage,
    cacheEnabled: config.cacheEnabled,
    translationStylePreset: config.translationStylePreset,
    imageOptions: {
      maxSize: config.maxImageSize,
    },
  });
}
