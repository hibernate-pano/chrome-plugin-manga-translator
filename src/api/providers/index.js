import { ProviderFactory } from '../provider-factory';
import { OpenAIProvider } from './openai-provider';

// 注册所有提供者
ProviderFactory.registerProvider('openai', OpenAIProvider);

// 后续可以添加更多提供者
// ProviderFactory.registerProvider('deepseek', DeepSeekProvider);
// ProviderFactory.registerProvider('anthropic', ClaudeProvider);
// ProviderFactory.registerProvider('openrouter', OpenRouterProvider);

export default ProviderFactory; 