import { hostMatchesAllowlist } from '@/shared/app-config';

export interface PageAvailability {
  state: 'ready' | 'unsupported' | 'needs-refresh';
  message: string;
  canRefresh: boolean;
  canRetry: boolean;
}

const UNSUPPORTED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'moz-extension:',
  'file:',
];

export function isSupportedPageUrl(url?: string): boolean {
  if (!url) {
    return false;
  }

  return !UNSUPPORTED_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

export function getPageAvailability(args: {
  url?: string;
  contentScriptReachable: boolean;
}): PageAvailability {
  const { url, contentScriptReachable } = args;

  if (!isSupportedPageUrl(url)) {
    return {
      state: 'unsupported',
      message: '当前页面不支持扩展脚本，请切换到普通网页中的漫画页面。',
      canRefresh: false,
      canRetry: false,
    };
  }

  if (!contentScriptReachable) {
    return {
      state: 'needs-refresh',
      message: '当前页面尚未准备好，请刷新页面后重试。',
      canRefresh: true,
      canRetry: true,
    };
  }

  return {
    state: 'ready',
    message: '',
    canRefresh: false,
    canRetry: false,
  };
}

/**
 * Which allowlist entries actually authorise auto-translation of `url`.
 *
 * The switch used to compare the current hostname against the stored list with
 * a plain `includes`, so a `*.example.com` entry — which the worker does treat
 * as covering the page — showed as off. Worse, switching it off then removed
 * only an exact host entry, leaving the wildcard in place and the switch
 * snapping straight back on. Both halves now go through the same matcher the
 * background worker uses, so the switch cannot disagree with the behaviour.
 */
export function matchingAllowlistEntries(
  url: string | null,
  hosts: readonly string[]
): string[] {
  if (!url) {
    return [];
  }
  return hosts.filter(entry => hostMatchesAllowlist(url, [entry]));
}

export function isHostAutoTranslated(
  url: string | null,
  hosts: readonly string[]
): boolean {
  return matchingAllowlistEntries(url, hosts).length > 0;
}
