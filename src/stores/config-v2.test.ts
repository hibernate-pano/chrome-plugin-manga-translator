import { beforeEach, describe, expect, it } from 'vitest';

import { useAppConfigStore } from './config-v2';
import { DEFAULT_OPENAI_COMPATIBLE_CONFIG } from '@/shared/app-config';
import { shallowChanged } from './config-v2';

describe('AppConfigStore', () => {
  beforeEach(() => {
    useAppConfigStore.getState().resetToDefaults();
  });

  // Regression for v1.1.1 / v1.4.0: chrome.storage.onChanged fires for our own
  // persist writes too. Comparing raw key counts or object references always
  // reported "changed" (the snapshot has 19 fields, the runtime store 42),
  // which produced an unbounded write storm and pushed `obf:`-obfuscated API
  // keys back into memory. shallowChanged now compares by value, restricted to
  // the persisted field whitelist.
  describe('shallowChanged (storage-change listener guard)', () => {
    it('returns false when every persisted field holds the same value', () => {
      const current = { enabled: true, targetLanguage: 'zh-CN' };
      expect(
        shallowChanged({ enabled: true, targetLanguage: 'zh-CN' }, current)
      ).toBe(false);
    });

    it('returns true when a primitive differs', () => {
      expect(shallowChanged({ enabled: true }, { enabled: false })).toBe(true);
    });

    it('returns false when nested values are equal but references differ', () => {
      // This is the exact shape of a persist echo: same data, new objects.
      const candidate = {
        overlayStyle: {
          backgroundColor: 'rgba(240, 240, 235, 0.94)',
          textColor: '#111111',
          minFontSize: 10,
          maxFontSize: 22,
          verticalText: false,
        },
      };
      const current = {
        overlayStyle: {
          backgroundColor: 'rgba(240, 240, 235, 0.94)',
          textColor: '#111111',
          minFontSize: 10,
          maxFontSize: 22,
          verticalText: false,
        },
      };
      expect(shallowChanged(candidate, current)).toBe(false);
    });

    it('returns true when a nested value actually differs', () => {
      expect(
        shallowChanged(
          { overlayStyle: { minFontSize: 12 } },
          { overlayStyle: { minFontSize: 10 } }
        )
      ).toBe(true);
    });

    it('ignores keys outside the persisted whitelist', () => {
      // The runtime store carries ~23 action fields the snapshot never has.
      // Those must not make every echo look like a change.
      const candidate = { targetLanguage: 'zh-CN' };
      const current = {
        targetLanguage: 'zh-CN',
        setEnabled: () => undefined,
        resetToDefaults: () => undefined,
      };
      expect(shallowChanged(candidate, current)).toBe(false);
    });

    it('ignores unknown injected keys in the snapshot', () => {
      const current = { targetLanguage: 'zh-CN' };
      expect(
        shallowChanged(
          { targetLanguage: 'zh-CN', somethingInjected: 'x' },
          current
        )
      ).toBe(false);
    });
  });

  it('defaults to openai-compatible with MiniMax baked-in default', () => {
    const state = useAppConfigStore.getState();
    expect(state.provider).toBe('openai-compatible');
    // v1.1.0: default endpoint is MiniMax (from .env injection), no longer
    // the OpenAI placeholder. The base URL should point at MiniMax when the
    // .env is present (test env may not have it for CI, but the template
    // fallback is MiniMax).
    expect(state.providers['openai-compatible'].baseUrl).toContain(
      'minimaxi.com'
    );
    expect(state.autoContinueEnabled).toBe(true);
    expect(state.translationPipeline).toBe('full-image-vlm');
  });

  it('keeps only openai-compatible, ollama and lm-studio provider surfaces', () => {
    const state = useAppConfigStore.getState();
    expect(Object.keys(state.providers)).toEqual([
      'openai-compatible',
      'ollama',
      'lm-studio',
    ]);
  });

  it('updates the active provider settings and readiness', () => {
    const store = useAppConfigStore.getState();
    store.setProvider('openai-compatible');
    // Runtime input replaces the build-time default.
    store.updateProviderSettings('openai-compatible', {
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });

    expect(useAppConfigStore.getState().isProviderConfigured()).toBe(true);
    expect(useAppConfigStore.getState().openaiCompatible.model).toBe(
      'gpt-4o-mini'
    );
    expect(useAppConfigStore.getState().openaiCompatible.apiKey).toBe(
      'sk-test'
    );
  });

  it('supports switching to ollama and toggling auto continuation', () => {
    const store = useAppConfigStore.getState();
    store.setProvider('ollama');
    store.setAutoContinueEnabled(false);

    const state = useAppConfigStore.getState();
    expect(state.provider).toBe('ollama');
    expect(state.isProviderConfigured('ollama')).toBe(true);
    expect(state.autoContinueEnabled).toBe(false);
  });

  it('does not persist the build-time apiKey into chrome.storage', async () => {
    const store = useAppConfigStore.getState();
    store.setOverlayStyle({
      backgroundColor: 'rgba(20, 20, 20, 0.92)',
      textColor: '#fafafa',
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const result = await chrome.storage.local.get([
      'manga-translator-config-v2',
    ]);
    const storedObj = result['manga-translator-config-v2'];
    expect(storedObj).not.toBeNull();
    expect(storedObj.state).toBeDefined();
    const storedState = storedObj.state || storedObj;

    // The build-time key is intentionally not copied into local storage.
    expect(storedState.openaiCompatible.apiKey).toBe('');
    expect(storedState.ollama.apiKey).toBe('');
    expect(storedState.lmStudio.apiKey).toBe('');
    expect(storedState.providers['openai-compatible'].apiKey).toBe('');
    expect(storedState.providers.ollama.apiKey).toBe('');
    expect(storedState.providers['lm-studio'].apiKey).toBe('');
    expect(storedState.overlayStyle).toEqual({
      backgroundColor: 'rgba(20, 20, 20, 0.92)',
      textColor: '#fafafa',
      minFontSize: 10,
      maxFontSize: 22,
      verticalText: false,
    });
  });

  it('keeps a user-supplied apiKey on the openai-compatible slot', () => {
    useAppConfigStore
      .getState()
      .setProviderApiKey('openai-compatible', 'sk-user-override');
    expect(useAppConfigStore.getState().openaiCompatible.apiKey).toBe(
      'sk-user-override'
    );
  });

  // ================================================================
  // v0.3.1 → v0.3.2 upgrade migration (regression guard for p1)
  // ================================================================
  describe('v0.3.1 → v0.3.2 upgrade migration', () => {
    it('remaps legacy `openai` provider into `openai-compatible`', async () => {
      // Simulate a v0.3.1 persisted envelope where the user was on the old
      // 'openai' provider key with no 'openai-compatible' or 'lm-studio'.
      await chrome.storage.local.set({
        'manga-translator-config-v2': {
          state: {
            enabled: true,
            provider: 'openai',
            providers: {
              openai: {
                apiKey: 'sk-legacy',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o',
              },
              ollama: {
                apiKey: '',
                baseUrl: 'http://localhost:11434',
                model: 'llava',
              },
            },
            targetLanguage: 'zh-CN',
            maxImageSize: 1920,
            parallelLimit: 3,
            cacheEnabled: true,
          },
          version: 1,
        },
      });

      // Force re-hydrate by re-importing the store fresh.
      // Vitest module cache prevents that, so call the store's persist API.
      const persistApi = (
        useAppConfigStore as unknown as {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist;
      await persistApi.rehydrate();

      const state = useAppConfigStore.getState();
      expect(state.provider).toBe('openai-compatible');
      expect(state.providers['openai-compatible'].apiKey).toBe('sk-legacy');
      expect(state.providers['openai-compatible'].baseUrl).toBe(
        'https://api.openai.com/v1'
      );
      expect(state.providers['openai-compatible'].model).toBe('gpt-4o');
      expect(state.providers.ollama.model).toBe('llava');
      expect(state.providers.ollama.baseUrl).toBe('http://localhost:11434');
      // lm-studio must exist after migration even though it didn't in v1
      expect(state.providers['lm-studio']).toBeDefined();
      expect(state.providers['lm-studio'].baseUrl).toBe(
        'http://localhost:1234/v1'
      );
    });

    it('remaps legacy `siliconflow` provider settings to `openai-compatible`', async () => {
      await chrome.storage.local.set({
        'manga-translator-config-v2': {
          state: {
            enabled: false,
            provider: 'siliconflow',
            providers: {
              siliconflow: {
                apiKey: 'sk-sf',
                baseUrl: 'https://api.siliconflow.cn/v1',
                model: 'Qwen/Qwen2.5-VL-32B-Instruct',
              },
            },
            targetLanguage: 'zh-CN',
          },
          version: 1,
        },
      });

      const persistApi = (
        useAppConfigStore as unknown as {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist;
      await persistApi.rehydrate();

      const state = useAppConfigStore.getState();
      expect(state.provider).toBe('openai-compatible');
      expect(state.providers['openai-compatible'].apiKey).toBe('sk-sf');
      expect(state.providers['openai-compatible'].baseUrl).toBe(
        'https://api.siliconflow.cn/v1'
      );
      expect(state.providers['openai-compatible'].model).toBe(
        'Qwen/Qwen2.5-VL-32B-Instruct'
      );
    });
  });

  // Empty persisted keys mean "use the build-time default". Non-empty
  // endpoint/model values still survive as user overrides.
  it('preserves env-injected apiKey across rehydrate from stripped storage', async () => {
    await chrome.storage.local.set({
      'manga-translator-config-v2': {
        state: {
          enabled: false,
          provider: 'openai-compatible',
          openaiCompatible: {
            apiKey: '', // partialize strips; simulate that state on disk
            baseUrl: 'https://api.openai.com/v1', // leftover from a stale
            model: 'gpt-4o-legacy', //   legacy user that we must ignore
          },
          providers: {
            'openai-compatible': {
              apiKey: '',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o-legacy',
            },
          },
        },
        version: 3,
      },
    });

    const persistApi = (
      useAppConfigStore as unknown as {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist;
    await persistApi.rehydrate();

    const settings =
      useAppConfigStore.getState().providers['openai-compatible'];
    expect(settings.apiKey).toBe(DEFAULT_OPENAI_COMPATIBLE_CONFIG.apiKey);
    expect(settings.baseUrl).toBe('https://api.openai.com/v1');
    expect(settings.model).toBe('gpt-4o-legacy');
  });
});
