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
 * They are read from the environment first and from a credentials file
 * second (`$CWS_CREDENTIALS_FILE`, or
 * `~/.config/chrome-web-store/credentials.env`), so that no secret is ever
 * written to a file in this repository. The script is not part of the
 * extension bundle and the values never reach the build.
 *
 * The three OAuth values are turned into a short-lived access token by
 * Google's token endpoint; the access token is what authorises the upload.
 *
 * The endpoints are the ones documented by Google:
 *   POST https://chromewebstore.googleapis.com/upload/v2/publishers/{pub}/items/{item}:upload
 *   POST https://chromewebstore.googleapis.com/v2/publishers/{pub}/items/{item}:publish
 *   GET  https://chromewebstore.googleapis.com/v2/publishers/{pub}/items/{item}:fetchStatus
 *
 * The upload body is the ZIP's raw bytes — not a multipart form.
 *
 * What the API can and cannot do is worth stating plainly, because it
 * decides what "automatic publishing" means here:
 *
 *   - There is **no** create-item endpoint and **no** listing-metadata
 *     endpoint. The listing has to be created and filled in once, in the
 *     dashboard. After that, every version is uploadable and publishable
 *     from here.
 *   - Publishing a version submits it for review. It does not put it live.
 *   - The rollout percentage and the publish type are decided by the
 *     request, not by whatever the dashboard happens to have saved.
 *
 * Usage:
 *   CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \
 *   PUBLISHER_ID=... ITEM_ID=... node scripts/publish-to-store.mjs [zip]
 *
 * With no ZIP path, the current version's public package is used.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFindings, scanTree } from './credential-scan.mjs';
import {
  buildPublishRequest,
  buildServiceAccountAssertion,
  compareVersions,
  describeStatus,
  interpretUploadState,
  parseArgs,
  publishedVersion,
  PublishError,
  resolveCredentials,
} from './store-publish.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: node scripts/publish-to-store.mjs [zip] [options]

Options:
  --dry-run                 verify everything, upload nothing
  --publish-type=default    go live as soon as the review approves (default)
  --publish-type=staged     wait for approval, then release it separately
  --rollout=N               share of users who get this version first (0-100)
  --skip-review             ask the store to skip review (most items cannot)
  --block-on-warnings       fail the publish if the store reports warnings
  --set-percentage=N        raise the rollout of the published version and exit
  --credentials=PATH        credentials file (default: ~/.config/chrome-web-store/credentials.env)
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const packageJson = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8')
  );
  const version = packageJson.version;
  const zipPath = resolve(
    projectRoot,
    options.zip ?? `release/manga-translator-v${version}-public.zip`
  );

  // --- 1. The package itself ------------------------------------------------
  // Checked before the credentials are touched: this half needs no secret,
  // and it is the half that decides whether the store is even worth calling.
  verifyPackage(zipPath, version);

  // --- 2. Credentials --------------------------------------------------------
  const { auth, publisherId, itemId, source } = resolveCredentials({
    env: process.env,
    credentialsFile: options.credentialsFile,
    projectRoot,
  });

  console.log(`[publish] package  : ${zipPath}`);
  console.log(`[publish] version  : ${version}`);
  console.log(`[publish] item     : publishers/${publisherId}/items/${itemId}`);
  console.log(`[publish] creds    : ${source}`);

  // --- 3. An access token ----------------------------------------------------
  const token = await acquireToken(auth);
  const itemName = `publishers/${publisherId}/items/${itemId}`;

  // --- 4. What the store already has ----------------------------------------
  const status = await fetchStatus(itemName, token);
  if (status.notFound) {
    fail(
      `the store does not know item ${ITEM_ID}`,
      'Create the listing once in the dashboard (Add new item), fill in the ' +
        'listing, privacy and distribution tabs, and use that item id.'
    );
  }

  const live = publishedVersion(status.body);
  console.log(
    `[publish] store     : ${live ? `live version ${live}` : 'nothing published yet'}` +
      ` (${describeStatus(status.body)})`
  );

  if (live && compareVersions(version, live) <= 0) {
    fail(
      `version ${version} is not higher than the published ${live}`,
      'The store only accepts a version above the live one. Bump the ' +
        'version in package.json and rebuild.'
    );
  }

  if (options.setPercentage !== null) {
    await setPublishedDeployPercentage({
      itemName,
      token,
      percentage: options.setPercentage,
    });
    return;
  }

  if (options.dryRun) {
    console.log('[publish] dry run  : everything checks out; nothing uploaded');
    return;
  }

  // --- 5. Upload ------------------------------------------------------------
  await uploadPackage({ itemName, token, zipPath });

  // --- 6. Publish ------------------------------------------------------------
  const request = buildPublishRequest({
    publishType: options.publishType,
    rollout: options.rollout,
    skipReview: options.skipReview,
    blockOnWarnings: options.blockOnWarnings,
  });
  console.log(`[publish] publish   : ${JSON.stringify(request)}`);

  const published = await apiCall(
    `https://chromewebstore.googleapis.com/v2/${itemName}:publish`,
    {
      method: 'POST',
      token,
      body: JSON.stringify(request),
      contentType: 'application/json',
    }
  );

  if (!published.ok) {
    console.error(
      `[publish] publish failed (${published.status}): ${errorMessage(published.body)}`
    );
    console.error(
      '[publish] the draft is uploaded — it can be published from the dashboard'
    );
    process.exit(1);
  }

  console.log(
    `[publish] submitted  : ${published.body?.state ?? 'unknown'} — the store reviews every version`
  );

  const after = await fetchStatus(itemName, token);
  console.log(`[publish] store     : ${describeStatus(after.body)}`);
}

