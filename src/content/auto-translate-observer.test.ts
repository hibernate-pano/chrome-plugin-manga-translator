import { describe, expect, it, vi } from 'vitest';
import {
  createDebouncedAutoTranslate,
  shouldAutoTranslateFollowUp,
} from './auto-translate-observer';

describe('auto translate observer helpers', () => {
  it('only schedules follow-up when auto mode is enabled and images are pending', () => {
    expect(
      shouldAutoTranslateFollowUp({
        enabled: true,
        status: 'idle',
        hasPendingImages: true,
      })
    ).toBe(true);

    expect(
      shouldAutoTranslateFollowUp({
        enabled: false,
        status: 'idle',
        hasPendingImages: true,
      })
    ).toBe(false);

    expect(
      shouldAutoTranslateFollowUp({
        enabled: true,
        status: 'translating',
        hasPendingImages: true,
      })
    ).toBe(false);

    expect(
      shouldAutoTranslateFollowUp({
        enabled: true,
        status: 'complete',
        hasPendingImages: false,
      })
    ).toBe(false);
  });

  it('debounces repeated scheduling into one callback', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debounced = createDebouncedAutoTranslate(callback, 500);

    debounced.schedule();
    debounced.schedule();
    debounced.schedule();

    vi.advanceTimersByTime(499);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('cancels pending callbacks', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debounced = createDebouncedAutoTranslate(callback, 500);

    debounced.schedule();
    debounced.cancel();
    vi.advanceTimersByTime(500);

    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
