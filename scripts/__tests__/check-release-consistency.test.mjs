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
  mkdirSync(join(workdir, 'src', 'content'), { recursive: true });
  mkdirSync(join(workdir, 'src', 'shared'), { recursive: true });
  mkdirSync(join(workdir, 'src', 'utils'), { recursive: true });
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
  writeSourceTree(workdir);
  return workdir;
}

/**
 * The credential half of the build-time configuration, in the shape the
 * injection script writes it.
 */
const FAKE_KEY = 'sk-guardfixturekey0123456789';

/**
 * A source tree the credential-boundary check can walk: a content script that
 * reaches the endpoint half of the build-time configuration but not the
 * credential half.
 */
function writeSourceTree(workdir) {
  writeFileSync(
    join(workdir, 'src', 'shared', 'app-config.ts'),
    [
      "import { ENV_CONFIG } from './env-config';",
      'export const DEFAULT_CONFIG = {',
      '  baseUrl: ENV_CONFIG.minimax.baseUrl,',
      '  model: ENV_CONFIG.minimax.model,',
      '};',
    ].join('\n')
  );
  writeFileSync(
    join(workdir, 'src', 'shared', 'env-config.ts'),
    [
      "import { ENV_CONFIG as GENERATED } from './env-config.generated';",
      'export const ENV_CONFIG = GENERATED;',
    ].join('\n')
  );
  writeFileSync(
    join(workdir, 'src', 'shared', 'env-config.generated.ts'),
    [
      'export const ENV_CONFIG = {',
      '  "minimax": { "baseUrl": "https://api.example.com/v1", "model": "m" }',
      '} as const;',
    ].join('\n')
  );
  writeFileSync(
    join(workdir, 'src', 'shared', 'env-credentials.generated.ts'),
    [
      'export const ENV_CREDENTIALS = {',
      `  "minimax": { "apiKey": "${FAKE_KEY}" }`,
      '} as const;',
    ].join('\n')
  );
  writeFileSync(
    join(workdir, 'src', 'content', 'content.ts'),
    [
      "import { DEFAULT_CONFIG } from '@/shared/app-config';",
      'export const base = DEFAULT_CONFIG.baseUrl;',
    ].join('\n')
  );
  // The key-obfuscation module: it holds no key, but it holds the salt and
  // the XOR routine that turn a stored "obf:" value back into plaintext. It
  // sits in the tree, unreferenced, so the "content script reaches nothing"
  // case below is a real one rather than an empty tree.
  writeFileSync(
    join(workdir, 'src', 'utils', 'crypto.ts'),
    [
      "const SALT = 'manga-translator-salt';",
      'export function deobfuscate(key: string): string {',
      '  return key.split("").map((c, i) => c).join("") + SALT.length;',
      '}',
    ].join('\n')
  );
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

/**
 * The credential boundary.
 *
 * The content script is injected into every page the user opens, so a key it
 * can reach is a key in every page. The v3 hardening round claimed this was
 * fixed while `dist/content.js` still carried the plaintext key: the key
 * reached the content script through `app-config.ts` → `env-config.ts` →
 * `env-config.generated.ts`, and nothing checked.
 *
 * Both directions are pinned here, because a guard that only ever passes is
 * worse than no guard at all.
 */
describe('release consistency guard: the credential boundary', () => {
  it('accepts a content script that cannot reach the credential module', () => {
    const workdir = makeWorkdir();
    try {
      const result = runGuard(workdir);
      expect(result.code).toBe(0);
      expect(result.output).toContain(
        'content script reaches no credential module'
      );
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the content script can reach the credential module', () => {
    const workdir = makeWorkdir();
    try {
      // The exact mistake: a content script that imports the module holding
      // the key. The bundle would then carry the key into every page.
      writeFileSync(
        join(workdir, 'src', 'content', 'content.ts'),
        [
          "import { ENV_CREDENTIALS } from '@/shared/env-credentials.generated';",
          'export const key = ENV_CREDENTIALS.minimax.apiKey;',
        ].join('\n')
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('can reach the credential module');
      expect(result.output).toContain('env-credentials.generated.ts');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the import carries a default binding next to a type-only one', () => {
    const workdir = makeWorkdir();
    try {
      /*
       * `import credentials, { type ProviderType } from '...'` is a runtime
       * dependency: the default binding survives the compile. A scanner that
       * reads "every name in the braces starts with `type`" and stops there
       * would call this one type-only and let the key through.
       */
      writeFileSync(
        join(workdir, 'src', 'content', 'content.ts'),
        [
          "import credentials, { type ProviderType } from '@/shared/env-credentials.generated';",
          'export const key = credentials.minimax.apiKey;',
        ].join('\n')
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('can reach the credential module');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the import is indented', () => {
    const workdir = makeWorkdir();
    try {
      /*
       * An import that is not at the start of the line is still an import.
       * A scanner that anchors its pattern to the beginning of the line
       * never sees it.
       */
      writeFileSync(
        join(workdir, 'src', 'content', 'content.ts'),
        [
          "  import { ENV_CREDENTIALS } from '@/shared/env-credentials.generated';",
          'export const key = ENV_CREDENTIALS.minimax.apiKey;',
        ].join('\n')
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('can reach the credential module');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('checks the source graph only after the credential files are generated', () => {
    /*
     * The credential module is generated, not committed: a clean checkout
     * does not have it. If the source-level check runs before the
     * generation, the module is not on disk, the import graph cannot reach
     * it, and the first gate of the credential boundary passes without
     * looking. The artifact gate still catches a real key, but the source
     * gate is the one that stops the mistake before anything is written.
     */
    const repoRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..'
    );
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8')
    );

    for (const script of ['build', 'build:public']) {
      const command = pkg.scripts[script];
      const generated = command.indexOf('inject-env-config.mjs');
      const checked = command.indexOf(
        'check-release-consistency.mjs --source-only'
      );
      expect(
        generated,
        `${script} generates the credential files`
      ).toBeGreaterThan(-1);
      expect(checked, `${script} runs the source-level check`).toBeGreaterThan(
        -1
      );
      expect(
        generated,
        `${script} checks the source graph after the generation`
      ).toBeLessThan(checked);
    }
  });

  it('fails when the content script reaches the key through a shared module', () => {
    const workdir = makeWorkdir();
    try {
      // The indirect route: the content script never names the credential
      // module, but a module it does import does.
      writeFileSync(
        join(workdir, 'src', 'shared', 'preloaded-config.ts'),
        [
          "import { ENV_CREDENTIALS } from './env-credentials.generated';",
          'export const PRELOADED = ENV_CREDENTIALS.minimax.apiKey;',
        ].join('\n')
      );
      writeFileSync(
        join(workdir, 'src', 'shared', 'app-config.ts'),
        [
          "import { PRELOADED } from './preloaded-config';",
          'export const DEFAULT_CONFIG = { key: PRELOADED };',
        ].join('\n')
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('can reach the credential module');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the content script reaches the key-obfuscation module', () => {
    const workdir = makeWorkdir();
    try {
      // The salt check only looks at web-accessible files, and the content
      // script is not one — so without the obfuscation module in the
      // boundary list, "just run `pnpm build`" would let the salt and the
      // XOR routine into the bundle that is injected into every page. A
      // content script that can de-obfuscate can read the user's key.
      writeFileSync(
        join(workdir, 'src', 'content', 'content.ts'),
        [
          "import { deobfuscate } from '@/utils/crypto';",
          'export const key = deobfuscate("obf:whatever");',
        ].join('\n')
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('can reach the credential module');
      expect(result.output).toContain('utils/crypto.ts');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('does not treat a type-only import as a dependency', () => {
    const workdir = makeWorkdir();
    try {
      // A type-only import is erased at compile time, so it cannot carry a
      // key into the bundle. Flagging it would train people to work around
      // the guard instead of fixing the real leak.
      writeFileSync(
        join(workdir, 'src', 'content', 'content.ts'),
        [
          "import type { ENV_CREDENTIALS } from '@/shared/env-credentials.generated';",
          'export type Key = typeof ENV_CREDENTIALS;',
        ].join('\n')
      );

      const result = runGuard(workdir);
      expect(result.code).toBe(0);
      expect(result.output).toContain(
        'content script reaches no credential module'
      );
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('fails when the built content script carries the key', () => {
    const workdir = makeWorkdir();
    try {
      // The source boundary is clean, but the key is in the bytes anyway —
      // the artifact check is the backstop for a route the source graph does
      // not show.
      writeFileSync(
        join(workdir, 'dist', 'content.js'),
        `var key = "${FAKE_KEY}";`
      );

      const result = runGuard(workdir);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain(
        'dist/content.js contains a build-time API key'
      );
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
