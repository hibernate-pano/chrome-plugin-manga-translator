#!/usr/bin/env node

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

if (packageJson.version !== manifest.version) {
  console.error(
    `[release-check] version mismatch: package.json=${packageJson.version} manifest.json=${manifest.version}`
  );
  process.exit(1);
}

// The content script is injected into every page the user opens, so its
// weight is paid on page load rather than at extension install. This budget
// exists because an over-broad `manualChunks` entry once pulled all of
// react-dom (~110 KB) into the content bundle, tripling its size.
const CONTENT_BUDGET_BYTES = 200 * 1024;

let contentBytes = null;
try {
  contentBytes = readFileSync(join(projectRoot, 'dist', 'content.js')).length;
} catch {
  // No dist/ yet (e.g. the pre-build consistency check on a clean tree).
}

if (contentBytes !== null && contentBytes > CONTENT_BUDGET_BYTES) {
  console.error(
    `[release-check] content.js is ${(contentBytes / 1024).toFixed(1)} KB, over the ${(
      CONTENT_BUDGET_BYTES / 1024
    ).toFixed(0)} KB budget`
  );
  process.exit(1);
}

const sizeNote =
  contentBytes === null
    ? 'content.js not built yet, size budget skipped'
    : `content.js ${(contentBytes / 1024).toFixed(1)} KB / ${(
        CONTENT_BUDGET_BYTES / 1024
      ).toFixed(0)} KB budget`;

/**
 * Assert the built manifest still exposes every resource the built output loads
 * at runtime.
 *
 * `vite.config.ts` prunes `web_accessible_resources` down to what is actually
 * used, and that pruning once went too far: the content script Chrome registers
 * is a CRXJS loader that does `import(chrome.runtime.getURL('content.js'))`, so
 * dropping `content.js` from the list made the dynamic import fail on every
 * page — and because the loader swallows the rejection into `console.error`,
 * the extension looked installed and healthy while doing nothing at all. Size
 * and version checks cannot see that class of mistake, so this one can.
 */
function checkWebAccessibleIntegrity() {
  const distDir = join(projectRoot, 'dist');
  const builtManifestPath = join(distDir, 'manifest.json');
  if (!existsSync(builtManifestPath)) {
    return 'manifest not built yet, resource check skipped';
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

const resourceNote = checkWebAccessibleIntegrity();

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

const fieldNote = checkStoreFieldLimits();

console.log(
  `[release-check] version ${packageJson.version} is consistent; ${sizeNote}; ${resourceNote}; ${fieldNote}`
);
