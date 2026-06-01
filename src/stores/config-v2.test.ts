import { beforeEach, describe, expect, it } from 'vitest';

import { useAppConfigStore } from './config-v2';
import { obfuscateApiKey } from '@/utils/crypto';

describe('AppConfigStore', () => {
  beforeEach(() => {
    useAppConfigStore.getState().resetToDefaults();
  });

  it('defaults to openai-compatible with auto continuation enabled', () => {
    const state = useAppConfigStore.getState();
    expect(state.provider).toBe('openai-compatible');
    expect(state.providers['openai-compatible'].baseUrl).toBe(
      'https://api.openai.com/v1'
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
    store.updateProviderSettings('openai-compatible', {
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });

    expect(useAppConfigStore.getState().isProviderConfigured()).toBe(true);
    expect(useAppConfigStore.getState().openaiCompatible.model).toBe(
      'gpt-4o-mini'
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

  it('obfuscates API Key in storage and transparently restores it in store', async () => {
    const store = useAppConfigStore.getState();
    // 写入 API Key 
    store.setProviderApiKey('openai-compatible', 'sk-my-secret-key-123456');
    store.setProviderApiKey('lm-studio', 'lm-secret-key-999');
    store.setOverlayStyle({
      backgroundColor: 'rgba(20, 20, 20, 0.92)',
      textColor: '#fafafa',
    });
    
    // 等待持久化异步操作写入完成
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    // 检查 chrome.storage.sync 中保存的是混淆后的值（包含 obf:）且没有暴露明文
    const result = await chrome.storage.sync.get(['manga-translator-config-v2']);
    const storedObj = result['manga-translator-config-v2'];
    expect(storedObj).not.toBeNull();
    expect(storedObj.state).toBeDefined();
    const storedState = storedObj.state || storedObj;
    
    expect(storedState.openaiCompatible.apiKey).toBe(obfuscateApiKey('sk-my-secret-key-123456'));
    expect(storedState.openaiCompatible.apiKey).not.toContain('sk-my-secret');
    expect(storedState.lmStudio.apiKey).toBe(obfuscateApiKey('lm-secret-key-999'));
    expect(storedState.lmStudio.apiKey).not.toContain('lm-secret');
    expect(storedState.overlayStyle).toEqual({
      backgroundColor: 'rgba(20, 20, 20, 0.92)',
      textColor: '#fafafa',
      minFontSize: 10,
      maxFontSize: 22,
      verticalText: false,
    });
    
    // 检查内存状态，内存中应当保持明文
    expect(useAppConfigStore.getState().openaiCompatible.apiKey).toBe('sk-my-secret-key-123456');
    expect(useAppConfigStore.getState().lmStudio.apiKey).toBe('lm-secret-key-999');
    expect(useAppConfigStore.getState().providers['openai-compatible'].apiKey).toBe('sk-my-secret-key-123456');
    expect(useAppConfigStore.getState().providers['lm-studio'].apiKey).toBe('lm-secret-key-999');
  });

  // ================================================================
  // v0.3.1 → v0.3.2 upgrade migration (regression guard for p1)
  // ================================================================
  describe('v0.3.1 → v0.3.2 upgrade migration', () => {
    it('remaps legacy `openai` provider into `openai-compatible`', async () => {
      // Simulate a v0.3.1 persisted envelope where the user was on the old
      // 'openai' provider key with no 'openai-compatible' or 'lm-studio'.
      await chrome.storage.sync.set({
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
      const persistApi = (useAppConfigStore as unknown as {
        persist: { rehydrate: () => Promise<void> };
      }).persist;
      await persistApi.rehydrate();

      const state = useAppConfigStore.getState();
      expect(state.provider).toBe('openai-compatible');
      expect(state.providers['openai-compatible'].apiKey).toBe('sk-legacy');
      expect(state.providers['openai-compatible'].model).toBe('gpt-4o');
      expect(state.providers.ollama.model).toBe('llava');
      // lm-studio must exist after migration even though it didn't in v1
      expect(state.providers['lm-studio']).toBeDefined();
      expect(state.providers['lm-studio'].baseUrl).toBe('http://localhost:1234/v1');
    });

    it('remaps legacy `siliconflow` provider settings to `openai-compatible`', async () => {
      await chrome.storage.sync.set({
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

      const persistApi = (useAppConfigStore as unknown as {
        persist: { rehydrate: () => Promise<void> };
      }).persist;
      await persistApi.rehydrate();

      const state = useAppConfigStore.getState();
      expect(state.provider).toBe('openai-compatible');
      expect(state.providers['openai-compatible'].apiKey).toBe('sk-sf');
      expect(state.providers['openai-compatible'].baseUrl).toBe(
        'https://api.siliconflow.cn/v1'
      );
    });
  });

});
