export function isTranslationEnabled(config: unknown): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const maybeConfig = config as {
    enabled?: boolean;
    autoContinueEnabled?: boolean;
    state?: { enabled?: boolean; autoContinueEnabled?: boolean };
  };

  const enabled = maybeConfig.state?.enabled ?? maybeConfig.enabled ?? false;
  const autoContinueEnabled =
    maybeConfig.state?.autoContinueEnabled ??
    maybeConfig.autoContinueEnabled ??
    true;

  return enabled && autoContinueEnabled;
}

export function createAutoTranslateMessage(enabled: boolean) {
  return enabled
    ? ({ type: 'TRANSLATE_PAGE' } as const)
    : ({ type: 'CANCEL_TRANSLATION' } as const);
}
