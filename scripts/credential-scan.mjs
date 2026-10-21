/**
 * The credential patterns and the file scanner, shared by the two guards that
 * stand between a private API key and the public store.
 *
 * `check-public-build.mjs` watches the build; `publish-to-store.mjs` watches
 * the package it is about to hand to the store. They are the same question
 * asked twice — "does this artifact contain a credential?" — so they must
 * agree on the answer. A pattern that lives in only one of them is a pattern
 * the other one can miss.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Credential shapes we refuse to publish. Deliberately broad: a false
 * positive costs one build cycle, a false negative ships someone's key.
 */
export const SECRET_PATTERNS = [
  // JSON-shaped env config: "apiKey": "sk-..."
  { name: 'env-config apiKey', pattern: /"apiKey"\s*:\s*"([^"]+)"/g },
  // Source-shaped: apiKey: 'sk-...'
  {
    name: 'env-config apiKey (unquoted key)',
    pattern: /apiKey\s*:\s*['"]([^'"]+)['"]/g,
  },
  // Provider key prefixes, anywhere in any emitted file.
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'SiliconFlow key', pattern: /\bsf-[A-Za-z0-9]{16,}\b/g },
  // Authorization headers baked into a bundle.
  { name: 'bearer header', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
];

/**
 * References to a hosted model *repository*.
 *
 * A model name is allowed to look like `qwen2.5vl:7b` — that is an ordinary
 * Ollama tag. What must never ship is a pointer at a repository
 * (`owner/repo`, `hf.co/owner/repo:quant`): it leaks a repository the
 * developer keeps to themselves, and it becomes the default model for every
 * store user, who cannot pull it. Their first "test connection" then fails
 * on a model that does not exist for them.
 *
 * This was not hypothetical. The public packages v1.3.3 through v2.0.3 all
 * carried the developer's private HuggingFace repository, because the
 * credential scan only knew about keys.
 */
export const PUBLIC_REFERENCE_PATTERNS = [
  {
    name: 'HuggingFace repository reference',
    pattern: /hf\.co\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g,
  },
];

export const SCANNABLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.html',
  '.css',
  '.txt',
  '.map',
]);

/**
 * Values that mean "there is no credential here", not "here is a credential".
 * A public build's whole point is that these are empty.
 */
const PLACEHOLDERS = new Set(['', 'EMPTY', 'null']);

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function hasScannableExtension(filePath) {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 && SCANNABLE_EXTENSIONS.has(filePath.slice(dot));
}

export function collectFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === '.DS_Store') {
      continue;
    }
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      out.push(...collectFiles(full));
      continue;
    }
    if (!hasScannableExtension(full) || stats.size > MAX_FILE_BYTES) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/**
 * Scan one file for credential shapes.
 *
 * `label` is how the finding is reported — the path relative to whatever
 * root the caller is scanning, so the message points at the file rather
 * than at a temporary directory.
 */
export function scanFile(filePath, label) {
  let contents;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const findings = [];
  for (const { name, pattern } of [
    ...SECRET_PATTERNS,
    ...PUBLIC_REFERENCE_PATTERNS,
  ]) {
    // These regexes are module-level and global, so state carries over
    // between calls unless the cursor is reset.
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      if (PLACEHOLDERS.has(value)) {
        continue;
      }
      findings.push({
        label,
        name,
        preview:
          value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value,
      });
    }
  }
  return findings;
}

/**
 * Scan a whole directory tree.
 *
 * `labelFor` turns an absolute path into the label used in the report.
 */
export function scanTree(dir, labelFor = filePath => filePath) {
  const findings = [];
  for (const filePath of collectFiles(dir)) {
    findings.push(...scanFile(filePath, labelFor(filePath)));
  }
  return findings;
}

/**
 * Render findings as report lines, one per distinct problem.
 *
 * The same secret often appears in many files; reporting it once per file
 * turns one mistake into a wall of output.
 */
export function formatFindings(findings) {
  const lines = [];
  const seen = new Set();
  for (const finding of findings) {
    const signature = `${finding.name}|${finding.preview}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    lines.push(`  - ${finding.name} in ${finding.label} (${finding.preview})`);
  }
  return lines;
}
