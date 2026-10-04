/**
 * The public-build guard is the last line of defence between a private
 * `.env` and a published extension package. Before v1.4.0 its regex looked
 * for `apiKey:\s*"..."` while the generated file is JSON-shaped with the key
 * itself quoted, so it matched nothing and always reported success.
 *
 * These tests pin the failure behaviour by running the real script against
 * a temporary project tree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'check-public-build.mjs'
);

const FAKE_KEY = 'sk-AAAAAAAAAAAAAAAAAAAAAAdummy';

function envConfig(apiKey) {
  return [
    'export const ENV_CONFIG = {',
    '  "minimax": {',
    '    "baseUrl": "https://api.example.com/v1",',
    `    "apiKey": "${apiKey}",`,
    '    "model": "m"',
    '  }',
    '} as const;',
  ].join('\n');
}

let workdir;

function runGuard(args = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, ...args], {
      cwd: workdir,
      encoding: 'utf8',
      env: { ...process.env, MT_PUBLIC_BUILD_ROOT: workdir },
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function writeGenerated(apiKey) {
  writeFileSync(
    join(workdir, 'src', 'shared', 'env-config.generated.ts'),
    envConfig(apiKey)
  );
}

function writeDist(relativePath, contents) {
  const path = join(workdir, 'dist', relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

describe('check-public-build guard', () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'mt-public-build-'));
    mkdirSync(join(workdir, 'src', 'shared'), { recursive: true });
    mkdirSync(join(workdir, 'dist'), { recursive: true });
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('passes when the env config has empty keys and dist is clean', () => {
    writeGenerated('');
    writeDist('content.js', 'console.log("hello");');

    const result = runGuard();
    expect(result.output).toContain('verified');
    expect(result.code).toBe(0);
  });

  it('fails when a key is present in the generated env config', () => {
    writeGenerated(FAKE_KEY);
    writeDist('content.js', 'console.log("hello");');

    const result = runGuard();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('REFUSING');
  });

  it('fails when a key is baked into a dist bundle', () => {
    writeGenerated('');
    writeDist('content.js', `var key = "${FAKE_KEY}";`);

    const result = runGuard();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('REFUSING');
    expect(result.output).toContain('dist/content.js');
  });

  it('fails when a bearer header is baked into a dist bundle', () => {
    writeGenerated('');
    writeDist(
      'background.js',
      'headers.Authorization = "Bearer sk-ZZZZZZZZZZZZZZZZZZZZZZ";'
    );

    const result = runGuard();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('REFUSING');
  });

  it('refuses when dist is missing', () => {
    writeGenerated('');
    rmSync(join(workdir, 'dist'), { recursive: true, force: true });

    const result = runGuard();
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('dist/ is empty or missing');
  });

  it('--source-only checks config without requiring dist', () => {
    // Pre-build phase: dist/ still holds the previous (private) build, so the
    // guard must not look at it yet.
    writeGenerated('');
    rmSync(join(workdir, 'dist'), { recursive: true, force: true });

    const result = runGuard(['--source-only']);
    expect(result.output).toContain('build-time config');
    expect(result.code).toBe(0);
  });

  it('--source-only still rejects a key in build-time config', () => {
    writeGenerated(FAKE_KEY);
    writeDist('content.js', 'console.log("hello");');

    const result = runGuard(['--source-only']);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('REFUSING');
  });
});