/**
 * Check the package that is about to be uploaded.
 *
 * The ZIP is examined rather than `dist/`, because the ZIP is what the store
 * receives: a hand-made or stale archive is exactly the case where the two
 * disagree.
 */
function verifyPackage(zipPath, version) {
  if (!existsSync(zipPath)) {
    fail(
      `${zipPath} not found`,
      'Run pnpm package:public first — it builds the credential-free package.'
    );
  }

  const extractDir = mkdtempSync(join(tmpdir(), 'mt-store-publish-'));
  try {
    try {
      execFileSync('unzip', ['-q', '-o', zipPath, '-d', extractDir], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (error) {
      fail(
        `could not unpack ${zipPath}: ${error.message}`,
        'The package has to be a readable ZIP archive.'
      );
    }

    const findings = scanTree(extractDir, filePath =>
      filePath.slice(extractDir.length + 1)
    );
    if (findings.length > 0) {
      console.error(
        '[publish] REFUSING to upload: the package contains credentials or private references'
      );
      for (const line of formatFindings(findings)) {
        console.error(line);
      }
      process.exit(1);
    }

    const manifestPath = join(extractDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      fail(
        'the package has no manifest.json',
        'It was not produced by pnpm package:public.'
      );
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== version) {
      fail(
        `the package is version ${manifest.version}, the repository is ${version}`,
        'Rebuild the package so the two agree.'
      );
    }

    console.log(
      `[publish] package  : verified — ${manifest.name} ${manifest.version}, no credentials`
    );
    return { manifest };
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

/**
 * Turn the credentials into an access token.
 *
 * Three ways in, because three ways exist: a token that is already valid, a
 * service account key, and the OAuth refresh-token flow.
 */
async function acquireToken(auth) {
  if (auth.mode === 'access-token') {
    console.log('[publish] token     : supplied directly');
    return auth.accessToken;
  }

  const { status, body } =
    auth.mode === 'service-account'
      ? await serviceAccountToken(auth.keyPath)
      : await refreshToken(auth);

  if (!body?.access_token) {
    fail(
      `token exchange failed (${status}): ${body?.error ?? 'unknown'}`,
      body?.error_description ??
        'The credentials must carry the scope ' +
          'https://www.googleapis.com/auth/chromewebstore'
    );
  }

  // The access token is a bearer credential. Its length is reported; its
  // value is not.
  console.log(
    `[publish] token     : acquired (${body.access_token.length} chars, expires in ${
      body.expires_in ?? '?'
    }s)`
  );
  return body.access_token;
}

async function refreshToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await readJson(response),
  };
}

async function serviceAccountToken(keyPath) {
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const assertion = buildServiceAccountAssertion(key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await readJson(response),
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function uploadPackage({ itemName, token, zipPath }) {
  const zipBytes = readFileSync(zipPath);
  console.log(`[publish] uploading : ${zipBytes.length} bytes`);

  const response = await apiCall(
    `https://chromewebstore.googleapis.com/upload/v2/${itemName}:upload`,
    {
      method: 'POST',
      token,
      body: zipBytes,
      contentType: 'application/zip',
    }
  );

  if (!response.ok) {
    fail(
      `upload failed (${response.status}): ${errorMessage(response.body)}`,
      errorHint(response)
    );
  }

  console.log(`[publish] uploaded  : ${JSON.stringify(response.body)}`);

  // The store processes the package asynchronously.
  if (interpretUploadState(response.body) === 'pending') {
    console.log('[publish] uploading : still processing; polling');
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise(done => setTimeout(done, 2000));
      const status = await fetchStatus(itemName, token);
      const state = interpretUploadState(status.body);
      if (state === 'pending') {
        continue;
      }
      if (state === 'failed') {
        fail(
          `the package was rejected: ${describeStatus(status.body)}`,
          'Fix the package and upload it again.'
        );
      }
      break;
    }
  }
}

async function setPublishedDeployPercentage({ itemName, token, percentage }) {
  console.log(
    `[publish] rollout  : raising the published version to ${percentage}%`
  );
  const response = await apiCall(
    `https://chromewebstore.googleapis.com/v2/${itemName}:setPublishedDeployPercentage`,
    {
      method: 'POST',
      token,
      body: JSON.stringify({ deployPercentage: percentage }),
      contentType: 'application/json',
    }
  );
  if (!response.ok) {
    fail(
      `setting the deploy percentage failed (${response.status}): ${errorMessage(response.body)}`,
      'The percentage has to be larger than the one the version is on now.'
    );
  }
  console.log(`[publish] rollout  : ${JSON.stringify(response.body)}`);
}

/**
 * The store's own status for an item.
 *
 * `fetchStatus` is a GET. It is also the only documented way to read the
 * item's state back, so it answers both "is it live" and "what did the
 * publish do".
 */
async function fetchStatus(itemName, token) {
  const response = await apiCall(
    `https://chromewebstore.googleapis.com/v2/${itemName}:fetchStatus`,
    { method: 'GET', token }
  );
  if (response.status === 404) {
    return { notFound: true, body: {} };
  }
  if (!response.ok) {
    fail(
      `reading the item failed (${response.status}): ${errorMessage(response.body)}`,
      errorHint(response)
    );
  }
  return { notFound: false, body: response.body };
}

async function apiCall(url, { method, token, body, contentType }) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

function errorMessage(body) {
  if (body?.error?.message) {
    return body.error.message;
  }
  if (body?.error_description) {
    return body.error_description;
  }
  return JSON.stringify(body);
}

/**
 * The store's answers are terse. Turn the common ones into the action that
 * actually unblocks the developer.
 */
function errorHint(response) {
  const message = errorMessage(response.body).toLowerCase();
  if (response.status === 401 || response.status === 403) {
    return 'The refresh token is missing the chromewebstore scope, or it was revoked.';
  }
  if (response.status === 404) {
    return 'The item id is wrong, or the listing does not exist yet.';
  }
  if (message.includes('version')) {
    return 'The store only accepts a version higher than the published one.';
  }
  if (message.includes('permission') || message.includes('access')) {
    return 'Check that the refresh token carries the chromewebstore scope.';
  }
  return null;
}

function fail(message, hint) {
  console.error(`[publish] ${message}`);
  if (hint) {
    console.error(`[publish] ${hint}`);
  }
  process.exit(1);
}

main().catch(error => {
  if (error instanceof PublishError) {
    console.error(`[publish] ${error.message}`);
    process.exit(1);
  }
  console.error(`[publish] failed: ${error.message}`);
  process.exit(1);
});
