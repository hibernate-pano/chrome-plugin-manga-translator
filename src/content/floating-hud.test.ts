/**
 * floating-hud.test.ts
 *
 * 测试 FloatingHud 的基础渲染和状态切换
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingHud } from './floating-hud';
import type { HudState } from './floating-hud';
import {
  WHITE_PAGE,
  contrastRatio,
  cssBlock,
  cssDeclaration,
  parseColor,
  surfaceColor,
  textContrast,
} from '@/test/contrast';
import type { Rgb } from '@/test/contrast';

// ==================== 辅助函数 ====================

function getHudHost(): Element | null {
  return document.querySelector('[data-manga-translator-hud]');
}

// ==================== 测试用例 ====================

describe('FloatingHud', () => {
  let hud: FloatingHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  describe('constructor', () => {
    it('应挂载到 document.body', () => {
      const host = getHudHost();
      expect(host).not.toBeNull();
      expect(document.body.contains(host)).toBe(true);
    });

    it('应使用固定定位，位于左下角', () => {
      // The bottom-left, not the bottom-right: the reading panel is docked
      // on the right and is tall enough to reach the bottom of the screen,
      // so a HUD in the same corner was covered by it.
      const host = getHudHost() as HTMLElement;
      expect(host.style.position).toBe('fixed');
      expect(host.style.bottom).toBe('20px');
      expect(host.style.left).toBe('20px');
      expect(host.style.right).toBe('');
    });
  });

  describe('update - hidden 状态', () => {
    it('hidden 状态时 HUD div 应隐藏', () => {
      hud.update({ status: 'hidden' });
      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud') as HTMLElement | null;
      expect(hudDiv?.style.display).toBe('none');
    });
  });

  describe('update - translating 状态', () => {
    it('应显示翻译进度', () => {
      const state: HudState = { status: 'translating', current: 3, total: 10 };
      hud.update(state);

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.style.display).toBe('block');
      expect(hudDiv?.textContent).toContain('正在翻译');
      expect(hudDiv?.textContent).toContain('3');
      expect(hudDiv?.textContent).toContain('10');
    });

    it('有 currentImageIndex 时显示"第 N 张"格式', () => {
      const state: HudState = {
        status: 'translating',
        current: 3,
        total: 10,
        currentImageIndex: 2,
      };
      hud.update(state);

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('第 2 张');
      expect(hudDiv?.textContent).toContain('10');
    });

    it('应显示取消按钮', () => {
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const cancelBtn = shadow?.getElementById('cancel-btn');

      expect(cancelBtn).not.toBeNull();
    });

    it('有 etaSeconds 时显示剩余时间', () => {
      hud.update({
        status: 'translating',
        current: 3,
        total: 10,
        etaSeconds: 45,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('约 45 秒');
    });

    it('超过一分钟的剩余时间用分表示', () => {
      hud.update({
        status: 'translating',
        current: 3,
        total: 10,
        etaSeconds: 90,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('约 1 分 30 秒');
    });

    it('没有 etaSeconds 时不显示剩余时间', () => {
      hud.update({ status: 'translating', current: 3, total: 10 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      // "还剩多久"在信息不足时必须缺席，不能显示成 0 秒——那会被读成"卡住了"。
      expect(hudDiv?.textContent).not.toContain('约');
      expect(hudDiv?.textContent).not.toContain('秒');
    });
  });

  describe('update - complete 状态', () => {
    it('应显示完成信息', () => {
      hud.update({
        status: 'complete',
        translatedCount: 7,
        failedCount: 1,
        cachedCount: 2,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('翻译完成');
      expect(hudDiv?.textContent).toContain('7');
    });

    it('2 秒后应自动隐藏（无失败时）', () => {
      vi.useFakeTimers();

      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 0,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud') as HTMLElement | null;

      // 初始可见
      expect(hudDiv?.style.display).toBe('block');

      // 2 秒后
      vi.advanceTimersByTime(2000);
      expect(hudDiv?.style.display).toBe('none');

      vi.useRealTimers();
    });

    it('失败数 > 0 时应显示重新翻译按钮', () => {
      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 2,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const retryBtn = shadow?.getElementById('retry-failed-btn');

      expect(retryBtn).not.toBeNull();
      expect(retryBtn?.textContent).toContain('重新翻译失败项');
    });

    it('失败数 > 0 时不应自动隐藏', () => {
      vi.useFakeTimers();

      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 2,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud') as HTMLElement | null;

      // 初始可见
      expect(hudDiv?.style.display).toBe('block');

      // 3 秒后（超过之前的 2 秒阈值）仍应可见
      vi.advanceTimersByTime(3000);
      expect(hudDiv?.style.display).toBe('block');

      vi.useRealTimers();
    });
  });

  describe('update - error 状态', () => {
    it('应显示错误信息', () => {
      hud.update({ status: 'error', message: 'API 密钥无效' });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('翻译出错');
      expect(hudDiv?.textContent).toContain('API 密钥无效');
    });

    it('应对 HTML 特殊字符转义', () => {
      hud.update({ status: 'error', message: '<script>alert(1)</script>' });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');
      const html = hudDiv?.innerHTML ?? '';

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('应显示错误建议', () => {
      hud.update({
        status: 'error',
        message: 'Ollama 服务未启动',
        suggestion: '请运行 ollama serve 启动服务',
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('Ollama 服务未启动');
      expect(hudDiv?.textContent).toContain('请运行 ollama serve 启动服务');
    });

    it('无建议时不显示建议区域', () => {
      hud.update({ status: 'error', message: '网络错误' });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('网络错误');
      expect(hudDiv?.textContent).not.toContain('请检查');
    });
  });

  describe('destroy', () => {
    it('应从 DOM 移除 HUD', () => {
      expect(getHudHost()).not.toBeNull();
      hud.destroy();
      expect(getHudHost()).toBeNull();
    });
  });

  describe('hud-cancel 事件', () => {
    it('点击取消按钮应分发 hud-cancel 事件', () => {
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const cancelBtn = shadow?.getElementById(
        'cancel-btn'
      ) as HTMLElement | null;

      const listener = vi.fn();
      host.addEventListener('hud-cancel', listener);

      cancelBtn?.click();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('hud-retry-failed 事件', () => {
    it('点击重新翻译按钮应分发 hud-retry-failed 事件', () => {
      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 2,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const retryBtn = shadow?.getElementById(
        'retry-failed-btn'
      ) as HTMLElement | null;

      const listener = vi.fn();
      host.addEventListener('hud-retry-failed', listener);

      retryBtn?.click();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('无失败项时不应有重新翻译按钮', () => {
      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 0,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const retryBtn = shadow?.getElementById('retry-failed-btn');

      expect(retryBtn).toBeNull();
    });

    it('complete 状态显示缓存命中数（cachedCount > 0）', () => {
      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 0,
        cachedCount: 3,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('其中 3 张来自缓存');
    });

    it('complete 状态显示跳过的图片数（skippedCount > 0）', () => {
      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 0,
        cachedCount: 0,
        skippedCount: 7,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('已跳过 7 张');
      expect(hudDiv?.textContent).toContain('尺寸/位置不匹配');
    });

    it('complete 状态显示失败原因', () => {
      // Without the reason, a run that failed 20 images looks identical to
      // a run that failed because the API key is wrong.
      hud.update({
        status: 'complete',
        translatedCount: 0,
        failedCount: 20,
        cachedCount: 0,
        lastError: 'API 密钥无效，请检查配置',
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('失败原因');
      expect(hudDiv?.textContent).toContain('API 密钥无效');
    });

    it('complete 状态对失败原因做 HTML 转义', () => {
      hud.update({
        status: 'complete',
        translatedCount: 0,
        failedCount: 1,
        cachedCount: 0,
        lastError: '<img src=x onerror=alert(1)>',
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');
      const html = hudDiv?.innerHTML ?? '';

      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
    });

    it('complete 状态没有失败原因时不显示原因行', () => {
      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 0,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).not.toContain('失败原因');
    });

    it('complete 状态说明译文已直接覆盖在原图上', () => {
      // The overlay is drawn straight over the artwork. Telling the user
      // that is what happened stops "where did my translation go".
      hud.update({
        status: 'complete',
        translatedCount: 5,
        failedCount: 0,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('译文已直接覆盖在原图上');
    });
  });

  describe('update - scanning 状态', () => {
    it('扫描中显示提示', () => {
      hud.update({ status: 'scanning' });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.style.display).toBe('block');
      expect(hudDiv?.textContent).toContain('扫描页面中');
    });

    it('扫描时显示候选图片数', () => {
      hud.update({ status: 'scanning', candidateCount: 12 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('候选 12 张');
    });
  });
});

// The HUD is pinned to the bottom-right corner of somebody else's page.
//
// A card that reports an error, or a completion with failed images, used to
// stay there for the rest of the page's life with no way to dismiss it. The
// reader had to reload the page to get that corner of the screen back —
// and on a page they were trying to read, reloading is not free.
describe('the HUD can be dismissed', () => {
  let hud: FloatingHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  function shadow(): ShadowRoot {
    const host = getHudHost() as HTMLElement;
    return host.shadowRoot as ShadowRoot;
  }

  it('shows a close button on an error card', () => {
    hud.update({ status: 'error', message: '出错了' });
    expect(shadow().getElementById('close-btn')).toBeTruthy();
  });

  it('hides the HUD when the close button is clicked', () => {
    hud.update({ status: 'error', message: '出错了' });
    const close = shadow().getElementById('close-btn') as HTMLButtonElement;
    close.click();

    const hudEl = shadow().getElementById('hud') as HTMLElement;
    expect(hudEl.style.display).toBe('none');
  });

  it('shows a close button when some images failed', () => {
    // This card deliberately does not auto-hide, so without a close button
    // it is permanent.
    hud.update({
      status: 'complete',
      translatedCount: 3,
      failedCount: 2,
      cachedCount: 0,
    });
    expect(shadow().getElementById('close-btn')).toBeTruthy();
  });

  it('closes a "some images failed" card on click', () => {
    hud.update({
      status: 'complete',
      translatedCount: 3,
      failedCount: 2,
      cachedCount: 0,
    });
    (shadow().getElementById('close-btn') as HTMLButtonElement).click();

    const hudEl = shadow().getElementById('hud') as HTMLElement;
    expect(hudEl.style.display).toBe('none');
  });

  it('does not offer a close button on a card that auto-hides', () => {
    // A successful run hides itself after two seconds; a close button on it
    // would be noise.
    hud.update({
      status: 'complete',
      translatedCount: 3,
      failedCount: 0,
      cachedCount: 0,
    });
    expect(shadow().getElementById('close-btn')).toBeNull();
  });

  it('keeps the retry button working after a close', () => {
    hud.update({
      status: 'complete',
      translatedCount: 3,
      failedCount: 2,
      cachedCount: 0,
    });
    const retried = vi.fn();
    hud['container'].addEventListener('hud-retry-failed', retried);

    (shadow().getElementById('retry-failed-btn') as HTMLButtonElement).click();
    expect(retried).toHaveBeenCalled();
  });
});

// The HUD is drawn on top of somebody else's comic page, so every word in it
// has to survive the worst backdrop there is: a white page.
//
// The numbers below are the ones the accessibility review measured — the
// suggestion hint sat at 2.83:1 and the close button at 3.08:1, both under
// what they owe. These tests assert the ratio itself, not a literal colour,
// so a declaration that gets weaker fails the build.
describe('HUD 的对比度预算', () => {
  let hud: FloatingHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  function stylesheet(): string {
    const host = getHudHost() as HTMLElement;
    return host.shadowRoot?.querySelector('style')?.textContent ?? '';
  }

  /** The colour a card paints, once it is composited over the page. */
  function cardSurface(selector: string): Rgb {
    const background = cssDeclaration(
      cssBlock(stylesheet(), selector),
      'background'
    );
    return surfaceColor(background, WHITE_PAGE);
  }

  /** The contrast of a rule's text colour against a surface. */
  function contrastOf(selector: string, surface: Rgb): number {
    const color = cssDeclaration(cssBlock(stylesheet(), selector), 'color');
    return textContrast(color, surface);
  }

  it('错误提示文字在红色错误卡上至少 4.5:1', () => {
    // 0.6 alpha over rgb(191,64,64) was rgb(230,179,179): 2.83:1.
    const errorCard = cardSurface('.hud-card--error');
    expect(contrastOf('.hud-suggestion', errorCard)).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it('错误提示文字字号不小于 12px', () => {
    const size = cssDeclaration(
      cssBlock(stylesheet(), '.hud-suggestion'),
      'font-size'
    );
    expect(Number.parseFloat(size)).toBeGreaterThanOrEqual(12);
  });

  it('错误正文在红色错误卡上至少 4.5:1', () => {
    const errorCard = cardSurface('.hud-card--error');
    expect(contrastOf('.hud-message', errorCard)).toBeGreaterThanOrEqual(4.5);
  });

  it('关闭按钮在红色错误卡上至少 4.5:1', () => {
    // 0.65 alpha managed 3.08:1 there.
    const errorCard = cardSurface('.hud-card--error');
    expect(contrastOf('.hud-close', errorCard)).toBeGreaterThanOrEqual(4.5);
  });

  it('关闭按钮的点击区不小于 24x24（WCAG 2.5.8）', () => {
    // It used to be 22x22, under the minimum target size.
    const block = cssBlock(stylesheet(), '.hud-close');
    expect(
      Number.parseFloat(cssDeclaration(block, 'width'))
    ).toBeGreaterThanOrEqual(24);
    expect(
      Number.parseFloat(cssDeclaration(block, 'height'))
    ).toBeGreaterThanOrEqual(24);
  });

  it('统计行与次要说明在深色卡片上至少 4.5:1', () => {
    // The muted line used to sit at 0.5 alpha / 11px: 3.95:1.
    const card = cardSurface('.hud-card');
    expect(contrastOf('.hud-sub', card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf('.hud-sub-muted', card)).toBeGreaterThanOrEqual(4.5);
  });

  it('操作按钮的标签在自己的底色上至少 4.5:1', () => {
    // A translucent white plate under a white label measured 4.05:1.
    const errorCard = cardSurface('.hud-card--error');
    const button = surfaceColor(
      cssDeclaration(cssBlock(stylesheet(), '.hud-action'), 'background'),
      errorCard
    );
    const label = cssDeclaration(
      cssBlock(stylesheet(), '.hud-action'),
      'color'
    );
    expect(textContrast(label, button)).toBeGreaterThanOrEqual(4.5);
  });

  it('进度条填充与轨道至少 3:1', () => {
    // #3b82f6 on the track measured 1.56:1 — the progress was unreadable.
    const card = cardSurface('.hud-card');
    const track = surfaceColor(
      cssDeclaration(
        cssBlock(stylesheet(), '.hud-progress-track'),
        'background'
      ),
      card
    );
    const fill = cssDeclaration(
      cssBlock(stylesheet(), '.hud-progress-bar'),
      'background'
    );
    expect(contrastRatio(parseColor(fill).rgb, track)).toBeGreaterThanOrEqual(
      3
    );
  });
});
