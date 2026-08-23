/**
 * Pre-configured provider presets for personal use.
 *
 * API keys are read from the gitignored env-config.generated.ts which is
 * regenerated from .env by scripts/inject-env-config.mjs at build time.
 * The keys never live in source control.
 *
 * Primary (default): MiniMax M3  —  ENV_CONFIG.minimax
 * Backup:            OpenCode · DeepSeek V4 Flash — ENV_CONFIG.opencode
 */
import type { ProviderType } from '@/providers/base';
import type { ProviderSettings } from './app-config';
import { ENV_CONFIG } from './env-config';

export interface ProviderPreset {
  id: string;
  provider: ProviderType;
  label: string;
  description: string;
  note?: string;
  settings: ProviderSettings;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'minimax-m3',
    provider: 'openai-compatible',
    label: 'MiniMax · M3',
    description: 'MiniMax M3 多模态模型（默认首选）。',
    note: '默认首选',
    settings: {
      apiKey: ENV_CONFIG.minimax.apiKey,
      baseUrl: ENV_CONFIG.minimax.baseUrl,
      model: ENV_CONFIG.minimax.model,
    },
  },
  {
    id: 'opencode-deepseek-v4-flash',
    provider: 'openai-compatible',
    label: 'OpenCode · DeepSeek V4 Flash',
    description: 'OpenCode 网关转发的 DeepSeek V4 Flash（备选）。',
    note: '备选',
    settings: {
      apiKey: ENV_CONFIG.opencode.apiKey,
      baseUrl: ENV_CONFIG.opencode.baseUrl,
      model: ENV_CONFIG.opencode.model,
    },
  },
  {
    id: 'ollama-local-llava',
    provider: 'ollama',
    label: 'Ollama · LLaVA (本地)',
    description: '本地 Ollama，需要先 ollama pull llava。',
    note: '完全离线、零费用，需本机 GPU',
    settings: {
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      model: 'llava',
    },
  },
];

export function findPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}
