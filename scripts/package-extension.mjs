#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintSourceChanged } from './source-fingerprint.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(projectRoot, 'dist');
const releaseDir = join(projectRoot, 'release');
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
);

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error(
    '[package] dist/manifest.json not found; run build:public first'
  );
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(join(distDir, 'manifest.json'), 'utf8')
);
if (manifest.version !== packageJson.version) {
  console.error(
    `[package] dist version ${manifest.version} does not match package ${packageJson.version}`
  );
  process.exit(1);
}

/**
 * The store package must carry the third-party notices.
 *
 * The bundled OCR data, tesseract.js and the rest of the dependency tree ship
 * their licences with an obligation to reproduce the notices. Keeping the file
 * at the repository root — rather than in `dist/`, which every build
 * regenerates — makes the requirement a property of the repository instead of
 * a build output that can go missing. Packaging refuses to produce a ZIP
 * without it; a package that silently drops the notices is a licence
 * violation, not a smaller download.
 */
const noticesName = 'THIRD-PARTY-NOTICES';
const noticesPath = join(projectRoot, noticesName);
if (!existsSync(noticesPath)) {
  console.error(
    `[package] ${noticesName} is missing from the repository root — refusing to build a store package without the third-party notices`
  );
  process.exit(1);
}

/**
 * Refuse to package a dist/ that does not match the source in front of us.
 *
 * `package:public` runs the build itself, so a stale artifact should be
 * impossible here — which is exactly why the check belongs in the packaging
 * step rather than in a habit. A ZIP built at 19:05 survived two later bug-fix
 * commits and was still sitting in release/ looking upload-ready, with a
 * matching .sha256 that made it look verified.
 */
const freshness = fingerprintSourceChanged();
if (freshness.changed) {
  console.error(
    `[package] dist/ does not match the current source (${freshness.reason}) — rebuild before packaging`
  );
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });
const zipName = `manga-translator-v${packageJson.version}-public.zip`;
const zipPath = join(releaseDir, zipName);
rmSync(zipPath, { force: true });

// `-x` rather than an ignore file: the exclusion has to apply while walking
// dist/, and `zip` has no portable "skip dotfiles" flag. `.DS_Store` in an
// uploaded store artifact is noise at best and an unexplained foreign file at
// worst, and macOS regenerates it in dist/ on nearly every build.
execFileSync(
  'zip',
  ['-qr', zipPath, '.', '-x', '*.DS_Store', '-x', '__MACOSX/*'],
  {
    cwd: distDir,
  }
);

// `-j` (junk paths) is what lands the notices at the ZIP root. The file sits
// outside dist/ on purpose, and the store reviews the extracted archive rather
// than the repository, so its location in the ZIP is the one that matters.
execFileSync('zip', ['-qj', zipPath, noticesPath]);

const digest = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(`${zipPath}.sha256`, `${digest}  ${zipName}\n`);

console.log(`[package] wrote release/${zipName}`);
console.log(`[package] sha256 ${digest}`);
