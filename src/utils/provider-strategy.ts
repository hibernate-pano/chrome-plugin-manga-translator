import type { ProviderType } from '@/providers/base';

export interface ProviderStrategy {
  lane: 'direct-cloud' | 'private';
  recommendation: string;
  tradeoff: string;
  suggestedModel: string;
  fallbackAdvice: string;
  speedLabel: '快' | '中' | '慢';
  qualityLabel: '高' | '中高' | '中';
  costLabel: '低' | '中' | '高' | '本地';
}

const PROVIDER_STRATEGY: Record<ProviderType, ProviderStrategy> = {
  'openai-compatible': {
    lane: 'direct-cloud',
    recommendation: '适合希望统一接入兼容 OpenAI 接口视觉模型的用户。',
    tradeoff: '灵活度高，但质量和成本更依赖你填写的端点与模型。',
    suggestedModel: 'gpt-4o',
    fallbackAdvice: '结果不理想时优先换模型，或者切到 Ollama 本地模型。',
    speedLabel: '中',
    qualityLabel: '高',
    costLabel: '高',
  },
  ollama: {
    lane: 'private',
    recommendation: '适合隐私优先或离线环境用户。',
    tradeoff: '本地自由度高，但模型和机器配置决定上限。',
    suggestedModel: 'llava',
    fallbackAdvice: '本地效果不稳时，先换更强视觉模型，或改用 OpenAI-compatible 直连。',
    speedLabel: '慢',
    qualityLabel: '中',
    costLabel: '本地',
  },
};

const PROVIDER_PRICING: Record<ProviderType, { input: number; output: number }> =
  {
    'openai-compatible': { input: 0.005, output: 0.015 },
    ollama: { input: 0, output: 0 },
  };

export function getProviderStrategy(provider: ProviderType): ProviderStrategy {
  return PROVIDER_STRATEGY[provider];
}

export function estimateProviderCost(
  provider: ProviderType,
  averageTokensPerImage: number,
  images: number
): number {
  const pricing = PROVIDER_PRICING[provider];
  if (!pricing) {
    return 0;
  }

  const promptTokens = averageTokensPerImage * 0.65;
  const completionTokens = averageTokensPerImage * 0.35;
  const singleImageCost =
    (promptTokens / 1000) * pricing.input +
    (completionTokens / 1000) * pricing.output;

  return singleImageCost * images;
}
