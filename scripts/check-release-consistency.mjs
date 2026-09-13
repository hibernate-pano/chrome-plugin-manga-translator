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

console.log(`[release-check] version ${packageJson.version} is consistent`);
