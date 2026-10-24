/**
 * The backends this build was given.
 *
 * A build can ship with a backend already configured — the author's own
 * MiniMax, an OpenCodeGo route, a local Ollama — and a public build ships
 * with none of them. The onboarding worked that out (it lists what is
 * actually there); the settings page did not, and its first line told every
 * reader they could "直接使用构建时预置的后端" — which, in the build that
 * goes to the store, is a promise about a backend that does not exist.
 *
 * This module is the one place that answers the question.
 *
 * It reads the credentials module, so it may only be imported by the
 * extension's own pages — the worker, the popup, the options page and the
 * onboarding. The content script must never reach it: it is injected into
 * every page the user opens, and a key it can reach is a key in every page.
 * The build enforces that (`scripts/check-release-consistency.mjs`).
 */

import { ENV_CONFIG } from './env-config';
import { ENV_CREDENTIALS } from './env-credentials';

export interface EnvBackend {
  /** The name the product shows. */
  label: string;
  /** The model this backend would use. */
  detail: string;
  /** Whether this backend is the one that is configured right now. */
  isActive: boolean;
}

/**
 * Every backend this build can use out of the box.
 *
 * A backend counts as usable when it has an endpoint, a model, and — for the
 * cloud ones — a key. Ollama needs no key: it runs on the reader's machine.
 */
export function configuredBackends(): EnvBackend[] {
  const out: EnvBackend[] = [];
  if (ENV_CREDENTIALS.minimax.apiKey && ENV_CONFIG.minimax.model) {
    out.push({
      label: 'MiniMax',
      detail: ENV_CONFIG.minimax.model,
      isActive: false,
    });
  }
  if (ENV_CREDENTIALS.opencode.apiKey && ENV_CONFIG.opencode.model) {
    out.push({
      label: 'OpenCodeGo · DeepSeek',
      detail: ENV_CONFIG.opencode.model,
      isActive: false,
    });
  }
  if (ENV_CONFIG.ollama.baseUrl && ENV_CONFIG.ollama.model) {
    out.push({
      label: 'Ollama（本地）',
      detail: ENV_CONFIG.ollama.model,
      isActive: false,
    });
  }
  return out;
}

/**
 * The settings page's first line.
 *
 * A build that ships with a backend can say so; a public build — the one
 * that goes to the store — cannot, and promising one there is a promise
 * about something that does not exist.
 */
export function describeBackendAvailability(count: number): string {
  return count > 0
    ? '可直接使用构建时预置的后端，也可以在这里填写自己的 API Key、地址与模型。'
    : '在这里填写自己的 API Key、地址与模型；本地 Ollama / LM Studio 不需要 Key。';
}
