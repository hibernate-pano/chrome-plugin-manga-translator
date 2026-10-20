import type { ProviderType } from '@/providers/base';
import { readProviderType } from '@/shared/content-config';

/**
 * The provider a translation will actually use, with its settings.
 *
 * The values come from the worker's authoritative configuration, never from
 * a message. This is the single place where the API key is read out of the
 * stored config, and it only ever runs inside the service worker.
 */
export interface ActiveProviderConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolve the active provider from a normalised configuration record.
 *
 * A request can name a provider, a base URL and a model, but none of them
 * are allowed to influence the call: the user's own configuration decides
 * which endpoint the key is sent to.
 */
export function resolveActiveProvider(
  config: Record<string, unknown>
): ActiveProviderConfig {
  const provider = readProviderType(config['provider']);
  const providers = isRecord(config['providers']) ? config['providers'] : {};
  const settings = isRecord(providers[provider]) ? providers[provider] : {};

  return {
    provider,
    apiKey: readString(settings['apiKey']),
    baseUrl: readString(settings['baseUrl']),
    model: readString(settings['model']),
  };
}
