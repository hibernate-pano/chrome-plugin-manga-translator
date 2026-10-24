/**
 * Support diagnostics.
 *
 * The extension makes a promise it has to keep: it collects nothing, sends
 * nothing, has no telemetry and no crash reporting. That promise is the
 * product's privacy story, and it is worth more than a crash reporter.
 *
 * But it leaves the user with nowhere to go when a page will not translate.
 * "It doesn't work" is not a bug report; the reporter needs to know which
 * provider was in use, which model, whether the key was found, and what the
 * failure was.
 *
 * So the extension builds that information **locally** and hands it to the
 * user, who pastes it into an issue if they want to. Nothing leaves the
 * device until the user does it deliberately.
 *
 * The redaction below is the load-bearing part. A diagnostics bundle is
 * exactly the kind of thing people paste into a public issue tracker, so it
 * must not carry the API key, the endpoint, the page URL, or anything about
 * the pages the user reads.
 */

import { SELF_HOSTED_SERVICE_LABEL } from '@/utils/provider-label';

export interface DiagnosticsInput {
  /** The extension's version. */
  version: string;
  /** Which provider slot was selected. */
  provider: string;
  /** The service name behind the endpoint — never the endpoint itself. */
  providerLabel: string;
  /** The model name. Not a credential, and the user needs to name it. */
  model: string;
  /** The target language the user picked. */
  targetLanguage: string;
  /** The translation style preset. */
  translationStylePreset: string;
  /** Whether a key was found for the active provider. The key is not read. */
  hasApiKey: boolean;
  /** The image resolution cap in force. */
  maxImageSize: number;
  /** The concurrency limit in force. */
  parallelLimit: number;
  /** Whether the translation cache is on. */
  cacheEnabled: boolean;
  /** Counters from the local usage records. */
  usage: {
    translations: number;
    billableCalls: number;
    tokens: number;
    cacheHitRate: number;
  };
  /** The most recent error message the user saw, if any. */
  lastError?: string | null;
}

/**
 * The bundle the user copies.
 *
 * Everything in it is a setting the user chose or a counter they can see in
 * the UI already. Nothing in it identifies the machine, the account or the
 * pages.
 */
export interface DiagnosticsBundle {
  extension: string;
  version: string;
  provider: {
    slot: string;
    service: string;
    model: string;
    hasApiKey: boolean;
  };
  translation: {
    targetLanguage: string;
    stylePreset: string;
    maxImageSize: number;
    parallelLimit: number;
    cacheEnabled: boolean;
  };
  usage: {
    translations: number;
    billableCalls: number;
    tokens: number;
    cacheHitRate: number;
  };
  lastError: string | null;
}

/**
 * A value that looks like a credential and must not appear in the output.
 *
 * The check is deliberately paranoid: it looks at the *shape* of every string
 * in the bundle, not at the field names, because a stray secret that reaches
 * an issue tracker is not recoverable.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // An "obf:" value is the stored form of a key — it must never be here.
  /obf:/i,
  // A bearer header, pasted by accident from a network log.
  /bearer\s+[a-z0-9._-]{8,}/i,
  // The key prefixes the supported services actually use.
  /\bsk-[a-z0-9_-]{8,}/i,
  /\bAIza[0-9A-Za-z_-]{10,}/,
  // A long hex or base64 blob with no spaces is almost never prose.
  /\b[0-9a-f]{32,}\b/i,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
  /*
   * A URL.
   *
   * The endpoint is not a secret — the user needs to name it when they ask
   * for help. But the bundle gets pasted into a *public* issue tracker,
   * where `https://llm.internal.corp/v1` identifies the reporter's employer
   * and says nothing about the bug. The provider's error messages quote the
   * base URL verbatim ("无法连接 https://…：网络错误"), so an error that
   * reaches this function almost always carries the endpoint with it.
   *
   * This pattern is here because the promise is 「不含 API Key、接口地址」,
   * and it used to hold only because the one caller never passed an error
   * in. The next caller would not have known that.
   */
  /\bhttps?:\/\/[^\s]+/i,
];

/**
 * Does this string look like it carries a credential?
 */
export function looksLikeSecret(value: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * A label that is really a hostname.
 *
 * The settings page names a self-hosted gateway by its host, because that is
 * the only way the user can tell which machine receives their images. The
 * bundle is a different audience: it gets pasted into a public issue
 * tracker, where `llm.internal.corp` identifies the reporter's employer and
 * says nothing about the bug. So a label shaped like a host is replaced by a
 * description of the endpoint's shape.
 */
const HOSTNAME_LIKE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * The service name a diagnostics bundle is allowed to carry.
 *
 * This is the last line of defence, applied to whatever label it is handed.
 * The caller is expected to pass a safe one already (`getDiagnosticsServiceLabel`),
 * but a bundle that is one careless caller away from carrying a hostname is
 * not a bundle anybody should paste into an issue.
 */
export function redactServiceLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return 'OpenAI 兼容（未配置端点）';
  }
  return HOSTNAME_LIKE.test(trimmed) ? SELF_HOSTED_SERVICE_LABEL : trimmed;
}

/**
 * Build the bundle.
 *
 * The last error is the one field that comes from outside the app, so it is
 * checked for secrets and dropped if it looks like one. An error message
 * that mentions a key is exactly the error a user would paste.
 */
export function buildDiagnosticsBundle(
  input: DiagnosticsInput
): DiagnosticsBundle {
  const lastError =
    input.lastError && !looksLikeSecret(input.lastError)
      ? input.lastError
      : null;

  return {
    extension: '漫画翻译助手 / Manga Translator',
    version: input.version,
    provider: {
      slot: input.provider,
      service: redactServiceLabel(input.providerLabel),
      model: input.model,
      hasApiKey: input.hasApiKey,
    },
    translation: {
      targetLanguage: input.targetLanguage,
      stylePreset: input.translationStylePreset,
      maxImageSize: input.maxImageSize,
      parallelLimit: input.parallelLimit,
      cacheEnabled: input.cacheEnabled,
    },
    usage: {
      translations: input.usage.translations,
      billableCalls: input.usage.billableCalls,
      tokens: input.usage.tokens,
      cacheHitRate: input.usage.cacheHitRate,
    },
    lastError,
  };
}

/**
 * The bundle as the text the user pastes into an issue.
 */
export function formatDiagnosticsBundle(bundle: DiagnosticsBundle): string {
  return JSON.stringify(bundle, null, 2);
}
