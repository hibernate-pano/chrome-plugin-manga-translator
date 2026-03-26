/**
 * floating-hud.test.ts
 *
 * 测试 FloatingHud 的基础渲染和状态切换
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingHud } from './floating-hud';
import type { HudState } from './floating-hud';

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

    it('应使用固定定位，位于右下角', () => {
      const host = getHudHost() as HTMLElement;
      expect(host.style.position).toBe('fixed');
      expect(host.style.bottom).toBe('20px');
      expect(host.style.right).toBe('20px');
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
      expect(hudDiv?.textContent).toContain('翻译中');
      expect(hudDiv?.textContent).toContain('3');
      expect(hudDiv?.textContent).toContain('10');
    });

    it('应显示取消按钮', () => {
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const cancelBtn = shadow?.getElementById('cancel-btn');

      expect(cancelBtn).not.toBeNull();
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

    it('2 秒后应自动隐藏', () => {
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
  });

  describe('update - hover-select 状态', () => {
    it('应显示选图提示', () => {
      hud.update({ status: 'hover-select' });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('点击选图翻译');
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
      const cancelBtn = shadow?.getElementById('cancel-btn') as HTMLElement | null;

      const listener = vi.fn();
      host.addEventListener('hud-cancel', listener);

      cancelBtn?.click();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
