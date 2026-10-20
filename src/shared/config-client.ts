import type { ContentConfigSnapshot } from './content-config';

/**
 * The shape of a `GET_CONFIG` answer.
 *
 * `config` is present only when the request succeeded. `enabled` mirrors the
 * master switch and is always present when the request succeeded, so a
 * caller that only needs the switch does not have to dig into the snapshot.
 */
export interface GetConfigResult {
  ok: boolean;
  enabled: boolean;
  config: ContentConfigSnapshot | null;
}

/**
 * Ask the service worker for the redacted configuration.
 *
 * The worker owns the configuration, and it is the only context allowed to
 * hold an API key. A content script therefore does not read
 * `chrome.storage.local` for the config: it asks the worker, and the worker
 * answers with a snapshot in which every credential has been replaced by a
 * boolean.
 *
 * The call fails closed. When the worker cannot be reached — the extension
 * was reloaded, the context is invalid — the answer is "the extension is
 * off", because an unknown configuration must never become a paid API call.
 */
export async function fetchContentConfig(): Promise<GetConfigResult> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'GET_CONFIG',
    })) as { success?: boolean; config?: ContentConfigSnapshot } | undefined;

    if (!response || response.success !== true || !response.config) {
      return { ok: false, enabled: false, config: null };
    }

    return {
      ok: true,
      enabled: response.config.enabled === true,
      config: response.config,
    };
  } catch {
    return { ok: false, enabled: false, config: null };
  }
}
