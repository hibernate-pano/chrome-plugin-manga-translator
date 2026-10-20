/**
 * The build-time provider *credentials*.
 *
 * These are the API keys a personal build is shipped with. They belong to
 * the service worker and to the extension's own pages (the Settings page
 * offers them as a one-click fill).
 *
 * They must never reach the content script. A content script is injected into
 * every page the user visits, so a key in its bundle is a key in every page.
 * The split between this module and `env-config.ts` is what makes that
 * structural: the content script's import closure cannot reach this file,
 * and `scripts/check-release-consistency.mjs` fails the build if a key shows
 * up in `dist/content.js` anyway.
 */

interface ProviderCredential {
  /** The API key. Empty when the build carried no key. */
  apiKey: string;
}

interface EnvCredentials {
  minimax: ProviderCredential;
  opencode: ProviderCredential;
  ollama: ProviderCredential;
}

import { ENV_CREDENTIALS as GENERATED } from './env-credentials.generated';

export const ENV_CREDENTIALS: EnvCredentials = GENERATED;
