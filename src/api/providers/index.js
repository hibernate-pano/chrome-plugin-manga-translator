import { ProviderFactory } from '../provider-factory';
import { OpenAIProvider } from './openai-provider';
import { DeepSeekProvider } from './deepseek-provider';
import { ClaudeProvider } from './claude-provider';
import { QwenProvider } from './qwen-provider';

// 注册所有提供者
ProviderFactory.registerProvider('openai', OpenAIProvider);
ProviderFactory.registerProvider('deepseek', DeepSeekProvider);
ProviderFactory.registerProvider('claude', ClaudeProvider);
ProviderFactory.registerProvider('qwen', QwenProvider);

// 后续可以添加更多提供者
// ProviderFactory.registerProvider('anthropic', ClaudeProvider);
// ProviderFactory.registerProvider('openrouter', OpenRouterProvider);

export default ProviderFactory; 