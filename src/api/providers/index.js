import { ProviderFactory } from '../provider-factory';
import { OpenAIProvider } from './openai-provider';
import { DeepSeekProvider } from './deepseek-provider';
import { ClaudeProvider } from './claude-provider';
import { QwenProvider } from './qwen-provider';

// 注册所有提供者
console.log('[Providers] 开始注册 Provider...');

ProviderFactory.registerProvider('openai', OpenAIProvider);
console.log('[Providers] 已注册: openai');

ProviderFactory.registerProvider('deepseek', DeepSeekProvider);
console.log('[Providers] 已注册: deepseek');

ProviderFactory.registerProvider('claude', ClaudeProvider);
console.log('[Providers] 已注册: claude');

ProviderFactory.registerProvider('qwen', QwenProvider);
console.log('[Providers] 已注册: qwen');

console.log('[Providers] Provider 注册完成，已注册:', ProviderFactory.getRegisteredProviders());

// 后续可以添加更多提供者
// ProviderFactory.registerProvider('anthropic', ClaudeProvider);
// ProviderFactory.registerProvider('openrouter', OpenRouterProvider);

export default ProviderFactory; 