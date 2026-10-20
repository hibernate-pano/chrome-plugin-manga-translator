#!/usr/bin/env node

/**
 * check-store-claims.mjs
 *
 * The store listing, the privacy policy and the review notes are declarations
 * made to the Chrome Web Store and to the user. A capability described there
 * that does not exist in the code is a false statement in a submission, and it
 * has happened twice in this repository: v2.0.0 removed an invented "text
 * eraser" feature from the listing, and the same mistake came back wearing a
 * different hat ("超长图自动拼接") in a later draft.
 *
 * Reading the documents carefully does not catch that class of mistake, because
 * the reader has no way to know what the code does. A machine can: every
 * promise is registered in `docs/store-claims.md` together with the code that
 * backs it, and this script checks both directions.
 *
 *   1. Every anchor still resolves. If the symbol behind a promise is renamed
 *      or deleted, the promise has lost its support and the build fails.
 *
 *   2. Every promise that a document makes still says what the table says it
 *      says. If a document drops or rewords the sentence, the claims table and
 *      the document have drifted apart and the build fails.
 *
 * The script is source-only by construction: it reads `docs/`, `src/` and
 * `public/`, never `dist/`. There is therefore no artifact phase and nothing
 * for `--source-only` to change — the flag is accepted so that the build wiring
 * reads the same way as `check-release-consistency.mjs`'s does, and so that a
 * future artifact check can be added without changing the command line.
 *
 * Zero dependencies, pure Node ESM, matching the style of the other build
 * guards in this directory.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CLAIMS_FILE = join(projectRoot, 'docs', 'store-claims.md');

/**
 * The documents a promise can be made in, and the key used in the claims
 * table's third column.
 */
const DOCUMENT_TARGETS = {
  listing: 'docs/store-listing-zh.md',
  privacy: 'docs/privacy-policy.md',
  review: 'docs/store-review-notes-zh.md',
  readme: 'README.md',
  release: 'docs/chrome-web-store-release.md',
};

const HEADER_CELLS = ['承诺', '代码锚点', '文案'];

/**
 * Collapse every whitespace run to a single space.
 *
 * The documents wrap their prose, so a phrase that is one line in the source
 * file can be two lines in the rendered document. Comparing whitespace-
 * normalised text keeps the check about the wording rather than about where
 * the author happened to wrap it.
 */
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Does `token` appear in `source` as a standalone token?
 *
 * An identifier has to match on identifier boundaries: `thinking` must not be
 * satisfied by `somethingElseThinking`, or a rename would pass unnoticed. A
 * token that is not an identifier (a URL, a colour literal, a command line)
 * is matched as a plain substring.
 */
