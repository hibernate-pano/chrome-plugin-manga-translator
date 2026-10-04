#!/usr/bin/env node

import { readFileSync } from 'node:fs';
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

console.log(
  `[release-check] version ${packageJson.version} is consistent; ${sizeNote}`
);
