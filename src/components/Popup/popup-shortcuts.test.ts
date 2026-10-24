import { describe, expect, it } from 'vitest';

import { formatShortcutKeys, isMacPlatform } from './popup-shortcuts';

describe('快捷键的显示', () => {
  it('splits a shortcut into the keys the user has to press', () => {
    expect(formatShortcutKeys('Ctrl+Shift+Y', false)).toEqual([
      'Ctrl',
      'Shift',
      'Y',
    ]);
  });

  it('shows the Command key as ⌘ on a Mac', () => {
    expect(formatShortcutKeys('Command+Shift+Y', true)).toEqual([
      '⌘',
      'Shift',
      'Y',
    ]);
  });

  it('recognises a Mac from the user agent', () => {
    expect(
      isMacPlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      )
    ).toBe(true);
    expect(
      isMacPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      )
    ).toBe(false);
  });
});
