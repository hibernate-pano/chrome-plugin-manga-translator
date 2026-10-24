#!/usr/bin/env node

/**
 * check-release-consistency.mjs
 *
 * Guards a build against two classes of mistake:
 *
 *   1. Source-level: the version in package.json must match the manifest, and
 *      the manifest's fields must fit the Chrome Web Store's limits. These can
 *      be checked at any time, before or after the build.
 *
 *   2. Artifact-level: the built content script must fit its size budget, the
 *      built manifest's web-accessible resources must cover every path the
 *      runtime actually loads, and no web-accessible file may contain the API
 *      key obfuscation salt. These can only be checked once `dist/` exists and
 *      reflects the current source.
 *
 * The two classes are separated by the `--source-only` flag, and the flag is
 * not a convenience — it is the difference between checking and not checking.
 *
 * The script used to infer the phase from the presence of `dist/`, which
 * produced two failure modes that both had the same root cause:
 *
 *   - **A stale `dist/` was judged as if it were the new one.** `pnpm build`
 *     runs this script before Vite. If a previous build had left a `dist/`
 *     behind, the pre-build call inspected THAT one — so a fix that only
 *     takes effect during the build (such as removing `content.js` from
 *     `web_accessible_resources`) could never be applied: the check failed on
 *     the old artifact and blocked the very build that would have fixed it.
 *     The check was a deadlock.
 *
 *   - **A build that produced nothing passed.** With no `dist/manifest.json`,
 *     every artifact check took its "not built yet" branch and returned
 *     success. A Vite build that wrote no output at all was reported as a
 *     clean release.
 *
 * Both are now impossible: the phase is stated explicitly, and the artifact
 * phase insists that the artifact exists.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
);
const manifest = JSON.parse(
  readFileSync(join(projectRoot, 'public', 'manifest.json'), 'utf8')
);

/**
 * Source-only mode: check what can be checked without a build, and say so
 * plainly instead of pretending to have checked the artifact.
 */
const sourceOnly = process.argv.includes('--source-only');

/**
 * Assert the built manifest still exposes every resource the built output loads
 * at runtime.
 *
 * `vite.config.ts` prunes `web_accessible_resources` down to what is actually
 * used. The pruning once went too far in the other direction: the content
 * script Chrome registers used to be a CRXJS loader that does
 * `import(chrome.runtime.getURL('content.js'))`, so dropping `content.js` from
 * the list made the dynamic import fail on every page — and because the loader
 * swallows the rejection into `console.error`, the extension looked installed
 * and healthy while doing nothing at all. Size and version checks cannot see
 * that class of mistake, so this one can.
 *
 * The loader is gone now (the content script is registered as a plain static
 * file), so `content.js` is no longer among the runtime-loaded paths and
 * nothing forces it back into the exposed list.
 */
function checkWebAccessibleIntegrity() {
  const distDir = join(projectRoot, 'dist');
  const builtManifestPath = join(distDir, 'manifest.json');
  if (!existsSync(builtManifestPath)) {
    fail(
      'dist/manifest.json is missing — the build produced no manifest, so there is nothing to release'
    );
  }

  const built = JSON.parse(readFileSync(builtManifestPath, 'utf8'));
  const exposed = new Set(
    (built.web_accessible_resources ?? []).flatMap(group => group.resources)
  );

  const required = new Set();
  const getUrlCall = /getURL\(\s*['"]([^'"]+)['"]\s*\)/g;
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.js')) continue;
      const source = readFileSync(full, 'utf8');
      let match;
      while ((match = getUrlCall.exec(source))) {
        const raw = match[1];
        if (!raw || raw.includes('://') || !/^[A-Za-z0-9._/-]+$/.test(raw)) {
          continue;
        }
        required.add(raw.replace(/^\.?\//, ''));
      }
    }
  };
  walk(distDir);

  const missing = [...required].filter(
    resource =>
      !exposed.has(resource) &&
      // A `dir/*` declaration covers any concrete file beneath it.
      ![...exposed].some(
        entry => entry.endsWith('/*') && resource.startsWith(entry.slice(0, -1))
      )
  );

  if (missing.length > 0) {
    console.error(
      `[release-check] runtime-loaded resources missing from web_accessible_resources: ${missing.join(', ')}`
    );
    console.error(
      '[release-check] a content script or worker that resolves chrome.runtime.getURL(...) for a ' +
        'non-exposed path fails silently in the page context. Keep these declared, or remove the load.'
    );
    process.exit(1);
  }

  return `web_accessible_resources covers ${required.size} runtime-loaded path(s)`;
}

