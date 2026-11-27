/**
 * tesseract.js's browser `workerPath` default is a jsdelivr template literal.
 *
 * It is overridden at runtime by `text-detector.ts`, but the store scans the
 * package: Blue Argon quoted the literal. The Vite plugin rewrites it before
 * Rollup bundles the dependency. These tests pin the rewrite and the
 * fail-loud behaviour when the dependency changes shape.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { patchClientDefaultOptions } from '../lib/tesseract-client-defaults.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const REAL_DEFAULT_OPTIONS = join(
  repoRoot,
  'node_modules',
  'tesseract.js',
  'src',
  'worker',
  'browser',
  'defaultOptions.js'
);

describe('tesseract client default localization', () => {
  it('rewrites the real jsdelivr workerPath template to a local path', () => {
    const patched = patchClientDefaultOptions(
      readFileSync(REAL_DEFAULT_OPTIONS, 'utf8')
    );

    expect(patched).not.toContain('cdn.jsdelivr.net');
    expect(patched).toContain("workerPath: 'tesseract/worker.min.js'");
  });

  it('throws when the workerPath template is gone', () => {
    expect(() =>
      patchClientDefaultOptions('module.exports = { workerPath: "x" };')
    ).toThrow(/workerPath default/);
  });

  it('throws when another jsdelivr URL would survive the rewrite', () => {
    const source =
      'workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@v${version}/dist/worker.min.js`,' +
      " other: 'https://cdn.jsdelivr.net/npm/other/dist/thing.js'";
    expect(() => patchClientDefaultOptions(source)).toThrow(
      /still contain a jsdelivr URL/
    );
  });
});
