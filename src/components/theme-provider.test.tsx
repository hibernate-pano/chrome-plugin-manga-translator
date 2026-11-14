/**
 * The privacy policy states that preferences are stored locally and are never
 * synced through the user's Google account, and the background worker deletes
 * the legacy `storage.sync` copy to honour that. The theme provider used
 * `storage.sync`, which put a preference straight back into account sync and
 * contradicted the published claim.
 *
 * The mock below throws on any `storage.sync` access, so a regression fails
 * loudly rather than silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const localStore: Record<string, unknown> = {};

function installChromeMock(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      get local() {
        return {
          get: async (keys: string[]) => {
            const out: Record<string, unknown> = {};
            for (const key of keys) {
              if (key in localStore) out[key] = localStore[key];
            }
            return out;
          },
          set: async (items: Record<string, unknown>) => {
            Object.assign(localStore, items);
          },
          remove: async () => undefined,
        };
      },
      get sync(): never {
        throw new Error(
          'chrome.storage.sync must not be used: preferences are local-only'
        );
      },
    },
    runtime: { id: 'theme-provider-test' },
  };
}

import { ThemeProvider, resolveStoredTheme } from './theme-provider';

/**
 * The provider applies the theme to <html> as a class; no component reads
 * the theme back from a context. The probe therefore only has to be mounted
 * for the provider's effect to run — the assertions look at the document.
 */
function ThemeProbe() {
  return <div data-testid='probe'>mounted</div>;
}

describe('theme provider storage', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    installChromeMock();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the stored theme through storage.local', async () => {
    localStore['manga-translator-theme'] = 'light';
    render(
      <ThemeProvider storageKey='manga-translator-theme'>
        <ThemeProbe />
      </ThemeProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('never touches storage.sync', async () => {
    // The mock's `storage.sync` getter throws, so "no error was thrown" was
    // the whole assertion — and a provider that wrapped its sync read in a
    // try/catch would have passed it while silently doing nothing. Assert
    // that the stored value was actually read from local storage instead:
    // that proves a real read happened, and that it happened in the
    // account-sync-free area.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    localStore['manga-translator-theme'] = 'light';
    render(
      <ThemeProvider storageKey='manga-translator-theme'>
        <ThemeProbe />
      </ThemeProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('theme provider honours a pinned theme', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    installChromeMock();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a pinned theme even when storage holds an older system value', async () => {
    // The surfaces are hard-coded paper and the shadcn primitives follow the
    // theme class, so a leftover `system` from an earlier version must not
    // repaint them into a half-and-half page.
    localStore['manga-translator-theme'] = 'system';

    render(
      <ThemeProvider defaultTheme='light' storageKey='manga-translator-theme'>
        <ThemeProbe />
      </ThemeProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('does not let a stored dark theme repaint the paper page', async () => {
    // A `dark` value left by an older build must not repaint the paper
    // surfaces: the body would go near-black while every proof-sheet
    // surface stayed paper.
    localStore['manga-translator-theme'] = 'dark';

    render(
      <ThemeProvider defaultTheme='light' storageKey='manga-translator-theme'>
        <ThemeProbe />
      </ThemeProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('removes a stale dark class left on the document element', async () => {
    document.documentElement.classList.add('dark');

    render(
      <ThemeProvider defaultTheme='light' storageKey='manga-translator-theme'>
        <ThemeProbe />
      </ThemeProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});

// The resolution rule on its own: what the provider does with whatever is
// in storage.
describe('resolveStoredTheme', () => {
  it('keeps a stored light theme', () => {
    expect(resolveStoredTheme('light', 'light')).toBe('light');
  });

  it('overrides a stored dark theme', () => {
    // The dark theme is not implemented, so it must never reach the DOM.
    expect(resolveStoredTheme('dark', 'light')).toBe('light');
  });

  it('overrides a stored system theme', () => {
    expect(resolveStoredTheme('system', 'light')).toBe('light');
  });

  it('falls back to the pinned theme for anything unrecognised', () => {
    expect(resolveStoredTheme(undefined, 'light')).toBe('light');
    expect(resolveStoredTheme(null, 'light')).toBe('light');
    expect(resolveStoredTheme('neon', 'light')).toBe('light');
  });
});
