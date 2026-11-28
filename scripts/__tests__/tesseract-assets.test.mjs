/**
 * The tesseract worker patch is a string rewrite against a pinned dependency.
 *
 * The Blue Argon finding was two defaults that stayed in the package after
 * the runtime had overridden them. The fix lives in the build, so these tests
 * pin two things at once: the rewrite produces local paths, and it fails
 * loudly when the pinned tesseract.js worker no longer matches the
 * expression. A silently skipped rewrite would ship the CDN defaults again.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TESSERACT_CORE_FILES,
  TESSERACT_DATA_VERSION,
  TESSERACT_DATA_VARIANT,
  TESSERACT_LANGUAGES,
  patchWorkerSource,
  trainedDataPackage,
  trainedDataRelativePath,
  urlLoadsExtensionAsset,
} from '../lib/tesseract-assets.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const REAL_WORKER = join(
  repoRoot,
  'node_modules',
  'tesseract.js',
  'dist',
  'worker.min.js'
);

/**
 * The two minified expressions the patch knows how to rewrite.
 *
 * Kept in the same shape as the emitted worker: the core default is a string
 * with the version concatenated onto it, and the language default is a
 * directory with a variant chosen by a ternary.
 */
const SYNTHETIC_WORKER =
  'var c=o||"https://cdn.jsdelivr.net/npm/tesseract.js-core@v".concat(h.substring(1));' +
  'var b=s||"https://cdn.jsdelivr.net/npm/@tesseract.js-data/".concat(i,m?"/4.0.0_best_int":"/4.0.0");';

describe('tesseract worker localization', () => {
  it('rewrites both remote defaults to local paths', () => {
    const patched = patchWorkerSource(SYNTHETIC_WORKER);

    expect(patched).not.toContain('cdn.jsdelivr.net');
    expect(patched).toContain('o||"tesseract-core-simd-lstm.wasm.js"');
    expect(patched).toContain('s||"lang"');
  });

  it('leaves no remote URL in the real installed worker', () => {
    const source = readFileSync(REAL_WORKER, 'utf8');
    const patched = patchWorkerSource(source);

    expect(patched).not.toMatch(/https?:\/\//);
    expect(patched).toContain('tesseract-core-simd-lstm.wasm.js');
    expect(patched).toContain('"lang"');
  });

  it('throws when the core default expression is gone', () => {
    expect(() =>
      patchWorkerSource(
        'var b=s||"https://cdn.jsdelivr.net/npm/@tesseract.js-data/".concat(i,m?"/4.0.0_best_int":"/4.0.0");'
      )
    ).toThrow(/core default/);
  });

  it('throws when the language default expression is gone', () => {
    expect(() =>
      patchWorkerSource(
        'var c=o||"https://cdn.jsdelivr.net/npm/tesseract.js-core@v".concat(h.substring(1));'
      )
    ).toThrow(/language-data default/);
  });

  it('throws when another remote URL would survive the rewrite', () => {
    const source = `${SYNTHETIC_WORKER} fetch("https://cdn.example.com/extra.js");`;
    expect(() => patchWorkerSource(source)).toThrow(
      /still contains 1 remote URL/
    );
  });

  it('pins the language list and the data variant the detector expects', () => {
    expect([...TESSERACT_LANGUAGES].sort()).toEqual([
      'chi_sim',
      'eng',
      'jpn',
      'kor',
    ]);
    expect(TESSERACT_DATA_VERSION).toBe('1.0.0');
    expect(TESSERACT_DATA_VARIANT).toBe('4.0.0_best_int');
    // Only the single-file core ships. It embeds the wasm binary, so the
    // sibling `.wasm` is never fetched; shipping it was 2.86 MB of dead weight
    // in dist/ and in the store ZIP.
    expect(TESSERACT_CORE_FILES).toEqual(['tesseract-core-simd-lstm.wasm.js']);
  });

  it('points every package path at the pinned best_int file', () => {
    for (const lang of TESSERACT_LANGUAGES) {
      expect(trainedDataPackage(lang)).toBe(`@tesseract.js-data/${lang}`);
      expect(trainedDataRelativePath(lang)).toBe(
        `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`
      );
    }
  });

  it('has a real gzip-traineddata file for every language', () => {
    for (const lang of TESSERACT_LANGUAGES) {
      const file = join(
        repoRoot,
        'node_modules',
        trainedDataRelativePath(lang)
      );
      expect(existsSync(file), file).toBe(true);
      const head = readFileSync(file).subarray(0, 2);
      expect([head[0], head[1]], file).toEqual([0x1f, 0x8b]);
    }
  });
});

/**
 * The runtime acceptance script decides "was this asset loaded?" from URLs
 * captured over CDP. That comparison used `String.includes`, which made the
 * `.wasm` requirement pass whenever the `.wasm.js` file was loaded — the exact
 * false pass that kept a dead 2.86 MB binary in the package.
 */
describe('runtime asset matching', () => {
  const CORE = 'tesseract/tesseract-core-simd-lstm.wasm';
  const CORE_JS = 'tesseract/tesseract-core-simd-lstm.wasm.js';

  it('matches the packaged url exactly', () => {
    expect(urlLoadsExtensionAsset(`chrome-extension://abc/${CORE}`, CORE)).toBe(
      true
    );
    expect(
      urlLoadsExtensionAsset(`chrome-extension://abc/${CORE_JS}`, CORE_JS)
    ).toBe(true);
  });

  it('does not let the .wasm.js glue satisfy the .wasm asset', () => {
    expect(
      urlLoadsExtensionAsset(`chrome-extension://abc/${CORE_JS}`, CORE)
    ).toBe(false);
  });

  it('ignores a query string or fragment', () => {
    expect(
      urlLoadsExtensionAsset(`chrome-extension://abc/${CORE}?v=1#x`, CORE)
    ).toBe(true);
  });

  it('does not accept a remote url with the same path', () => {
    expect(
      urlLoadsExtensionAsset(`https://cdn.example.com/${CORE_JS}`, CORE_JS)
    ).toBe(false);
    expect(urlLoadsExtensionAsset(CORE_JS, CORE_JS)).toBe(false);
  });
});
