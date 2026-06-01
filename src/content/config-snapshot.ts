import type { OverlayStyleConfig } from '@/stores/config-v2';

type PersistedConfigRecord = any;

function isRecord(value: unknown): value is PersistedConfigRecord {
  return typeof value === 'object' && value !== null;
}

export function extractPersistedConfigState(
  config: unknown
): PersistedConfigRecord {
  if (!isRecord(config)) {
    return {};
  }

  return isRecord(config.state) ? config.state : config;
}

export function getEnabledFromConfig(config: unknown): boolean {
  const state = extractPersistedConfigState(config);
  const enabled = typeof state.enabled === 'boolean' ? state.enabled : false;
  const autoContinueEnabled =
    typeof state.autoContinueEnabled === 'boolean'
      ? state.autoContinueEnabled
      : true;

  return enabled && autoContinueEnabled;
}

export function getOverlayStyleFromConfig(
  config: unknown
): OverlayStyleConfig | null {
  const state = extractPersistedConfigState(config);
  const overlayStyle = state.overlayStyle;

  if (!isRecord(overlayStyle)) {
    return null;
  }

  if (
    typeof overlayStyle.backgroundColor !== 'string' ||
    typeof overlayStyle.textColor !== 'string' ||
    typeof overlayStyle.minFontSize !== 'number' ||
    typeof overlayStyle.maxFontSize !== 'number' ||
    typeof overlayStyle.verticalText !== 'boolean'
  ) {
    return null;
  }

  return {
    backgroundColor: overlayStyle.backgroundColor,
    textColor: overlayStyle.textColor,
    minFontSize: overlayStyle.minFontSize,
    maxFontSize: overlayStyle.maxFontSize,
    verticalText: overlayStyle.verticalText,
  };
}
