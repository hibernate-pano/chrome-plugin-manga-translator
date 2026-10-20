import { describe, expect, it } from 'vitest';

import { detectServiceName, getProviderLabel } from './provider-label';

describe('detectServiceName', () => {
  it('recognises the services the extension ships with', () => {
    expect(detectServiceName('https://api.minimaxi.com/v1')).toBe('MiniMax');
    expect(detectServiceName('https://api.deepseek.com/v1')).toBe('DeepSeek');
    expect(detectServiceName('https://api.openai.com/v1')).toBe('OpenAI');
  });

  it('accepts an endpoint with no scheme', () => {
    expect(detectServiceName('api.minimaxi.com/v1')).toBe('MiniMax');
  });

  it('does not match a look-alike host', () => {
    // A host that merely contains the name is not that service. Treating
    // "evil-minimaxi.com" as MiniMax would tell the user their key is going
    // to MiniMax when it is not.
    expect(detectServiceName('https://notminimaxi.com/v1')).toBeNull();
    expect(detectServiceName('https://minimaxi.com.evil.test/v1')).toBeNull();
    expect(detectServiceName('https://evil.test/minimaxi.com/v1')).toBeNull();
  });

  it('matches a subdomain of a known service', () => {
    expect(detectServiceName('https://eu.api.deepseek.com/v1')).toBe(
      'DeepSeek'
    );
  });

  it('returns null for an unrecognised gateway', () => {
    expect(detectServiceName('https://llm.internal.corp/v1')).toBeNull();
  });

  it('returns null for an empty or broken endpoint', () => {
    expect(detectServiceName('')).toBeNull();
    expect(detectServiceName('   ')).toBeNull();
    expect(detectServiceName('http://')).toBeNull();
  });
});

describe('getProviderLabel', () => {
  it('names the local providers after themselves', () => {
    expect(
      getProviderLabel({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
      })
    ).toBe('Ollama');
    expect(
      getProviderLabel({
        provider: 'lm-studio',
        baseUrl: 'http://localhost:1234/v1',
      })
    ).toBe('LM Studio');
  });

  it('names the hosted service behind the OpenAI-compatible slot', () => {
    // The point of the label: the user recognises this name from their
    // bill, and "OpenAI-compatible" does not appear on it.
    expect(
      getProviderLabel({
        provider: 'openai-compatible',
        baseUrl: 'https://api.minimaxi.com/v1',
      })
    ).toBe('MiniMax');
  });

  it('falls back to the host for a self-hosted gateway', () => {
    // Naming the protocol would hide which machine the images are sent to.
    expect(
      getProviderLabel({
        provider: 'openai-compatible',
        baseUrl: 'https://llm.internal.corp/v1',
      })
    ).toBe('llm.internal.corp');
  });

  it('drops a leading www from the host fallback', () => {
    expect(
      getProviderLabel({
        provider: 'openai-compatible',
        baseUrl: 'https://www.mygateway.test/v1',
      })
    ).toBe('mygateway.test');
  });

  it('falls back to the generic name when nothing is configured', () => {
    expect(
      getProviderLabel({ provider: 'openai-compatible', baseUrl: '' })
    ).toBe('OpenAI-compatible');
  });
});
