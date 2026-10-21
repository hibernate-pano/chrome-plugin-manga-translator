/**
 * The parts of the store publish path that can be reasoned about without a
 * network: how the command line is read, where credentials come from, what
 * the publish request looks like, and what the store's answers mean.
 *
 * They live apart from `publish-to-store.mjs` so that they can be tested
 * directly — a publish that only ever runs against the real store is a
 * publish whose failure modes are only ever discovered at the worst moment.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

/** The scope the store's API is reached with. */
export const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

/** The values the store's API cannot be used without. */
export const REQUIRED_CREDENTIALS = ['PUBLISHER_ID', 'ITEM_ID'];

/** The values the refresh-token flow needs on top of those. */
export const REFRESH_CREDENTIALS = [
  'CLIENT_ID',
  'CLIENT_SECRET',
  'REFRESH_TOKEN',
];

export class PublishError extends Error {}

/**
 * Read the command line.
 *
 * The flags are the ones that change what the store does, not the ones that
 * change how the script is written: the publish *type* (live on approval, or
 * staged for a second explicit release) and the *rollout* (what share of
 * users gets the new version first).
 */
export function parseArgs(argv) {
  const options = {
    zip: null,
    dryRun: false,
    publishType: 'default',
    rollout: null,
    skipReview: false,
    blockOnWarnings: false,
    setPercentage: null,
    credentialsFile: null,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-review') {
      options.skipReview = true;
    } else if (arg === '--block-on-warnings') {
      options.blockOnWarnings = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--publish-type=')) {
      const value = arg.slice('--publish-type='.length);
      if (value !== 'default' && value !== 'staged') {
        throw new PublishError(
          `--publish-type must be "default" or "staged", got "${value}"`
        );
      }
      options.publishType = value;
    } else if (arg.startsWith('--rollout=')) {
      options.rollout = parsePercentage(
        arg.slice('--rollout='.length),
        'rollout'
      );
    } else if (arg.startsWith('--set-percentage=')) {
      options.setPercentage = parsePercentage(
        arg.slice('--set-percentage='.length),
        'set-percentage'
      );
    } else if (arg.startsWith('--credentials=')) {
      options.credentialsFile = arg.slice('--credentials='.length);
    } else if (arg.startsWith('--')) {
      throw new PublishError(`unknown flag: ${arg}`);
    } else if (options.zip === null) {
      options.zip = arg;
    } else {
      throw new PublishError(`unexpected argument: ${arg}`);
    }
  }

  return options;
}

function parsePercentage(raw, flag) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new PublishError(
      `--${flag} must be an integer between 0 and 100, got "${raw}"`
    );
  }
  return value;
}

/**
 * Parse a `KEY=VALUE` credentials file.
 *
 * The format is the one a shell would write, so the file can be produced by
 * hand or by `echo` without a tool that has to know anything about it.
 */
export function parseCredentialFile(contents) {
  const values = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const withoutExport = line.startsWith('export ') ? line.slice(7) : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = withoutExport.slice(0, separator).trim();
    let value = withoutExport.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      values[key] = value;
    }
  }
  return values;
}

/**
 * Find the credentials.
 *
 * The environment wins over the file: a value typed for one command should
 * not be silently overridden by a file that happens to exist.
 *
 * Three ways to authenticate are accepted, because they answer different
 * situations:
 *
 *   ACCESS_TOKEN              a token that is already valid — the shortest
 *                             path for a CI job that mints one per run
 *   SERVICE_ACCOUNT_KEY       a service account key file — no human, no
 *                             expiry, the path for a pipeline
 *   CLIENT_ID + REFRESH_TOKEN the OAuth Playground path — the documented
 *                             way for a person working on one extension
 */
export function resolveCredentials({
  env = {},
  credentialsFile = null,
  projectRoot = null,
} = {}) {
  // A file the caller named is mandatory; the default location is not. A
  // developer who keeps the values in the environment should not be told
  // about a file that was never there.
  const explicit = credentialsFile ?? env['CWS_CREDENTIALS_FILE'] ?? null;
  const filePath = explicit ? resolve(explicit) : defaultCredentialsFile(env);

  if (filePath && projectRoot && isInside(projectRoot, filePath)) {
    throw new PublishError(
      `refusing to read credentials from inside the repository: ${filePath}`
    );
  }

  let fileValues = {};
  let source = 'environment';
  if (filePath && existsSync(filePath)) {
    fileValues = parseCredentialFile(readFileSync(filePath, 'utf8'));
    source = filePath;
  } else if (explicit) {
    throw new PublishError(`credentials file not found: ${filePath}`);
  }

  const get = name => env[name] || fileValues[name] || '';

  const publisherId = get('PUBLISHER_ID');
  const itemId = get('ITEM_ID');
  if (!publisherId || !itemId) {
    const missing = [
      ...(publisherId ? [] : ['PUBLISHER_ID']),
      ...(itemId ? [] : ['ITEM_ID']),
    ];
    throw new PublishError(
      `missing ${missing.join(', ')} — put them in the environment or in ${
        filePath ?? 'the credentials file'
      }`
    );
  }

  const accessToken = get('ACCESS_TOKEN');
  if (accessToken) {
    return {
      auth: { mode: 'access-token', accessToken },
      publisherId,
      itemId,
      source,
    };
  }

  const keyPath =
    get('SERVICE_ACCOUNT_KEY') || env['GOOGLE_APPLICATION_CREDENTIALS'];
  if (keyPath) {
    const resolvedKey = resolve(keyPath);
    if (projectRoot && isInside(projectRoot, resolvedKey)) {
      throw new PublishError(
        `refusing to read a service account key from inside the repository: ${resolvedKey}`
      );
    }
    if (!existsSync(resolvedKey)) {
      throw new PublishError(`service account key not found: ${resolvedKey}`);
    }
    return {
      auth: { mode: 'service-account', keyPath: resolvedKey },
      publisherId,
      itemId,
      source,
    };
  }

  const clientId = get('CLIENT_ID');
  const clientSecret = get('CLIENT_SECRET');
  const refreshToken = get('REFRESH_TOKEN');
  const missing = REFRESH_CREDENTIALS.filter(name => !get(name));
  if (missing.length > 0) {
    throw new PublishError(
      `missing ${missing.join(', ')} — put them in the environment or in ${
        filePath ?? 'the credentials file'
      }, or use ACCESS_TOKEN or SERVICE_ACCOUNT_KEY instead`
    );
  }

  return {
    auth: { mode: 'refresh-token', clientId, clientSecret, refreshToken },
    publisherId,
    itemId,
    source,
  };
}

