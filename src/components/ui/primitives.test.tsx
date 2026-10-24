/**
 * These three components had no test importing them, so they were absent from
 * the coverage denominator while PopupApp and OptionsApp gated destructive
 * actions and provider limits through them.
 */
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  cssBlock,
  cssDeclaration,
  hslToRgb,
  parseHslTriple,
} from '@/test/contrast';
import type { Rgb } from '@/test/contrast';

import { ConfirmDialog } from './confirm-dialog';
import { Slider } from './slider';
import { Switch } from './switch';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

const appCss = readFileSync(path.join(repoRoot, 'src/index.css'), 'utf8');
const tailwindConfig = readFileSync(
  path.join(repoRoot, 'tailwind.config.js'),
  'utf8'
);

/**
 * The colour a Tailwind colour token resolves to.
 *
 * `bg-primary` is not a colour by itself: it is `hsl(var(--primary))` in
 * the Tailwind config, and `--primary` is a colour in the stylesheet.
 * Following the chain is the only way to know what the user actually sees
 * without a browser — and it is the chain that made the switch white once.
 */
function tokenColor(token: string): Rgb | null {
  const entry = new RegExp(`${token}:\\s*\\{([^}]*)\\}`).exec(tailwindConfig);
  const variable = entry
    ? /hsl\(var\((--[a-z-]+)\)\)/.exec(entry[1] ?? '')
    : null;
  if (!variable) {
    return null;
  }
  const { h, s, l } = parseHslTriple(
    cssDeclaration(cssBlock(appCss, ':root'), variable[1] ?? '')
  );
  return hslToRgb(h, s, l);
}

