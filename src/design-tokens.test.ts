/**
 * Three themes, one contract.
 *
 * The extension now ships 校正紙 (proof), 分镜黑 (panel) and 巨字海报
 * (poster). They are palettes, not separate components: every surface asks
 * for the same six semantic colours, so a theme is only allowed to change the
 * values. That makes two things worth pinning, and neither is a mood:
 *
 * 1. Every theme stays readable. The contrast ratios the product promised for
 *    the proof sheet — 7:1 body, 4.5:1 secondary, 3:1 control boundaries —
 *    have to hold for a black surface and a pure-white one too.
 * 2. `src/shared/theme.ts` and `src/index.css` agree. The TS table is what the
 *    shadow-root overlays get; the CSS is what the popup and the options page
 *    get. If they drift, the HUD is one colour and the popup another, and
 *    nothing else would notice.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  THEMES,
  THEME_NAMES,
  THEME_PALETTES,
  hexChannels,
  overlayThemeCss,
  resolveThemeName,
  themeDescriptor,
} from '@/shared/theme';
import {
  contrastRatio,
  cssBlock,
  cssDeclaration,
  hslToRgb,
  parseHslTriple,
} from '@/test/contrast';
import type { Rgb } from '@/test/contrast';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const appCss = readFileSync(path.join(repoRoot, 'src/index.css'), 'utf8');

/** The `:root, [data-theme='x']` block for one theme. */
function themeBlock(name: string): string {
  return cssBlock(appCss, `[data-theme='${name}']`);
}

function token(name: string, cssToken: string): Rgb {
  const block = themeBlock(name);
  const value = cssDeclaration(block, cssToken);
  if (!value) {
    // `:root, [data-theme='proof']` is a selector list; `cssBlock` matches it
    // by exact alternative, so an absent token is a real failure.
    throw new Error(`${name} does not declare ${cssToken}`);
  }
  const { h, s, l } = parseHslTriple(value);
  return hslToRgb(h, s, l);
}

describe('three palettes are declared in CSS', () => {
  it('declares every theme the TypeScript table names', () => {
    for (const name of THEME_NAMES) {
      expect(themeBlock(name), `missing block for ${name}`).not.toBe('');
    }
  });

  it('matches the TS palette for every theme', () => {
    // The overlays read the TS table; the shells read the CSS. If these two
    // disagree the HUD and the popup render different products.
    for (const name of THEME_NAMES) {
      const palette = THEME_PALETTES[name];
      for (const cssToken of [
        '--paper',
        '--ink',
        '--ink-muted',
        '--vermilion',
        '--blueprint',
        '--rule',
        '--rule-soft',
        '--on-accent',
      ] as const) {
        const key = cssToken.slice(2) as keyof typeof palette;
        const fromCss = token(name, cssToken);
        const fromTs = parseColorTriple(palette[key]);
        expect(fromCss, `${name} ${cssToken}`).toEqual(fromTs);
      }
    }
  });
});

describe('every theme keeps the contrast promises', () => {
  for (const name of THEME_NAMES) {
    describe(name, () => {
      const paper = token(name, '--paper');
      const ink = token(name, '--ink');
      const muted = token(name, '--ink-muted');
      const accent = token(name, '--vermilion');
      const blueprint = token(name, '--blueprint');
      const rule = token(name, '--rule');
      const onAccent = token(name, '--on-accent');

      it('body text is at least 7:1', () => {
        expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(7);
      });

      it('secondary text is at least 4.5:1', () => {
        expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5);
      });

      it('control boundaries are at least 3:1', () => {
        expect(contrastRatio(rule, paper)).toBeGreaterThanOrEqual(3);
      });

      it('the accent is at least 3:1 for large text and indicators', () => {
        expect(contrastRatio(accent, paper)).toBeGreaterThanOrEqual(3);
      });

      it('a label on the accent fill is at least 4.5:1', () => {
        // 分镜黑 is the theme that made this a token: white on #FF3B1F is
        // 3.56:1, so a white label there would have shipped unreadable.
        expect(contrastRatio(onAccent, accent)).toBeGreaterThanOrEqual(4.5);
      });

      it('blueprint notes are at least 4.5:1', () => {
        expect(contrastRatio(blueprint, paper)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});

describe('theme metadata', () => {
  it('names exactly three themes, each with a label and an origin', () => {
    expect(THEME_NAMES).toHaveLength(3);
    expect(THEMES).toHaveLength(3);
    for (const theme of THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.origin.length).toBeGreaterThan(0);
    }
  });

  it('marks only 分镜黑 as a dark surface', () => {
    const dark = THEMES.filter(theme => theme.dark).map(theme => theme.name);
    expect(dark).toEqual(['panel']);
  });

  it('resolves unknown names to the default instead of failing', () => {
    expect(resolveThemeName('panel')).toBe('panel');
    expect(resolveThemeName('dark')).toBe('proof');
    expect(resolveThemeName(undefined)).toBe('proof');
  });

  it('describes a theme it knows', () => {
    expect(themeDescriptor('poster').label).toBe('巨字海报');
  });
});

describe('overlayThemeCss', () => {
  it('emits both the solid colour and its channel triple', () => {
    const css = overlayThemeCss('proof');
    expect(css).toContain('--mt-paper: #E9E9E2;');
    expect(css).toContain('--mt-paper-rgb: 233 233 226;');
  });

  it('declares color-scheme from the theme polarity', () => {
    // A black surface with `color-scheme: light` gets light scrollbars and
    // light form controls, which is the half-dark page this product has
    // already shipped once.
    expect(overlayThemeCss('panel')).toContain('color-scheme: dark');
    expect(overlayThemeCss('proof')).toContain('color-scheme: light');
    expect(overlayThemeCss('poster')).toContain('color-scheme: light');
  });

  it('emits a palette that is readable on its own surface', () => {
    // The overlay's card is painted with `--mt-paper`, so every other colour
    // has to be legible on it. This is the same check the CSS block gets,
    // applied to the string the shadow root actually receives.
    for (const name of THEME_NAMES) {
      const css = overlayThemeCss(name);
      const paper = readVar(css, '--mt-paper');
      expect(
        contrastRatio(readVar(css, '--mt-ink'), paper),
        `${name} body`
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrastRatio(readVar(css, '--mt-ink-muted'), paper),
        `${name} secondary`
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(readVar(css, '--mt-vermilion'), paper),
        `${name} accent`
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('hexChannels', () => {
  it('turns a hex colour into space-separated channels', () => {
    expect(hexChannels('#0B0B0B')).toBe('11 11 11');
    expect(hexChannels('#E9E9E2')).toBe('233 233 226');
  });

  it('returns null for a value that is not six-digit hex', () => {
    expect(hexChannels('rgb(1 2 3)')).toBeNull();
    expect(hexChannels('#fff')).toBeNull();
  });
});

/** `#RRGGBB` to an RGB triple, for comparing against a parsed CSS colour. */
function parseColorTriple(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) {
    throw new Error(`not a six-digit hex colour: ${value}`);
  }
  const digits = match[1] ?? '';
  return [0, 2, 4].map(offset =>
    Number.parseInt(digits.slice(offset, offset + 2), 16)
  ) as Rgb;
}

/** Read one `--mt-*` value out of an emitted overlay stylesheet. */
function readVar(css: string, name: string): Rgb {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!match) {
    throw new Error(`${name} missing from ${css.slice(0, 80)}`);
  }
  return parseColorTriple(match[1] ?? '');
}
