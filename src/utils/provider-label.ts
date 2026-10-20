import type { ProviderType } from '@/providers/base';

/**
 * The name of the service a provider slot is actually pointed at.
 *
 * The extension has three provider *slots* — an OpenAI-compatible one, Ollama
 * and LM Studio — but the OpenAI-compatible slot is pointed at whatever
 * service the user configured. Out of the box that is MiniMax or OpenCodeGo,
 * and both of them bill the user.
 *
 * Showing "OpenAI-compatible" in the popup told the user nothing about which
 * service was about to charge them. The slot name is an implementation detail;
 * the service name is what the user recognises from their own bill.
 *
 * The mapping is derived from the base URL, because that is the only field
 * that identifies the service. The model name is not a reliable signal — a
 * user can point any of these endpoints at any model.
 */
const SERVICE_BY_HOST: ReadonlyArray<{
  match: RegExp;
  label: string;
}> = [
  { match: /(^|\.)minimaxi?\.com$/i, label: 'MiniMax' },
  { match: /(^|\.)minimax\.chat$/i, label: 'MiniMax' },
  { match: /(^|\.)opencode\.(org|ai|com)$/i, label: 'OpenCodeGo' },
  { match: /(^|\.)api\.deepseek\.com$/i, label: 'DeepSeek' },
  { match: /(^|\.)api\.openai\.com$/i, label: 'OpenAI' },
  { match: /(^|\.)siliconflow\.cn$/i, label: 'SiliconFlow' },
  { match: /(^|\.)dashscope\.aliyuncs\.com$/i, label: '通义千问' },
  { match: /(^|\.)api\.anthropic\.com$/i, label: 'Anthropic' },
  { match: /(^|\.)generativelanguage\.googleapis\.com$/i, label: 'Gemini' },
  { match: /(^|\.)api\.groq\.com$/i, label: 'Groq' },
  { match: /(^|\.)api\.together\.xyz$/i, label: 'Together AI' },
  { match: /(^|\.)openrouter\.ai$/i, label: 'OpenRouter' },
];

function extractHost(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The service name behind an OpenAI-compatible endpoint.
 *
 * Returns null for an endpoint that is not a recognised service — the caller
 * then falls back to the generic slot name, which is the honest answer for a
 * self-hosted gateway.
 */
export function detectServiceName(baseUrl: string): string | null {
  const host = extractHost(baseUrl);
  if (!host) {
    return null;
  }
  for (const { match, label } of SERVICE_BY_HOST) {
    if (match.test(host)) {
      return label;
    }
  }
  return null;
}

/**
 * The label to show the user for the provider they are about to spend money
 * with.
 *
 * Local providers name themselves. The OpenAI-compatible slot names the
 * service behind the configured endpoint, falling back to the host itself when
 * the service is not one we recognise — a self-hosted gateway is more useful
 * identified by its host than by the name of the protocol it speaks.
 */
export function getProviderLabel(args: {
  provider: ProviderType;
  baseUrl: string;
}): string {
  const { provider, baseUrl } = args;
  if (provider === 'ollama') {
    return 'Ollama';
  }
  if (provider === 'lm-studio') {
    return 'LM Studio';
  }

  const service = detectServiceName(baseUrl);
  if (service) {
    return service;
  }

  const host = extractHost(baseUrl);
  if (host) {
    // Strip the leading "www." — nobody identifies their gateway by it.
    return host.replace(/^www\./, '');
  }
  return 'OpenAI-compatible';
}