// jsdom provides no ResizeObserver, and Radix's Slider measures its track with
// one on mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ??
  (ResizeObserverStub as unknown as typeof ResizeObserver);

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title='重置全部'
        description='会清空缓存'
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('wires the accessible name and description to the dialog', () => {
    render(
      <ConfirmDialog
        open
        title='强制重翻'
        description='会重新请求模型并产生费用'
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      screen.getByText('强制重翻').id
    );
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('会重新请求模型并产生费用').id
    );
  });

  it('focuses cancel on open so the destructive action is not the default', () => {
    render(
      <ConfirmDialog
        open
        title='清空缓存'
        description='确认？'
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '取消' })
    );
  });

  it('routes confirm and cancel to the right handler', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title='清空缓存'
        description='确认？'
        confirmLabel='清空'
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and on backdrop click but not on panel click', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title='清空缓存'
        description='确认？'
        onConfirm={() => undefined}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    // A click that lands on the panel must not dismiss the dialog, or every
    // mis-click inside it would read as a cancel.
    onCancel.mockClear();
    fireEvent.click(screen.getByRole('alertdialog'));
    expect(onCancel).not.toHaveBeenCalled();

    const backdrop = document.querySelector('[role="presentation"]');
    if (!backdrop) throw new Error('backdrop missing');
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('removes its key listener on unmount', () => {
    const onCancel = vi.fn();
    const view = render(
      <ConfirmDialog
        open
        title='清空缓存'
        description='确认？'
        onConfirm={() => undefined}
        onCancel={onCancel}
      />
    );

    view.unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('exposes a checkbox role and reports changes', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        checked={false}
        onCheckedChange={onCheckedChange}
        aria-label='启用扩展'
      />
    );

    const control = screen.getByRole('switch', { name: '启用扩展' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('reflects the checked state', () => {
    render(
      <Switch checked onCheckedChange={() => undefined} aria-label='缓存' />
    );
    expect(screen.getByRole('switch', { name: '缓存' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});

describe('Slider', () => {
  it('renders at the controlled value and reports a change', () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        value={[3]}
        min={1}
        max={5}
        step={1}
        onValueChange={onValueChange}
        aria-label='并发数'
      />
    );

    // Radix puts the slider role on the thumb, not on the root it is declared
    // on, so query by role.
    const thumb = screen.getByRole('slider');
    expect(thumb).toHaveAttribute('aria-valuenow', '3');
    expect(thumb).toHaveAttribute('aria-valuemin', '1');
    expect(thumb).toHaveAttribute('aria-valuemax', '5');

    thumb.focus();
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith([4]);
  });
});

describe('Slider range', () => {
  it('renders one thumb per value in a range', () => {
    // Radix renders a thumb per value in the array. A hard-coded single
    // thumb made the font-size range show one handle, and dragging it moved
    // both ends at once — the user set a minimum and silently got a new
    // maximum they never chose.
    render(
      <Slider
        value={[10, 22]}
        min={8}
        max={48}
        step={1}
        onValueChange={() => undefined}
        aria-label='字号范围'
      />
    );

    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('still renders a single thumb for a single-value slider', () => {
    render(
      <Slider
        value={[3]}
        min={1}
        max={5}
        step={1}
        onValueChange={() => undefined}
        aria-label='并发数'
      />
    );

    expect(screen.getAllByRole('slider')).toHaveLength(1);
  });
});

// A modal dialog that lets Tab walk out of it is not modal.
//
// The dialog claims `aria-modal="true"`, but the focus was free to leave:
// a keyboard user tabbing past the last button landed on Popup controls
// hidden behind the overlay, with no visible way to tell where they were.
describe('ConfirmDialog focus management', () => {
  it('keeps Tab inside the dialog', () => {
    render(
      <ConfirmDialog
        open
        title='清空缓存'
        description='确认？'
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );

    const confirmButton = screen.getByRole('button', { name: '确认' });
    const cancelButton = screen.getByRole('button', { name: '取消' });

    // Focus starts on cancel (the safe default). Tabbing from the last
    // focusable element must wrap back to the first one, not escape.
    confirmButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(cancelButton);
  });

  it('wraps backwards from the first element to the last', () => {
    render(
      <ConfirmDialog
        open
        title='清空缓存'
        description='确认？'
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );

    const confirmButton = screen.getByRole('button', { name: '确认' });
    const cancelButton = screen.getByRole('button', { name: '取消' });

    cancelButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(confirmButton);
  });

  it('brings the focus back when it is outside the dialog', () => {
    // The backwards branch already pulled the focus back from outside the
    // dialog; the forward branch did not, so the walk out of the dialog
    // was still possible — only from the other direction.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type='button' onClick={() => setOpen(true)}>
            打开
          </button>
          <ConfirmDialog
            open={open}
            title='清空缓存'
            description='确认？'
            onConfirm={() => undefined}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开' });
    trigger.focus();
    fireEvent.click(trigger);

    // The focus ended up outside the dialog: the reader clicked the page
    // behind the overlay, or the browser moved it.
    trigger.focus();
    expect(screen.getByRole('alertdialog').contains(trigger)).toBe(false);

    fireEvent.keyDown(window, { key: 'Tab' });

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '取消' })
    );
  });

  it('returns the focus to the trigger when it closes', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type='button' onClick={() => setOpen(true)}>
            打开
          </button>
          <ConfirmDialog
            open={open}
            title='清空缓存'
            description='确认？'
            onConfirm={() => undefined}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '取消' })
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    // Without this the focus falls back to <body> and a keyboard user has
    // no idea where they are after dismissing the dialog.
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the focus return when the parent re-renders while it is open', () => {
    // Every production call site passes a fresh inline `onCancel`, so a
    // parent re-render used to hand the focus effect a new `onCancel` and
    // re-run it. The effect then recorded the dialog's *own* cancel button
    // as the element the focus had to go back to — a button that is already
    // unmounted when the dialog closes, so the focus fell to <body>.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type='button' onClick={() => setOpen(true)}>
            打开
          </button>
          <ConfirmDialog
            open={open}
            title='清空缓存'
            description='确认？'
            onConfirm={() => undefined}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }

    const { rerender } = render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开' });
    trigger.focus();
    fireEvent.click(trigger);

    const cancelButton = screen.getByRole('button', { name: '取消' });
    expect(document.activeElement).toBe(cancelButton);

    // A parent re-render: a brand new inline `onCancel` reaches the dialog.
    rerender(<Harness />);

    // The focus must still be inside the dialog.
    expect(
      screen.getByRole('alertdialog').contains(document.activeElement)
    ).toBe(true);

    fireEvent.click(cancelButton);

    // And closing must still hand the focus back to the trigger.
    expect(document.activeElement).toBe(trigger);
  });
});

// WCAG 2.2 SC 2.4.13 (Focus Appearance, AA) wants a focus indicator of at
// least 2 CSS pixels. The slider thumb was the only 1px ring in the
// extension — the other twenty were 2px — so the control the user has to
// aim at was the hardest one to see.
describe('焦点环的粗细', () => {
  it('滑块手柄的焦点环是 2px', () => {
    render(
      <Slider
        value={[3]}
        min={1}
        max={5}
        step={1}
        onValueChange={() => undefined}
        aria-label='并发数'
      />
    );

    const thumb = screen.getByRole('slider');
    expect(thumb.className).toContain('focus-visible:ring-2');
    expect(thumb.className).not.toContain('focus-visible:ring-1');
    // The ring is offset against the page, so it does not vanish into the
    // track the thumb sits on.
    expect(thumb.className).toContain('focus-visible:ring-offset-2');
  });

  it('开关的焦点环也是 2px', () => {
    render(
      <Switch checked onCheckedChange={() => undefined} aria-label='缓存' />
    );

    const control = screen.getByRole('switch', { name: '缓存' });
    expect(control.className).toContain('focus-visible:ring-2');
    expect(control.className).not.toContain('focus-visible:ring-1');
  });
});

// The switch used to be painted white: `--primary` was white, so the
// checked track and the slider's filled range were white in a product
// whose accent is cyan. The colour is now read through the chain that
// decides it — Tailwind token -> CSS variable -> rgb — so a white switch
// cannot come back unnoticed.
describe('控件的选中态用产品的主色', () => {
  it('主色是 cyan-400，不是白色', () => {
    expect(tokenColor('primary')).toEqual([34, 211, 238]);
  });

  it('开关打开时是主色', () => {
    render(
      <Switch checked onCheckedChange={() => undefined} aria-label='缓存' />
    );

    const control = screen.getByRole('switch', { name: '缓存' });
    expect(control.className).toContain('data-[state=checked]:bg-primary');
    expect(control.className).not.toContain('bg-white');
  });

  it('滑块已选的部分是主色', () => {
    render(
      <Slider
        value={[3]}
        min={1}
        max={5}
        step={1}
        onValueChange={() => undefined}
        aria-label='并发数'
      />
    );

    // The filled range is painted with the primary colour; the empty
    // track is the same colour at 20%.
    const range = document.querySelector('.bg-primary');
    expect(range).not.toBeNull();
    const track = document.querySelector('.bg-primary\\/20');
    expect(track).not.toBeNull();
  });
});
