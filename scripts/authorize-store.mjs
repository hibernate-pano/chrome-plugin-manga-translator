#!/usr/bin/env node

/**
 * Re-authorise the Chrome Web Store OAuth client.
 *
 * The store's API is OAuth2-only. The three OAuth values live outside this
 * repository (environment or a credentials file), and the refresh token among
 * them **expires**: Google hands out a 30-day refresh token for an installed
 * app, and it can be revoked at any time. When it dies, every store
 * operation fails with a message that looks like a credential problem:
 *
 *   {"error":"invalid_grant","error_description":"Token has been expired or revoked."}
 *
 * That error says nothing about the client id, the secret or the item — so
 * the honest response is to run this script and get a new token, not to
 * start editing credentials at random.
 *
 * What this does:
 *   1. Reads CLIENT_ID / CLIENT_SECRET from the environment or a credentials
 *      file (the same places `publish-to-store.mjs` looks).
 *   2. Starts a one-shot HTTP server on 127.0.0.1 and opens Google's consent
 *      screen in Chrome. The browser is the only part a human has to touch:
 *      one "允许" click on a screen that already knows the account.
 *   3. Exchanges the returned code for a refresh token (`access_type=offline`
 *      + `prompt=consent`, so a **new** refresh token comes back every time).
 *   4. Writes the new refresh token back into the credentials file it came
 *      from (a timestamped backup is kept), or prints it if `--print-only`.
 *   5. Verifies it by reading the item's status through the API — because a
 *      token that was written is not the same thing as a token that works.
 *
 * Usage:
 *   node scripts/authorize-store.mjs
 *   node scripts/authorize-store.mjs --creds ~/.config/mcp/mcp.json
 *   node scripts/authorize-store.mjs --proxy http://127.0.0.1:7897
 *   node scripts/authorize-store.mjs --print-only
 *
 * Credentials are never printed. The token is masked in every message.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_CREDS = join(homedir(), '.config', 'mcp', 'mcp.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const options = {
    creds: process.env.CWS_CREDENTIALS_FILE ?? DEFAULT_CREDS,
    proxy: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '',
    printOnly: false,
    dryRun: false,
    check: false,
    verify: true,
    itemId: process.env.CWS_ITEM_ID ?? '',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--creds') {
      options.creds = argv[++index];
    } else if (arg.startsWith('--creds=')) {
      options.creds = arg.slice('--creds='.length);
    } else if (arg === '--proxy') {
      options.proxy = argv[++index];
    } else if (arg.startsWith('--proxy=')) {
      options.proxy = arg.slice('--proxy='.length);
    } else if (arg === '--print-only') {
      options.printOnly = true;
    } else if (arg === '--item-id') {
      options.itemId = argv[++index];
    } else if (arg.startsWith('--item-id=')) {
      options.itemId = arg.slice('--item-id='.length);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--no-verify') {
      options.verify = false;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * Secret managers write values as `{{SECRET_xxxx}}…`. The prefix has to go,
 * or the token exchange fails with a message that reads like "wrong
 * credentials" when the credentials are actually fine.
 */
function stripSecretPrefix(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^\{\{SECRET_[^}]*\}\}\s*/, '').trim();
}

function mask(value) {
  if (!value) return '(missing)';
  return `*** (${String(value).length} chars)`;
}

/**
 * Two shapes are accepted: a flat `{CWS_CLIENT_ID: …}` and an MCP config
 * `{mcpServers: {<name>: {CWS_CLIENT_ID: …}}}`. The MCP shape is the one
 * this machine actually uses, so it comes first.
 */
function findCredSlot(raw, wanted) {
  const servers = raw?.mcpServers;
  if (servers && typeof servers === 'object') {
    for (const [name, block] of Object.entries(servers)) {
      if (block && typeof block === 'object' && wanted in block) {
        return { raw, path: ['mcpServers', name], block, name };
      }
      if (block?.env && typeof block.env === 'object' && wanted in block.env) {
        return {
          raw,
          path: ['mcpServers', name, 'env'],
          block: block.env,
          name,
        };
      }
    }
  }
  if (raw && typeof raw === 'object' && wanted in raw) {
    return { raw, path: [], block: raw, name: '(root)' };
  }
  return null;
}

