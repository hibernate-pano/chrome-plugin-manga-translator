/**
 * The store-claims guard exists because a promise without code behind it is a
 * false statement in a Chrome Web Store submission, not a wording problem.
 *
 * This project shipped that mistake twice: v2.0.0 removed an invented "text
 * eraser" feature from the listing, and the same mistake returned in a later
 * draft under a different name ("超长图自动拼接"). A guard that only ever
 * passes is worse than no guard at all, so the tests below pin both
 * directions: a promise whose code anchor disappears must fail, and a
 * document that stops making a promise the table records must fail too.
 *
 * The script resolves `docs/` and `src/` from the repository root, which is
 * derived from the script's own location. It is therefore exercised by
 * copying the script itself into a throwaway tree, so the copy resolves the
 * throwaway tree as its root — the same technique the release-consistency
 * guard's tests use.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'check-store-claims.mjs'
);

function runGuard(workdir, args = []) {
  const localScript = join(workdir, 'scripts', 'check-store-claims.mjs');
  try {
    const stdout = execFileSync('node', [localScript, ...args], {
      cwd: workdir,
      encoding: 'utf8',
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

/**
 * A minimal tree the guard accepts: one promise, one code anchor that exists,
 * and one document that makes the promise.
 */
const CLAIMS_TABLE = [
  '| 承诺 | 代码锚点 | 文案 |',
  '| --- | --- | --- |',
  '| 译文叠加在原图 | `src/services/renderer.ts:OverlayRenderer` | listing: 译文叠加在原图 |',
].join('\n');

const CLAIMS_DOC = [
  '# 对外承诺 → 代码锚点对照表',
  '',
  '| 列 | 含义 |',
  '| --- | --- |',
  '| 承诺 | 对外做出这句承诺的事实本身 |',
  '',
  '## 对照表',
  '',
  CLAIMS_TABLE,
  '',
].join('\n');

function makeWorkdir({ claims = CLAIMS_DOC } = {}) {
  const workdir = mkdtempSync(join(tmpdir(), 'mt-store-claims-'));
  mkdirSync(join(workdir, 'scripts'), { recursive: true });
  mkdirSync(join(workdir, 'docs'), { recursive: true });
  mkdirSync(join(workdir, 'src', 'services'), { recursive: true });
  copyFileSync(scriptPath, join(workdir, 'scripts', 'check-store-claims.mjs'));

  writeFileSync(join(workdir, 'docs', 'store-claims.md'), claims);
  writeFileSync(
    join(workdir, 'docs', 'store-listing-zh.md'),
    '这里描述了译文叠加在原图这件事。\n'
  );
  writeFileSync(
    join(workdir, 'docs', 'privacy-policy.md'),
    'Nothing is collected.\n'
  );
  writeFileSync(
    join(workdir, 'docs', 'store-review-notes-zh.md'),
    '权限理由。\n'
  );
  writeFileSync(
    join(workdir, 'docs', 'chrome-web-store-release.md'),
    'Release checklist.\n'
  );
  writeFileSync(join(workdir, 'README.md'), '# Readme\n');
  writeFileSync(
    join(workdir, 'src', 'services', 'renderer.ts'),
    'export class OverlayRenderer {\n  render() {}\n}\n'
  );
  return workdir;
}

describe('store claims guard', () => {
  it('accepts a promise whose code anchor still exists', () => {
    const workdir = makeWorkdir();
    try {
      const result = runGuard(workdir);
      expect(result.code).toBe(0);
      expect(result.output).toContain('promise(s) verified');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the symbol behind a promise is deleted', () => {
    const workdir = makeWorkdir();
    try {
      // The promise still reads fine in the listing; only the code behind it
      // is gone. That is exactly the drift this guard exists to catch.
      writeFileSync(
        join(workdir, 'src', 'services', 'renderer.ts'),
        'export function somethingElse() {}\n'
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('lost its code support');
      expect(result.output).toContain('OverlayRenderer');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the file behind a promise no longer exists', () => {
    const workdir = makeWorkdir();
    try {
      rmSync(join(workdir, 'src', 'services', 'renderer.ts'), {
        force: true,
      });

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('does not exist');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the claims table is malformed', () => {
    const workdir = makeWorkdir({
      claims: CLAIMS_DOC.replace(
        '| 译文叠加在原图 | `src/services/renderer.ts:OverlayRenderer` | listing: 译文叠加在原图 |',
        '| 译文叠加在原图 | `src/services/renderer.ts:OverlayRenderer` |'
      ),
    });
    try {
      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('claims table row has 2 cells');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the claims table has no recognisable header', () => {
    const workdir = makeWorkdir({
      claims: '# 对外承诺\n\n| 承诺 | 支撑 |\n| --- | --- |\n| x | y |\n',
    });
    try {
      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('no claims table found');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when a document stops making a promise the table records', () => {
    const workdir = makeWorkdir();
    try {
      // The code is untouched and still supports the promise; the document has
      // simply stopped saying it. The reverse check is what notices.
      writeFileSync(
        join(workdir, 'docs', 'store-listing-zh.md'),
        '这里描述了别的事情。\n'
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(
        'is claimed in docs/store-listing-zh.md but that text no longer appears there'
      );
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when a placement names a document that does not exist', () => {
    const workdir = makeWorkdir({
      claims: CLAIMS_DOC.replace(
        'listing: 译文叠加在原图',
        'roadmap: 译文叠加在原图'
      ),
    });
    try {
      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('names an unknown document');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('accepts the source-only flag as a no-op', () => {
    const workdir = makeWorkdir();
    try {
      // The check never reads `dist/`, so the phase flag cannot change the
      // outcome. It exists only so the build wiring reads the same way as the
      // release-consistency guard's does.
      const result = runGuard(workdir, ['--source-only']);
      expect(result.code).toBe(0);
      expect(result.output).toContain('promise(s) verified');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
