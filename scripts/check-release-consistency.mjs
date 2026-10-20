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

if (sourceOnly) {
  // The artifact has not been built yet (or is a leftover from a previous
  // build). Judging it here would either block the build that would fix it or
  // pass by accident, so the artifact checks are deferred to the post-build
  // invocation instead.
  console.log(
    `[release-check] version ${packageJson.version} is consistent; ${fieldNote}; artifact checks deferred to the post-build pass`
  );
  process.exit(0);
}

const sizeNote = checkContentScriptSize();
const resourceNote = checkWebAccessibleIntegrity();
const exposureNote = checkNoSecretsExposed();

console.log(
  `[release-check] version ${packageJson.version} is consistent; ${sizeNote}; ${resourceNote}; ${exposureNote}; ${fieldNote}`
);
