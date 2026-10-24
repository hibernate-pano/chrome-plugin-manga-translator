import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticsBundle,
  formatDiagnosticsBundle,
  looksLikeSecret,
  type DiagnosticsInput,
} from './diagnostics';

const BASE: DiagnosticsInput = {
  version: '2.0.4',
  provider: 'openai-compatible',
  providerLabel: 'MiniMax',
  model: 'MiniMax-M3',
  targetLanguage: 'zh-CN',
  translationStylePreset: 'natural-zh',
  hasApiKey: true,
  maxImageSize: 1024,
  parallelLimit: 3,
  cacheEnabled: true,
  usage: {
    translations: 12,
    billableCalls: 9,
    tokens: 1234,
    cacheHitRate: 25,
  },
  lastError: '请求超时',
};

describe('buildDiagnosticsBundle', () => {
  it('reports the settings a support question needs', () => {
    const bundle = buildDiagnosticsBundle(BASE);
    expect(bundle.version).toBe('2.0.4');
    expect(bundle.provider.service).toBe('MiniMax');
    expect(bundle.provider.model).toBe('MiniMax-M3');
    expect(bundle.provider.hasApiKey).toBe(true);
    expect(bundle.translation.targetLanguage).toBe('zh-CN');
    expect(bundle.usage.billableCalls).toBe(9);
  });

  /**
   * The whole point of the bundle is that it is safe to paste into a public
   * issue tracker. It must never carry the key.
   */
  it('never includes the API key, only whether one was found', () => {
    const bundle = buildDiagnosticsBundle(BASE);
    expect(Object.keys(bundle.provider)).not.toContain('apiKey');
    expect(bundle.provider.hasApiKey).toBe(true);
  });

  it('never includes the endpoint URL', () => {
    const bundle = buildDiagnosticsBundle({
      ...BASE,
      providerLabel: 'MiniMax',
    });
    expect(formatDiagnosticsBundle(bundle)).not.toContain('minimaxi.com');
  });

  /**
   * A self-hosted gateway is named by its host in the settings page — that is
   * how the user knows which machine receives their images. The bundle is a
   * different audience: it gets pasted into a public issue tracker, where
   * `gateway.mycorp.internal` identifies the reporter's employer and says
   * nothing about the bug.
   */
  it('never carries a self-hosted hostname into the bundle', () => {
    const bundle = buildDiagnosticsBundle({
      ...BASE,
      providerLabel: 'gateway.mycorp.internal',
    });
    const text = formatDiagnosticsBundle(bundle);
    expect(text).not.toContain('mycorp.internal');
    expect(text).not.toContain('gateway');
    // The shape of the endpoint is still worth reporting.
    expect(bundle.provider.service).toBe('OpenAI 兼容（自建端点）');
  });

  it('keeps the name of a service the user recognises', () => {
    // The service name is what a support answer needs, and it says nothing
    // about the reporter.
    const bundle = buildDiagnosticsBundle({
      ...BASE,
      providerLabel: 'MiniMax',
    });
    expect(bundle.provider.service).toBe('MiniMax');
  });

  it('drops a last error that carries a credential', () => {
    const bundle = buildDiagnosticsBundle({
      ...BASE,
      lastError: '请求失败：sk-cp-abcdef123456789',
    });
    expect(bundle.lastError).toBeNull();
  });

  it('keeps an ordinary last error', () => {
    const bundle = buildDiagnosticsBundle(BASE);
    expect(bundle.lastError).toBe('请求超时');
  });

  it('handles a missing last error', () => {
    const bundle = buildDiagnosticsBundle({ ...BASE, lastError: null });
    expect(bundle.lastError).toBeNull();
  });
});

describe('looksLikeSecret', () => {
  it('flags the stored form of a key', () => {
    expect(looksLikeSecret('obf:0a1b2c3d')).toBe(true);
  });

  it('flags a bearer header', () => {
    expect(looksLikeSecret('Authorization: Bearer abcdef123456')).toBe(true);
  });

  it('flags a provider key prefix', () => {
    expect(looksLikeSecret('sk-cp-1234567890abcdef')).toBe(true);
    expect(looksLikeSecret('AIzaSyA1234567890abcdefgh')).toBe(true);
  });

  it('flags a long hex blob', () => {
    expect(looksLikeSecret('a'.repeat(40))).toBe(true);
  });

  it('flags an endpoint address', () => {
    // The diagnostics bundle promises 「不含 API Key、接口地址」. A self
    // hosted gateway lives on an intranet host, and that hostname is
    // exactly the kind of thing the user does not want pasted into a
    // support thread — so the guard has to catch it, not the caller's
    // good manners.
    expect(looksLikeSecret('https://intranet.example.com/v1')).toBe(true);
    expect(looksLikeSecret('http://192.168.1.10:11434')).toBe(true);
  });

  it('does not flag ordinary error text', () => {
    expect(looksLikeSecret('请求超时，请检查网络')).toBe(false);
    expect(looksLikeSecret('Model not found')).toBe(false);
    expect(looksLikeSecret('图片尺寸过小')).toBe(false);
  });
});

describe('formatDiagnosticsBundle', () => {
  it('produces readable JSON', () => {
    const text = formatDiagnosticsBundle(buildDiagnosticsBundle(BASE));
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).toContain('"version": "2.0.4"');
  });
});
