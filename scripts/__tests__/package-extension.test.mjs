/**
 * The store package has a licence obligation the build cannot see.
 *
 * `THIRD-PARTY-NOTICES` lives at the repository root, outside `dist/`, and is
 * added to the ZIP by the packaging step. Both directions matter: a package
 * that silently drops the notices is a licence violation, and a notices file
 * that lands inside a subdirectory is not where the store's extracted archive
 * expects it. These tests run the real packager in a throwaway tree, the same
 * way the release-consistency tests exercise their guard, because the script
 * derives its root from its own location.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGER_SCRIPTS = [
  'package-extension.mjs',
  'source-fingerprint.mjs',
  'record-source-fingerprint.mjs',
];

/** Throwaway trees, removed after each test. */
const workdirs = [];

const VERSION = '9.9.9';
const zipName = `manga-translator-v${VERSION}-public.zip`;

/**
 * A minimal tree the packager accepts: a version-consistent dist, and the
 * scripts plus a recorded source fingerprint. `public/` and `src/` are absent
 * on purpose — the fingerprint tolerates that, and the packager never reads
 * them.
 */
function makeWorkdir() {
  const workdir = mkdtempSync(join(tmpdir(), 'mt-package-extension-'));
  workdirs.push(workdir);

  mkdirSync(join(workdir, 'scripts'), { recursive: true });
  mkdirSync(join(workdir, 'dist'), { recursive: true });
  for (const name of PACKAGER_SCRIPTS) {
    copyFileSync(join(scriptsDir, name), join(workdir, 'scripts', name));
  }

  writeFileSync(
    join(workdir, 'package.json'),
    `${JSON.stringify({ name: 'package-test', version: VERSION }, null, 2)}\n`
  );
  writeFileSync(
    join(workdir, 'dist', 'manifest.json'),
    `${JSON.stringify({ manifest_version: 3, version: VERSION }, null, 2)}\n`
  );
  writeFileSync(join(workdir, 'dist', 'content.js'), 'console.log(1);\n');

  execFileSync(
    'node',
    [join(workdir, 'scripts', 'record-source-fingerprint.mjs')],
    { cwd: workdir, encoding: 'utf8' }
  );

  return workdir;
}

function runPackager(workdir) {
  try {
    const stdout = execFileSync(
      'node',
      [join(workdir, 'scripts', 'package-extension.mjs')],
      { cwd: workdir, encoding: 'utf8' }
    );
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function zipEntries(zipPath) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

afterEach(() => {
  while (workdirs.length > 0) {
    rmSync(workdirs.pop(), { recursive: true, force: true });
  }
});

describe('package:public third-party notices', () => {
  it('refuses to package when THIRD-PARTY-NOTICES is missing', () => {
    const workdir = makeWorkdir();

    const result = runPackager(workdir);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('THIRD-PARTY-NOTICES');
    expect(result.output).toContain('missing from the repository root');
    expect(existsSync(join(workdir, 'release', zipName))).toBe(false);
  });

  it('places THIRD-PARTY-NOTICES at the ZIP root', () => {
    const workdir = makeWorkdir();
    const notices = 'Third-party notices placeholder\n';
    writeFileSync(join(workdir, 'THIRD-PARTY-NOTICES'), notices);

    const result = runPackager(workdir);

    expect(result.code).toBe(0);
    const zipPath = join(workdir, 'release', zipName);
    const entries = zipEntries(zipPath);
    expect(entries).toContain('THIRD-PARTY-NOTICES');
    expect(entries).toContain('manifest.json');
    expect(
      execFileSync('unzip', ['-p', zipPath, 'THIRD-PARTY-NOTICES'], {
        encoding: 'utf8',
      })
    ).toBe(notices);
  });
});
