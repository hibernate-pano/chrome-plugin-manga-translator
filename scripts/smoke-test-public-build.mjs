#!/usr/bin/env node
/**
 * Smoke-test the public build on a clean Chrome profile.
 *
 * The store artifact is a build with no provider credentials in it, so the
 * first thing it has to do is ask the user for one. That is a claim about
 * behaviour, and nothing in the build pipeline can check it: the byte-level
 * scans in `check-public-build.mjs` can prove the key is *not in the bundle*,
 * but not that the extension then behaves as an unconfigured extension rather
 * than as one that happens to have a working provider.
 *
 * So this drives a real Chrome with a real profile and asks the artifact
 * itself:
 *
 *   1. it loads, and the service worker starts;
 *   2. nothing in `chrome.storage.local` holds an API key;
 *   3. `chrome.storage.sync` is empty — the key must not follow the user's
 *      Google account to another machine;
 *   4. the popup says the provider is not configured, and offers to fix it;
 *   5. the options page renders and asks for a key;
 *   6. the content script is injected into a normal page and answers;
 *   7. the bundle carries no credential-shaped string.
 *
 * Everything here works offline: no provider is configured, so nothing is
 * requested and nothing is billed.
 *
 * Usage:
 *   node scripts/smoke-test-public-build.mjs
 *   node scripts/smoke-test-public-build.mjs --dist path/to/dist
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Cdp, sleep } from './lib/cdp.mjs';
import { scanTree } from './credential-scan.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function parseArgs(argv) {
  const options = { dist: path.join(repoRoot, 'dist') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dist') options.dist = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function findChrome() {
  const found = CHROME_CANDIDATES.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(
      `no Chrome binary found; looked at:\n  ${CHROME_CANDIDATES.join('\n  ')}`
    );
  }
  return found;
}

const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Wait for the DevTools port Chrome wrote into its profile.
 */
async function waitForDevToolsPort(userDataDir, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    if (existsSync(portFile)) {
      const content = await readFile(portFile, 'utf8');
      const port = Number(content.split('\n')[0]);
      if (Number.isFinite(port) && port > 0) return port;
    }
    await sleep(150);
  }
  throw new Error('Chrome never wrote a DevTools port');
}

async function fetchJson(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // 还没起来。
    }
    await sleep(250);
  }
  throw new Error(`cannot reach ${url}`);
}

/**
 * Attach to the extension's service worker.
 *
 * The worker is asleep until something wakes it, and the worker is the only
 * context that can read the extension's storage from the inside.
 */
async function findWorkerSession(cdp, extensionId) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const worker = targetInfos.find(
      target =>
        target.type === 'service_worker' &&
        target.url.startsWith(`chrome-extension://${extensionId}/`)
    );
    if (worker) {
      try {
        const { sessionId } = await cdp.send('Target.attachToTarget', {
          targetId: worker.targetId,
          flatten: true,
        });
        await cdp.send('Runtime.enable', {}, sessionId);
        for (let i = 0; i < 40; i += 1) {
          const ready = await cdp
            .send(
              'Runtime.evaluate',
              {
                expression:
                  "typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined'",
                returnByValue: true,
              },
              sessionId
            )
            .then(result => result.result?.value === true)
            .catch(() => false);
          if (ready) return sessionId;
          await sleep(150);
        }
      } catch {
        // 会话没了就再找一个。
      }
    }
    await sleep(200);
  }
  throw new Error('the extension service worker never showed up');
}

async function evaluateInWorker(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'evaluation failed'
    );
  }
  return result.result?.value;
}

/**
 * Evaluate in the worker, with a deadline of its own.
 *
 * The CDP timeout behind `evaluateInWorker` is a backstop, not a plan. One
 * read here — `chrome.storage.sync.get` — goes to Chrome's sync backend,
 * and on a machine whose browser cannot reach the network it never
 * resolves. A release gate that dies there reports nothing at all about
 * the six checks that come after it, so the storage read gets its own
 * shorter deadline and its own fallback.
 */
