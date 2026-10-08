#!/usr/bin/env node

/**
 * record-source-fingerprint.mjs
 *
 * Runs at the end of every build to record what dist/ was built from, so
 * packaging can later prove freshness by content instead of by mtime.
 * See scripts/source-fingerprint.mjs for why timestamps are not used.
 */

import { writeSourceFingerprint } from './source-fingerprint.mjs';

const { digest, fileCount } = writeSourceFingerprint();
console.log(
  `[source-fingerprint] recorded ${fileCount} build input(s): ${digest.slice(0, 16)}…`
);
