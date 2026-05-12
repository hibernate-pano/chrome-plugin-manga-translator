import type { ProviderType } from '@/providers/base';
import type { ProvidersConfig } from '@/stores/config-v2';

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

export function isProviderConfigured(
  provider: ProviderType,
  providers: ProvidersConfig
): boolean {
  const settings = providers[provider];
  if (provider === 'ollama') {
    return !!settings.baseUrl.trim();
  }

  return !!settings.apiKey.trim();
}

export function getConfigurationNextStep(
  provider: ProviderType,
  providers: ProvidersConfig
): string {
  if (provider === 'ollama') {
    return providers.ollama.baseUrl.trim()
      ? '先确认 Ollama 里有可用视觉模型，再开始本地直连翻译。'
      : '先填写 Ollama 地址，再拉取一个视觉模型。';
  }

  return providers[provider].apiKey.trim()
    ? 'OpenAI-compatible 直连已就绪，可以直接开始翻译。'
    : '先填写 OpenAI-compatible API Key，启用直连翻译。';
}
