#!/usr/bin/env node
/* eslint-disable no-console -- CLI evidence script: stdout is the artifact */
/**
 * Evidence scanner for the Blue Argon remote-code finding.
 *
 * Prints every remote URL in the built package, then every remote *code*
 * vector (the class the Chrome Web Store rejects). Exits non-zero when a code
 * vector remains, so the same command can be used before and after the fix.
 *
 * Usage:
 *   node evidence/cws-blue-argon/scan-remote-code.mjs [dist]
 */

import { resolve } from 'node:path';

import {
  formatRemoteCodeFinding,
  scanTreeForRemoteCode,
  scanTreeForRemoteUrls,
} from '../../scripts/lib/remote-code-scan.mjs';

const root = resolve(process.argv[2] ?? 'dist');

console.log(`[scan] root: ${root}`);

const inventory = scanTreeForRemoteUrls(root);
console.log(
  `[scan] scanned ${inventory.scannedFiles} file(s); ` +
    `${inventory.urls.length} distinct remote URL(s)`
);
for (const { file, url } of inventory.urls) {
  console.log(`  URL ${file}: ${url}`);
}

const { scannedFiles, findings } = scanTreeForRemoteCode(root);
console.log(
  `[scan] remote code vectors: ${findings.length} ` +
    `(in ${scannedFiles} scanned file(s))`
);
for (const finding of findings) {
  console.log(`  VECTOR ${formatRemoteCodeFinding(finding)}`);
}

if (findings.length > 0) {
  console.error('[scan] FAIL: the package still contains loadable remote code');
  process.exit(1);
}

console.log('[scan] PASS: no loadable remote code in the package');
