#!/usr/bin/env node

/**
 * Prove that the bytes the Chrome Web Store serves are the bytes in
 * `release/`.
 *
 * The public listing reports a version; it does not report a build. v2.2.0
 * was published with the version string in the ledger, and the public page
 * agreed, while the bundle on the store was the pre-fix build. Version
 * equality is not release verification; this command downloads the live CRX,
 * unpacks it, and compares every file against the package.
 *
 * Usage:
 *   pnpm store:verify
 *   pnpm store:verify release/manga-translator-v2.2.1-public.zip
 *   pnpm store:verify --item=<id> --json
 *
 * Exit code 0 means: same manifest version and every file hash matches.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareBundles,
  crxZipOffset,
  describeVerdict,
  hashTree,
  parseArgs,
  StoreVerifyError,
} from './store-verify.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: node scripts/verify-store-build.mjs [zip] [options]

Options:
  --item=ID    listing to download (default: the one in docs/store-release-log.md)
  --json       print the comparison as JSON
`;

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof StoreVerifyError) {
      console.error(`[store-verify] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const packageJson = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8')
  );
  const zipPath = resolve(
    projectRoot,
    options.zip ?? `release/manga-translator-v${packageJson.version}-public.zip`
  );

  if (!existsSync(zipPath)) {
    fail(
      `${zipPath} not found`,
      'Run pnpm package:public first — there is nothing to compare against.'
    );
  }

  const workDir = mkdtempSync(join(tmpdir(), 'mt-store-verify-'));
  try {
    const expectedDir = join(workDir, 'expected');
    extractZip(zipPath, expectedDir);

    const expectedManifest = JSON.parse(
      readFileSync(join(expectedDir, 'manifest.json'), 'utf8')
    );
    const expectedVersion = expectedManifest.version;

    const crx = await downloadCrx(options.itemId);
    const zipBytes = crx.subarray(crxZipOffset(crx));
    const liveZipPath = join(workDir, 'live.zip');
    writeFileSync(liveZipPath, zipBytes);

    const liveDir = join(workDir, 'live');
    extractZip(liveZipPath, liveDir);

    const liveManifest = JSON.parse(
      readFileSync(join(liveDir, 'manifest.json'), 'utf8')
    );
    const liveVersion = liveManifest.version;

    const expected = hashTree(readTree(expectedDir));
    const live = hashTree(readTree(liveDir));
    const result = compareBundles(expected, live);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            itemId: options.itemId,
            package: zipPath,
            expectedVersion,
            liveVersion,
            expectedFiles: expected.size,
            liveFiles: live.size,
            ...result,
            ok: result.ok && expectedVersion === liveVersion,
          },
          null,
          2
        )
      );
    } else {
      console.log(`[store-verify] package : ${zipPath}`);
      console.log(
        `[store-verify] item    : ${options.itemId} (${expected.size} files expected, ${live.size} live)`
      );
      console.log(describeVerdict({ expectedVersion, liveVersion, result }));
    }

    if (!result.ok || expectedVersion !== liveVersion) {
      process.exit(1);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Download the live CRX from Chrome's update service. */
async function downloadCrx(itemId) {
  const url =
    'https://clients2.google.com/service/update2/crx' +
    '?response=redirect&prodversion=131.0&acceptformat=crx3' +
    `&x=${encodeURIComponent(`id=${itemId}&uc`)}`;

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    fail(
      `CRX download failed (HTTP ${response.status})`,
      `The store knows item ${itemId}? Check the id or the network.`
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.toString('latin1', 0, 4) !== 'Cr24') {
    const body = bytes.toString('utf8', 0, 300).replace(/\s+/g, ' ').trim();
    fail(
      `the update service did not return a CRX: ${body || '(empty body)'}`,
      'Chrome may rate-limit the update endpoint. Retry, or check the item id.'
    );
  }
  return bytes;
}

/** Unpack an archive into `destDir`; unzip refuses a truncated file loudly. */
function extractZip(zipPath, destDir) {
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', destDir], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) {
    fail(
      `could not unpack ${zipPath}: ${error.message}`,
      'The archive is not a readable ZIP.'
    );
  }
}

/** Read every file under `dir` into a POSIX-path-keyed object. */
function readTree(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      readTree(full, base, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const key = relative(base, full).split(sep).join('/');
    out[key] = readFileSync(full);
  }
  return out;
}

function fail(message, hint) {
  console.error(`[store-verify] FAILED: ${message}`);
  if (hint) {
    console.error(`[store-verify] ${hint}`);
  }
  process.exit(1);
}

main().catch(error => {
  console.error(`[store-verify] ${error.stack ?? error.message}`);
  process.exit(1);
});
