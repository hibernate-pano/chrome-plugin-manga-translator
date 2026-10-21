#!/usr/bin/env node

/**
 * Upload the credential-free package to the Chrome Web Store and publish it.
 *
 * The store's API is OAuth2-only, and five values are needed that cannot be
 * derived from anything in this repository:
 *
 *   CLIENT_ID      — the OAuth client id of the Google Cloud project
 *   CLIENT_SECRET  — the matching client secret
 *   REFRESH_TOKEN  — a long-lived token with the chromewebstore scope
 *   PUBLISHER_ID   — the publisher id shown in the dashboard under
 *                     Publisher → Settings
 *   ITEM_ID        — the id of the store listing the ZIP belongs to
 *
 * They are read from the environment so that no secret is ever written to a
 * file in this repository. This script is not part of the extension bundle
 * and the values never reach the build.
 *
 * The three OAuth values are turned into a short-lived access token by
 * Google's token endpoint; the access token is what authorises the upload.
 *
 * The endpoints are the ones documented by Google:
 *   POST https://chromewebstore.googleapis.com/upload/v2/publishers/{pub}/items/{item}:upload
 *   POST https://chromewebstore.googleapis.com/v2/publishers/{pub}/items/{item}:publish
 *
 * The upload body is the ZIP's raw bytes — not a multipart form.
 *
 * Usage:
 *   CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \
 *   PUBLISHER_ID=... ITEM_ID=... node scripts/publish-to-store.mjs [zip]
 *
 * With no ZIP path, the current version's public package is used.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED = [
  ['CLIENT_ID', process.env.CLIENT_ID],
  ['CLIENT_SECRET', process.env.CLIENT_SECRET],
  ['REFRESH_TOKEN', process.env.REFRESH_TOKEN],
  ['PUBLISHER_ID', process.env.PUBLISHER_ID],
  ['ITEM_ID', process.env.ITEM_ID],
];

const missing = REQUIRED.filter(([, value]) => !value).map(([name]) => name);
if (missing.length > 0) {
  console.error(
    `[publish] missing ${missing.join(', ')} — see the header of this file for how to obtain them`
  );
  process.exit(1);
}

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const PUBLISHER_ID = process.env.PUBLISHER_ID;
const ITEM_ID = process.env.ITEM_ID;

const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
);
const version = packageJson.version;

const zipPath = resolve(
  projectRoot,
  process.argv[2] ?? `release/manga-translator-v${version}-public.zip`
);

if (!existsSync(zipPath)) {
  console.error(
    `[publish] ${zipPath} not found — run pnpm package:public first`
  );
  process.exit(1);
}

// Refuse to upload a ZIP that was not produced by the credential-free build.
// `pnpm build` produces a dist/ that may carry the developer's `.env` keys;
// `pnpm package:public` blanks the whole provider block instead. Uploading
// the wrong one would publish a personal API key to every store user.
const manifestPath = join(projectRoot, 'dist', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('[publish] dist/manifest.json not found — rebuild first');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version) {
  console.error(
    `[publish] dist/manifest.json is version ${manifest.version}, package is ${version} — rebuild`
  );
  process.exit(1);
}

const itemName = `publishers/${PUBLISHER_ID}/items/${ITEM_ID}`;

console.log(`[publish] package : ${zipPath}`);
console.log(`[publish] version : ${version}`);
console.log(`[publish] item    : ${itemName}`);

// --- 1. Exchange the refresh token for a short-lived access token ---------
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }),
});

const tokenBody = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || !tokenBody.access_token) {
  console.error(
    `[publish] token exchange failed (${tokenResponse.status}): ${tokenBody.error ?? 'unknown'}`
  );
  if (tokenBody.error_description) {
    console.error(`[publish] ${tokenBody.error_description}`);
  }
  process.exit(1);
}

// The access token is a bearer credential. Its length is reported; its
// value is not.
console.log(
  `[publish] access token acquired (${tokenBody.access_token.length} chars, expires in ${
    tokenBody.expires_in ?? '?'
  }s)`
);

const authHeaders = { Authorization: `Bearer ${tokenBody.access_token}` };

// --- 2. Upload the ZIP ----------------------------------------------------
// The body is the ZIP's raw bytes.
const zipBytes = readFileSync(zipPath);
console.log(`[publish] uploading ${zipBytes.length} bytes…`);

const uploadResponse = await fetch(
  `https://chromewebstore.googleapis.com/upload/v2/${itemName}:upload`,
  {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/zip',
    },
    body: zipBytes,
  }
);

const uploadBody = await uploadResponse.json().catch(() => ({}));
if (!uploadResponse.ok) {
  console.error(
    `[publish] upload failed (${uploadResponse.status}): ${JSON.stringify(uploadBody)}`
  );
  process.exit(1);
}

console.log(`[publish] upload response: ${JSON.stringify(uploadBody)}`);

// The store processes the package asynchronously. `uploadState` reports
// whether it is still working on it.
if (uploadBody.uploadState === 'UPLOAD_IN_PROGRESS') {
  console.log('[publish] upload still processing; polling…');
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 2000));
    const statusResponse = await fetch(
      `https://chromewebstore.googleapis.com/v2/${itemName}:fetchStatus`,
      { method: 'POST', headers: authHeaders }
    );
    const status = await statusResponse.json().catch(() => ({}));
    if (status.uploadState !== 'UPLOAD_IN_PROGRESS') {
      console.log(`[publish] upload state: ${JSON.stringify(status)}`);
      if (status.uploadState && status.uploadState !== 'COMPLETE') {
        console.error(
          '[publish] the package was rejected — fix it before publishing'
        );
        process.exit(1);
      }
      break;
    }
  }
}

// --- 3. Publish it --------------------------------------------------------
// Uploading a ZIP only creates a draft. It has to be published separately,
// or it stays in the dashboard and never reaches the store.
console.log('[publish] publishing…');

const publishResponse = await fetch(
  `https://chromewebstore.googleapis.com/v2/${itemName}:publish`,
  { method: 'POST', headers: authHeaders }
);

const publishBody = await publishResponse.json().catch(() => ({}));
if (!publishResponse.ok) {
  console.error(
    `[publish] publish failed (${publishResponse.status}): ${JSON.stringify(publishBody)}`
  );
  console.error(
    '[publish] the draft is uploaded — it can be published from the dashboard'
  );
  process.exit(1);
}

console.log(`[publish] publish response: ${JSON.stringify(publishBody)}`);

// Reading the item back is the only way to confirm what actually happened.
try {
  const itemResponse = await fetch(
    `https://chromewebstore.googleapis.com/v2/${itemName}`,
    { headers: authHeaders }
  );
  const item = await itemResponse.json();
  console.log(
    `[publish] item status: ${JSON.stringify(item.status ?? item, null, 2)}`
  );
} catch {
  console.log('[publish] could not read the item back; check the dashboard');
}