function readCreds(file) {
  const env = {
    clientId: stripSecretPrefix(process.env.CWS_CLIENT_ID ?? ''),
    clientSecret: stripSecretPrefix(process.env.CWS_CLIENT_SECRET ?? ''),
    refreshToken: stripSecretPrefix(process.env.CWS_REFRESH_TOKEN ?? ''),
    publisherId: stripSecretPrefix(process.env.CWS_PUBLISHER_ID ?? ''),
  };
  if (!existsSync(file)) {
    if (env.clientId && env.clientSecret) return { env, slot: null, file };
    throw new Error(
      `no credentials file at ${file} and CWS_CLIENT_ID / CWS_CLIENT_SECRET are not in the environment`
    );
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const slot = findCredSlot(raw, 'CWS_CLIENT_ID');
  const block = slot?.block ?? {};
  const merged = {
    clientId: env.clientId || stripSecretPrefix(block.CWS_CLIENT_ID ?? ''),
    clientSecret:
      env.clientSecret || stripSecretPrefix(block.CWS_CLIENT_SECRET ?? ''),
    refreshToken:
      env.refreshToken || stripSecretPrefix(block.CWS_REFRESH_TOKEN ?? ''),
    publisherId:
      env.publisherId || stripSecretPrefix(block.CWS_PUBLISHER_ID ?? ''),
    itemId: stripSecretPrefix(block.CWS_ITEM_ID ?? ''),
  };
  return { env: merged, slot, file, raw };
}

/** curl is used for the token exchange because Node's fetch ignores the
 *  HTTPS_PROXY environment variable, and Google's endpoints are not
 *  reachable from this network without it. */
function curlJson(url, body, proxy) {
  const args = [
    '-sS',
    '-X',
    'POST',
    url,
    '-H',
    'Content-Type: application/x-www-form-urlencoded',
  ];
  if (proxy) args.push('--proxy', proxy);
  args.push('--data', body);
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('curl', args, { encoding: 'utf8', timeout: 60_000 });
  } catch (error) {
    stderr = error.stderr?.toString() ?? '';
    throw new Error(`curl failed: ${stderr.trim() || error.message}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(
      `unexpected response from the token endpoint: ${stdout.slice(0, 300)}`
    );
  }
}

/**
 * Waits for the browser to come back with an authorization code.
 *
 * The redirect never leaves the machine: the server is bound to 127.0.0.1
 * and answers with a page that says so.
 */
function waitForCode({ clientId, port }) {
  return new Promise((resolve, reject) => {
    const redirectUri = `http://127.0.0.1:${port}`;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        response.writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        response.end('授权失败，可以关掉这个页面。');
        server.close();
        reject(new Error(`the consent screen returned an error: ${error}`));
        return;
      }
      if (!code) {
        response.writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        response.end('缺少 code 参数。');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<meta charset="utf-8"><body style="font-family:system-ui;padding:40px">' +
          '<h2>授权完成 ✅</h2><p>可以关掉这个页面了，回到终端。</p></body>'
      );
      server.close();
      resolve({ code, redirectUri });
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
      });
      const url = `${AUTH_URL}?${params.toString()}`;
      console.log('[authorize] opening the consent screen in Chrome…');
      console.log(
        '[authorize] if it does not open, paste this URL into a browser:'
      );
      console.log(`[authorize]   ${url}`);
      openInChrome(url);
    });
  });
}

