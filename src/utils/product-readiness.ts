import type { ProviderType } from '@/providers/base';
import type { ProvidersConfig, ServerConfig } from '@/stores/config-v2';

export interface ActiveTabSupport {
  supported: boolean;
  hostLabel: string;
  reason: string;
  advice: string;
}

const RESTRICTED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'moz-extension://',
  'vivaldi://',
];

export function getActiveTabSupport(url?: string): ActiveTabSupport {
  if (!url) {
    return {
      supported: false,
      hostLabel: '未检测到页面',
      reason: '还没有拿到当前标签页信息。',
      advice: '请先打开一个漫画网页，再点击插件。',
    };
  }

  const matchedPrefix = RESTRICTED_URL_PREFIXES.find(prefix =>
    url.startsWith(prefix)
  );

  if (matchedPrefix) {
    return {
      supported: false,
      hostLabel: matchedPrefix.replace('://', '').replace(':', ''),
      reason: '浏览器内部页面无法注入内容脚本。',
      advice: '请切换到普通网页中的漫画页面后再试。',
    };
  }

  if (url.startsWith('file://')) {
    return {
      supported: true,
      hostLabel: '本地文件',
      reason: '当前页面理论上可用。',
      advice: '如果无法翻译，请到扩展详情里开启“允许访问文件网址”。',
    };
  }

  try {
    const parsed = new URL(url);
    return {
      supported: true,
      hostLabel: parsed.host || parsed.protocol.replace(':', ''),
      reason: '当前页面支持注入。',
      advice: '页面打开后即可直接开始翻译。',
    };
  } catch {
    return {
      supported: true,
      hostLabel: '当前网页',
      reason: '当前页面支持注入。',
      advice: '页面打开后即可直接开始翻译。',
    };
  }
}

export function isExecutionModeConfigured(
  executionMode: 'server' | 'provider-direct',
  server: ServerConfig,
  provider: ProviderType,
  providers: ProvidersConfig
): boolean {
  if (executionMode === 'server') {
    return server.enabled && !!server.baseUrl.trim();
  }

  const settings = providers[provider];
  if (provider === 'ollama') {
    return !!settings.baseUrl.trim();
  }

  return !!settings.apiKey.trim();
}

export function getConfigurationNextStep(
  executionMode: 'server' | 'provider-direct',
  server: ServerConfig,
  provider: ProviderType,
  providers: ProvidersConfig
): string {
  if (executionMode === 'server') {
    return server.baseUrl.trim()
      ? '先测试服务端连接，再回到漫画页面点击翻译。'
      : '先填写服务端地址，再测试连接。';
  }

  if (provider === 'ollama') {
    return providers.ollama.baseUrl.trim()
      ? '先确认 Ollama 里有视觉模型，再开始翻译。'
      : '先填写 Ollama 地址，再拉取一个视觉模型。';
  }

  return providers[provider].apiKey.trim()
    ? '建议先测试 Provider 连接，再开始翻译。'
    : '先填写 API Key，再测试连接。';
}
