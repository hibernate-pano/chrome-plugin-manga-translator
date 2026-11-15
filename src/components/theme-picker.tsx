import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { THEMES } from '@/shared/theme';

/**
 * The theme switch.
 *
 * Three themes, one control. It is a segmented row rather than a dropdown
 * because there are exactly three and the reader is picking a look, not
 * filling in a setting — the swatch has to be visible before it is chosen.
 *
 * `compact` is the popup's version: the same three buttons at 44px targets
 * but without the provenance line, since the popup is 360px wide and every
 * vertical pixel competes with the translation controls.
 */
interface ThemePickerProps {
  compact?: boolean;
  className?: string;
}

export function ThemePicker({ compact = false, className }: ThemePickerProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role='radiogroup'
      aria-label='界面主题'
      className={cn(
        'flex w-full border border-ink',
        compact ? '' : 'divide-x divide-ink',
        className
      )}
    >
      {THEMES.map(candidate => {
        const active = candidate.name === theme;
        return (
          <button
            key={candidate.name}
            type='button'
            role='radio'
            aria-checked={active}
            onClick={() => setTheme(candidate.name)}
            className={cn(
              'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vermilion',
              compact ? 'border-r border-ink last:border-r-0' : '',
              active
                ? 'bg-ink text-paper'
                : 'bg-paper text-ink-muted hover:text-ink'
            )}
          >
            <span className='text-[13px] font-medium leading-none'>
              {candidate.label}
            </span>
            {compact ? null : (
              <span
                className={cn(
                  'font-mono text-[10px] leading-none tracking-[0.04em]',
                  active ? 'text-paper/70' : 'text-ink-muted'
                )}
              >
                {candidate.origin}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