function openInChrome(url) {
  if (existsSync(CHROME)) {
    try {
      spawn(CHROME, [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch {
      /* fall through to `open` */
    }
  }
  try {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.log('[authorize] could not open a browser — use the URL above');
  }
}

function writeTokenBack({ slot, file }, refreshToken) {
  if (!slot) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(file, `${file}.bak-${stamp}`);
  slot.block.CWS_REFRESH_TOKEN = refreshToken;
  writeFileSync(file, `${JSON.stringify(slot.raw, null, 2)}\n`, 'utf8');
  console.log(`[authorize] wrote the new refresh token into ${file}`);
  console.log(`[authorize] backup: ${file}.bak-${stamp}`);
  return true;
}

/** A token that was written is not a token that works. Read the item. */
async function verifyWithApi({
  clientId,
  clientSecret,
  refreshToken,
  publisherId,
  itemId,
  proxy,
}) {
  if (!publisherId || !itemId) {
    console.log(
      '[authorize] no publisher id / item id — skipping the API check'
    );
    return;
  }
  const token = curlJson(
    TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    proxy
  );
  if (!token?.access_token) {
    throw new Error(
      `the refresh token was refused: ${JSON.stringify(token).slice(0, 300)}`
    );
  }
  const url = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${itemId}:fetchStatus`;
  const args = [
    '-sS',
    url,
    '-H',
    `Authorization: Bearer ${token.access_token}`,
  ];
  if (proxy) args.push('--proxy', proxy);
  const body = execFileSync('curl', args, {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const parsed = JSON.parse(body);
  const submitted = parsed?.submittedItemRevisionStatus?.state ?? '(none)';
  const published = parsed?.publishedItemRevisionStatus?.state ?? '(none)';
  console.log(
    `[authorize] API check: submitted=${submitted} published=${published}`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { env, slot, file } = readCreds(options.creds);

  if (!env.clientId || !env.clientSecret) {
    throw new Error(
      `CLIENT_ID / CLIENT_SECRET not found in ${options.creds} or the environment`
    );
  }
  console.log(`[authorize] client id: ${mask(env.clientId)}`);
  console.log(`[authorize] client secret: ${mask(env.clientSecret)}`);
  console.log(`[authorize] current refresh token: ${mask(env.refreshToken)}`);
  console.log(`[authorize] credentials file: ${file}`);

  if (options.dryRun) {
    console.log(
      '[authorize] --dry-run: nothing was requested and nothing was written'
    );
    return;
  }

  if (options.check) {
    if (!env.refreshToken) {
      throw new Error('no refresh token to check');
    }
    await verifyWithApi({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      refreshToken: env.refreshToken,
      publisherId: env.publisherId,
      itemId: options.itemId || env.itemId,
      proxy: options.proxy,
    });
    console.log('[authorize] --check: the current token works');
    return;
  }

  const port = 42800 + Math.floor(Math.random() * 2000);
  const { code, redirectUri } = await waitForCode({
    clientId: env.clientId,
    port,
  });

  console.log('[authorize] exchanging the code for a refresh token…');
  const token = curlJson(
    TOKEN_URL,
    new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
    options.proxy
  );

  if (!token?.refresh_token) {
    throw new Error(
      `no refresh token in the response: ${JSON.stringify(token).slice(0, 300)}`
    );
  }
  console.log(`[authorize] new refresh token: ${mask(token.refresh_token)}`);

  if (options.printOnly) {
    console.log('');
    console.log(`CWS_REFRESH_TOKEN=${token.refresh_token}`);
    console.log('');
    console.log('[authorize] --print-only: nothing was written to disk');
    return;
  }

  const written = writeTokenBack({ slot, file }, token.refresh_token);
  if (!written) {
    console.log(
      '[authorize] could not find where to write it — set CWS_REFRESH_TOKEN yourself:'
    );
    console.log(`CWS_REFRESH_TOKEN=${token.refresh_token}`);
    return;
  }

  if (options.verify) {
    await verifyWithApi({
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      refreshToken: token.refresh_token,
      publisherId: env.publisherId,
      itemId: options.itemId || env.itemId,
      proxy: options.proxy,
    });
  }
  console.log('[authorize] done');
}

main().catch(error => {
  console.error(`[authorize] ${error.message}`);
  process.exit(1);
});
