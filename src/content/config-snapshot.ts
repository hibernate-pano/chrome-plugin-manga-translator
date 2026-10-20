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
