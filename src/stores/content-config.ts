/**
 * The content script's view of the app configuration.
 *
 * This store is deliberately NOT the persisted config store
 * (`@/stores/config-v2`). That one keeps the API key in memory — it
 * deobfuscates it while rehydrating from `chrome.storage.local` — and a
 * content script must never hold a credential, not even for a moment.
 *
 * Importing `@/stores/config-v2` from a content script is therefore a
 * security bug, not a style question: the persist middleware rehydrates at
 * module evaluation and puts the plaintext key into the content script's
 * heap. This module has no runtime dependency on it.
 *
 * The values come from the service worker, which sends a redacted snapshot
 * (`@/shared/content-config`).
 */
import { create } from 'zustand';

import { DEFAULT_CONFIG } from '@/shared/app-config';
import {
  CONTENT_PROVIDER_TYPES,
  type ContentConfigSnapshot,
} from '@/shared/content-config';
import type { ProviderType } from '@/providers/base';

export interface ContentConfigStore extends ContentConfigSnapshot {
  /**
   * Replace the snapshot with a fresh one from the worker.
   */
  setConfig: (config: ContentConfigSnapshot) => void;
}

function defaultProviderConfig(type: ProviderType): {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
} {
  const settings = DEFAULT_CONFIG.providers[type];
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    // The default says "no key": the worker is the only context that knows
    // whether one is configured, and it says so in the snapshot.
    hasApiKey: false,
  };
}

function defaultSnapshot(): ContentConfigSnapshot {
  const providers = {} as Record<
    ProviderType,
    ContentConfigSnapshot['providers'][ProviderType]
  >;
  for (const type of CONTENT_PROVIDER_TYPES) {
    providers[type] = defaultProviderConfig(type);
  }

  return {
    enabled: DEFAULT_CONFIG.enabled,
    provider: DEFAULT_CONFIG.provider,
    providers,
    targetLanguage: DEFAULT_CONFIG.targetLanguage,
    translationStylePreset: DEFAULT_CONFIG.translationStylePreset,
    autoContinueEnabled: DEFAULT_CONFIG.autoContinueEnabled,
    autoTranslateHosts: [...DEFAULT_CONFIG.autoTranslateHosts],
    cacheEnabled: DEFAULT_CONFIG.cacheEnabled,
    parallelLimit: DEFAULT_CONFIG.parallelLimit,
    regionBatchSize: DEFAULT_CONFIG.regionBatchSize,
    translationPipeline: DEFAULT_CONFIG.translationPipeline,
    fallbackToFullImage: DEFAULT_CONFIG.fallbackToFullImage,
    renderMode: DEFAULT_CONFIG.renderMode,
    maxImageSize: DEFAULT_CONFIG.maxImageSize,
    overlayStyle: { ...DEFAULT_CONFIG.overlayStyle },
  };
}

export const useContentConfigStore = create<ContentConfigStore>()(set => ({
  ...defaultSnapshot(),
  setConfig: config => set({ ...config }),
}));
