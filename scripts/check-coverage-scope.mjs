#!/usr/bin/env node
/**
 * Fail when a source file is missing from the coverage report.
 *
 * Vitest 0.34's v8 provider builds its denominator only from files a test
 * actually imported: `coverage.all` is off, and turning it on crashes in
 * v8-to-istanbul while resolving the sourcemap of an untested .tsx file. The
 * result is that a file with zero tests is not reported as 0% — it is absent,
 * so it cannot drag the number down, and `pnpm test:coverage` can pass while a
 * security-critical module is untested. That is how the service worker and both
 * app shells went missing behind an 81% "pass".
 *
 * So this script reads the emitted report and asserts every source file is
 * present, except those named in UNTESTED_ALLOWLIST below. That list is a debt
 * register: it may only shrink, and adding a file to it is a visible, reviewable
 * edit rather than a silent omission.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const reportPath = path.join(repoRoot, 'coverage/coverage-final.json');

/**
 * Files knowingly outside the denominator, with the reason each one is there.
 * Delete an entry once a test imports the file; do not add to this list without
 * a reason a reviewer can check.
 */
const UNTESTED_ALLOWLIST = new Set([
  // React shells for the two extension pages. Rendering them needs the whole
  // persist/store/transport graph mounted; their decision logic is extracted
  // into pure, tested modules (popup-state, app-config) instead.
  'src/components/Options/OptionsApp.tsx',
  'src/components/Popup/PopupApp.tsx',
  // Entry points that only call createRoot().render(); no logic to assert.
  'src/options.tsx',
  'src/popup.tsx',
]);

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (entry.endsWith('.d.ts')) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    const relative = path.relative(repoRoot, full).split(path.sep).join('/');
    // Test harness, not product code: vitest.config.ts already excludes
    // src/test/ from coverage, so it must not be demanded here either.
    if (relative.startsWith('src/test/')) continue;
    out.push(relative);
  }
  return out;
}

function main() {
  if (!existsSync(reportPath)) {
    console.error(
      '[coverage-scope] no coverage/coverage-final.json — run `pnpm test:coverage` first'
    );
    return 1;
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const reported = new Set(
    Object.keys(report).map(key =>
      path.relative(repoRoot, key).split(path.sep).join('/')
    )
  );
  const sources = collectSourceFiles(path.join(repoRoot, 'src'));

  const missing = sources.filter(
    file => !reported.has(file) && !UNTESTED_ALLOWLIST.has(file)
  );
  const stale = [...UNTESTED_ALLOWLIST].filter(
    file => !sources.includes(file) || reported.has(file)
  );

  if (missing.length > 0) {
    console.error(
      `[coverage-scope] ${missing.length} source file(s) are absent from the coverage report:`
    );
    for (const file of missing) console.error(`  - ${file}`);
    console.error(
      'A file nobody imports in a test is invisible to the 70% threshold, so it ' +
        'looks passing while untested. Add a test that imports it, or — only with ' +
        'a reason a reviewer can check — add it to UNTESTED_ALLOWLIST.'
    );
    return 1;
  }

  if (stale.length > 0) {
    console.error(
      `[coverage-scope] ${stale.length} allowlisted file(s) no longer need the exemption:`
    );
    for (const file of stale) console.error(`  - ${file}`);
    console.error('Remove them from UNTESTED_ALLOWLIST.');
    return 1;
  }

  console.log(
    `[coverage-scope] every source file is accounted for: ${sources.length - UNTESTED_ALLOWLIST.size}/${sources.length} in the denominator, ${UNTESTED_ALLOWLIST.size} explicitly exempted`
  );
  return 0;
}

process.exit(main());