function tokenPresent(source, token) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}($|[^A-Za-z0-9_$])`).test(
      source
    );
  }
  return source.includes(token);
}

/**
 * Does the anchor still point at something real?
 *
 * `path:symbol` — the file must exist and the symbol must still be in it.
 * `path:123`   — the file must exist and still have that many lines.
 */
function checkAnchor(anchor) {
  const separator = anchor.indexOf(':');
  if (separator <= 0 || separator === anchor.length - 1) {
    return {
      ok: false,
      reason: `anchor "${anchor}" is malformed (expected path:symbol or path:line)`,
    };
  }

  const relativePath = anchor.slice(0, separator);
  const token = anchor.slice(separator + 1);
  const fullPath = join(projectRoot, relativePath);

  if (!existsSync(fullPath)) {
    return { ok: false, reason: `file "${relativePath}" does not exist` };
  }

  const source = readFileSync(fullPath, 'utf8');

  if (/^\d+$/.test(token)) {
    const line = Number(token);
    const lineCount = source.split('\n').length;
    if (lineCount < line) {
      return {
        ok: false,
        reason: `"${relativePath}" has ${lineCount} lines but the anchor points at line ${line}`,
      };
    }
    return { ok: true };
  }

  if (!tokenPresent(source, token)) {
    return {
      ok: false,
      reason: `"${token}" no longer appears in "${relativePath}"`,
    };
  }
  return { ok: true };
}

/**
 * Split a table row into its cells.
 *
 * A row looks like `| a | b | c |`, so splitting on `|` and dropping the two
 * empty ends gives the cells. A cell may not contain a raw `|`, because that
 * would make the column count ambiguous.
 */
function splitRow(line) {
  const cells = line
    .trim()
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim());
  return cells;
}

function isSeparatorRow(cells) {
  return cells.every(cell => /^:?-{2,}:?$/.test(cell));
}

/**
 * Parse the claims table.
 *
 * The file must contain a table whose header is the three documented columns.
 * Other tables in the file are prose support and are ignored; anything else in
 * the claims table itself is a format error rather than something to guess at,
 * because a half-parsed table would silently check less than it appears to.
 */
export function parseClaims(markdown) {
  const rows = [];
  const lines = markdown.split('\n');
  let inClaimsTable = false;
  let sawClaimsTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      inClaimsTable = false;
      continue;
    }

    const cells = splitRow(line);
    if (isSeparatorRow(cells)) {
      continue;
    }

    if (!sawClaimsTable) {
      if (
        cells.length === HEADER_CELLS.length &&
        cells.every((cell, index) => cell === HEADER_CELLS[index])
      ) {
        sawClaimsTable = true;
        inClaimsTable = true;
        continue;
      }
      continue;
    }

    if (!inClaimsTable) {
      continue;
    }

    if (cells.length !== HEADER_CELLS.length) {
      return {
        error: `claims table row has ${cells.length} cells, expected ${HEADER_CELLS.length}: "${line}"`,
      };
    }

    rows.push({
      claim: cells[0],
      anchors: cells[1]
        .split(';')
        .map(anchor => anchor.trim().replace(/^`|`$/g, ''))
        .filter(Boolean),
      placements: cells[2]
        .split(';')
        .map(entry => entry.trim())
        .filter(Boolean)
        .map(entry => {
          const colon = entry.indexOf(':');
          if (colon <= 0) {
            return {
              error: `placement "${entry}" is malformed (expected doc: fragment)`,
            };
          }
          const doc = entry.slice(0, colon).trim();
          const rest = entry.slice(colon + 1).trim();
          if (!Object.prototype.hasOwnProperty.call(DOCUMENT_TARGETS, doc)) {
            return {
              error: `placement "${entry}" names an unknown document "${doc}" (known: ${Object.keys(DOCUMENT_TARGETS).join(', ')})`,
            };
          }
          return { doc, fragment: rest === 'yes' ? null : rest };
        }),
    });
  }

  if (!sawClaimsTable) {
    return {
      error: `no claims table found in docs/store-claims.md (expected a table headed "${HEADER_CELLS.join(' | ')}")`,
    };
  }
  if (rows.length === 0) {
    return { error: 'the claims table in docs/store-claims.md has no rows' };
  }

  return { rows };
}

function main() {
  // Accepted for symmetry with `check-release-consistency.mjs`. This check has
  // no artifact phase, so the flag changes nothing — it is here so that the
  // build wiring reads the same way, and so that a future artifact check can
  // be added without changing the command line.
  const sourceOnly = process.argv.includes('--source-only');

  if (!existsSync(CLAIMS_FILE)) {
    console.error(
      '[store-claims] docs/store-claims.md is missing — every outward promise needs a code anchor'
    );
    process.exit(1);
  }

  const markdown = readFileSync(CLAIMS_FILE, 'utf8');
  const parsed = parseClaims(markdown);

  if (parsed.error) {
    console.error(`[store-claims] ${parsed.error}`);
    process.exit(1);
  }

  const documentText = {};
  for (const [doc, relativePath] of Object.entries(DOCUMENT_TARGETS)) {
    const fullPath = join(projectRoot, relativePath);
    if (!existsSync(fullPath)) {
      console.error(`[store-claims] ${relativePath} is missing`);
      process.exit(1);
    }
    documentText[doc] = normalizeWhitespace(readFileSync(fullPath, 'utf8'));
  }

  const failures = [];
  let anchorCount = 0;
  const placementCounts = {};

  for (const row of parsed.rows) {
    if (!row.claim) {
      failures.push('a claims table row has an empty promise');
      continue;
    }

    if (row.anchors.length === 0) {
      failures.push(`"${row.claim}" has no code anchor`);
      continue;
    }

    for (const anchor of row.anchors) {
      anchorCount += 1;
      const result = checkAnchor(anchor);
      if (!result.ok) {
        failures.push(
          `"${row.claim}" lost its code support: ${result.reason} (anchor: ${anchor})`
        );
      }
    }

    for (const placement of row.placements) {
      if (placement.error) {
        failures.push(`"${row.claim}" ${placement.error}`);
        continue;
      }
      const { doc, fragment } = placement;
      const needle = normalizeWhitespace(fragment ?? row.claim);
      if (!needle) {
        failures.push(
          `"${row.claim}" has an empty fragment for ${DOCUMENT_TARGETS[doc]}`
        );
        continue;
      }
      if (!documentText[doc].includes(needle)) {
        failures.push(
          `"${row.claim}" is claimed in ${DOCUMENT_TARGETS[doc]} but that text no longer appears there: "${needle}"`
        );
        continue;
      }
      placementCounts[doc] = (placementCounts[doc] ?? 0) + 1;
    }
  }

  if (failures.length > 0) {
    console.error('[store-claims] the outward promises and the code disagree:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    console.error(
      '[store-claims] fix the code, fix the wording, or update docs/store-claims.md — but do not leave a promise without a support.'
    );
    process.exit(1);
  }

  const placementSummary = Object.entries(placementCounts)
    .map(([doc, count]) => `${count} in ${DOCUMENT_TARGETS[doc]}`)
    .join(', ');

  console.log(
    `[store-claims] ${parsed.rows.length} promise(s) verified against ${anchorCount} code anchor(s); ${placementSummary}${
      sourceOnly ? ' (source-only)' : ''
    }`
  );
}

main();
