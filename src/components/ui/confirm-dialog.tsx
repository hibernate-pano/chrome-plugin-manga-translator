import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * 轻量级确认对话框，用于危险操作（强制重翻、彻底重置等）的二次确认。
 *
 * 故意不用 Radix Dialog / framer-motion —— popup 体积敏感，
 * 纯 React + CSS transition 足够，且自带深色主题样式（与 PopupApp 一致）。
 *
 * 无障碍：
 * - role="alertdialog" + aria-labelledby / aria-describedby
 * - 打开时自动聚焦"取消"按钮（安全默认：不执行危险动作）
 * - Escape 关闭、点击遮罩关闭
 * - Tab 焦点锁在对话框内，关闭后焦点回到触发按钮
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** 确认按钮文案，默认"确认" */
  confirmLabel?: string;
  /** 取消按钮文案，默认"取消" */
  cancelLabel?: string;
  /** 危险动作用 destructive = true，确认按钮变红 */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /**
   * The element that had focus before the dialog opened, so it can be given
   * the focus back when the dialog closes.
   */
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // 打开时聚焦"取消"（安全默认），Escape 关闭，Tab 锁在对话框内
  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') {
        return;
      }
      // A modal dialog that lets Tab walk out of it is not modal: the user
      // ends up focused on Popup controls behind the overlay, which they
      // cannot see, and a keyboard user has no way to tell where they are.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      const active = document.activeElement;
      if (
        e.shiftKey &&
        (active === first || !dialogRef.current?.contains(active))
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  // 关闭后把焦点还给触发按钮。
  //
  // Without this the focus falls back to <body>, and a keyboard user who
  // opened the dialog from a button has no idea where they are afterwards.
  useEffect(() => {
    if (open) {
      return;
    }
    const target = previouslyFocused.current;
    if (target && target.isConnected) {
      target.focus();
      previouslyFocused.current = null;
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
      onClick={onCancel}
      role='presentation'
    >
      <div
        ref={dialogRef}
        role='alertdialog'
        aria-modal='true'
        aria-labelledby='confirm-dialog-title'
        aria-describedby='confirm-dialog-desc'
        onClick={e => e.stopPropagation()}
        className='w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl'
      >
        <h2
          id='confirm-dialog-title'
          className={cn(
            'text-base font-semibold',
            destructive ? 'text-red-400' : 'text-white'
          )}
        >
          {title}
        </h2>
        <p
          id='confirm-dialog-desc'
          className='mt-2 text-sm leading-relaxed text-slate-300'
        >
          {description}
        </p>
        <div className='mt-5 flex justify-end gap-2'>
          <button
            ref={cancelRef}
            type='button'
            onClick={onCancel}
            className='rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'
          >
            {cancelLabel}
          </button>
          <button
            type='button'
            onClick={onConfirm}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
              destructive
                ? 'bg-red-700 hover:bg-red-800 focus-visible:ring-red-400'
                : 'bg-cyan-700 hover:bg-cyan-800 focus-visible:ring-cyan-400'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
