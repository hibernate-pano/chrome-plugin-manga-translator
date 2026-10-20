/**
 * These three components had no test importing them, so they were absent from
 * the coverage denominator while PopupApp and OptionsApp gated destructive
 * actions and provider limits through them.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ConfirmDialog } from './confirm-dialog';
import { Slider } from './slider';
import { Switch } from './switch';

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
});
