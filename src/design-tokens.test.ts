/**
 * The proof-sheet palette is a contract, not a mood.
 *
 * The old shell shipped a surface test that compared cards with the page.
 * The redesign has no cards, so that test was deleted; this one guards the
 * four relationships the new design depends on. A token can be restyled,
 * but it cannot quietly become unreadable.
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
import type { Rgb } from '@/test/contrast';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const appCss = readFileSync(path.join(repoRoot, 'src/index.css'), 'utf8');
const root = cssBlock(appCss, ':root');

function token(name: string): Rgb {
  const { h, s, l } = parseHslTriple(cssDeclaration(root, name));
  return hslToRgb(h, s, l);
}

const paper = token('--paper');
const ink = token('--ink');
const muted = token('--ink-muted');
const vermilion = token('--vermilion');
const blueprint = token('--blueprint');
const rule = token('--rule');

describe('proof-sheet palette contrast', () => {
  it('body text is ink on paper, at least 7:1', () => {
    expect(contrastRatio(ink, paper)).toBeGreaterThanOrEqual(7);
  });

  it('secondary text is at least 4.5:1 on paper', () => {
    expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5);
  });

  it('control boundaries are at least 3:1 on paper', () => {
    // WCAG 1.4.11: a form field or switch edge has to be visible.
    expect(contrastRatio(rule, paper)).toBeGreaterThanOrEqual(3);
  });

  it('white labels on the vermilion action are at least 4.5:1', () => {
    expect(contrastRatio([255, 255, 255], vermilion)).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it('vermilion is at least 3:1 on paper for large text and indicators', () => {
    expect(contrastRatio(vermilion, paper)).toBeGreaterThanOrEqual(3);
  });

  it('blueprint notes are at least 4.5:1 on paper', () => {
    expect(contrastRatio(blueprint, paper)).toBeGreaterThanOrEqual(4.5);
  });
});
