/**
 * Type-safe access to the build-time provider *endpoints*.
 *
 * Values are populated at build time by scripts/inject-env-config.mjs, which
 * reads .env (project root or parent directory) and writes the resulting
 * values into env-config.generated.ts. That file is gitignored so the values
 * never enter the repo.
 *
 * There is no API key in this file, and that is the point: the content
 * script imports this module, and a content script is injected into every
 * page the user visits. The endpoint and the model name are not credentials
 * — the redacted snapshot the content script receives deliberately keeps
 * them, because the translation cache key is built from them — so they can
 * live here. The keys live in `env-credentials.ts`, which nothing the
 * content script imports may reach.
 *
 * The build pipeline always runs inject-env-config.mjs before tsc/vitest
 * (see package.json scripts), so env-config.generated.ts always exists at
 * compile time. Do not import env-config.generated.ts anywhere else.
 */

export interface ProviderEndpoint {
  /** Where the provider is called. Not a credential. */
  baseUrl: string;
  /** The model name. */
  model: string;
}

export interface EnvConfig {
  /** Primary provider. MiniMax M3 by default in the user's setup. */
  minimax: ProviderEndpoint;
  /** Backup provider. OpenCodeGo-routed DeepSeek in the user's setup. */
  opencode: ProviderEndpoint;
  /**
   * Local Ollama daemon. host + model only; the native API is keyless, and
   * its `/v1` OpenAI-compat shim is also unauthenticated by default.
   */
  ollama: ProviderEndpoint;
}

import { ENV_CONFIG as GENERATED } from './env-config.generated';

export const ENV_CONFIG: EnvConfig = GENERATED;
