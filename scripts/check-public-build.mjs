#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedPath = join(
  projectRoot,
  'src',
  'shared',
  'env-config.generated.ts'
);
const generated = readFileSync(generatedPath, 'utf8');

const leakedKeys = [...generated.matchAll(/apiKey:\s*"([^"]+)"/g)]
  .map(match => match[1])
  .filter(Boolean);

if (leakedKeys.length > 0) {
  console.error(
    `[public-build] refusing package: ${leakedKeys.length} API key(s) remain in env-config.generated.ts`
  );
  process.exit(1);
}

console.log('[public-build] verified: no provider API keys are embedded');
