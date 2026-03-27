import type { ProviderType } from '@/providers/base';

export interface ProviderStrategy {
  lane: 'balanced' | 'premium' | 'budget' | 'private' | 'compat';
  recommendation: string;
  tradeoff: string;
  suggestedModel: string;
  fallbackAdvice: string;
  speedLabel: '快' | '中' | '慢';
  qualityLabel: '高' | '中高' | '中';
  costLabel: '低' | '中' | '高' | '本地';
}

const PROVIDER_STRATEGY: Record<ProviderType, ProviderStrategy> = {
  siliconflow: {
    lane: 'balanced',
    recommendation: '默认主力方案，适合大多数中文漫画用户。',
    tradeoff: '速度、价格、质量比较均衡。',
    suggestedModel: 'Qwen/Qwen2.5-VL-32B-Instruct',
    fallbackAdvice: '连续失败时优先切到服务端 OCR-First 或 Ollama 本地模型。',
    speedLabel: '快',
    qualityLabel: '中高',
    costLabel: '低',
  },
  dashscope: {
    lane: 'compat',
    recommendation: '适合希望用阿里生态、兼顾稳定性的用户。',
    tradeoff: '质量稳定，但成本通常略高于硅基流动。',
    suggestedModel: 'qwen-vl-max',
    fallbackAdvice: '如果大图或长页不稳，建议切服务端模式。',
    speedLabel: '中',
    qualityLabel: '中高',
    costLabel: '中',
  },
  openai: {
    lane: 'premium',
    recommendation: '适合追求理解质量和复杂页面鲁棒性的用户。',
    tradeoff: '质量高，但成本明显更高。',
    suggestedModel: 'gpt-4o',
    fallbackAdvice: '预算敏感时回退到硅基流动；失败率高时切服务端模式。',
    speedLabel: '中',
    qualityLabel: '高',
    costLabel: '高',
  },
  claude: {
    lane: 'premium',
    recommendation: '适合看重语义理解、语气保真的用户。',
    tradeoff: '质量高，但吞吐和成本都偏重。',
    suggestedModel: 'claude-sonnet-4-20250514',
    fallbackAdvice: '大批量翻译时建议改成硅基流动或服务端模式。',
    speedLabel: '中',
    qualityLabel: '高',
    costLabel: '高',
  },
  deepseek: {
    lane: 'budget',
    recommendation: '适合对成本更敏感、愿意接受少量质量波动的用户。',
    tradeoff: '便宜，但复杂场景稳定性通常不如头部方案。',
    suggestedModel: 'deepseek-chat',
    fallbackAdvice: '如果对白框复杂或漏字偏多，切到硅基流动或服务端模式。',
    speedLabel: '快',
    qualityLabel: '中',
    costLabel: '低',
  },
  ollama: {
    lane: 'private',
    recommendation: '适合隐私优先或离线环境用户。',
    tradeoff: '本地自由度高，但模型和机器配置决定上限。',
    suggestedModel: 'llava',
    fallbackAdvice: '本地效果不稳时，先换更强视觉模型，再考虑服务端模式。',
    speedLabel: '慢',
    qualityLabel: '中',
    costLabel: '本地',
  },
};

const PROVIDER_PRICING: Record<ProviderType, { input: number; output: number }> =
  {
    siliconflow: { input: 0.001, output: 0.002 },
    dashscope: { input: 0.0015, output: 0.002 },
    openai: { input: 0.005, output: 0.015 },
    claude: { input: 0.003, output: 0.015 },
    deepseek: { input: 0.00027, output: 0.0011 },
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
