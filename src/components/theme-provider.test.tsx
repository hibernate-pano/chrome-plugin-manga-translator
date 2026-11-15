/**
 * The theme provider now carries three themes instead of one, and the
 * contract it has to keep is the same one it had before plus two new ones:
 *
 * 1. Preferences are local-only. The privacy policy says so, and the
 *    background worker deletes the legacy `storage.sync` copy to honour it.
 *    The mock below throws on any `storage.sync` access, so a regression
 *    fails loudly rather than silently.
 * 2. An unrecognised stored value never reaches the DOM. That was true when
 *    there was one theme (`dark` resolved to `light`); it is still true with
 *    three, and the value to fall back to is the pinned default.
 * 3. The chosen theme is written back, because the content script's overlays
 *    live in another document and learn about the change from storage.
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

import { ThemeProvider, resolveStoredTheme, useTheme } from './theme-provider';

/**
 * The provider applies the theme to <html> as `data-theme`; the probe reads
 * the context so the tests can also exercise the setter.
 */
function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid='theme'>{theme}</span>
      <button type='button' onClick={() => setTheme('poster')}>
        poster
      </button>
    </div>
  );
}

function renderProvider(defaultTheme: 'proof' | 'panel' | 'poster' = 'proof') {
  return render(
    <ThemeProvider
      defaultTheme={defaultTheme}
      storageKey='manga-translator-theme'
    >
      <ThemeProbe />
    </ThemeProvider>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  for (const key of Object.keys(localStore)) delete localStore[key];
  installChromeMock();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark', 'light');
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme provider storage', () => {
  it('reads the stored theme through storage.local', async () => {
    localStore['manga-translator-theme'] = 'panel';
    renderProvider();

    await settle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('panel');
    expect(screen.getByTestId('theme').textContent).toBe('panel');
  });

  it('never touches storage.sync', async () => {
    // The mock's `storage.sync` getter throws, so "no error was thrown" was
    // the whole assertion — and a provider that wrapped its sync read in a
    // try/catch would have passed it while silently doing nothing. Assert
    // that the stored value was actually read from local storage instead.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    localStore['manga-translator-theme'] = 'poster';
    renderProvider();
    await settle();

    expect(document.documentElement.getAttribute('data-theme')).toBe('poster');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('writes the chosen theme back so the content script can follow', async () => {
    renderProvider();
    await settle();

    await act(async () => {
      screen.getByRole('button', { name: 'poster' }).click();
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('poster');
    expect(localStore['manga-translator-theme']).toBe('poster');
  });
});

describe('theme provider fallbacks', () => {
  it('resolves an older system value to the pinned theme', async () => {
    localStore['manga-translator-theme'] = 'system';
    renderProvider('proof');

    await settle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('proof');
  });

  it('does not let a stale dark value paint an unstyled page', async () => {
    localStore['manga-translator-theme'] = 'dark';
    renderProvider('proof');

    await settle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('proof');
  });

  it('removes a stale dark class left on the document element', async () => {
    document.documentElement.classList.add('dark');
    renderProvider('panel');

    await settle();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('panel');
  });

  it('sets color-scheme to match the theme polarity', async () => {
    localStore['manga-translator-theme'] = 'panel';
    renderProvider();

    await settle();
    // 分镜黑 is the one dark surface; a light `color-scheme` would give it
    // light scrollbars and light form controls on a black page.
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});

// The resolution rule on its own: what the provider does with whatever is
// in storage.
describe('resolveStoredTheme', () => {
  it('keeps a stored theme that exists', () => {
    expect(resolveStoredTheme('proof', 'panel')).toBe('proof');
    expect(resolveStoredTheme('panel', 'proof')).toBe('panel');
    expect(resolveStoredTheme('poster', 'proof')).toBe('poster');
  });

  it('falls back to the pinned default for anything unrecognised', () => {
    expect(resolveStoredTheme(undefined, 'proof')).toBe('proof');
    expect(resolveStoredTheme(null, 'panel')).toBe('panel');
    expect(resolveStoredTheme('neon', 'poster')).toBe('poster');
    expect(resolveStoredTheme('light', 'proof')).toBe('proof');
    expect(resolveStoredTheme('dark', 'proof')).toBe('proof');
  });

  it('defaults to 校正紙 when no default is given', () => {
    expect(resolveStoredTheme(undefined)).toBe('proof');
  });
});
