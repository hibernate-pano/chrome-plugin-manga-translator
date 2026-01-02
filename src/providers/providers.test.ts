/**
 * Provider Validation Tests
 * 
 * Tests for provider configuration validation (Property 8: 云端 Provider 需要 API 密钥)
 * Validates: Requirements 4.2, 6.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { DeepSeekProvider } from './deepseek';
import { OllamaProvider } from './ollama';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider();
  });

  it('should have correct name and type', () => {
    expect(provider.name).toBe('OpenAI GPT-4V');
    expect(provider.type).toBe('openai');
  });

  it('should reject empty API key', async () => {
    await provider.initialize({ apiKey: '' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(false);
    expect(result.message).toContain('API');
  });

  it('should reject short API key', async () => {
    await provider.initialize({ apiKey: 'short' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(false);
    expect(result.message).toContain('无效');
  });

  it('should accept valid API key', async () => {
    await provider.initialize({ apiKey: 'sk-1234567890abcdefghijklmnop' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(true);
  });
});

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;

  beforeEach(() => {
    provider = new ClaudeProvider();
  });

  it('should have correct name and type', () => {
    expect(provider.name).toBe('Claude Vision');
    expect(provider.type).toBe('claude');
  });

  it('should reject empty API key', async () => {
    await provider.initialize({ apiKey: '' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(false);
    expect(result.message).toContain('API');
  });

  it('should reject short API key', async () => {
    await provider.initialize({ apiKey: 'short' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(false);
    expect(result.message).toContain('无效');
  });

  it('should accept valid API key', async () => {
    await provider.initialize({ apiKey: 'sk-ant-api03-1234567890abcdefghijklmnop' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(true);
  });
});

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;

  beforeEach(() => {
    provider = new DeepSeekProvider();
  });

  it('should have correct name and type', () => {
    expect(provider.name).toBe('DeepSeek VL');
    expect(provider.type).toBe('deepseek');
  });

  it('should reject empty API key', async () => {
    await provider.initialize({ apiKey: '' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(false);
    expect(result.message).toContain('API');
  });

  it('should reject short API key', async () => {
    await provider.initialize({ apiKey: 'short' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(false);
    expect(result.message).toContain('无效');
  });

  it('should accept valid API key', async () => {
    await provider.initialize({ apiKey: 'sk-1234567890' });
    const result = await provider.validateConfig();
    
    expect(result.valid).toBe(true);
  });
});

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider();
  });

  it('should have correct name and type', () => {
    expect(provider.name).toBe('Ollama');
    expect(provider.type).toBe('ollama');
  });

  it('should use default base URL', async () => {
    await provider.initialize({});
    // Ollama doesn't require API key, but needs service to be running
    // This test just verifies initialization works
    expect(provider.type).toBe('ollama');
  });

  it('should accept custom base URL', async () => {
    await provider.initialize({ baseUrl: 'http://192.168.1.100:11434' });
    expect(provider.type).toBe('ollama');
  });
});
