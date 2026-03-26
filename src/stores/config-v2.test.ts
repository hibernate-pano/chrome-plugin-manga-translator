/**
 * Config Store v2 Tests
 * 
 * Tests for configuration storage and retrieval
 * Validates: Requirements 1.4, 6.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppConfigStore } from './config-v2';

describe('AppConfigStore', () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useAppConfigStore.getState().resetToDefaults();
  });

  describe('Toggle Operations', () => {
    it('should start with enabled = false', () => {
      const state = useAppConfigStore.getState();
      expect(state.enabled).toBe(false);
    });

    it('should toggle enabled state', () => {
      const store = useAppConfigStore.getState();
      
      store.toggleEnabled();
      expect(useAppConfigStore.getState().enabled).toBe(true);
      
      store.toggleEnabled();
      expect(useAppConfigStore.getState().enabled).toBe(false);
    });

    it('should set enabled state directly', () => {
      const store = useAppConfigStore.getState();
      
      store.setEnabled(true);
      expect(useAppConfigStore.getState().enabled).toBe(true);
      
      store.setEnabled(false);
      expect(useAppConfigStore.getState().enabled).toBe(false);
    });
  });

  describe('Server Mode', () => {
    it('should start in server mode with localhost preconfigured', () => {
      const state = useAppConfigStore.getState();
      expect(state.executionMode).toBe('server');
      expect(state.server.enabled).toBe(true);
      expect(state.server.baseUrl).toBe('http://127.0.0.1:8000');
      expect(state.isServerConfigured()).toBe(true);
    });

    it('should update server configuration', () => {
      const store = useAppConfigStore.getState();

      store.setExecutionMode('server');
      store.updateServerConfig({
        enabled: true,
        baseUrl: 'http://127.0.0.1:8000',
        authToken: 'token',
        timeoutMs: 15000,
      });

      const state = useAppConfigStore.getState();
      expect(state.executionMode).toBe('server');
      expect(state.server.baseUrl).toBe('http://127.0.0.1:8000');
      expect(state.server.timeoutMs).toBe(15000);
      expect(state.isServerConfigured()).toBe(true);
    });
  });

  describe('Provider Operations', () => {
    it('should have siliconflow as default provider', () => {
      const state = useAppConfigStore.getState();
      expect(state.provider).toBe('siliconflow');
    });

    it('should change provider', () => {
      const store = useAppConfigStore.getState();
      
      store.setProvider('claude');
      expect(useAppConfigStore.getState().provider).toBe('claude');
      
      store.setProvider('ollama');
      expect(useAppConfigStore.getState().provider).toBe('ollama');
    });

    it('should update provider settings', () => {
      const store = useAppConfigStore.getState();
      
      store.updateProviderSettings('openai', { apiKey: 'test-key' });
      
      const state = useAppConfigStore.getState();
      expect(state.providers.openai.apiKey).toBe('test-key');
    });

    it('should set provider API key', () => {
      const store = useAppConfigStore.getState();
      
      store.setProviderApiKey('claude', 'claude-api-key');
      
      const state = useAppConfigStore.getState();
      expect(state.providers.claude.apiKey).toBe('claude-api-key');
    });

    it('should get active provider settings', () => {
      const store = useAppConfigStore.getState();
      
      store.setProvider('deepseek');
      store.setProviderApiKey('deepseek', 'deepseek-key');
      
      const settings = useAppConfigStore.getState().getActiveProviderSettings();
      expect(settings.apiKey).toBe('deepseek-key');
    });
  });

  describe('Provider Configuration Check', () => {
    it('should report cloud provider as not configured without API key', () => {
      const store = useAppConfigStore.getState();
      
      expect(store.isProviderConfigured('openai')).toBe(false);
      expect(store.isProviderConfigured('claude')).toBe(false);
      expect(store.isProviderConfigured('deepseek')).toBe(false);
    });

    it('should report cloud provider as configured with API key', () => {
      const store = useAppConfigStore.getState();
      
      store.setProviderApiKey('openai', 'test-api-key');
      
      expect(useAppConfigStore.getState().isProviderConfigured('openai')).toBe(true);
    });

    it('should report ollama as configured with base URL', () => {
      const store = useAppConfigStore.getState();
      
      // Ollama has default baseUrl, so it should be configured
      expect(store.isProviderConfigured('ollama')).toBe(true);
    });

    it('should check current provider when no argument provided', () => {
      const store = useAppConfigStore.getState();

      // Default provider is siliconflow with no API key
      expect(store.isProviderConfigured()).toBe(false);

      store.setProviderApiKey('siliconflow', 'test-key');
      expect(useAppConfigStore.getState().isProviderConfigured()).toBe(true);
    });
  });

  describe('Language Settings', () => {
    it('should have zh-CN as default target language', () => {
      const state = useAppConfigStore.getState();
      expect(state.targetLanguage).toBe('zh-CN');
    });

    it('should change target language', () => {
      const store = useAppConfigStore.getState();
      
      store.setTargetLanguage('en-US');
      expect(useAppConfigStore.getState().targetLanguage).toBe('en-US');
    });
  });

  describe('Performance Settings', () => {
    it('should have default performance settings', () => {
      const state = useAppConfigStore.getState();
      
      expect(state.maxImageSize).toBe(1920);
      expect(state.parallelLimit).toBe(3);
      expect(state.cacheEnabled).toBe(true);
      expect(state.translationStylePreset).toBe('natural-zh');
    });

    it('should update performance settings', () => {
      const store = useAppConfigStore.getState();
      
      store.setMaxImageSize(1280);
      store.setParallelLimit(5);
      store.setCacheEnabled(false);
      
      const state = useAppConfigStore.getState();
      expect(state.maxImageSize).toBe(1280);
      expect(state.parallelLimit).toBe(5);
      expect(state.cacheEnabled).toBe(false);
    });
  });

  describe('Translation Style Preset', () => {
    it('should update translation style preset', () => {
      const store = useAppConfigStore.getState();

      store.setTranslationStylePreset('concise-bubble');
      expect(useAppConfigStore.getState().translationStylePreset).toBe(
        'concise-bubble'
      );
    });
  });

  describe('Reset', () => {
    it('should reset all settings to defaults', () => {
      const store = useAppConfigStore.getState();
      
      // Modify various settings
      store.setEnabled(true);
      store.setProvider('claude');
      store.setProviderApiKey('claude', 'test-key');
      store.setTargetLanguage('en-US');
      store.setMaxImageSize(1280);
      
      // Reset
      store.resetToDefaults();
      
      // Verify defaults
      const state = useAppConfigStore.getState();
      expect(state.enabled).toBe(false);
      expect(state.provider).toBe('siliconflow');
      expect(state.providers.claude.apiKey).toBe('');
      expect(state.targetLanguage).toBe('zh-CN');
      expect(state.maxImageSize).toBe(1920);
    });
  });
});
