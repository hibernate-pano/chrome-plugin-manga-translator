/**
 * The theme switch is the only control the reader uses to change the look,
 * so what it has to get right is narrow and worth pinning:
 *
 * 1. All three themes are offered, by name, as radio buttons — a screen
 *    reader has to be able to tell which one is selected.
 * 2. Choosing one changes the document, not just the button.
 * 3. The choice survives a reload, because it is written to storage rather
 *    than held in React state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { ThemePicker } from './theme-picker';
import { ThemeProvider } from './theme-provider';
import { THEMES } from '@/shared/theme';

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
        throw new Error('chrome.storage.sync must not be used');
      },
    },
  };
}

function renderPicker(compact = false) {
  return render(
    <ThemeProvider defaultTheme='proof' storageKey='picker-test-theme'>
      <ThemePicker compact={compact} />
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemePicker', () => {
  it('offers every theme as a radio in a labelled group', async () => {
    renderPicker();
    await settle();

    const group = screen.getByRole('radiogroup', { name: '界面主题' });
    expect(group).toBeTruthy();

    for (const theme of THEMES) {
      expect(screen.getByRole('radio', { name: new RegExp(theme.label) }));
    }
    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length);
  });

  it('marks the current theme as checked and the others as not', async () => {
    renderPicker();
    await settle();

    const proof = screen.getByRole('radio', { name: /校正紙/ });
    const panel = screen.getByRole('radio', { name: /分镜黑/ });
    expect(proof.getAttribute('aria-checked')).toBe('true');
    expect(panel.getAttribute('aria-checked')).toBe('false');
  });

  it('switches the document when another theme is chosen', async () => {
    renderPicker();
    await settle();

    await act(async () => {
      screen.getByRole('radio', { name: /巨字海报/ }).click();
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('poster');
    expect(
      screen
        .getByRole('radio', { name: /巨字海报/ })
        .getAttribute('aria-checked')
    ).toBe('true');
  });

  it('persists the choice so it survives a reload', async () => {
    renderPicker();
    await settle();

    await act(async () => {
      screen.getByRole('radio', { name: /分镜黑/ }).click();
    });

    expect(localStore['picker-test-theme']).toBe('panel');
  });

  it('hides the provenance line in the compact popup variant', async () => {
    renderPicker(true);
    await settle();

    // The compact row keeps the names and drops the one-line origin, which is
    // what makes three buttons fit in a 360px header.
    for (const theme of THEMES) {
      expect(screen.getByText(theme.label)).toBeTruthy();
      expect(screen.queryByText(theme.origin)).toBeNull();
    }
  });

  it('shows the provenance line in the full variant', async () => {
    renderPicker(false);
    await settle();

    for (const theme of THEMES) {
      expect(screen.getByText(theme.origin)).toBeTruthy();
    }
  });
});
