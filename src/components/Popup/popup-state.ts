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
