/**
 * Integration Tests for Manga Translator v2
 * 
 * Tests the complete translation flow including:
 * - Full translation pipeline
 * - Multi-provider switching
 * - Ollama local connection
 * 
 * Requirements: All
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTranslatorFromConfig, getTranslator, resetTranslator } from './translator';
import { OverlayRenderer, getRenderer, resetRenderer } from './renderer';
import { compressImage, calculateHash } from './image-processor';
import { useAppConfigStore } from '@/stores/config-v2';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import type { ProviderType, TextArea } from '@/providers/base';
import {
  resetDefaultTranslationTransport,
  setDefaultTranslationTransport,
  type TranslationTransport,
} from './translation-transport';

// ==================== Test Utilities ====================

/**
 * Create a mock HTMLImageElement for testing
 */
function createMockImage(width = 800, height = 600, src = 'https://example.com/manga.jpg'): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  Object.defineProperty(img, 'width', { value: width, configurable: true });
  Object.defineProperty(img, 'height', { value: height, configurable: true });
  Object.defineProperty(img, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'offsetHeight', { value: height, configurable: true });
  img.src = src;
  return img;
}

/**
 * Create mock text areas for testing
 */
function createMockTextAreas(): TextArea[] {
  return [
    {
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.1,
      originalText: 'こんにちは',
      translatedText: '你好',
    },
    {
      x: 0.5,
      y: 0.3,
      width: 0.4,
      height: 0.15,
      originalText: 'ありがとう',
      translatedText: '谢谢',
    },
  ];
}

// Valid API key format (at least 20 characters)
const MOCK_API_KEY = 'sk-test-mock-api-key-12345678901234567890';

function createMockTransport(
  implementation: TranslationTransport['translateImage']
): TranslationTransport {
  return {
    translateImage: vi.fn(implementation),
  };
}

// ==================== Integration Tests ====================

