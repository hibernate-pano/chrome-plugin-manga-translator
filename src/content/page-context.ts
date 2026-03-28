import type { PageSupportState } from '@/shared/runtime-contracts';
import type { ChapterBootstrap, SiteAdapter } from './site-adapters';

export interface ContentPageContext {
  href: string;
  adapter: SiteAdapter | null;
  support: PageSupportState;
  chapterId: string | null;
}

export function createSupportState(
  siteAdapter: SiteAdapter | null
): PageSupportState {
  if (!siteAdapter) {
    return {
      supported: false,
      site: null,
      reason: '当前页面不是 ManhwaRead 章节阅读页',
    };
  }

  return {
    supported: true,
    site: siteAdapter.id,
    reason: null,
  };
}

export function createPageContext(
  href: string,
  siteAdapter: SiteAdapter | null,
  bootstrap: ChapterBootstrap | null
): ContentPageContext {
  return {
    href,
    adapter: siteAdapter,
    support: createSupportState(siteAdapter),
    chapterId: bootstrap?.chapterId ?? null,
  };
}

export function getPageContextKey(context: ContentPageContext): string {
  if (!context.support.supported) {
    return `unsupported:${context.href}`;
  }

  return `${context.support.site}:${context.chapterId ?? context.href}`;
}

export function hasPageContextChanged(
  previous: ContentPageContext,
  next: ContentPageContext
): boolean {
  return getPageContextKey(previous) !== getPageContextKey(next);
}
