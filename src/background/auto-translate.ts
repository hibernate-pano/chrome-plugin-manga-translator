export function isTranslationEnabled(config: unknown): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const maybeConfig = config as {
    enabled?: boolean;
    state?: { enabled?: boolean };
  };

  return maybeConfig.state?.enabled ?? maybeConfig.enabled ?? false;
}

export function createAutoTranslateMessage(enabled: boolean) {
  return enabled
    ? ({ type: 'TRANSLATE_PAGE' } as const)
    : ({ type: 'CANCEL_TRANSLATION' } as const);
}
