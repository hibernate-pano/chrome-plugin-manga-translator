import { describe, expect, it } from 'vitest';

import {
  createPageContext,
  createSupportState,
  getPageContextKey,
  hasPageContextChanged,
} from './page-context';
import type { SiteAdapter } from './site-adapters';

const TEST_ADAPTER: SiteAdapter = {
  id: 'manhwaread',
  matchesChapter: () => true,
  getChapterBootstrap: () => null,
  listRenderablePages: () => [],
  resolveCanonicalImage: () => null,
  prepareImage: async () => undefined,
};

describe('page-context', () => {
  it('marks unsupported pages explicitly', () => {
    const support = createSupportState(null);

    expect(support).toEqual({
      supported: false,
      site: null,
      reason: '当前页面不是 ManhwaRead 章节阅读页',
    });
  });

  it('uses chapter id as the stable supported page key', () => {
    const context = createPageContext(
      'https://manhwaread.com/manhwa/outro/chapter-1/',
      TEST_ADAPTER,
      {
        chapterId: '/manhwa/outro/chapter-1',
        baseUrl: 'https://manread.xyz/1268',
        pages: [],
      }
    );

    expect(getPageContextKey(context)).toBe(
      'manhwaread:/manhwa/outro/chapter-1'
    );
  });

  it('detects chapter navigation as a page-context change', () => {
    const previous = createPageContext(
      'https://manhwaread.com/manhwa/outro/chapter-1/',
      TEST_ADAPTER,
      {
        chapterId: '/manhwa/outro/chapter-1',
        baseUrl: 'https://manread.xyz/1268',
        pages: [],
      }
    );
    const next = createPageContext(
      'https://manhwaread.com/manhwa/outro/chapter-2/',
      TEST_ADAPTER,
      {
        chapterId: '/manhwa/outro/chapter-2',
        baseUrl: 'https://manread.xyz/1268',
        pages: [],
      }
    );

    expect(hasPageContextChanged(previous, next)).toBe(true);
  });

  it('treats identical supported chapter contexts as unchanged', () => {
    const previous = createPageContext(
      'https://manhwaread.com/manhwa/outro/chapter-1/',
      TEST_ADAPTER,
      {
        chapterId: '/manhwa/outro/chapter-1',
        baseUrl: 'https://manread.xyz/1268',
        pages: [],
      }
    );
    const next = createPageContext(
      'https://manhwaread.com/manhwa/outro/chapter-1/',
      TEST_ADAPTER,
      {
        chapterId: '/manhwa/outro/chapter-1',
        baseUrl: 'https://manread.xyz/1268',
        pages: [],
      }
    );

    expect(hasPageContextChanged(previous, next)).toBe(false);
  });
});
