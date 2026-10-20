/**
 * The global stylesheet carries the theme, and none of it can be observed
 * from a component test: the popup and the options page are the only things
 * that import it, and mounting them needs the whole app graph. The
 * requirements that were measured in a real browser — the native controls
 * following the theme, one focus colour everywhere, a page that cannot
 * repaint itself half white — are asserted here against the file itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  cssBlock,
  cssDeclaration,
  hslToRgb,
  parseHslTriple,
} from '@/test/contrast';

const cssPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'index.css'
);
const css = readFileSync(cssPath, 'utf8');

/** The colour a CSS variable resolves to, for the `H S% L%` variables. */
function variableColor(name: string): [number, number, number] {
  const value = cssDeclaration(cssBlock(css, ':root'), name);
  const { h, s, l } = parseHslTriple(value);
  return hslToRgb(h, s, l);
}

describe('全局主题变量', () => {
  it('声明了 color-scheme: dark', () => {
    // Without it the computed value stays "normal" and the native controls
    // — scrollbars, select popups, date pickers — are drawn for a light
    // page inside a dark settings screen.
    expect(cssDeclaration(cssBlock(css, ':root'), 'color-scheme')).toBe('dark');
  });

  it('把深色调色板放在 :root 上', () => {
    // The palette used to live on a `.dark` class that React adds after the
    // first paint, so the pages flashed white before the theme settled.
    expect(cssDeclaration(cssBlock(css, ':root'), '--background')).toBe(
      '0 0% 3.9%'
    );
    expect(cssDeclaration(cssBlock(css, ':root'), '--foreground')).toBe(
      '0 0% 98%'
    );
  });

  it('没有浅色调色板可以再把页面刷成一半白一半黑', () => {
    expect(cssBlock(css, '.light')).toBe('');
  });
});

describe('焦点指示器', () => {
  it('只有一个焦点颜色变量', () => {
    // `--ring` is the slot the shadcn switch and slider draw their focus
    // ring with; pointing it at `--focus-ring` keeps them from drifting
    // away from the global outline.
    expect(cssDeclaration(cssBlock(css, ':root'), '--ring')).toBe(
      'var(--focus-ring)'
    );
  });

  it('焦点颜色是 cyan-400', () => {
    // rgb(34,211,238) — the colour the content-script overlays use, so the
    // ring does not change colour halfway through the page.
    const { h, s, l } = parseHslTriple(
      cssDeclaration(cssBlock(css, ':root'), '--focus-ring')
    );
    expect(hslToRgb(h, s, l)).toEqual([34, 211, 238]);
  });

  it('全局焦点环使用这个变量', () => {
    const block = cssBlock(css, "[role='button']:focus-visible");
    expect(cssDeclaration(block, 'outline')).toBe(
      '2px solid hsl(var(--focus-ring))'
    );
  });

  it('焦点环在页面底色上至少 3:1', () => {
    // WCAG 1.4.11: a focus indicator has to be visible against what it
    // sits on.
    const focus = variableColor('--focus-ring');
    const background = variableColor('--background');
    expect(contrastRatio(focus, background)).toBeGreaterThanOrEqual(3);
  });
});