/**
 * Refuse to ship a build whose web-accessible resources can be read by any
 * page, and that contain the API key obfuscation code.
 *
 * The salt in `src/utils/crypto.ts` ships in the bundle, and the XOR routine
 * that uses it ships next to it. Together they reverse the `obf:` form of a
 * stored API key back to plaintext. A content script is not a security
 * boundary anyway — the page it runs in can observe it — but the key itself
 * is the user's credential, and it should not be handed to every site the
 * user visits.
 *
 * CRXJS used to force `content.js` into `web_accessible_resources` for every
 * page, because it registers the content script as a loader that does
 * `import(chrome.runtime.getURL('content.js'))`. That made the salt readable
 * by any site via `fetch(chrome.runtime.getURL('content.js'))`. The content
 * script is now registered as a plain static file, which Chrome injects
 * directly, so it does not need to be exposed at all.
 *
 * This check exists so that a future change cannot quietly put it back. It
 * fails on two independent conditions:
 *
 *   1. `content.js` itself is web-accessible, or
 *   2. any web-accessible file contains the obfuscation salt.
 *
 * The second condition is the one that actually matters — it catches the salt
 * being smuggled into an exposed chunk under a different name, which is what
 * a "just move it to its own chunk" refactor would do.
 */
function checkNoSecretsExposed() {
  const distDir = join(projectRoot, 'dist');
  const builtManifestPath = join(distDir, 'manifest.json');
  if (!existsSync(builtManifestPath)) {
    fail(
      'dist/manifest.json is missing — the build produced no manifest, so there is nothing to release'
    );
  }

  const built = JSON.parse(readFileSync(builtManifestPath, 'utf8'));
  const groups = built.web_accessible_resources ?? [];
  const exposed = groups.flatMap(group => group.resources ?? []);

  // 1. The content script must not be reachable from a page.
  if (exposed.includes('content.js')) {
    console.error(
      '[release-check] web_accessible_resources exposes content.js to every page'
    );
    console.error(
      '[release-check] any site can then fetch(chrome.runtime.getURL("content.js")) and read the ' +
        'API key obfuscation salt out of it. Register the content script as a static file instead ' +
        '(see promoteContentScriptToStaticEntry in vite.config.ts).'
    );
    process.exit(1);
  }

  // 2. No exposed file may contain the obfuscation salt, whatever it is named.
  const SALT = 'manga-translator-salt';
  const offenders = [];
  const check = relativePath => {
    const full = join(distDir, relativePath);
    if (!existsSync(full) || !statSync(full).isFile()) return;
    if (!/\.(js|mjs|cjs|html|css|json)$/.test(relativePath)) return;
    if (readFileSync(full, 'utf8').includes(SALT)) {
      offenders.push(relativePath);
    }
  };

  for (const resource of exposed) {
    if (resource.endsWith('/*')) {
      const dir = join(distDir, resource.slice(0, -1));
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        check(`${resource.slice(0, -1)}${entry}`);
      }
      continue;
    }
    check(resource);
  }

  if (offenders.length > 0) {
    console.error(
      `[release-check] web-accessible resources contain the API key obfuscation salt: ${offenders.join(', ')}`
    );
    console.error(
      '[release-check] the salt and the XOR routine that uses it turn a stored "obf:" key back ' +
        "into plaintext, so any page that can read this file can read the user's API key. " +
        'Do not place the key-obfuscation module in a web-accessible file.'
    );
    process.exit(1);
  }

  return `no key-obfuscation code is web-accessible (${exposed.length} exposed resource pattern(s))`;
}

/**
 * The content script is injected into every page the user opens, so its
 * weight is paid on page load rather than at extension install. This budget
 * exists because an over-broad `manualChunks` entry once pulled all of
 * react-dom (~110 KB) into the content bundle, tripling its size.
 */
const CONTENT_BUDGET_BYTES = 200 * 1024;

function checkContentScriptSize() {
  const contentPath = join(projectRoot, 'dist', 'content.js');
  if (!existsSync(contentPath)) {
    fail(
      'dist/content.js is missing — the build produced no content script, so there is nothing to release'
    );
  }
  const bytes = readFileSync(contentPath).length;
  if (bytes > CONTENT_BUDGET_BYTES) {
    console.error(
      `[release-check] content.js is ${(bytes / 1024).toFixed(1)} KB, over the ${(
        CONTENT_BUDGET_BYTES / 1024
      ).toFixed(0)} KB budget`
    );
    process.exit(1);
  }
  return `content.js ${(bytes / 1024).toFixed(1)} KB / ${(
    CONTENT_BUDGET_BYTES / 1024
  ).toFixed(0)} KB budget`;
}

