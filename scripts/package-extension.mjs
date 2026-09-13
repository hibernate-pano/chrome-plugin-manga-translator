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

mkdirSync(releaseDir, { recursive: true });
const zipName = `manga-translator-v${packageJson.version}-public.zip`;
const zipPath = join(releaseDir, zipName);
rmSync(zipPath, { force: true });

execFileSync('zip', ['-qr', zipPath, '.'], { cwd: distDir });

const digest = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(`${zipPath}.sha256`, `${digest}  ${zipName}\n`);

console.log(`[package] wrote release/${zipName}`);
console.log(`[package] sha256 ${digest}`);
