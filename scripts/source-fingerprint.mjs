/**
 * source-fingerprint.mjs
 *
 * Content fingerprint of everything that can change the built extension.
 *
 * Purpose: let packaging prove that dist/ was built from the source tree that
 * is sitting in front of it right now.
 *
 * Why not compare mtimes: timestamps lie. A `git checkout`, a `touch`, a file
 * copied from a machine with a skewed clock, or an archive that preserves
 * future dates will all make a correct build look stale (a false positive that
 * blocks a legitimate release) or make a stale build look fresh (the exact bug
 * this is meant to catch). A first attempt at this used mtimes and did both.
 * Content hashing has neither failure mode.
 *
 * The fingerprint is cached outside dist/ (node_modules/.cache) so it never
 * reaches the uploaded artifact.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FINGERPRINT_PATH = join(
  projectRoot,
  'node_modules',
  '.cache',
  'mt-source-fingerprint.json'
);

/**
 * Files that define the build output beyond src/.
 *
 * public/ is included because manifest.json, icons and the HTML entry points
 * are copied verbatim into dist/ — editing the manifest without rebuilding
 * produces a zip whose version and permissions do not match the repo.
 */
const INCLUDE_DIRS = ['src', 'public'];
const INCLUDE_FILES = [
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'tailwind.config.js',
  'postcss.config.js',
];
const SKIP_DIRS = new Set(['node_modules', '.git', '__tests__']);

const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.png',
  '.svg',
  '.webp',
]);

function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const ext = dot >= 0 ? entry.name.slice(dot) : '';
    if (EXTENSIONS.has(ext)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Hash of (relative path, bytes) for every build input.
 *
 * Paths are sorted so the result does not depend on directory iteration order,
 * and path text is folded in so a rename cannot collide with a content edit.
 */
export function computeSourceFingerprint() {
  const files = [];
  for (const dir of INCLUDE_DIRS) {
    collect(join(projectRoot, dir), files);
  }
  for (const name of INCLUDE_FILES) {
    const full = join(projectRoot, name);
    if (existsSync(full)) {
      files.push(full);
    }
  }
  files.sort();

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(projectRoot, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }

  return { digest: hash.digest('hex'), fileCount: files.length };
}

/** Record the fingerprint of the source tree that dist/ was just built from. */
export function writeSourceFingerprint() {
  const { digest, fileCount } = computeSourceFingerprint();
  mkdirSync(dirname(FINGERPRINT_PATH), { recursive: true });
  writeFileSync(
    FINGERPRINT_PATH,
    `${JSON.stringify({ digest, fileCount, recordedAt: new Date().toISOString() }, null, 2)}\n`
  );
  return { digest, fileCount };
}

/** The fingerprint recorded by the last build, or null if there was none. */
export function readSourceFingerprint() {
  try {
    const parsed = JSON.parse(readFileSync(FINGERPRINT_PATH, 'utf8'));
    if (typeof parsed?.digest === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function fingerprintSourceChanged() {
  const recorded = readSourceFingerprint();
  if (!recorded) {
    return { changed: true, reason: 'no fingerprint recorded by any build' };
  }
  const current = computeSourceFingerprint();
  if (current.digest !== recorded.digest) {
    return {
      changed: true,
      reason: 'source changed since dist/ was built',
      recorded,
      current,
    };
  }
  return { changed: false, recorded, current };
}
