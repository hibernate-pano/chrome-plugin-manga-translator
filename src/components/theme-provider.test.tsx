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
import { act, render, screen } from '@testing-library/react';

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

import { ThemeProvider, useTheme } from './theme-provider';

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid='theme'>{theme}</span>
      <button type='button' onClick={() => setTheme('dark')}>
        dark
      </button>
    </div>
  );
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

  it('reads and writes the theme through storage.local', async () => {
    localStore['manga-translator-theme'] = 'light';
    render(
      <ThemeProvider storageKey='manga-translator-theme'>
        <ThemeProbe />
      </ThemeProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('theme').textContent).toBe('light');

    await act(async () => {
      screen.getByRole('button', { name: 'dark' }).click();
      await Promise.resolve();
    });

    expect(localStore['manga-translator-theme']).toBe('dark');
  });

  it('never touches storage.sync', async () => {
    // The mock's `storage.sync` getter throws, so "no error was thrown" was
    // the whole assertion — and a provider that wrapped its sync write in a
    // try/catch would have passed it while silently doing nothing. Assert the
    // write landed in local storage instead: that proves a real write happened
    // and that it happened in the account-sync-free area.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    render(
      <ThemeProvider storageKey='manga-translator-theme'>
        <ThemeProbe />
      </ThemeProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'dark' }).click();
      await Promise.resolve();
    });

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(localStore['manga-translator-theme']).toBe('dark');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
