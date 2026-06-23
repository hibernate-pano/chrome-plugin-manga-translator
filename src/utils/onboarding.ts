import type { ProviderType } from '@/providers/base';

const DISMISSED_KEY = 'manga-translator-onboarding-dismissed';
const FOCUS_KEY = 'manga-translator-onboarding-focus';

export interface OnboardingFocusSignal {
  provider: ProviderType;
  ts: number;
}

export async function isOnboardingDismissed(): Promise<boolean> {
  const result = await chrome.storage.session.get(DISMISSED_KEY);
  return Boolean(result[DISMISSED_KEY]);
}

export async function setOnboardingDismissed(): Promise<void> {
  await chrome.storage.session.set({ [DISMISSED_KEY]: true });
}

export async function requestConfigureFocus(
  provider: ProviderType
): Promise<void> {
  const signal: OnboardingFocusSignal = { provider, ts: Date.now() };
  await chrome.storage.session.set({ [FOCUS_KEY]: signal });
}

export async function readAndClearFocusSignal(): Promise<OnboardingFocusSignal | null> {
  const result = await chrome.storage.session.get(FOCUS_KEY);
  const signal = result[FOCUS_KEY] as OnboardingFocusSignal | undefined;
  if (!signal) {
    return null;
  }
  // Only honor signals from the last 30 seconds
  if (Date.now() - signal.ts > 30_000) {
    void chrome.storage.session.remove(FOCUS_KEY);
    return null;
  }
  await chrome.storage.session.remove(FOCUS_KEY);
  return signal;
}

