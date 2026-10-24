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

/**
 * The body of a `@media` block.
 *
 * `cssBlock` cannot be used for this: it splits the file on `}` and returns
 * the first rule whose selector list contains the one asked for, and the
 * file has an earlier `*` rule (`* { @apply border-border }`).
 */
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start === -1) {
    return '';
  }
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return css.slice(open + 1, index);
      }
    }
  }
  return '';
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
      '222.2 47.4% 3.9%'
    );
    expect(cssDeclaration(cssBlock(css, ':root'), '--foreground')).toBe(
      '0 0% 98%'
    );
  });

  it('页面底色就是 popup 与设置页用的 slate-950', () => {
    // The page is painted `bg-slate-950`; the switch thumb and the slider
    // thumb are painted `--background`. With the old neutral grey the thumb
    // was a different colour from the surface it sits on.
    expect(cssDeclaration(cssBlock(css, ':root'), '--card')).toBe(
      '222.2 47.4% 3.9%'
    );
    expect(cssDeclaration(cssBlock(css, ':root'), '--popover')).toBe(
      '222.2 47.4% 3.9%'
    );
  });

  it('没有浅色调色板可以再把页面刷成一半白一半黑', () => {
    expect(cssBlock(css, '.light')).toBe('');
  });
});

describe('强调色', () => {
  it('--primary 是 cyan-400，和焦点环同一个颜色', () => {
    // `--primary` was pure white, so the switch track and the slider fill
    // were white in a cyan product, and the switch thumb measured 1.02:1
    // against the page.
    expect(cssDeclaration(cssBlock(css, ':root'), '--primary')).toBe(
      '187.9 85.7% 53.3%'
    );
    expect(variableColor('--primary')).toEqual([34, 211, 238]);
    expect(variableColor('--primary')).toEqual(variableColor('--focus-ring'));
  });

  it('开关手柄在轨道上至少 3:1', () => {
    // The thumb is painted `--background`, the checked track `--primary`.
    // WCAG 1.4.11: a control boundary has to be visible against what it
    // sits on.
    expect(
      contrastRatio(variableColor('--background'), variableColor('--primary'))
    ).toBeGreaterThanOrEqual(3);
  });

  it('--primary-foreground 在强调色上可读', () => {
    expect(
      contrastRatio(
        variableColor('--primary-foreground'),
        variableColor('--primary')
      )
    ).toBeGreaterThanOrEqual(4.5);
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

  it('summary 也有同样的焦点环', () => {
    // The popup's two collapsible panels are `<details><summary>`. Without
    // `summary` in the list they fell back to the browser's blue outline,
    // and "one focus colour for the whole extension" was not true.
    const block = cssBlock(css, 'summary:focus-visible');
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

describe('减少动态效果', () => {
  const body = mediaBlock('(prefers-reduced-motion: reduce)');

  it('有一条 prefers-reduced-motion 规则', () => {
    expect(body).not.toBe('');
  });

  it('关掉动画与过渡', () => {
    const block = cssBlock(body, '*');
    expect(cssDeclaration(block, 'animation-duration')).toBe(
      '0.01ms !important'
    );
    expect(cssDeclaration(block, 'animation-iteration-count')).toBe(
      '1 !important'
    );
    expect(cssDeclaration(block, 'transition-duration')).toBe(
      '0.01ms !important'
    );
    expect(cssDeclaration(block, 'scroll-behavior')).toBe('auto !important');
  });
});
