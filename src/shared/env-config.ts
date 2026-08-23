/**
 * Type-safe access to environment-injected provider credentials.
 *
 * Values are populated at build time by scripts/inject-env-config.mjs,
 * which reads .env (project root or parent directory) and writes the
 * resulting values into env-config.generated.ts. That file is gitignored
 * so the keys never enter the repo.
 *
 * The build pipeline always runs inject-env-config.mjs before tsc/vitest
 * (see package.json scripts), so env-config.generated.ts always exists at
 * compile time. Do not import env-config.generated.ts anywhere else.
 */

export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface EnvConfig {
  /** Primary provider. MiniMax M3 by default in the user's setup. */
  minimax: ProviderCredentials;
  /** Backup provider. OpenCode-routed DeepSeek in the user's setup. */
  opencode: ProviderCredentials;
}

import { ENV_CONFIG as GENERATED } from './env-config.generated';

export const ENV_CONFIG: EnvConfig = GENERATED;

export function hasMinimaxCredentials(): boolean {
  return Boolean(
    ENV_CONFIG.minimax.apiKey &&
      ENV_CONFIG.minimax.baseUrl &&
      ENV_CONFIG.minimax.model
  );
}

export function hasOpencodeCredentials(): boolean {
  return Boolean(
    ENV_CONFIG.opencode.apiKey &&
      ENV_CONFIG.opencode.baseUrl &&
      ENV_CONFIG.opencode.model
  );
}
