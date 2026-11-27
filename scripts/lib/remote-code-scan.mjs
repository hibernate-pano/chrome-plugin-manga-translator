/**
 * Find remote code vectors in a built extension.
 *
 * Chrome Web Store review treats a remotely hosted script as a Manifest V3
 * violation even when the runtime never reaches it: the scanner reads the
 * package, not the execution trace. The Blue Argon review of 2.3.1 named two
 * strings that were still baked into the bundle by tesseract.js — its default
 * `workerPath` and its default core URL — while the extension overwrote both
 * at runtime.
 *
 * So this scanner looks for the vectors themselves, not for whether the code
 * around them is reachable:
 *
 *   - any `http(s)` URL whose path ends in `.js`, `.mjs` or `.wasm`;
 *   - a remote URL passed to `importScripts`, `new Worker` or dynamic
 *     `import()`;
 *   - the tesseract.js CDN defaults, including the language-data prefix,
 *     which is data rather than code but still means the OCR path is not
 *     self-contained.
 *
 * A URL that merely names a provider endpoint (`https://api.example.com/v1`)
 * is not code and is not reported. The distinction matters: this guard runs
 * on every build, and a false positive would teach the team to ignore it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Extensions that can carry executable code or a script reference. */
export const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.html',
  '.json',
]);

const REMOTE_URL = /https?:\/\/[^\s"'`<>()\\]+/g;

/**
 * Substrings that identify tesseract.js's remote defaults.
 *
 * The core default is a prefix with the version concatenated at runtime
 * (`...tesseract.js-core@v` + `7.0.0`), so it never looks like a URL ending
 * in `.js`. The language-data prefix is a directory URL. Both are found by
 * name instead.
 */
const KNOWN_REMOTE_CODE_MARKERS = [
  'cdn.jsdelivr.net/npm/tesseract',
  'cdn.jsdelivr.net/npm/@tesseract.js-data',
  'tesseract.js-core@v',
  'tessdata.projectnaptha.com',
  'unpkg.com/tesseract',
];

/**
 * Loaders that execute whatever the URL points at.
 *
 * A URL reaching one of these is a code vector regardless of its extension,
 * because the loader decides how to run it.
 */
const LOAD_CONTEXT_PATTERNS = [
  {
    kind: 'importScripts',
    pattern: /\bimportScripts\s*\(\s*['"`](https?:\/\/[^'"`\s]+)['"`]/g,
  },
  {
    kind: 'new Worker',
    pattern: /\bnew\s+Worker\s*\(\s*['"`](https?:\/\/[^'"`\s]+)['"`]/g,
  },
  {
    kind: 'dynamic import',
    pattern: /\bimport\s*\(\s*['"`](https?:\/\/[^'"`\s]+)['"`]/g,
  },
];

function stripUrlSuffix(url) {
  return url.split('#')[0].split('?')[0];
}

/** Does the URL's path look like executable code? */
export function looksLikeCodeUrl(url) {
  const path = stripUrlSuffix(url).toLowerCase();
  return (
    path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.wasm')
  );
}

function addFinding(findings, seen, file, reason, evidence) {
  const key = `${file}\0${reason}\0${evidence}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ file, reason, evidence });
}

/**
 * Recover the URL literal around a known marker.
 *
 * The marker can sit inside a double-quoted string, a template literal or a
 * minified expression. Taking the nearest quote of any kind keeps the
 * evidence to the URL instead of dragging the rest of the bundle in; the
 * 240-character cap is a backstop for a source where no delimiter is nearby.
 */
function urlAroundMarker(source, index, marker) {
  const start = source.lastIndexOf('http', index);
  if (start === -1) return marker;

  let end = -1;
  for (const delimiter of ['"', "'", '`']) {
    const found = source.indexOf(delimiter, index);
    if (found !== -1 && (end === -1 || found < end)) {
      end = found;
    }
  }

  const stop = end === -1 ? Math.min(source.length, start + 240) : end;
  return source.slice(start, stop).slice(0, 240);
}

/**
 * Every remote code vector in one file.
 *
 * @param {string} source
 * @param {string} [file]
 * @returns {Array<{file: string, reason: string, evidence: string}>}
 */
export function findRemoteCodeVectors(source, file = '<source>') {
  const findings = [];
  const seen = new Set();
  const codeUrls = new Set();

  for (const match of source.matchAll(REMOTE_URL)) {
    const url = match[0];
    if (looksLikeCodeUrl(url)) {
      codeUrls.add(url);
      addFinding(findings, seen, file, 'remote code URL', url);
    }
  }

  for (const marker of KNOWN_REMOTE_CODE_MARKERS) {
    let index = source.indexOf(marker);
    while (index !== -1) {
      const evidence = urlAroundMarker(source, index, marker);
      // A jsdelivr code URL is already reported by the URL pass above; the
      // marker pass exists for the prefixes that do not end in `.js` (the
      // core version is concatenated, and the language data is a directory).
      if (!codeUrls.has(evidence)) {
        addFinding(findings, seen, file, 'tesseract CDN default', evidence);
      }
      index = source.indexOf(marker, index + marker.length);
    }
  }

  for (const { kind, pattern } of LOAD_CONTEXT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      addFinding(findings, seen, file, `remote ${kind}`, match[1]);
    }
  }

  return findings;
}

/**
 * Every remote URL in one file, code or not.
 *
 * The release gate only fails on code vectors. This inventory exists for the
 * evidence log: it shows what remains in the bundle and makes it obvious that
 * the remaining URLs are provider endpoints and page hosts, not scripts.
 *
 * @param {string} source
 * @param {string} [file]
 * @returns {Array<{file: string, url: string}>}
 */
export function findRemoteUrls(source, file = '<source>') {
  const urls = [];
  const seen = new Set();
  for (const match of source.matchAll(REMOTE_URL)) {
    const key = `${file}\0${match[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push({ file, url: match[0] });
  }
  return urls;
}

function walk(root, onFile) {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, onFile);
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : '';
    if (!SCANNED_EXTENSIONS.has(ext)) continue;
    const file = relative(root, full).split(sep).join('/');
    onFile(file, readFileSync(full, 'utf8'));
  }
}

/**
 * Scan every built file under `root`.
 *
 * @param {string} root
 * @returns {{scannedFiles: number, findings: Array<{file: string, reason: string, evidence: string}>}}
 */
export function scanTreeForRemoteCode(root) {
  const findings = [];
  const seen = new Set();
  let scannedFiles = 0;

  walk(root, (file, source) => {
    scannedFiles += 1;
    for (const finding of findRemoteCodeVectors(source, file)) {
      addFinding(findings, seen, file, finding.reason, finding.evidence);
    }
  });

  findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.reason.localeCompare(right.reason) ||
      left.evidence.localeCompare(right.evidence)
  );

  return { scannedFiles, findings };
}

/**
 * Every remote URL under `root`, for the evidence log.
 *
 * @param {string} root
 * @returns {{scannedFiles: number, urls: Array<{file: string, url: string}>}}
 */
export function scanTreeForRemoteUrls(root) {
  const urls = [];
  const seen = new Set();
  let scannedFiles = 0;

  walk(root, (file, source) => {
    scannedFiles += 1;
    for (const entry of findRemoteUrls(source, file)) {
      const key = `${entry.file}\0${entry.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(entry);
    }
  });

  urls.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.url.localeCompare(right.url)
  );

  return { scannedFiles, urls };
}

export function formatRemoteCodeFinding(finding) {
  return `${finding.file}: ${finding.reason} — ${finding.evidence}`;
}