/**
 * The credential boundary: the content script must not be able to reach the
 * module that holds the API key.
 *
 * This is checked on the *source* import graph rather than only on the built
 * artifact, because the artifact check is downstream of the mistake it is
 * supposed to prevent. A content script is injected into every page the user
 * opens, so a key in its bundle is a key in every page — and by the time the
 * built file can be inspected, the key has already been written to disk.
 *
 * The rule is structural: a module that holds a credential is only ever
 * imported by a privileged context (the worker, the Settings page, the
 * onboarding modal). `src/shared/preloaded-config.ts` is that module, and
 * `src/shared/env-credentials.generated.ts` is what it wraps. If the content
 * script's import closure reaches either, the build fails here — before Vite
 * ever writes a bundle.
 *
 * Type-only imports are erased at compile time and are not edges in the
 * bundle graph, so they are not followed. That distinction matters: a
 * `import type { ProviderSettings }` is documentation, not a dependency.
 *
 * `src/utils/crypto.ts` is in the list for a related reason. It holds no
 * key, but it holds the *salt* and the XOR routine that turn a stored `obf:`
 * value back into plaintext, so a content script that could reach it could
 * un-obfuscate the key it reads out of storage. The salt check further down
 * only looks at web-accessible files, and the content script is not one — so
 * without this entry the build gate and the test gate would cover different
 * module sets, and "just run `pnpm build`" would quietly let the
 * obfuscation code into the bundle.
 */
const CREDENTIAL_MODULES = [
  'src/shared/env-credentials.generated.ts',
  'src/shared/env-credentials.ts',
  'src/shared/preloaded-config.ts',
  'src/utils/crypto.ts',
];

/**
 * Resolve an import specifier to a file inside the project.
 */
function resolveImport(specifier, fromFile) {
  let base;
  if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith('@/')) {
    base = join(projectRoot, 'src', specifier.slice(2));
  } else {
    return null;
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Collect the modules a file depends on at runtime.
 *
 * `import type {...}` is erased and is not a dependency. `import { type A, b }`
 * is a real dependency because `b` survives the compile.
 */
function runtimeImports(source) {
  const specifiers = [];
  const named = /\{([\s\S]*)\}/;

  // import ... from '...'
  const fromPattern = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  let match;
  while ((match = fromPattern.exec(source))) {
    const clause = match[1].trim();
    // A type-only import carries no runtime dependency.
    if (/^type\s/.test(clause)) continue;
    // `import { type A, type B } from '...'` is type-only as a whole.
    const bindings = clause.match(named);
    if (bindings) {
      const names = bindings[1]
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
      if (names.length > 0 && names.every(part => /^type\s/.test(part))) {
        continue;
      }
    }
    specifiers.push(match[2]);
  }

  // import '...' | export ... from '...' | import('...')
  const others = [
    /^import\s+['"]([^'"]+)['"]/gm,
    /^export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of others) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(source))) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

/**
 * Compute every module reachable from an entry point.
 */
