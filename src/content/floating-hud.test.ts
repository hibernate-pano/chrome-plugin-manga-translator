/**
 * floating-hud.test.ts
 *
 * 测试 FloatingHud 的基础渲染和状态切换
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FloatingHud } from './floating-hud';
import type { HudState } from './floating-hud';
import {
  WHITE_PAGE,
  contrastRatio,
  cssBlock,
  cssDeclaration,
  hslToRgb,
  parseColor,
  parseHslTriple,
  surfaceColor,
  textContrast,
} from '@/test/contrast';
import type { Rgb } from '@/test/contrast';
import { SKIPPED_IMAGES_REASON } from '@/shared/cost-wording';

// ==================== 辅助函数 ====================

function getHudHost(): Element | null {
  return document.querySelector('[data-manga-translator-hud]');
}

/** The stylesheet the HUD injects into its shadow root. */
function hudStylesheet(): string {
  const host = getHudHost() as HTMLElement;
  return host.shadowRoot?.querySelector('style')?.textContent ?? '';
}

/**
 * The product's accent colour, read out of the stylesheet the extension's
 * own pages use.
 *
 * The HUD lives in a shadow root on somebody else's page: it cannot read
 * the CSS variable at runtime, it hard-codes the same colour. That only
 * works while the two agree, and the only way to know is to compare them.
 */
function productAccent(): Rgb {
  const css = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css'),
    'utf8'
  );
  const { h, s, l } = parseHslTriple(
    cssDeclaration(cssBlock(css, ':root'), '--primary')
  );
  return hslToRgb(h, s, l);
}

