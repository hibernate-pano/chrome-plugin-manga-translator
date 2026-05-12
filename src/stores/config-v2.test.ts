import { beforeEach, describe, expect, it } from 'vitest';

import { useAppConfigStore } from './config-v2';

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
  });

  it('keeps only openai-compatible and ollama provider surfaces', () => {
    const state = useAppConfigStore.getState();
    expect(Object.keys(state.providers)).toEqual([
      'openai-compatible',
      'ollama',
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
});
