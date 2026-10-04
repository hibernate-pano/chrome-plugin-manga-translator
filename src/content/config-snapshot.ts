import { normalizeHostList } from '@/shared/app-config';
import type { OverlayStyleConfig } from '@/stores/config-v2';

type PersistedConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PersistedConfigRecord {
  return typeof value === 'object' && value !== null;
}

export function extractPersistedConfigState(
  config: unknown
): PersistedConfigRecord {
  if (!isRecord(config)) {
    return {};
  }

  return isRecord(config['state']) ? config['state'] : config;
}

/**
 * Is the master switch on?
 *
 * Named for what it returns: this is only the global toggle. Whether the
 * extension should act on the current page without being asked is a separate
 * question — see `shouldAutoTranslatePage` in `@/shared/app-config`.
 */
export function getEnabledFromConfig(config: unknown): boolean {
  const state = extractPersistedConfigState(config);
  return typeof state['enabled'] === 'boolean' ? state['enabled'] : false;
}

/**
 * Continue translating images that appear later in a page the user already
 * asked us to translate.
 */
export function getAutoContinueFromConfig(config: unknown): boolean {
  const state = extractPersistedConfigState(config);
  return typeof state['autoContinueEnabled'] === 'boolean'
    ? state['autoContinueEnabled']
    : true;
}

/**
 * Should this host be translated automatically on load, without the user
 * asking?
 */
export function getAutoTranslateHostsFromConfig(config: unknown): string[] {
  return normalizeHostList(
    extractPersistedConfigState(config)['autoTranslateHosts']
  );
}

export function getOverlayStyleFromConfig(
  config: unknown
): OverlayStyleConfig | null {
  const state = extractPersistedConfigState(config);
  const overlayStyle = state['overlayStyle'];

  if (!isRecord(overlayStyle)) {
    return null;
  }

  if (
    typeof overlayStyle['backgroundColor'] !== 'string' ||
    typeof overlayStyle['textColor'] !== 'string' ||
    typeof overlayStyle['minFontSize'] !== 'number' ||
    typeof overlayStyle['maxFontSize'] !== 'number' ||
    typeof overlayStyle['verticalText'] !== 'boolean'
  ) {
    return null;
  }

  return {
    backgroundColor: overlayStyle['backgroundColor'],
    textColor: overlayStyle['textColor'],
    minFontSize: overlayStyle['minFontSize'],
    maxFontSize: overlayStyle['maxFontSize'],
    verticalText: overlayStyle['verticalText'],
  };
}