/** The colour out of a `1px solid rgba(...)` border shorthand. */
function borderColor(value: string): string {
  const match = /rgba?\([^)]*\)/.exec(value);
  if (!match) {
    throw new Error(`边框里没有颜色: ${value}`);
  }
  return match[0];
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

  describe('键盘操作', () => {
    it('进度更新之后，焦点还在取消按钮上', () => {
      // 卡片是一整块 innerHTML，进度每动一次就被换掉一次 —— 焦点跟着按钮
      // 一起没了。键盘用户按 Tab 找到「取消当前翻译」，下一次进度跳动就
      // 把他弹回页面开头，得从头再 Tab 一遍。
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const cancelBtn = shadow?.getElementById('cancel-btn') as HTMLElement;
      cancelBtn.focus();
      expect(shadow?.activeElement).toBe(cancelBtn);

      hud.update({ status: 'translating', current: 2, total: 5 });

      expect(shadow?.activeElement?.id).toBe('cancel-btn');
    });

    it('上膛之后焦点还在重试按钮上', () => {
      // 重试要点两次，第二次才花钱。键盘用户按回车上了膛，焦点却没了，
      // 于是第二次回车按不到那颗按钮 —— 上膛等于白上。
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
      ) as HTMLElement;
      retryBtn.focus();
      expect(shadow?.activeElement).toBe(retryBtn);

      retryBtn.click();

      expect(shadow?.activeElement?.id).toBe('retry-failed-btn');
      expect(shadow?.getElementById('retry-failed-btn')?.textContent).toContain(
        '再点一次确认'
      );
    });

    it('按钮消失的时候不硬把焦点塞回别处', () => {
      // 错误卡片没有取消按钮了 —— 那时候没有东西可聚焦，焦点就该交给
      // 浏览器，不该被塞到一个不相干的地方。
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const cancelBtn = shadow?.getElementById('cancel-btn') as HTMLElement;
      cancelBtn.focus();

      hud.update({ status: 'error', message: 'API 密钥无效' });

      expect(shadow?.activeElement?.id).not.toBe('cancel-btn');
      expect(shadow?.getElementById('cancel-btn')).toBeNull();
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

    it('收起之后只剩一颗药丸，进度还在，点一下就展开', () => {
      // HUD 钉在左下角，而内容左对齐的阅读器上那正是画面。收起之后它
      // 几乎不挡东西，但读者最关心的进度还在。
      const state: HudState = { status: 'translating', current: 3, total: 10 };
      hud.update(state);

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const collapseBtn = shadow?.getElementById('collapse-btn');
      expect(collapseBtn).not.toBeNull();

      collapseBtn?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true })
      );

      const hudDiv = shadow?.getElementById('hud');
      expect(hudDiv?.textContent).toContain('翻译中 3/10');
      // 展开的入口还在。
      expect(shadow?.getElementById('collapse-btn')).not.toBeNull();

      shadow
        ?.getElementById('collapse-btn')
        ?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, composed: true })
        );
      expect(shadow?.getElementById('hud')?.textContent).toContain('正在翻译');
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

    it('说清楚这一轮要发几次请求', () => {
      // 右键翻一张长条图，图片数是 1，请求数是好几片。进度条上的
      // 「第 1 张 / 1」关于图片是真的，关于账单一句话都没说。
      const state: HudState = {
        status: 'translating',
        current: 0,
        total: 1,
        currentImageIndex: 1,
        costNote: '这张图是长条，会拆成 10 片分别请求（10 次调用费用）',
      };
      hud.update(state);

      const host = getHudHost() as HTMLElement;
      const hudDiv = host.shadowRoot?.getElementById('hud');

      expect(hudDiv?.textContent).toContain('拆成 10 片');
      expect(hudDiv?.textContent).toContain('10 次调用费用');
    });

    it('没有拆分说明的时候不多说', () => {
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const hudDiv = host.shadowRoot?.getElementById('hud');

      expect(hudDiv?.textContent).not.toContain('调用费用');
    });

    it('应显示取消按钮', () => {
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const cancelBtn = shadow?.getElementById('cancel-btn');

      expect(cancelBtn).not.toBeNull();
    });

    it('取消按钮说清楚它取消的是什么', () => {
      // 弹窗里写的是「取消当前翻译」。HUD 里只写「取消」，读者会以为这是
      // 「取消翻译 / 撤销译文」——而它其实只是停掉这一轮请求。
      hud.update({ status: 'translating', current: 1, total: 5 });

      const host = getHudHost() as HTMLElement;
      const cancelBtn = host.shadowRoot?.getElementById('cancel-btn');

      expect(cancelBtn?.textContent).toBe('取消当前翻译');
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
    it('部分成功时标题说的是部分完成，不是翻译完成', () => {
      hud.update({
        status: 'complete',
        translatedCount: 7,
        failedCount: 1,
        cachedCount: 2,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      // 成功 7、失败 1 —— 那一张确实没翻出来。标题写「翻译完成」会让读者
      // 只看第一行就以为整页好了，而弹窗对同一件事说的是「部分完成」。
      expect(hudDiv?.textContent).toContain('部分完成');
      expect(hudDiv?.textContent).not.toContain('翻译完成');
      expect(hudDiv?.textContent).toContain('7');
    });

    it('有几处没翻出来时，卡片说出来而不是只写「翻译完成」', () => {
      hud.update({
        status: 'complete',
        translatedCount: 12,
        failedCount: 0,
        cachedCount: 0,
        missingCount: 3,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      // 这一轮跑完了，但三处气泡还是原文。卡片只写「翻译完成」，读者会
      // 以为整页都翻好了，只当自己看漏了那三处。
      expect(hudDiv?.textContent).toContain('翻译完成');
      expect(hudDiv?.textContent).toContain('3 处文字没有翻出来');
    });

    it('一张都没成功时标题是翻译失败，不是翻译完成', () => {
      hud.update({
        status: 'complete',
        translatedCount: 0,
        failedCount: 2,
        cachedCount: 0,
      });

      const host = getHudHost() as HTMLElement;
      const shadow = host.shadowRoot;
      const hudDiv = shadow?.getElementById('hud');

      // 旧文案的第一行是「翻译完成」，第二行才是「成功 0，失败 2」——
      // 读者读到的是「完成了」。一次全部失败的运行里，这句是假的。
      expect(hudDiv?.textContent).toContain('翻译失败');
      expect(hudDiv?.textContent).not.toContain('翻译完成');
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
      // The button names the number of images it will re-request: the count
      // was on the card, but the button is what the reader reaches for.
      expect(retryBtn?.textContent).toContain('重新翻译失败的 2 张');
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

      // The first click only arms the button: this action spends money, and
      // the popup asks before it spends.
      retryBtn?.click();
      expect(listener).not.toHaveBeenCalled();

      const armedBtn = shadow?.getElementById(
        'retry-failed-btn'
      ) as HTMLElement | null;
      expect(armedBtn?.textContent).toContain('再点一次确认');

      armedBtn?.click();
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
      expect(hudDiv?.textContent).toContain(SKIPPED_IMAGES_REASON);
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

// The HUD is where the reader actually is when a run fails: the popup closes
// the moment they click the page. The popup's equivalent — a confirm dialog
// — says "会再次调用 Vision LLM 产生费用". The HUD did not, so the copy the
// reader acted on was the copy that hid the bill.
describe('重新翻译失败项要说明它要花钱', () => {
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

  function failedRun(): void {
    hud.update({
      status: 'complete',
      translatedCount: 3,
      failedCount: 2,
      cachedCount: 0,
    });
  }

  it('按钮的名字里就写着会再次计费', () => {
    failedRun();
    const retry = shadow().getElementById('retry-failed-btn');
    expect(retry?.textContent).toContain('重新翻译失败的');
    expect(retry?.textContent).toContain('计费');
  });

  it('本地服务商的按钮不说计费', () => {
    // Ollama / LM Studio 在本机跑，图片不离开这台机器，也没有账单。
    hud.update({
      status: 'complete',
      translatedCount: 5,
      failedCount: 2,
      cachedCount: 0,
      provider: 'ollama',
    });
    const retry = shadow().getElementById('retry-failed-btn');
    expect(retry?.textContent).toContain('重新翻译失败的 2 张');
    expect(retry?.textContent).not.toContain('计费');
    expect(retry?.textContent).toContain('本机');
  });

  it('按钮下面有一行说明调用模型会产生费用', () => {
    failedRun();
    const hudDiv = shadow().getElementById('hud');
    expect(hudDiv?.textContent).toContain('产生费用');
  });

  it('没有失败项时不出现重试按钮，也不出现计费说明', () => {
    hud.update({
      status: 'complete',
      translatedCount: 5,
      failedCount: 0,
      cachedCount: 0,
    });
    const hudDiv = shadow().getElementById('hud');
    expect(shadow().getElementById('retry-failed-btn')).toBeNull();
    expect(hudDiv?.textContent).not.toContain('计费');
  });
});

// "成功 0，失败 0，缓存 0" is not a diagnosis. The reader has three possible
// causes in front of them and no way to tell them apart: the pages have not
// loaded yet, they are too small to be comic pages, or they were already
// translated. The popup used to lead with the second one, sending readers
// off to resize images on a page that was merely lazy-loading.
describe('什么都没翻出来的时候要说清原因', () => {
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

  function emptyRun(
    extra: Partial<Extract<HudState, { status: 'complete' }>> = {}
  ): void {
    hud.update({
      status: 'complete',
      translatedCount: 0,
      failedCount: 0,
      cachedCount: 0,
      ...extra,
    });
  }

  it('图片还在加载时说的是加载，而不是尺寸', () => {
    emptyRun({ pendingCount: 40 });
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).toContain('40 张图片还在加载');
    expect(text).toContain('滚动');
    // The wrong diagnosis must not be there next to the right one.
    expect(text).not.toContain('太小');
  });

  it('全部因为不是漫画页被忽略时说的是忽略', () => {
    emptyRun({ skippedCount: 12 });
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).toContain('12');
    expect(text).toContain('太小');
    // 理由只有一份说法：HUD 和弹窗用同一个常量，两边各写一遍就会漂。
    expect(text).toContain(SKIPPED_IMAGES_REASON);
  });

  it('已经翻过的页面说的是翻过了', () => {
    emptyRun({ skippedDuplicateCount: 8 });
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).toContain('8');
    expect(text).toContain('已经翻译过');
  });

  it('什么都不知道时不编一个原因出来', () => {
    // No count at all: the HUD must not pretend it knows why.
    emptyRun();
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).toContain('没有找到可翻译的图片');
    expect(text).toContain('还没加载');
    expect(text).not.toContain('尺寸');
  });

  it('空的这一轮不自动隐藏——原因要读完', () => {
    vi.useFakeTimers();
    emptyRun({ pendingCount: 40 });
    const hudDiv = shadow().getElementById('hud') as HTMLElement;
    vi.advanceTimersByTime(3000);
    expect(hudDiv.style.display).toBe('block');
    vi.useRealTimers();
  });

  it('这张卡片可以关掉', () => {
    emptyRun({ pendingCount: 40 });
    expect(shadow().getElementById('close-btn')).toBeTruthy();
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

// The HUD told the reader that scrolling would carry on by itself.
//
// The promise is only true when the page is armed for auto-continue: the
// extension is on, the setting is on, and the page is either allowlisted
// or was translated on request. With the setting off the reader scrolls,
// waits, and waits for a translation that was never going to come — and
// the HUD is the only thing on the page that could have told them.
describe('HUD 要说清楚后面会发生什么', () => {
  let hud: FloatingHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  function shadow(): ShadowRoot {
    return (getHudHost() as HTMLElement).shadowRoot as ShadowRoot;
  }

  function emptyRun(
    extra: Partial<Extract<HudState, { status: 'complete' }>> = {}
  ): void {
    hud.update({
      status: 'complete',
      translatedCount: 0,
      failedCount: 0,
      cachedCount: 0,
      ...extra,
    });
  }

  it('页面会自动续翻时说的是自动继续', () => {
    emptyRun({ pendingCount: 40, autoContinueArmed: true });
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).toContain('会自动继续翻译');
    // It is going to spend money on its own, so the reader has to know
    // that before they scroll.
    expect(text).toContain('会产生费用');
  });

  it('页面不会自动续翻时说的是再点一次', () => {
    emptyRun({ pendingCount: 40, autoContinueArmed: false });
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).not.toContain('自动继续翻译');
    expect(text).toContain('再点一次');
    // The name of the button that has to be pressed again.
    expect(text).toContain('翻译当前页面');
  });

  it('不知道会不会自动续翻时不承诺', () => {
    // The content script did not answer: the HUD must not promise a
    // continuation it cannot know about.
    emptyRun({ pendingCount: 40 });
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).not.toContain('自动继续翻译');
    expect(text).toContain('再点一次');
  });

  it('预算用完时不承诺继续翻译', () => {
    // 这一页的自动续翻次数用完了，页面不会再翻新出现的图片。HUD 以前写
    // 的是"滚动到它们出现后会自动继续翻译"——那是一句它兑现不了的承诺，
    // 读者滚动、等待，什么也不会发生。
    emptyRun({
      pendingCount: 40,
      autoContinueArmed: false,
      autoContinueBudgetExhausted: true,
    });
    const text = shadow().getElementById('hud')?.textContent ?? '';
    expect(text).not.toContain('会自动继续翻译');
    expect(text).toContain('用完次数');
    // The billing news is part of it: nothing more will be requested.
    expect(text).toContain('不会再产生费用');
    expect(text).toContain('再点一次');
  });
});

// The HUD was blue. The product is cyan: the focus ring, the reading
// panel's number badge and the popup's primary button are all cyan-400, so
// a blue HUD read as a different tool sitting on top of the page.
describe('HUD 用产品的主色', () => {
  let hud: FloatingHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  it('进度条是产品的主色', () => {
    const fill = cssDeclaration(
      cssBlock(hudStylesheet(), '.hud-progress-bar'),
      'background'
    );
    expect(parseColor(fill).rgb).toEqual(productAccent());
  });

  it('重试按钮是产品的主色配深色文字', () => {
    const block = cssBlock(hudStylesheet(), '.hud-retry');
    const background = cssDeclaration(block, 'background');
    expect(parseColor(background).rgb).toEqual(productAccent());

    // White on this cyan was 1.81:1. The label has to be readable.
    const card = surfaceColor(
      cssDeclaration(cssBlock(hudStylesheet(), '.hud-card'), 'background'),
      WHITE_PAGE
    );
    const button = surfaceColor(background, card);
    expect(
      textContrast(cssDeclaration(block, 'color'), button)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('悬停时还是主色', () => {
    const hover = cssBlock(hudStylesheet(), '.hud-retry:hover');
    expect(parseColor(cssDeclaration(hover, 'background')).rgb).toEqual(
      productAccent()
    );
  });

  it('样式表里没有遗留的蓝色', () => {
    // blue-500 and blue-300 were the old HUD colours.
    expect(hudStylesheet()).not.toContain('59, 130, 246');
    expect(hudStylesheet()).not.toContain('147, 197, 253');
  });
});

// The cancel button is the only way to stop a translation that is being
// billed at this very moment. It measured about 24x14 pixels — below the
// 24x24 that WCAG 2.5.8 asks for, and it is a standalone button rather
// than a link inside a sentence, so the inline exception does not apply.
describe('取消按钮要够大', () => {
  let hud: FloatingHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  it('点击区至少 24px 高（WCAG 2.5.8）', () => {
    const block = cssBlock(hudStylesheet(), '.hud-cancel');
    expect(
      Number.parseFloat(cssDeclaration(block, 'min-height'))
    ).toBeGreaterThanOrEqual(24);
    expect(cssDeclaration(block, 'display')).toBe('inline-flex');
  });

  it('上下有内边距，不是贴着的文字', () => {
    const padding = cssDeclaration(
      cssBlock(hudStylesheet(), '.hud-cancel'),
      'padding'
    );
    expect(padding).not.toBe('0');
    expect(padding.split(' ')[0]).toBe('4px');
  });

  it('不是整宽按钮——那是重试按钮的形状', () => {
    const block = cssBlock(hudStylesheet(), '.hud-cancel');
    expect(cssDeclaration(block, 'width')).not.toBe('100%');
  });
});

// The HUD is drawn on top of somebody else's page, and pages are often
// black. The card was a translucent black rectangle with no border: on a
// black page its edge measured 1.00:1 against the background and the
// backdrop blur had nothing to blur, so the card simply was not there.
describe('深色页面上 HUD 也要有边', () => {
  let hud: FloatingHud;

  /** The worst backdrop there is: a page that is pure black. */
  const DARK_PAGE: Rgb = [0, 0, 0];

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  it('卡片有边框', () => {
    const border = cssDeclaration(
      cssBlock(hudStylesheet(), '.hud-card'),
      'border'
    );
    expect(border).not.toBe('');
  });

  it('深色页面上卡片的边缘看得出来', () => {
    const block = cssBlock(hudStylesheet(), '.hud-card');
    const card = surfaceColor(cssDeclaration(block, 'background'), DARK_PAGE);
    const edge = surfaceColor(
      borderColor(cssDeclaration(block, 'border')),
      DARK_PAGE
    );
    // 无边框时是 1.00:1；白 14% 的边框实测 1.35:1，仍然看不见。
    // WCAG 1.4.11 对界面边界的门槛是 3:1，卡片才有轮廓。
    expect(contrastRatio(edge, card)).toBeGreaterThanOrEqual(3);
  });

  it('浅色页面上也一样看得出来', () => {
    // 漫画页大多是白的，而白色边框压在白页上等于没有边框。边框是半透明白，
    // 它叠在卡片自己的底色上（CSS 的 background 默认铺到 border-box），
    // 所以这里要把边框合到卡片底色上再比。
    const block = cssBlock(hudStylesheet(), '.hud-card');
    const card = surfaceColor(cssDeclaration(block, 'background'), WHITE_PAGE);
    const edge = surfaceColor(
      borderColor(cssDeclaration(block, 'border')),
      card
    );
    expect(contrastRatio(edge, card)).toBeGreaterThanOrEqual(3);
  });

  it('卡片有阴影，把它从页面上托起来', () => {
    expect(
      cssDeclaration(cssBlock(hudStylesheet(), '.hud-card'), 'box-shadow')
    ).not.toBe('');
  });
});

/**
 * 读屏用户按下快捷键之后，唯一能得到的反馈就是这个播报。
 *
 * 翻译进行中每翻一张都会重画整张卡片；把这些都念出来是噪音，而结论
 * （翻译完成 / 部分完成 / 翻译失败 / 没有找到图片）不念，等于什么都没发生。
 */
describe('HUD 把结论播报给读屏用户', () => {
  let hud: FloatingHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new FloatingHud();
  });

  afterEach(() => {
    hud.destroy();
  });

  function hudDiv(): HTMLElement {
    const host = getHudHost() as HTMLElement;
    const found = host.shadowRoot?.getElementById('hud');
    if (!found) {
      throw new Error('找不到 HUD 容器');
    }
    return found;
  }

  it('完成时是一个 polite 的状态区', () => {
    hud.update({
      status: 'complete',
      translatedCount: 3,
      failedCount: 0,
      cachedCount: 0,
    });

    expect(hudDiv().getAttribute('role')).toBe('status');
    expect(hudDiv().getAttribute('aria-live')).toBe('polite');
  });

  it('出错时也播报', () => {
    hud.update({
      status: 'error',
      message: '网络连接失败，请检查网络',
      code: 'NETWORK_ERROR',
    } as never);

    expect(hudDiv().getAttribute('aria-live')).toBe('polite');
  });

  it('重画不重播', () => {
    // 「重新翻译失败项」的第一次点击只是把按钮变成待确认状态，卡片内容
    // 没变。让读屏把整张卡片再念一遍，是用噪音盖住了真正要说的那句。
    hud.update({
      status: 'complete',
      translatedCount: 3,
      failedCount: 2,
      cachedCount: 0,
    });
    expect(hudDiv().getAttribute('aria-live')).toBe('polite');

    const retry = hudDiv().querySelector('#retry-failed-btn');
    expect(retry).not.toBeNull();
    (retry as HTMLElement).click();

    expect(hudDiv().getAttribute('aria-live')).toBeNull();
  });

  it('翻译进行中不播报，免得每翻一张念一遍', () => {
    hud.update({ status: 'translating', current: 3, total: 12 });

    expect(hudDiv().getAttribute('aria-live')).toBeNull();
  });
});
