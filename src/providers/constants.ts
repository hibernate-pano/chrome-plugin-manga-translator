/**
 * Provider Constants
 *
 * Centralized configuration constants for all vision providers.
 */

// ==================== API URLs ====================

export const API_URLS = {
  OPENAI: 'https://api.openai.com/v1',
  CLAUDE: 'https://api.anthropic.com/v1',
  DEEPSEEK: 'https://api.deepseek.com/v1',
  OLLAMA: 'http://localhost:11434',
} as const;

// ==================== Default Models ====================

export const DEFAULT_MODELS = {
  OPENAI: 'gpt-4o',
  CLAUDE: 'claude-3-5-sonnet-20241022',
  DEEPSEEK: 'deepseek-chat',
  OLLAMA: 'llava:7b',
} as const;

// ==================== API Versions ====================

export const API_VERSIONS = {
  CLAUDE: '2023-06-01',
} as const;

// ==================== Request Limits ====================

export const REQUEST_LIMITS = {
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.1,
  IMAGE_DETAIL: 'high' as const,
} as const;

// ==================== Timeouts ====================

export const TIMEOUTS = {
  REQUEST: 30000, // 30 seconds
  RETRY_DELAY: 1000, // 1 second
} as const;
