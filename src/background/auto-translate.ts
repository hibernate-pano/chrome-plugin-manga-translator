import { hostMatchesAllowlist, normalizeHostList } from '@/shared/app-config';

/**
 * Read the persisted config snapshot defensively.
 *
 * Storage holds either the Zustand envelope (`{ state: {...} }`) or a flat
 * object, depending on which context wrote it last.
 */
function readConfigState(config: unknown): {
  enabled: boolean;
  autoContinueEnabled: boolean;
  autoTranslateHosts: unknown;
} {
  const maybeConfig =
    config && typeof config === 'object'
      ? (config as {
          enabled?: unknown;
          autoContinueEnabled?: unknown;
          autoTranslateHosts?: unknown;
          state?: {
            enabled?: unknown;
            autoContinueEnabled?: unknown;
            autoTranslateHosts?: unknown;
          };
        })
      : {};
  const state = maybeConfig.state ?? maybeConfig;
  return {
    enabled: typeof state.enabled === 'boolean' ? state.enabled : false,
    autoContinueEnabled:
      typeof state.autoContinueEnabled === 'boolean'
        ? state.autoContinueEnabled
        : true,
    autoTranslateHosts: state.autoTranslateHosts,
  };
}

/**
 * Is the master switch on? This gates every path, including manual actions.
 */
export function isTranslationEnabled(config: unknown): boolean {
  return readConfigState(config).enabled;
}

/**
 * Should this page be translated automatically, without the user asking?
 *
 * Requires the master switch AND that the host is on the user's allowlist.
 * Before this existed, enabling the extension meant every navigation in every
 * tab was translated: with `<all_urls>` host permission and no site control,
 * large images from whatever the user was browsing were sent to their vision
 * provider and billed for.
 *
 * A page the user explicitly translates stays translated either way — this
 * only decides whether we act unprompted.
 */
export function shouldAutoTranslatePage(
  config: unknown,
  pageUrl: string | undefined
): boolean {
  const state = readConfigState(config);
  if (!state.enabled || !pageUrl) {
    return false;
  }
  const hosts = normalizeHostList(state.autoTranslateHosts);
  return hostMatchesAllowlist(pageUrl, hosts);
}

/**
 * Should new images inside an already-translated page keep being translated?
 * This is the original "auto-continue" behaviour and is independent of the
 * per-site allowlist, because the user already asked for that page.
 */
export function isAutoContinueEnabled(config: unknown): boolean {
  const state = readConfigState(config);
  return state.enabled && state.autoContinueEnabled;
}

export function createAutoTranslateMessage(enabled: boolean) {
  return enabled
    ? ({ type: 'TRANSLATE_PAGE' } as const)
    : ({ type: 'CANCEL_TRANSLATION' } as const);
}
