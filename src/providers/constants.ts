/**
 * Provider Constants
 *
 * Centralized configuration constants for all vision providers.
 */

// ==================== API URLs ====================

export const API_URLS = {
  OPENAI: 'https://api.openai.com/v1',
  OLLAMA: 'http://localhost:11434',
} as const;

// ==================== Default Models ====================

export const DEFAULT_MODELS = {
  OPENAI: 'gpt-4o',
  OLLAMA: 'llava:7b',
} as const;

// ==================== Request Limits ====================

export const REQUEST_LIMITS = {
  MAX_TOKENS: 2048, // 漫画翻译输出通常 <1000 tokens，降低上限加快响应
  TEMPERATURE: 0.1,
  IMAGE_DETAIL: 'high' as const,
} as const;

// ==================== Timeouts ====================

export const TIMEOUTS = {
  REQUEST: 30000, // 30 seconds
  RETRY_DELAY: 1000, // 1 second
} as const;