describe('Integration Tests: Complete Translation Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTranslator();
    resetRenderer();
    useAppConfigStore.getState().resetToDefaults();
    useTranslationCacheStore.getState().clear();
    resetDefaultTranslationTransport();
    
    // Mock canvas for image processing
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mockBase64Data');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDefaultTranslationTransport();
  });

  describe('Full Translation Pipeline', () => {
    it('should complete full translation flow: image → process → translate → render', async () => {
      // Setup
      const mockTextAreas = createMockTextAreas();
      const transport = createMockTransport(async () => ({
        success: true,
        textAreas: mockTextAreas,
      }));
      setDefaultTranslationTransport(transport);
      
      // Configure store
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      useAppConfigStore.getState().setTargetLanguage('zh-CN');
      
      // Create translator and renderer
      const translator = createTranslatorFromConfig();
      const renderer = new OverlayRenderer();
      
      // Create mock image
      const img = createMockImage();
      document.body.appendChild(img);
      
      // Execute translation
      const result = await translator.translateImage(img);
      
      // Verify translation result
      expect(result.success).toBe(true);
      expect(result.textAreas).toHaveLength(2);
      expect(result.textAreas[0]?.translatedText).toBe('你好');
      
      // Render overlays
      const wrapper = renderer.render(img, result.textAreas);
      
      // Verify rendering
      expect(wrapper).toBeDefined();
      expect(renderer.hasOverlays(img)).toBe(true);
      expect(renderer.getOverlayCount()).toBe(1);
      
      // Cleanup
      renderer.removeAll();
      // Clean up DOM - wrapper may have been removed, so check parent
      if (img.parentElement) {
        img.parentElement.removeChild(img);
      }
    });

    it('should use cache for repeated translations', async () => {
      // Setup
      const mockTextAreas = createMockTextAreas();
      const transport = createMockTransport(async () => ({
        success: true,
        textAreas: mockTextAreas,
      }));
      setDefaultTranslationTransport(transport);
      
      // Configure store with caching enabled
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      useAppConfigStore.getState().setCacheEnabled(true);
      
      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      
      // First translation - should call API
      const result1 = await translator.translateImage(img);
      expect(result1.success).toBe(true);
      expect(transport.translateImage).toHaveBeenCalled();
      
      const callCount = vi.mocked(transport.translateImage).mock.calls.length;
      
      // Second translation - should use cache
      const result2 = await translator.translateImage(img);
      expect(result2.success).toBe(true);
      expect(result2.cached).toBe(true);
      expect(vi.mocked(transport.translateImage).mock.calls.length).toBe(callCount);
    });

    it('should handle empty text areas gracefully', async () => {
      // Setup with empty response
      setDefaultTranslationTransport(
        createMockTransport(async () => ({
          success: true,
          textAreas: [],
        }))
      );
      
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      const translator = createTranslatorFromConfig();
      const renderer = new OverlayRenderer();
      const img = createMockImage();
      
      // Execute translation
      const result = await translator.translateImage(img);
      
      // Verify result
      expect(result.success).toBe(true);
      expect(result.textAreas).toHaveLength(0);
      
      // Render should not create overlays for empty results
      const wrapper = renderer.render(img, result.textAreas);
      expect(wrapper).toBeDefined();
      expect(renderer.getOverlayCount()).toBe(0);
    });

    it('should use server mode without requiring provider api key', async () => {
      const mockTextAreas = createMockTextAreas();
      const transport = createMockTransport(async request => {
        expect(request.executionMode).toBe('server');
        expect(request.server?.baseUrl).toBe('http://127.0.0.1:8000');
        return {
          success: true,
          textAreas: mockTextAreas,
          pipeline: 'ocr-first',
          cached: false,
        };
      });
      setDefaultTranslationTransport(transport);

      const store = useAppConfigStore.getState();
      store.setExecutionMode('server');
      store.updateServerConfig({
        enabled: true,
        baseUrl: 'http://127.0.0.1:8000',
        authToken: 'token',
        timeoutMs: 30000,
      });

      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      const result = await translator.translateImage(img);

      expect(result.success).toBe(true);
      expect(result.textAreas).toHaveLength(2);
      expect(transport.translateImage).toHaveBeenCalledOnce();
    });
  });

  describe('Multi-Provider Switching', () => {
    it('should switch between OpenAI and Claude providers', async () => {
      const mockTextAreas = createMockTextAreas();
      setDefaultTranslationTransport(
        createMockTransport(async () => ({
          success: true,
          textAreas: mockTextAreas,
        }))
      );
      
      // Test OpenAI
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      let translator = createTranslatorFromConfig();
      expect(translator.getConfig().provider).toBe('openai');
      
      // Switch to Claude
      useAppConfigStore.getState().setProvider('claude');
      useAppConfigStore.getState().setProviderApiKey('claude', MOCK_API_KEY);
      
      translator = createTranslatorFromConfig();
      expect(translator.getConfig().provider).toBe('claude');
    });

    it('should switch between cloud and local (Ollama) providers', async () => {
      // Test cloud provider (OpenAI)
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      let config = useAppConfigStore.getState();
      expect(config.provider).toBe('openai');
      expect(config.isProviderConfigured('openai')).toBe(true);
      
      // Switch to Ollama (local)
      useAppConfigStore.getState().setProvider('ollama');
      useAppConfigStore.getState().updateProviderSettings('ollama', {
        baseUrl: 'http://localhost:11434',
        model: 'llava',
      });
      
      config = useAppConfigStore.getState();
      expect(config.provider).toBe('ollama');
      expect(config.isProviderConfigured('ollama')).toBe(true);
    });

    it('should validate provider configuration before translation', async () => {
      // Test without API key
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', '');
      
      const config = useAppConfigStore.getState();
      expect(config.isProviderConfigured('openai')).toBe(false);
      
      // Test with API key
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      expect(useAppConfigStore.getState().isProviderConfigured('openai')).toBe(true);
    });

    it('should handle provider-specific configurations', () => {
      const providers: ProviderType[] = ['openai', 'claude', 'deepseek', 'ollama'];
      
      providers.forEach(provider => {
        useAppConfigStore.getState().setProvider(provider);
        
        if (provider === 'ollama') {
          useAppConfigStore.getState().updateProviderSettings(provider, {
            baseUrl: 'http://localhost:11434',
            model: 'llava',
          });
        } else {
          useAppConfigStore.getState().setProviderApiKey(provider, MOCK_API_KEY);
        }
        
        const settings = useAppConfigStore.getState().getActiveProviderSettings();
        expect(settings).toBeDefined();
        
        if (provider === 'ollama') {
          expect(settings.baseUrl).toBe('http://localhost:11434');
        } else {
          expect(settings.apiKey).toBe(MOCK_API_KEY);
        }
      });
    });
  });

  describe('Ollama Local Connection', () => {
    it('should connect to local Ollama service', async () => {
      setDefaultTranslationTransport(
        createMockTransport(async () => ({
          success: true,
          textAreas: createMockTextAreas(),
        }))
      );
      
      useAppConfigStore.getState().setProvider('ollama');
      useAppConfigStore.getState().updateProviderSettings('ollama', {
        baseUrl: 'http://localhost:11434',
        model: 'llava',
      });
      
      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      
      const result = await translator.translateImage(img);
      
      expect(result.success).toBe(true);
      expect(result.textAreas).toHaveLength(2);
    });

    it('should handle Ollama service not running', async () => {
      setDefaultTranslationTransport(
        createMockTransport(async () => {
          throw new Error('Connection refused');
        })
      );
      
      useAppConfigStore.getState().setProvider('ollama');
      useAppConfigStore.getState().updateProviderSettings('ollama', {
        baseUrl: 'http://localhost:11434',
        model: 'llava',
      });
      
      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      
      const result = await translator.translateImage(img);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle missing Ollama model', async () => {
      setDefaultTranslationTransport(
        createMockTransport(async () => ({
          success: false,
          error: 'model not found',
        }))
      );
      
      useAppConfigStore.getState().setProvider('ollama');
      useAppConfigStore.getState().updateProviderSettings('ollama', {
        baseUrl: 'http://localhost:11434',
        model: 'nonexistent-model',
      });
      
      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      
      const result = await translator.translateImage(img);
      
      expect(result.success).toBe(false);
    });

    it('should support custom Ollama base URL', () => {
      const customUrl = 'http://192.168.1.100:11434';
      
      useAppConfigStore.getState().setProvider('ollama');
      useAppConfigStore.getState().updateProviderSettings('ollama', {
        baseUrl: customUrl,
        model: 'llava',
      });
      
      const settings = useAppConfigStore.getState().getActiveProviderSettings();
      expect(settings.baseUrl).toBe(customUrl);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle API errors gracefully', async () => {
      setDefaultTranslationTransport(
        createMockTransport(async () => ({
          success: false,
          error: 'Invalid API key',
        }))
      );
      
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      
      const result = await translator.translateImage(img);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle network errors', async () => {
      // Network errors are retryable, so this test needs longer timeout
      // Retry: 3 attempts with exponential backoff (2s + 4s + 8s = ~14s)
      setDefaultTranslationTransport(
        createMockTransport(async () => {
          throw new Error('Network error');
        })
      );
      
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      
      const result = await translator.translateImage(img);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle malformed API responses', async () => {
      setDefaultTranslationTransport(
        createMockTransport(async () => ({
          success: false,
          error: 'Failed to parse Vision LLM response: not valid json',
        }))
      );
      
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      const translator = createTranslatorFromConfig();
      const img = createMockImage();
      
      const result = await translator.translateImage(img);
      
      expect(result.success).toBe(false);
    });
  });

  describe('Singleton Management', () => {
    it('should reuse translator instance', () => {
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      const translator1 = getTranslator();
      const translator2 = getTranslator();
      
      expect(translator1).toBe(translator2);
    });

    it('should create new instance when forced', () => {
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      const translator1 = getTranslator();
      const translator2 = getTranslator(true);
      
      expect(translator1).not.toBe(translator2);
    });

    it('should reset translator on config change', () => {
      useAppConfigStore.getState().setProvider('openai');
      useAppConfigStore.getState().setProviderApiKey('openai', MOCK_API_KEY);
      
      const translator1 = getTranslator();
      resetTranslator();
      const translator2 = getTranslator();
      
      expect(translator1).not.toBe(translator2);
    });

    it('should reuse renderer instance', () => {
      const renderer1 = getRenderer();
      const renderer2 = getRenderer();
      
      expect(renderer1).toBe(renderer2);
    });
  });
});

