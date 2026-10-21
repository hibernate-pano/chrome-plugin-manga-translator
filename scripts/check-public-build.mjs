#!/usr/bin/env node

/**
 * check-public-build.mjs
 *
 * Guards `pnpm build:public` / `pnpm package:public` against shipping
 * provider credentials.
 *
 * It scans BOTH:
 *   1. the generated env sources, and
 *   2. every emitted file under dist/.
 *
 * Scanning only the source was not enough. The previous guard matched
 * `apiKey:\s*"([^"]+)"`, but the generated file is JSON-shaped, with the key
 * itself quoted (`"apiKey": "sk-..."`), so the regex never matched anything:
 * the check printed "verified" while real keys sat in the bundle. Scanning
 * dist/ as well means a credential that arrives by any other route is still
 * caught before packaging.
 *
 * There are now two generated sources, because the build-time configuration
 * was split in two: endpoints and models in `env-config.generated.ts`, keys
 * in `env-credentials.generated.ts`. The key half used to live in the same
 * file as the endpoint half, so reading only the endpoint file would now
 * report "verified" about a file that never holds a key. Both are read.
 *
 * The credential patterns themselves live in `credential-scan.mjs`, shared
 * with the publish script: two guards that ask the same question must agree
 * on the answer.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, formatFindings, scanFile } from './credential-scan.mjs';

// The root is overridable so the guard's own test suite can point it at a
// throwaway tree instead of the real working copy.
const projectRoot = process.env['MT_PUBLIC_BUILD_ROOT']
  ? resolve(process.env['MT_PUBLIC_BUILD_ROOT'])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const generatedPath = join(
  projectRoot,
  'src',
  'shared',
  'env-config.generated.ts'
);
const credentialsPath = join(
  projectRoot,
  'src',
  'shared',
  'env-credentials.generated.ts'
);
const distDir = join(projectRoot, 'dist');

/**
 * Parse the generated env config back into an object.
 *
 * The file is TypeScript, but the payload is plain JSON, so it can be read
 * back structurally instead of by regex. That matters: the credential guard
 * originally matched `apiKey: "..."` against a JSON-shaped file, matched
 * nothing, and reported success while real keys sat in the bundle.
 */
function parseEnvConfig(contents) {
  const match = /export const ENV_CONFIG = (\{[\s\S]*\}) as const;/.exec(
    contents
  );
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reject model identifiers that name a repository rather than a model.
 *
 * Only the generated config is inspected here; the bundle inherits the very
 * same values, and the reference scan covers anything that reached the
 * bundle by another route.
 */
function checkPublicModels(contents) {
  const config = parseEnvConfig(contents);
  if (!config || !isPlainObject(config)) {
    return [
      {
        label: 'src/shared/env-config.generated.ts',
        name: 'unreadable env config',
        preview: 'ENV_CONFIG could not be parsed',
      },
    ];
  }

  const findings = [];
  for (const [provider, settings] of Object.entries(config)) {
    if (!isPlainObject(settings)) {
      continue;
    }
    const model = settings['model'];
    if (typeof model !== 'string' || !model) {
      continue;
    }
    if (model.includes('/')) {
      findings.push({
        label: `src/shared/env-config.generated.ts (${provider}.model)`,
        name: 'model repository path',
        preview: model,
      });
    }
  }
  return findings;
}

const findings = [];

// 1. The generated source of truth for build-time credentials. This runs
//    before the bundle exists, so it fails fast on a bad `--public-build`
//    injection. Both generated files are read: the endpoint half and the
//    credential half.
let generatedContents;
try {
  generatedContents = readFileSync(generatedPath, 'utf8');
} catch {
  console.error(
    '[public-build] cannot read src/shared/env-config.generated.ts — run scripts/inject-env-config.mjs first'
  );
  process.exit(1);
}
try {
  readFileSync(credentialsPath, 'utf8');
} catch {
  console.error(
    '[public-build] cannot read src/shared/env-credentials.generated.ts — run scripts/inject-env-config.mjs first'
  );
  process.exit(1);
}
findings.push(...scanFile(generatedPath, 'src/shared/env-config.generated.ts'));
findings.push(
  ...scanFile(credentialsPath, 'src/shared/env-credentials.generated.ts')
);
findings.push(...checkPublicModels(generatedContents));

// 2. The shipped bundle. Skipped with `--source-only` when invoked before the
//    build (dist/ still holds the previous, possibly private, build).
const sourceOnly = process.argv.includes('--source-only');
let distFiles = [];
if (!sourceOnly) {
  distFiles = collectFiles(distDir);
  if (distFiles.length === 0) {
    console.error(
      '[public-build] dist/ is empty or missing — refusing to package'
    );
    process.exit(1);
  }
  for (const file of distFiles) {
    findings.push(...scanFile(file, file.slice(projectRoot.length + 1)));
  }
}

if (findings.length > 0) {
  console.error(
    '[public-build] REFUSING to package: credentials or private references detected'
  );
  for (const line of formatFindings(findings)) {
    console.error(line);
  }
  process.exit(1);
}

console.log(
  sourceOnly
    ? '[public-build] verified: no provider credentials or private model references in build-time config'
    : `[public-build] verified: ${distFiles.length} dist file(s) scanned, no provider credentials or private model references embedded`
);
