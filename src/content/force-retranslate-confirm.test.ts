import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getForceRetranslateConfirm } from './force-retranslate-confirm';

/**
 * 忽略缓存重翻会重新请求整页图片，是这个扩展里唯一会绕过缓存、重复花钱
 * 的动作。弹窗里的按钮有确认，键盘快捷键原本没有——用户按下一个键就多出
 * 一整页的账单。
 *
 * 这些测试钉住确认框本身：它必须说清会花多少钱，必须能被取消，键盘必须
 * 留在框里。
 */
describe('ForceRetranslateConfirm', () => {
  const confirm = getForceRetranslateConfirm();

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (confirm.isOpen()) {
      confirm.open({
        imageCount: 1,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      });
    }
  });

  function body(): HTMLElement {
    const found = confirm.shadowRoot.getElementById('confirm-body');
    if (!found) {
      throw new Error('找不到确认文案');
    }
    return found as HTMLElement;
  }

  function button(id: string): HTMLButtonElement {
    const found = confirm.shadowRoot.getElementById(id);
    if (!found) {
      throw new Error(`找不到 ${id}`);
    }
    return found as HTMLButtonElement;
  }

  it('says how many images will be re-requested', () => {
    confirm.open({
      imageCount: 12,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(body().textContent).toContain('12');
    expect(body().textContent).toContain('费用');
  });

  it('prices the images that have not loaded yet', () => {
    // 快捷键在这个页面上直接花钱，而且页面还压着 36 张懒加载的图。
    // 「本页全部 4 张」是个偏低的数字：自动续翻开着时，那 36 张一加载
    // 就会被送去模型，钱是花出去的，只是晚几秒。
    confirm.open({
      imageCount: 4,
      pending: 36,
      autoContinueArmed: true,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(body().textContent).toContain('本页 4 张图片');
    expect(body().textContent).toContain('另有 36 张还在加载');
    expect(body().textContent).toContain('加载后会自动翻译');
    expect(body().textContent).not.toContain('本页全部');
  });

  it('does not promise auto-translation when it is switched off', () => {
    confirm.open({
      imageCount: 4,
      pending: 36,
      autoContinueArmed: false,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(body().textContent).toContain('36');
    expect(body().textContent).toContain('自动续翻是关着的');
    expect(body().textContent).not.toContain('加载后会自动翻译');
  });

  it('says that a long image is charged as several requests', () => {
    // 12 张图片不等于 12 次请求：长条图会被拆成多片分别请求。
    // 只报图片数而不说这句话，用户会拿图片数去估实际账单。
    confirm.open({
      imageCount: 12,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(body().textContent).toContain('长条图会拆成多片分别请求');
    expect(body().textContent).toContain('实际请求次数可能高于图片数');
  });

  it('says that the images already translated are billed again', () => {
    // 弹窗里那一句「已经翻译成功的图片也会重新计费」在这个确认框里以前
    // 没有。快捷键走的是这条路，于是最贵的那半句只有点按钮的人看得到，
    // 按快捷键的人看不到。
    confirm.open({
      imageCount: 12,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(body().textContent).toContain('已经翻译成功的图片也会重新翻译');
    expect(body().textContent).toContain('会产生费用');
  });

  it('does not tell a local provider that it will be charged', () => {
    // Ollama / LM Studio 在本机跑：这个确认框是花钱之前唯一的一次说明。
    confirm.open({
      imageCount: 12,
      provider: 'ollama',
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(body().textContent).toContain('不产生服务商费用');
    expect(body().textContent).not.toContain('会产生费用');
  });

  it('says so when there is nothing to re-translate', () => {
    confirm.open({
      imageCount: 0,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(body().textContent).toContain('不会产生费用');
  });

  it('calls onConfirm when the user confirms', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    confirm.open({ imageCount: 3, onConfirm, onCancel });

    button('confirm').click();

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(confirm.isOpen()).toBe(false);
  });

  it('calls onCancel when the user cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    confirm.open({ imageCount: 3, onConfirm, onCancel });

    button('cancel').click();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirm.isOpen()).toBe(false);
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    confirm.open({ imageCount: 3, onConfirm: () => undefined, onCancel });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    );

    expect(onCancel).toHaveBeenCalledOnce();
    expect(confirm.isOpen()).toBe(false);
  });

  it('puts the keyboard on the safe choice', () => {
    confirm.open({
      imageCount: 3,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    expect(confirm.shadowRoot.activeElement).toBe(button('cancel'));
  });

  it('keeps the keyboard inside the dialog', () => {
    confirm.open({
      imageCount: 3,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    const confirmBtn = button('confirm');
    confirmBtn.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(confirm.shadowRoot.activeElement).toBe(button('cancel'));
  });
});
