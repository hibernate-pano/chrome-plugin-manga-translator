import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getImageExportDialog, ImageExportDialog } from './image-export-dialog';
import type { OverlayStyle } from '@/services/renderer';
import type { TextArea } from '@/providers/base';

/**
 * 合成这一步由 `@/services/image-exporter` 负责，弹窗只管界面。
 * 这里把它换成桩，测试才只测弹窗自己的那部分。
 */
const exportTranslatedImage = vi.hoisted(() => vi.fn());

vi.mock('@/services/image-exporter', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/image-exporter')>();
  return {
    ...actual,
    exportTranslatedImage,
  };
});

const STYLE: OverlayStyle = {
  backgroundColor: 'rgb(240, 240, 235)',
  textColor: '#111111',
  fontFamily: '"PingFang SC", sans-serif',
  borderRadius: 6,
  padding: 7,
  minFontSize: 10,
  maxFontSize: 22,
  verticalText: false,
};

const AREA: TextArea = {
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.1,
  originalText: 'やあ',
  translatedText: '你好',
};

/**
 * 在 shadow root 里找一个元素，找不到就直接失败——不然测试会静悄悄地
 * 什么都没测。
 */
function el<T extends Element>(root: ShadowRoot, selector: string): T {
  const found = root.querySelector(selector);
  if (!found) {
    throw new Error(`找不到 ${selector}`);
  }
  return found as T;
}

function makeImage(): HTMLImageElement {
  const image = document.createElement('img');
  image.src = 'https://cdn.example.com/page.jpg';
  document.body.appendChild(image);
  return image;
}