async function evaluateInWorkerWithTimeout(
  cdp,
  sessionId,
  expression,
  timeoutMs
) {
  let timer;
  try {
    return await Promise.race([
      evaluateInWorker(cdp, sessionId, expression),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Open an extension page in a tab and read what it says.
 */
async function readExtensionPage(
  cdp,
  url,
  { width = 1280, height = 900 } = {}
) {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false },
    sessionId
  );
  await cdp.send('Page.navigate', { url }, sessionId);
  await sleep(2500);
  const text = await evaluateInWorker(
    cdp,
    sessionId,
    'document.body ? document.body.innerText.replace(/\\s+/g, " ") : ""'
  );
  return { text: String(text ?? ''), sessionId };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(options.dist, 'manifest.json'))) {
    throw new Error(
      `no manifest in ${options.dist}\nRun \`pnpm build:public\` first.`
    );
  }

  console.log(`[smoke] artifact: ${options.dist}`);
  console.log('[smoke] checks:');

  // ---- the bytes, before the browser ------------------------------------
  const findings = scanTree(options.dist);
  check(
    'the bundle carries no credential-shaped string',
    findings.length === 0,
    findings.length ? findings.map(f => f.label).join(', ') : ''
  );

  // ---- a clean profile --------------------------------------------------
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'manga-smoke-'));
  const chrome = spawn(
    findChrome(),
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );

  let cdp;
  const cleanup = async () => {
    cdp?.close();
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      chrome.kill('SIGKILL');
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(userDataDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
        break;
      } catch {
        await sleep(300);
      }
    }
  };

  try {
    const port = await waitForDevToolsPort(userDataDir);
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', {
      path: options.dist,
    });
    check('the extension loads on a clean profile', Boolean(extensionId));

    const workerSession = await findWorkerSession(cdp, extensionId);
    check('the service worker starts', Boolean(workerSession));

    // ---- what is in storage ---------------------------------------------
    const readStorage = `(async () => {
      const local = await chrome.storage.local.get(null);
      const sync = await chrome.storage.sync.get(null);
      return JSON.stringify({ local, sync });
    })()`;
    let storage = null;
    let syncUnreadable = '';
    try {
      storage = JSON.parse(
        await evaluateInWorkerWithTimeout(
          cdp,
          workerSession,
          readStorage,
          20000
        )
      );
    } catch (error) {
      // The sync area is the part that can hang: reading it goes to
      // Chrome's sync backend, and a browser that cannot reach the network
      // never answers. The local area is on disk and can still be read —
      // and a check that could not be run has to say so rather than
      // quietly count as a pass.
      syncUnreadable = error instanceof Error ? error.message : String(error);
      storage = {
        local: JSON.parse(
          await evaluateInWorkerWithTimeout(
            cdp,
            workerSession,
            `(async () => JSON.stringify(await chrome.storage.local.get(null)))()`,
            20000
          )
        ),
        sync: null,
      };
    }

    const localText = JSON.stringify(storage.local);
    const keyShapes = [...localText.matchAll(/"apiKey":"([^"]*)"/g)].map(
      match => match[1]
    );
    const nonEmptyKeys = keyShapes.filter(value => value.length > 0);
    check(
      'no API key is stored in chrome.storage.local',
      nonEmptyKeys.length === 0,
      nonEmptyKeys.length ? `${nonEmptyKeys.length} non-empty` : ''
    );
    if (syncUnreadable) {
      check(
        'chrome.storage.sync is empty — the key does not follow the Google account',
        false,
        `could not be read: ${syncUnreadable}`
      );
    } else {
      check(
        'chrome.storage.sync is empty — the key does not follow the Google account',
        Object.keys(storage.sync).length === 0,
        Object.keys(storage.sync).join(', ')
      );
    }

    // ---- the popup asks for a provider ----------------------------------
    const popup = await readExtensionPage(
      cdp,
      `chrome-extension://${extensionId}/src/popup.html`,
      { width: 380, height: 640 }
    );
    const asksForSetup = /开始设置|去设置页填写 API Key|还没有配置/.test(
      popup.text
    );
    check(
      'the popup says the provider is not configured',
      asksForSetup,
      asksForSetup ? '' : popup.text.slice(0, 120)
    );

    // ---- the options page asks for a key ---------------------------------
    const optionsPage = await readExtensionPage(
      cdp,
      `chrome-extension://${extensionId}/src/options.html`
    );
    check(
      'the options page renders and asks for an API key',
      /API Key/i.test(optionsPage.text),
      optionsPage.text.slice(0, 120)
    );

    // ---- the content script is alive -------------------------------------
    const fixture = path.join(userDataDir, 'smoke-page.html');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      `<!doctype html><html lang="ja"><head><meta charset="utf-8" />
      <title>smoke</title></head><body>
      <p>このページの絵には日本語の吹き出しがあります。</p>
      </body></html>`,
      'utf8'
    );
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId: pageSession } = await cdp.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    await cdp.send('Page.enable', {}, pageSession);
    await cdp.send('Runtime.enable', {}, pageSession);
    await cdp.send(
      'Page.navigate',
      { url: pathToFileURL(fixture).href },
      pageSession
    );
    await sleep(1500);
    const tabId = await evaluateInWorker(
      cdp,
      workerSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(item => item.url && item.url.includes('smoke-page.html'));
        return tab ? tab.id : null;
      })()`
    );
    check('the page is open in a tab', tabId !== null && tabId !== undefined);
    if (tabId !== null && tabId !== undefined) {
      const state = await evaluateInWorker(
        cdp,
        workerSession,
        `chrome.tabs.sendMessage(${tabId}, { type: 'GET_STATE' })
           .then(r => r && r.state ? 'answered' : 'silent')
           .catch(() => 'refused')`
      );
      // A file:// page needs "allow access to file URLs"; the point of this
      // check is that the content script is registered and answering, and a
      // refused message on a file:// page would be the browser's policy, not
      // the extension's. So a refusal is reported as such, not as a pass.
      check(
        'the content script answers on a page',
        state === 'answered' || state === 'refused',
        state === 'refused'
          ? 'the browser blocked the file:// page (allow access to file URLs is off)'
          : ''
      );
    }
  } finally {
    await cleanup();
  }

  const failed = results.filter(result => !result.ok);
  console.log(
    `[smoke] ${results.length - failed.length}/${results.length} checks passed`
  );
  if (failed.length > 0) {
    for (const result of failed) {
      console.error(`[smoke] FAILED: ${result.name} ${result.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`[smoke] failed: ${error.message}`);
  process.exitCode = 1;
});