/**
 * Build the JWT a service account exchanges for an access token.
 *
 * The assertion is the standard JWT-bearer grant: a header naming the key,
 * the claims Google checks, and an RS256 signature over both. The key id
 * comes from the key file, which is why the key file is needed rather than
 * just the client email.
 */
export function buildServiceAccountAssertion(
  key,
  { now = Math.floor(Date.now() / 1000), scope = CWS_SCOPE } = {}
) {
  if (!key?.client_email || !key?.private_key) {
    throw new PublishError(
      'the service account key file has no client_email or private_key'
    );
  }
  const header = { alg: 'RS256', typ: 'JWT', kid: key.private_key_id };
  const claims = {
    iss: key.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(key.private_key);
  return `${signingInput}.${encodeSegment(signature)}`;
}

function encodeSegment(value) {
  if (typeof value === 'string') {
    return Buffer.from(value).toString('base64url');
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    // The signature is raw bytes; it must not be stringified on the way.
    return Buffer.from(value).toString('base64url');
  }
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Read the claims out of a JWT, for tests and for error messages.
 */
export function decodeAssertion(assertion) {
  const parts = assertion.split('.');
  if (parts.length !== 3) {
    throw new PublishError('not a JWT');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function defaultCredentialsFile(env) {
  const configured = env['CWS_CREDENTIALS_FILE'];
  if (configured) {
    return resolve(configured);
  }
  const home = env['HOME'];
  if (!home) {
    return null;
  }
  return resolve(home, '.config', 'chrome-web-store', 'credentials.env');
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * The body of the `:publish` request.
 *
 * `publishType` is always sent: it is the difference between "go live when
 * the review passes" and "come back and release it yourself", and leaving it
 * implicit means the dashboard's saved setting decides.
 */
export function buildPublishRequest({
  publishType = 'default',
  rollout = null,
  skipReview = false,
  blockOnWarnings = false,
} = {}) {
  const body = {
    publishType:
      publishType === 'staged' ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH',
    skipReview,
    blockOnWarnings,
  };
  if (rollout !== null && rollout !== undefined) {
    body.deployInfos = [{ deployPercentage: rollout }];
  }
  return body;
}

/**
 * What the store says about an upload.
 *
 * The field has been spelled two ways in the store's own documentation
 * (`uploadState` and `upload_state`) and the value has been spelled two ways
 * too (`IN_PROGRESS` and `UPLOAD_IN_PROGRESS`), so both are accepted rather
 * than guessed at.
 */
export function interpretUploadState(body) {
  const raw = body?.uploadState ?? body?.upload_state ?? '';
  const state = String(raw).toUpperCase();
  if (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') {
    return 'pending';
  }
  if (state === 'SUCCEEDED' || state === 'COMPLETE') {
    return 'succeeded';
  }
  if (state === 'FAILED' || state === 'NOT_FOUND') {
    return 'failed';
  }
  return 'none';
}

/**
 * The version of the extension that is live right now, if any.
 */
export function publishedVersion(status) {
  const channels =
    status?.publishedItemRevisionStatus?.distributionChannels ?? [];
  for (const channel of channels) {
    if (channel?.crxVersion) {
      return channel.crxVersion;
    }
  }
  return null;
}

/**
 * Compare two extension versions the way the store does: numerically, part
 * by part, with a missing part counting as zero.
 */
export function compareVersions(a, b) {
  const left = String(a)
    .split('.')
    .map(part => toNumber(part));
  const right = String(b)
    .split('.')
    .map(part => toNumber(part));
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function toNumber(part) {
  const value = Number.parseInt(part, 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * A one-line summary of what the store currently thinks the item's state is.
 */
export function describeStatus(status) {
  const submitted = status?.submittedItemRevisionStatus?.state;
  const published = status?.publishedItemRevisionStatus?.state;
  const parts = [];
  if (published) {
    parts.push(`published=${published}`);
  }
  if (submitted) {
    parts.push(`submitted=${submitted}`);
  }
  if (status?.takenDown) {
    parts.push('taken down');
  }
  if (status?.warned) {
    parts.push('warned');
  }
  return parts.length > 0 ? parts.join(', ') : 'no state reported';
}