describe('Integration Tests: Image Processing', () => {
  beforeEach(() => {
    // Mock canvas
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mockBase64Data');
  });

  it('should compress large images', () => {
    const largeImg = createMockImage(4000, 3000);
    
    const result = compressImage(largeImg, 1920);
    
    expect(result.wasCompressed).toBe(true);
    expect(result.width).toBeLessThanOrEqual(1920);
    expect(result.height).toBeLessThanOrEqual(1920);
  });

  it('should not compress small images', () => {
    const smallImg = createMockImage(800, 600);
    
    const result = compressImage(smallImg, 1920);
    
    expect(result.wasCompressed).toBe(false);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('should calculate consistent hash for same image', async () => {
    const hash1 = await calculateHash('test-image-data');
    const hash2 = await calculateHash('test-image-data');
    
    expect(hash1).toBe(hash2);
  });

  it('should calculate different hash for different images', async () => {
    const hash1 = await calculateHash('image-data-1');
    const hash2 = await calculateHash('image-data-2');
    
    expect(hash1).not.toBe(hash2);
  });
});

describe('Integration Tests: Overlay Rendering', () => {
  let renderer: OverlayRenderer;
  
  beforeEach(() => {
    renderer = new OverlayRenderer();
  });

  afterEach(() => {
    renderer.removeAll();
  });

  it('should render overlays at correct positions', () => {
    const img = createMockImage(800, 600);
    document.body.appendChild(img);
    
    const textAreas: TextArea[] = [
      { x: 0.1, y: 0.2, width: 0.3, height: 0.1, originalText: 'test', translatedText: '测试' },
    ];
    
    const wrapper = renderer.render(img, textAreas);
    const overlay = wrapper.querySelector('.manga-translator-overlay') as HTMLElement;
    
    expect(overlay).toBeDefined();
    expect(parseFloat(overlay.style.left)).toBeGreaterThanOrEqual(80);
    expect(parseFloat(overlay.style.top)).toBeGreaterThanOrEqual(120);
    expect(parseFloat(overlay.style.left) + parseFloat(overlay.style.width))
      .toBeLessThanOrEqual(320);
    expect(parseFloat(overlay.style.top) + parseFloat(overlay.style.height))
      .toBeLessThanOrEqual(180);
    
    document.body.removeChild(wrapper);
  });

  it('should remove all overlays when requested', () => {
    const img1 = createMockImage(800, 600, 'img1.jpg');
    const img2 = createMockImage(800, 600, 'img2.jpg');
    document.body.appendChild(img1);
    document.body.appendChild(img2);
    
    const textAreas = createMockTextAreas();
    
    renderer.render(img1, textAreas);
    renderer.render(img2, textAreas);
    
    expect(renderer.getOverlayCount()).toBe(2);
    
    renderer.removeAll();
    
    expect(renderer.getOverlayCount()).toBe(0);
    
    // Cleanup
    document.body.innerHTML = '';
  });

  it('should update overlay style', () => {
    renderer.updateStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      textColor: '#ffffff',
    });
    
    const style = renderer.getStyle();
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0.8)');
    expect(style.textColor).toBe('#ffffff');
  });
});