function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of runtimeImports(source)) {
      const resolved = resolveImport(specifier, file);
      if (resolved && !seen.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return seen;
}

function checkCredentialBoundary() {
  const contentEntry = join(projectRoot, 'src', 'content', 'content.ts');
  if (!existsSync(contentEntry)) {
    fail(
      'src/content/content.ts is missing — there is no content script to check'
    );
  }

  const closure = importClosure(contentEntry);
  const reached = CREDENTIAL_MODULES.filter(module =>
    closure.has(join(projectRoot, module))
  );

  if (reached.length > 0) {
    console.error(
      `[release-check] the content script can reach the credential module: ${reached.join(', ')}`
    );
    console.error(
      '[release-check] the content script is injected into every page the user opens, so a key it ' +
        'can reach is a key in every page. Keep the key in a module that only the worker and the ' +
        "extension's own pages import, and keep the endpoint/model in @/shared/app-config."
    );
    process.exit(1);
  }

  return `content script reaches no credential module (${closure.size} module(s) in closure)`;
}

/**
 * Refuse to ship a build whose content script has a credential baked into it.
 *
 * This is the artifact-level backstop for the source-level boundary check
 * above. The two answer different questions: the boundary check asks whether
 * the *code* can reach a key, and this one asks whether a key actually made it
 * into the *bytes* that get injected into every page.
 */
function checkNoCredentialsInContentScript() {
  const contentPath = join(projectRoot, 'dist', 'content.js');
  if (!existsSync(contentPath)) {
    fail(
      'dist/content.js is missing — the build produced no content script, so there is nothing to release'
    );
  }

  const generatedPath = join(
    projectRoot,
    'src',
    'shared',
    'env-credentials.generated.ts'
  );
  const credentials = new Set();
  if (existsSync(generatedPath)) {
    // The credentials are read structurally, not by scanning for string
    // literals. A literal scan would treat a provider *name* — "opencode" is
    // eight characters — as a credential, and the guard would then fail on
    // every build for a reason that has nothing to do with the key.
    const source = readFileSync(generatedPath, 'utf8');
    const match = /export const ENV_CREDENTIALS = (\{[\s\S]*\}) as const;/.exec(
      source
    );
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        for (const provider of Object.values(parsed)) {
          const key = provider?.apiKey;
          if (typeof key === 'string' && key.length >= 8) {
            credentials.add(key);
          }
        }
      } catch {
        fail(
          'src/shared/env-credentials.generated.ts could not be parsed — run scripts/inject-env-config.mjs'
        );
      }
    }
  }

  if (credentials.size === 0) {
    return 'content.js carries no build-time credential (build has none)';
  }

  const content = readFileSync(contentPath, 'utf8');
  const leaked = [...credentials].filter(credential =>
    content.includes(credential)
  );

  if (leaked.length > 0) {
    console.error(
      '[release-check] dist/content.js contains a build-time API key'
    );
    console.error(
      '[release-check] the content script is injected into every page the user visits. A key in it ' +
        'is a key in every page. Split the build-time configuration: endpoints and models in ' +
        '@/shared/env-config, keys in @/shared/env-credentials, and let only the worker import the latter.'
    );
    process.exit(1);
  }

  return `content.js carries none of the ${credentials.size} build-time credential(s)`;
}

/**
 * Chrome Web Store field limits, from
 * https://developer.chrome.com/docs/extensions/reference/manifest
 * ("Keys required by Chrome Web Store") and the Web Store title rules.
 *
 * The description shipped at 172 characters for months without anything
 * objecting, because no check ever counted them. Chrome documents 132 as the
 * maximum, and the field is listed under the keys the Web Store requires — so
 * this is a submission blocker, not a style preference. Fail loudly here
 * rather than discover it at upload time.
 */
const STORE_FIELD_LIMITS = [
  { key: 'name', limit: 45 },
  { key: 'description', limit: 132 },
];

function checkStoreFieldLimits() {
  const violations = [];
  for (const { key, limit } of STORE_FIELD_LIMITS) {
    const value = manifest[key];
    if (typeof value !== 'string') {
      violations.push(`${key} is missing or not a string`);
      continue;
    }
    if (value.length > limit) {
      violations.push(
        `${key} is ${value.length} characters, over the ${limit}-character limit by ${value.length - limit}`
      );
    }
  }

  if (violations.length > 0) {
    console.error('[release-check] invalid Chrome Web Store manifest fields:');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  return STORE_FIELD_LIMITS.map(
    ({ key, limit }) => `${key} ${manifest[key].length}/${limit}`
  ).join(', ');
}

function fail(message) {
  console.error(`[release-check] ${message}`);
  process.exit(1);
}

if (packageJson.version !== manifest.version) {
  console.error(
    `[release-check] version mismatch: package.json=${packageJson.version} manifest.json=${manifest.version}`
  );
  process.exit(1);
}

const fieldNote = checkStoreFieldLimits();
const boundaryNote = checkCredentialBoundary();

if (sourceOnly) {
  // The artifact has not been built yet (or is a leftover from a previous
  // build). Judging it here would either block the build that would fix it or
  // pass by accident, so the artifact checks are deferred to the post-build
  // invocation instead.
  console.log(
    `[release-check] version ${packageJson.version} is consistent; ${fieldNote}; ${boundaryNote}; artifact checks deferred to the post-build pass`
  );
  process.exit(0);
}

const sizeNote = checkContentScriptSize();
const resourceNote = checkWebAccessibleIntegrity();
const exposureNote = checkNoSecretsExposed();
const credentialNote = checkNoCredentialsInContentScript();

console.log(
  `[release-check] version ${packageJson.version} is consistent; ${sizeNote}; ${resourceNote}; ${exposureNote}; ${boundaryNote}; ${credentialNote}; ${fieldNote}`
);
