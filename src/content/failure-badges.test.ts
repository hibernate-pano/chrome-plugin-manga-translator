import { describe, expect, it, beforeEach } from 'vitest';
import { FailureBadges } from './failure-badges';

function makeImage(
  width = 200,
  height = 100,
  left = 0,
  top = 0
): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'getBoundingClientRect', {
    value: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(img);
  return img;
}

function badgesOf(badges: FailureBadges): Element[] {
  const shadow = (badges as unknown as { shadow: ShadowRoot }).shadow;
  return Array.from(shadow.querySelectorAll('.badge'));
}

describe('FailureBadges', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('标出一张失败的图', () => {
    const badges = new FailureBadges();
    badges.mark(makeImage(), '请求超时');

    expect(badgesOf(badges)).toHaveLength(1);
    badges.destroy();
  });

  it('角标画在图的左上角', () => {
    // 右侧被阅读面板压住了 —— 编号锚点早就踩过这个坑，这里跟着它。
    const badges = new FailureBadges();
    const img = makeImage(200, 100, 300, 400);
    badges.mark(img, '请求超时');

    const badge = badgesOf(badges)[0] as HTMLElement;
    expect(badge.style.left).toBe('312px');
    expect(badge.style.top).toBe('412px');
    badges.destroy();
  });

  it('角标带着失败原因，屏幕阅读器读得出来', () => {
    const badges = new FailureBadges();
    badges.mark(makeImage(), 'API 密钥无效');

    const badge = badgesOf(badges)[0] as HTMLElement;
    expect(badge.getAttribute('aria-label')).toContain('API 密钥无效');
    expect(badge.getAttribute('title')).toBe('API 密钥无效');
    badges.destroy();
  });

  it('同一张图再失败一次，换成新的原因', () => {
    // 重试之后失败的原因才是读者要处理的那个。
    const badges = new FailureBadges();
    const img = makeImage();
    badges.mark(img, '请求超时');
    badges.mark(img, 'API 密钥无效');

    const list = badgesOf(badges);
    expect(list).toHaveLength(1);
    expect(list[0]?.getAttribute('aria-label')).toContain('API 密钥无效');
    badges.destroy();
  });

  it('重试成功之后角标撤掉', () => {
    // 角标留着就是在说谎：画面上其实已经翻好了。
    const badges = new FailureBadges();
    const img = makeImage();
    badges.mark(img, '请求超时');
    badges.clear(img);

    expect(badgesOf(badges)).toHaveLength(0);
    badges.destroy();
  });

  it('reset 撤掉所有角标', () => {
    const badges = new FailureBadges();
    badges.mark(makeImage(), '原因一');
    badges.mark(makeImage(), '原因二');
    badges.reset();

    expect(badgesOf(badges)).toHaveLength(0);
    badges.destroy();
  });

  it('图滚出视野之后角标跟着走', () => {
    // 角标指的是一张图，不是一个位置。
    const badges = new FailureBadges();
    const img = makeImage(200, 100, 0, -500);
    badges.mark(img, '请求超时');

    const badge = badgesOf(badges)[0] as HTMLElement;
    expect(badge.style.display).toBe('none');
    badges.destroy();
  });

  it('页面换掉了 body 之后能看出角标已经掉队', () => {
    // 站点自己换掉 document.body 会把角标一起带走，之后这一页剩下的时间
    // 角标都是隐形的 —— 读者会以为"没有失败"。
    const badges = new FailureBadges();
    expect(badges.isAttached()).toBe(true);

    document.body.innerHTML = '';
    expect(badges.isAttached()).toBe(false);
    badges.destroy();
  });

  it('destroy 之后不再留着图的引用', () => {
    // 角标持有 <img> 的强引用；页面拆掉了还抓着，DOM 就活不下来。
    const badges = new FailureBadges();
    badges.mark(makeImage(), '请求超时');
    badges.destroy();

    expect((badges as unknown as { badges: unknown[] }).badges).toHaveLength(0);
    expect(
      document.querySelector('[data-manga-translator-failure-badges]')
    ).toBeNull();
  });
});