describe('ImageExportDialog', () => {
  let dialog: ImageExportDialog;

  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    exportTranslatedImage.mockReset();
    exportTranslatedImage.mockResolvedValue(
      new Blob(['png-bytes'], { type: 'image/png' })
    );
    dialog = getImageExportDialog();
  });

  afterEach(() => {
    dialog.close();
  });

  it('reuses the same host when it is opened twice', () => {
    const first = getImageExportDialog();
    const second = getImageExportDialog();

    expect(second).toBe(first);
    expect(second.hostElement).toBe(first.hostElement);
  });

  it('opens with a composing state and then shows the preview', async () => {
    const image = makeImage();
    dialog.open({ image, textAreas: [AREA], style: STYLE, index: 2 });

    expect(dialog.isOpen()).toBe(true);
    expect(dialog.hostElement.style.display).toBe('flex');
    expect(el(dialog.shadowRoot, '#status').textContent).toBe('正在合成…');
    expect(el<HTMLButtonElement>(dialog.shadowRoot, '#download').disabled).toBe(
      true
    );

    await vi.waitFor(() => {
      expect(el<HTMLImageElement>(dialog.shadowRoot, '#preview').src).toContain(
        'blob:preview'
      );
    });

    expect(el(dialog.shadowRoot, '#status').textContent).toBe('');
    expect(el<HTMLButtonElement>(dialog.shadowRoot, '#download').disabled).toBe(
      false
    );
    expect(el<HTMLInputElement>(dialog.shadowRoot, '#filename').value).toBe(
      'manga-localhost-2.png'
    );
  });

  it('says something a reader can act on when the export fails', async () => {
    // 弹窗以前直接把 worker 的英文原文显示出来：
    // 「合成失败：Failed to fetch image: 403」—— 一句内部用语，没有
    // 下一步该做什么。
    exportTranslatedImage.mockRejectedValue(
      new Error(
        'Failed to fetch image via background: Failed to fetch image: 403'
      )
    );

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    await vi.waitFor(() => {
      expect(el(dialog.shadowRoot, '#status').textContent).toContain(
        '合成失败'
      );
    });

    const status = el(dialog.shadowRoot, '#status').textContent ?? '';
    expect(status).not.toContain('Failed to fetch image');
    expect(status).toContain('图片');
  });

  it('does not offer a retry for a failure that will not get better', async () => {
    // 「Blocked image URL」「Image too large」这类失败重试一万次也是同样的
    // 结果。挂一个永远点不通的「重试」按钮，只是让人白等。
    exportTranslatedImage.mockRejectedValue(
      new Error('Failed to fetch image via background: Blocked image URL')
    );

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    await vi.waitFor(() => {
      expect(el(dialog.shadowRoot, '#status').textContent).toContain(
        '合成失败'
      );
    });

    expect(el<HTMLButtonElement>(dialog.shadowRoot, '#retry').hidden).toBe(
      true
    );
  });

  it('does offer a retry when the failure might be temporary', async () => {
    exportTranslatedImage.mockRejectedValue(
      new Error(
        'Failed to fetch image via background: Failed to fetch image: 503'
      )
    );

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    await vi.waitFor(() => {
      expect(el(dialog.shadowRoot, '#status').textContent).toContain(
        '合成失败'
      );
    });

    expect(el<HTMLButtonElement>(dialog.shadowRoot, '#retry').hidden).toBe(
      false
    );
  });

  it('is a modal dialog with an accessible name', () => {
    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    const card = el(dialog.shadowRoot, '#card');
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-labelledby')).toBe('dialog-title');
    expect(el(dialog.shadowRoot, '#dialog-title').textContent).toBe(
      '保存译文图片'
    );
  });

  it('downloads the PNG through a real anchor when the button is clicked', async () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });

    dialog.open({
      image: makeImage(),
      textAreas: [AREA],
      style: STYLE,
      index: 1,
    });
    await vi.waitFor(() => {
      expect(
        el<HTMLButtonElement>(dialog.shadowRoot, '#download').disabled
      ).toBe(false);
    });

    el<HTMLButtonElement>(dialog.shadowRoot, '#download').click();

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('manga-localhost-1.png');
    expect(clicked[0]?.href).toContain('blob:');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('sanitises the filename the user typed', async () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });
    await vi.waitFor(() => {
      expect(
        el<HTMLButtonElement>(dialog.shadowRoot, '#download').disabled
      ).toBe(false);
    });

    const input = el<HTMLInputElement>(dialog.shadowRoot, '#filename');
    input.value = 'my/page:name';
    el<HTMLButtonElement>(dialog.shadowRoot, '#download').click();

    expect(clicked[0]?.download).toBe('mypagename.png');
    // 用户得看见最后存下来的到底是什么名字。
    expect(input.value).toBe('mypagename.png');
  });

  it('keeps the dialog open with a retry when the composition fails', async () => {
    exportTranslatedImage.mockRejectedValue(new Error('图片获取失败'));

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    await vi.waitFor(() => {
      // 用户看到的是一句能照着做的话，不是 worker 的内部原文。
      expect(el(dialog.shadowRoot, '#status').textContent).toContain(
        '这张图片没能取回来'
      );
    });

    expect(dialog.isOpen()).toBe(true);
    expect(el<HTMLButtonElement>(dialog.shadowRoot, '#retry').hidden).toBe(
      false
    );
    expect(el<HTMLButtonElement>(dialog.shadowRoot, '#download').disabled).toBe(
      true
    );
  });

  it('closes on Escape', () => {
    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });
    expect(dialog.isOpen()).toBe(true);

    el(dialog.shadowRoot, '#card').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
      })
    );

    expect(dialog.isOpen()).toBe(false);
    expect(dialog.hostElement.style.display).toBe('none');
  });

  it('closes when the close button is pressed', () => {
    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    el<HTMLButtonElement>(dialog.shadowRoot, '#close').click();

    expect(dialog.isOpen()).toBe(false);
  });

  it('closes when the backdrop is clicked', () => {
    // The backdrop covers the whole host, so the click's target is the
    // backdrop and never the host. The old check (`target === host`) could
    // not be true, so clicking outside the card did nothing at all.
    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    el<HTMLElement>(dialog.shadowRoot, '#backdrop').click();

    expect(dialog.isOpen()).toBe(false);
  });

  it('stays open when the card itself is clicked', () => {
    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    el<HTMLElement>(dialog.shadowRoot, '#card').click();

    expect(dialog.isOpen()).toBe(true);
  });

  it('keeps the keyboard inside the dialog', () => {
    // The dialog claims aria-modal="true". A Tab that walks out into the
    // page behind leaves the user focused on something they cannot see.
    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    const focusable = Array.from(
      dialog.shadowRoot.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([hidden]), input:not([disabled])'
      )
    );
    const last = focusable[focusable.length - 1];
    expect(last).toBeDefined();
    last?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    const first = focusable[0];
    expect(dialog.shadowRoot.activeElement).toBe(first);
  });

  it('reports an error that is not an Error', async () => {
    exportTranslatedImage.mockRejectedValue('网络断了');

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    await vi.waitFor(() => {
      expect(el(dialog.shadowRoot, '#status').textContent).toContain(
        '网络断了'
      );
    });
  });

  it('reports an error it cannot describe', async () => {
    exportTranslatedImage.mockRejectedValue({});

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    await vi.waitFor(() => {
      expect(el(dialog.shadowRoot, '#status').textContent).toContain(
        '未知错误'
      );
    });
  });

  it('keeps the name the user already ended with .png', async () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });
    await vi.waitFor(() => {
      expect(
        el<HTMLButtonElement>(dialog.shadowRoot, '#download').disabled
      ).toBe(false);
    });

    el<HTMLInputElement>(dialog.shadowRoot, '#filename').value = 'my-page.PNG';
    el<HTMLButtonElement>(dialog.shadowRoot, '#download').click();

    expect(clicked[0]?.download).toBe('my-page.PNG');
  });

  it('does nothing when there is nothing to download yet', () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });

    // 合成还没回来，blob 是空的：不能导出一个空文件。
    (dialog as unknown as { download: () => void }).download();

    expect(clicked).toHaveLength(0);
  });

  it('falls back to the focused element when no trigger is given', () => {
    const focused = document.createElement('button');
    document.body.appendChild(focused);
    focused.focus();

    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });
    dialog.close();

    expect(document.activeElement).toBe(focused);
  });

  it('can be destroyed, and the next call builds a fresh one', () => {
    dialog.open({ image: makeImage(), textAreas: [AREA], style: STYLE });

    dialog.destroy();

    expect(dialog.isOpen()).toBe(false);
    expect(dialog.hostElement.isConnected).toBe(false);
    expect(getImageExportDialog()).not.toBe(dialog);
  });

  it('moves the focus into the dialog and back to the trigger', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    dialog.open({
      image: makeImage(),
      textAreas: [AREA],
      style: STYLE,
      trigger,
    });

    expect(dialog.shadowRoot.activeElement).toBe(
      el(dialog.shadowRoot, '#card')
    );

    dialog.close();

    expect(document.activeElement).toBe(trigger);
  });
});
