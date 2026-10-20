/**
 * The web-accessible-resources guard exists because of a real disclosure, not a
 * hypothetical one: CRXJS registered the content script as a loader that does
 * `import(chrome.runtime.getURL('content.js'))`, which forced `content.js` into
 * `web_accessible_resources` for every page. Any site could then fetch it and
 * read the API key obfuscation salt and the XOR routine next to it, which turn
 * a stored `obf:` key back into plaintext.
 *
 * The content script is now registered as a plain static file, so it is no
 * longer exposed. These tests pin both directions of the guard, because a
 * guard that only ever passes is worse than no guard at all.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'check-release-consistency.mjs'
);

/**
 * The script resolves `dist/` and `public/manifest.json` from the repository
 * root, which is derived from the script's own location. The guard is
 * therefore exercised by copying the script itself into a throwaway tree, so
 * the copy resolves the throwaway tree as its root.
 */
function runGuard(workdir, args = []) {
  const localScript = join(workdir, 'scripts', 'check-release-consistency.mjs');
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
 * A minimal tree the guard accepts: matching versions, a small content script,
 * a resource that is both exposed and resolved at runtime, and store-legal
 * manifest fields.
 */
function makeWorkdir() {
  const workdir = mkdtempSync(join(tmpdir(), 'mt-release-consistency-'));
  mkdirSync(join(workdir, 'public'), { recursive: true });
  mkdirSync(join(workdir, 'dist'), { recursive: true });
  mkdirSync(join(workdir, 'scripts'), { recursive: true });
  copyFileSync(
    scriptPath,
    join(workdir, 'scripts', 'check-release-consistency.mjs')
  );

  const manifest = {
    manifest_version: 3,
    name: '漫画翻译助手',
    version: '2.0.3',
    description: 'A short description that fits the Chrome Web Store limit.',
    content_scripts: [{ js: ['content.js'], matches: ['<all_urls>'] }],
    web_accessible_resources: [
      { matches: ['<all_urls>'], resources: ['tesseract/*'] },
    ],
  };
  writeFileSync(
    join(workdir, 'public', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  writeFileSync(
    join(workdir, 'package.json'),
    JSON.stringify({ name: 'x', version: '2.0.3' }, null, 2)
  );
  // The built manifest is what the resource and exposure checks read.
  writeFileSync(
    join(workdir, 'dist', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  // The content script resolves tesseract/* at runtime, so the guard's
  // "every runtime-loaded path must be exposed" rule is satisfied.
  writeFileSync(
    join(workdir, 'dist', 'content.js'),
    'chrome.runtime.getURL("tesseract/worker.min.js");'
  );
  return workdir;
}

function setWar(workdir, resources) {
  const path = join(workdir, 'public', 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.web_accessible_resources = [{ matches: ['<all_urls>'], resources }];
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  // The built manifest is what the guard reads, so mirror it.
  writeFileSync(
    join(workdir, 'dist', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}

describe('release consistency guard', () => {
  it('accepts a build whose only exposed resource is the OCR worker', () => {
    const workdir = makeWorkdir();
    try {
      const result = runGuard(workdir);
      expect(result.output).toContain(
        'no key-obfuscation code is web-accessible'
      );
      expect(result.code).toBe(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when content.js is web-accessible', () => {
    const workdir = makeWorkdir();
    try {
      setWar(workdir, ['tesseract/*', 'content.js']);
      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('exposes content.js');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the obfuscation salt is in a web-accessible file', () => {
    const workdir = makeWorkdir();
    try {
      // The salt hidden in an exposed chunk under a different name is the case
      // that matters: moving the key module into "its own chunk" would pass a
      // check that only looked at the file name.
      mkdirSync(join(workdir, 'dist', 'exposed'), { recursive: true });
      writeFileSync(
        join(workdir, 'dist', 'exposed', 'thing.js'),
        'const SALT = "manga-translator-salt";'
      );
      setWar(workdir, ['tesseract/*', 'exposed/*']);

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('obfuscation salt');
      expect(result.output).toContain('exposed/thing.js');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('does not flag the salt in files that are not web-accessible', () => {
    const workdir = makeWorkdir();
    try {
      // The salt legitimately lives in the extension's own chunks, which are
      // only ever loaded by the extension's own pages.
      writeFileSync(
        join(workdir, 'dist', 'chunks-crypto.js'),
        'const SALT = "manga-translator-salt";'
      );
      const result = runGuard(workdir);
      expect(result.code).toBe(0);
      expect(result.output).toContain(
        'no key-obfuscation code is web-accessible'
      );
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

/**
 * The phase distinction between "checking the source" and "checking the
 * artifact" is the reason this script takes a `--source-only` flag at all.
 *
 * It was added to break a deadlock: `pnpm build` runs the guard before Vite,
 * so the pre-build call used to inspect whatever `dist/` a previous build had
 * left behind. A fix that only takes effect during the build — removing
 * `content.js` from `web_accessible_resources` — could then never be applied,
 * because the guard failed on the stale artifact and blocked the build that
 * would have produced the fixed one.
 *
 * The same root cause had a second, quieter face: with no `dist/` at all,
 * every artifact check took its "not built yet" branch and returned success.
 * A build that produced nothing was reported as a clean release.
 *
 * Both are locked down below.
 */
describe('release consistency guard: build phase', () => {
  it('source-only mode does not judge a stale dist/', () => {
    const workdir = makeWorkdir();
    try {
      // The stale artifact still exposes content.js — exactly the state that
      // used to block the build that would have fixed it.
      setWar(workdir, ['tesseract/*', 'content.js']);

      const result = runGuard(workdir, ['--source-only']);
      expect(result.code).toBe(0);
      expect(result.output).toContain('artifact checks deferred');
      expect(result.output).not.toContain('exposes content.js');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('source-only mode still enforces the source-level checks', () => {
    const workdir = makeWorkdir();
    try {
      // Deferring the artifact checks must not turn the whole script into a
      // no-op: a version mismatch or an over-long store description is
      // knowable without a build, and is a submission blocker.
      const manifestPath = join(workdir, 'public', 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.description = 'x'.repeat(200);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const result = runGuard(workdir, ['--source-only']);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('over the 132-character limit');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('the artifact pass fails when the build produced no manifest', () => {
    const workdir = makeWorkdir();
    try {
      // A build that wrote nothing must not be reported as a clean release.
      rmSync(join(workdir, 'dist'), { recursive: true, force: true });

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('missing');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('the artifact pass fails when the build produced no content script', () => {
    const workdir = makeWorkdir();
    try {
      rmSync(join(workdir, 'dist', 'content.js'), { force: true });

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('no content script');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
