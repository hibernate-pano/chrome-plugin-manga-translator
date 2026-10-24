/**
 * The dark theme's surface scale.
 *
 * The popup and the settings page are two surfaces of one product, and the
 * defect this file guards against is a card that stops being a card: the
 * fill used to be 3% white over the page, which is 1.05:1 — the block and
 * the page were the same colour, and the product read as a pile of grey
 * boxes.
 *
 * The numbers below are the ones the browser computes. The alpha is
 * composited over the page first, then the WCAG relative-luminance
 * formula is applied to the result — the same maths
 * `src/test/contrast.ts` does for the content-script overlays.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio, parseColor } from '@/test/contrast';
import type { Rgb } from '@/test/contrast';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

/** The page both shells are painted with. */
const PAGE: Rgb = [2, 6, 23]; // slate-950

/** The three levels of the scale, as Tailwind writes them. */
const CONTAINER_FILL = 'bg-white/[0.08]';
const CONTAINER_BORDER = 'border-white/25';
const CONTROL_FILL = 'bg-white/[0.05]';
const WELL_FILL = 'bg-slate-950';

/** Every file that paints a surface of the product. */
const SURFACE_FILES = [
  'src/components/Popup/PopupApp.tsx',
  'src/components/Options/OptionsApp.tsx',
  'src/components/Onboarding/OnboardingApp.tsx',
  'src/components/ui/confirm-dialog.tsx',
];

/** The strings a className is built from. */
function classStrings(source: string): string[] {
  const out: string[] = [];
  const pattern = /'([^'\n]*)'|"([^"\n]*)"/g;
  let match = pattern.exec(source);
  while (match !== null) {
    out.push(match[1] ?? match[2] ?? '');
    match = pattern.exec(source);
  }
  return out;
}

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/** The colour a translucent fill paints, once the page is behind it. */
function fillColor(fill: string): Rgb {
  const { rgb, alpha } = parseColor(fill);
  return rgb.map((channel, index) => {
    const behind = PAGE[index] ?? 0;
    return channel * alpha + behind * (1 - alpha);
  }) as Rgb;
}

/** The colour a translucent border paints, over the fill it sits on. */
function borderColor(border: string, over: Rgb): Rgb {
  const { rgb, alpha } = parseColor(border);
  return rgb.map((channel, index) => {
    const behind = over[index] ?? 0;
    return channel * alpha + behind * (1 - alpha);
  }) as Rgb;
}

const allSources = SURFACE_FILES.map(file => ({
  file,
  source: sourceOf(file),
}));

describe('表面层级', () => {
  it('弹窗和设置页用的是同一套卡片', () => {
    // "两个界面必须看起来像同一个产品" — if one of them keeps a different
    // card, the product stops being one product. Both shells raise the
    // same container off the page and recess the same well into it.
    for (const file of [
      'src/components/Popup/PopupApp.tsx',
      'src/components/Options/OptionsApp.tsx',
    ]) {
      const source = sourceOf(file);
      expect(source, file).toContain(CONTAINER_FILL);
      expect(source, file).toContain(CONTAINER_BORDER);
      expect(source, file).toContain(WELL_FILL);
    }
  });

  it('弹窗里的控件是比卡片矮一级的表面', () => {
    // A control that sits directly on the page is one step below a card:
    // white 5% instead of 8%. The settings page has no such control —
    // everything on it lives inside a card.
    expect(sourceOf('src/components/Popup/PopupApp.tsx')).toContain(
      CONTROL_FILL
    );
  });

  it('没有剩下 3% 白的平铺卡片', () => {
    // 3% white over the page is 1.05:1: the block and the page are the
    // same colour, and the card stops reading as a card. A hover state is
    // not a fill — only the resting one is checked.
    for (const { file, source } of allSources) {
      for (const classes of classStrings(source)) {
        const tokens = classes.split(/\s+/);
        expect(tokens, `${file}: ${classes}`).not.toContain('bg-white/[0.03]');
        expect(tokens, `${file}: ${classes}`).not.toContain('bg-white/[0.02]');
      }
    }
  });

  it('每一张卡片都带边界', () => {
    // A card whose border cannot be told from its own fill has no edge.
    for (const { file, source } of allSources) {
      for (const classes of classStrings(source)) {
        if (!classes.includes(CONTAINER_FILL)) {
          continue;
        }
        expect(classes, `${file}: ${classes}`).toContain(CONTAINER_BORDER);
      }
    }
  });
});

describe('表面对比度', () => {
  it('卡片比页面亮至少 1.15:1', () => {
    const fill = fillColor('rgba(255, 255, 255, 0.08)');
    expect(contrastRatio(fill, PAGE)).toBeGreaterThanOrEqual(1.15);
  });

  it('卡片边界比卡片本身亮至少 2:1', () => {
    const fill = fillColor('rgba(255, 255, 255, 0.08)');
    const border = borderColor('rgba(255, 255, 255, 0.25)', fill);
    expect(contrastRatio(border, fill)).toBeGreaterThanOrEqual(2);
  });

  it('卡片边界比页面亮至少 2:1', () => {
    const fill = fillColor('rgba(255, 255, 255, 0.08)');
    const border = borderColor('rgba(255, 255, 255, 0.25)', fill);
    expect(contrastRatio(border, PAGE)).toBeGreaterThanOrEqual(2);
  });

  it('凹槽比卡片暗，一眼能看出是凹进去的', () => {
    const fill = fillColor('rgba(255, 255, 255, 0.08)');
    expect(
      contrastRatio(fill, fillColor('rgb(2, 6, 23)'))
    ).toBeGreaterThanOrEqual(1.1);
  });
});
