import { describe, expect, it } from 'vitest';
import {
  getActiveTabSupport,
  getConfigurationNextStep,
  isExecutionModeConfigured,
} from './product-readiness';
import type { ProvidersConfig, ServerConfig } from '@/stores/config-v2';

const providers: ProvidersConfig = {
  siliconflow: {
    apiKey: 'sk-demo',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-32B-Instruct',
  },
  dashscope: {
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max',
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  claude: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    model: 'llava',
  },
};

const server: ServerConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:8000',
  authToken: '',
  timeoutMs: 30000,
};

describe('getActiveTabSupport', () => {
  it('accepts regular web pages', () => {
    expect(getActiveTabSupport('https://example.com/chapter/1')).toMatchObject({
      supported: true,
      hostLabel: 'example.com',
    });
  });

  it('blocks browser internal pages', () => {
    expect(getActiveTabSupport('chrome://extensions')).toMatchObject({
      supported: false,
      hostLabel: 'chrome',
    });
  });

  it('keeps file pages supported with guidance', () => {
    expect(getActiveTabSupport('file:///tmp/demo.png')).toMatchObject({
      supported: true,
      hostLabel: '本地文件',
    });
  });
});

describe('isExecutionModeConfigured', () => {
  it('treats server mode as ready when base url exists', () => {
    expect(
      isExecutionModeConfigured('server', server, 'siliconflow', providers)
    ).toBe(true);
  });

  it('requires api key for cloud providers in direct mode', () => {
    expect(
      isExecutionModeConfigured('provider-direct', server, 'siliconflow', providers)
    ).toBe(true);
    expect(
      isExecutionModeConfigured('provider-direct', server, 'openai', providers)
    ).toBe(false);
  });

  it('only requires base url for ollama in direct mode', () => {
    expect(
      isExecutionModeConfigured('provider-direct', server, 'ollama', providers)
    ).toBe(true);
  });
});

describe('getConfigurationNextStep', () => {
  it('guides server users to fill base url first', () => {
    expect(
      getConfigurationNextStep(
        'server',
        { ...server, baseUrl: '' },
        'siliconflow',
        providers
      )
    ).toContain('填写服务端地址');
  });

  it('guides direct cloud users to set api key first', () => {
    expect(
      getConfigurationNextStep('provider-direct', server, 'openai', providers)
    ).toContain('填写 API Key');
  });
});
