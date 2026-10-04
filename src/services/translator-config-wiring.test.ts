/**
 * Config -> translator wiring.
 *
 * Replaces a 386-line suite that mocked the config store away and asserted on
 * local variables (`currentPipeline = 'x'; expect(currentPipeline).toBe('x')`),
 * which is why the v1.3.x "translator sends an `obf:`-obfuscated API key"
 * defect shipped unnoticed.
 *
 * Isolation strategy: every test builds its own chrome mock, and the mock's
 * `onChanged.addListener` is a no-op spy. The store's storage listener is
 * irrelevant to what these tests assert (single-context config -> translator
 * wiring), and making it inert removes the cross-test interference that made
 * an earlier version of this file fail nondeterministically. The echo path is
 * covered separately, in `config-storage-sync.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage: Record<string, unknown> = {};

function installChromeMock(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in storage) {
              out[key] = storage[key];
            }
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          const changes: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { newValue: value };
            storage[key] = value;
          }
        }),
        remove: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: { id: 'translator-config-wiring-test' },
  };
}

function settle(ms = 200): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface Harness {
  store: {
    getState: () => {
      setProvider: (p: 'openai-compatible' | 'ollama' | 'lm-studio') => void;
      updateProviderSettings: (
        p: 'openai-compatible' | 'ollama' | 'lm-studio',
        s: Record<string, string>
      ) => void;
      setTargetLanguage: (l: string) => void;
      setTranslationStylePreset: (p: 'faithful') => void;
      setRenderMode: (m: 'anchors-only') => void;
      isProviderConfigured: () => boolean;
      translationStylePreset: string;
      targetLanguage: string;
      renderMode: string;
    };
  };
  createTranslatorFromConfig: () => {
    getConfig: () => {
      provider: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      targetLanguage: string;
      translationStylePreset: string;
      renderMode?: string;
    };
    initialize: () => Promise<void>;
  };
}

async function createHarness(): Promise<Harness> {
  // One module graph for the whole file: `translator.ts` captures
  // `useAppConfigStore` at import time, so the store and the translator
  // factory must come from the same registry.
  vi.resetModules();
  const configModule = await import('@/stores/config-v2');
  const translatorModule = await import('@/services/translator');
  const harness: Harness = {
    store: configModule.useAppConfigStore as unknown as Harness['store'],
    createTranslatorFromConfig:
      translatorModule.createTranslatorFromConfig as unknown as Harness['createTranslatorFromConfig'],
  };
  await settle();
  return harness;
}

describe('config -> translator wiring', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) {
      delete storage[key];
    }
    installChromeMock();
  });

  it('passes the user-entered API key, base URL and model to the translator', async () => {
    const { store, createTranslatorFromConfig } = await createHarness();

    store.getState().setProvider('openai-compatible');
    store.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-user-supplied-key-1234567890',
      baseUrl: 'https://api.user.example/v1',
      model: 'user-model',
    });
    await settle();

    const config = createTranslatorFromConfig().getConfig();
    expect(config.provider).toBe('openai-compatible');
    expect(config.apiKey).toBe('sk-user-supplied-key-1234567890');
    expect(config.apiKey?.startsWith('obf:')).toBe(false);
    expect(config.baseUrl).toBe('https://api.user.example/v1');
    expect(config.model).toBe('user-model');
  });

  it('passes target language, style preset and render mode through', async () => {
    const { store, createTranslatorFromConfig } = await createHarness();

    store.getState().setTargetLanguage('ja');
    store.getState().setTranslationStylePreset('faithful');
    store.getState().setRenderMode('anchors-only');
    await settle();

    const config = createTranslatorFromConfig().getConfig();
    expect(config.targetLanguage).toBe('ja');
    expect(config.translationStylePreset).toBe('faithful');
    expect(config.renderMode).toBe('anchors-only');
  });

  it('refuses to initialize a cloud provider with an empty API key', async () => {
    const { store, createTranslatorFromConfig } = await createHarness();

    store.getState().setProvider('openai-compatible');
    store.getState().updateProviderSettings('openai-compatible', {
      apiKey: '',
    });
    await settle();

    await expect(createTranslatorFromConfig().initialize()).rejects.toThrow(
      /API Key/i
    );
  });

  it('initializes a local provider without an API key', async () => {
    const { store, createTranslatorFromConfig } = await createHarness();

    store.getState().setProvider('ollama');
    await settle();

    await expect(
      createTranslatorFromConfig().initialize()
    ).resolves.toBeUndefined();
  });

  it('keeps the local endpoint and model the user typed', async () => {
    const { store, createTranslatorFromConfig } = await createHarness();

    store.getState().setProvider('ollama');
    store.getState().updateProviderSettings('ollama', {
      baseUrl: 'http://192.168.1.50:11434',
      model: 'qwen3-vl:8b',
    });
    await settle();

    const config = createTranslatorFromConfig().getConfig();
    expect(config.baseUrl).toBe('http://192.168.1.50:11434');
    expect(config.model).toBe('qwen3-vl:8b');
  });

  it('reports provider readiness from live state', async () => {
    const { store } = await createHarness();

    store.getState().setProvider('openai-compatible');
    store.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-configured-key-1234567890',
    });
    expect(store.getState().isProviderConfigured()).toBe(true);

    store.getState().updateProviderSettings('openai-compatible', {
      apiKey: '',
    });
    expect(store.getState().isProviderConfigured()).toBe(false);
  });
});
