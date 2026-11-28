#!/usr/bin/env node
/* eslint-disable no-console -- CLI evidence script: stdout is the artifact */
/**
 * Prove the OCR fallback runs with the network cut off.
 *
 * The Blue Argon rejection was about remote code in the package, but the fix
 * only counts if the OCR path still works without a CDN. This script drives a
 * real Chrome with the built extension:
 *
 *   1. launches Chrome with every hostname except 127.0.0.1 unresolvable;
 *   2. serves a one-bubble Japanese fixture page and a fake OpenAI-compatible
 *      endpoint from 127.0.0.1;
 *   3. makes the fake model answer the full-image request with
 *      `{"textAreas":[]}` — the case that triggers the Tesseract fallback;
 *   4. waits for the overlay, records every request every target makes, and
 *      reports the local `chrome-extension://.../tesseract/*` assets that were
 *      actually loaded;
 *   5. proves the network is really off with a control fetch to jsdelivr;
 *   6. pins the negative half of the story: no bare `tesseract-core-*.wasm`
 *      binary was fetched (only the packaged `.wasm.js` core), the OCR ran
 *      in the extension's offscreen document rather than a page-origin blob
 *      worker, and no `blob:` worker target existed during the run.
 *
 * The target record is collected twice on purpose: browser-level discovery
 * events catch targets that come and go between polls, and `Target.getTargets`
 * snapshots are the replayable raw record. Both land in `runtime-network.json`
 * next to the timestamped request list.
 *
 * Usage:
 *   node evidence/cws-blue-argon/runtime-offline-ocr.mjs [--dist dist] [--out dir]
 *
 * `--out` keeps the produced evidence outside the checkout when the run is a
 * verification pass rather than a re-record of the committed artifacts.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Cdp, sleep } from '../../scripts/lib/cdp.mjs';
import { urlLoadsExtensionAsset } from '../../scripts/lib/tesseract-assets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function findChrome() {
  const found = CHROME_CANDIDATES.find(candidate => existsSync(candidate));
  if (!found) throw new Error('no Chrome binary found');
  return found;
}

function parseArgs(argv) {
  const options = { dist: path.join(repoRoot, 'dist'), out: here };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dist') options.dist = path.resolve(argv[++i]);
    else if (argv[i] === '--out') options.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return options;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
/**
 * The bare WASM binary that must never be requested.
 *
 * tesseract.js ships two forms of the core: `tesseract-core-<variant>.wasm.js`
 * (a JS wrapper with the binary inlined, which is what `text-detector.ts`
 * points `corePath` at) and a bare `.wasm` binary beside it. The `.wasm.js`
 * name deliberately does not match this expression — only a URL that ends at
 * `.wasm` does. A hit means the package is carrying a second copy of the core
 * and the run reached for it.
 */
const DEAD_WEIGHT_WASM = /tesseract-core-.*\.wasm$/;

/** Target types Chrome uses for script workers. */
function isWorkerTarget(info) {
  return /worker/i.test(info?.type ?? '');
}

/**
 * The target ledger: every target the browser reported, with first/last
 * sighting and the source that reported it.
 *
 * A single `Target.getTargets` poll is not enough evidence. An offscreen
 * document is auto-attached before its URL is known (the target info at
 * attach time can be empty), and a worker can live and die between polls.
 * Discovery events fill both gaps; the snapshots are the replayable record.
 */
function createTargetLedger() {
  const targets = new Map();
  const snapshots = [];

  const record = (info, source) => {
    if (!info || typeof info.targetId !== 'string') return;
    const at = Date.now();
    const existing = targets.get(info.targetId);
    if (existing) {
      // targetInfoChanged is how an offscreen target gains its URL after the
      // document navigates; never overwrite a known URL with an empty one.
      existing.url = info.url || existing.url;
      existing.type = info.type || existing.type;
      existing.attached = Boolean(info.attached);
      existing.lastSeenAt = at;
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    targets.set(info.targetId, {
      targetId: info.targetId,
      type: info.type ?? '',
      url: info.url ?? '',
      attached: Boolean(info.attached),
      firstSeenAt: at,
      lastSeenAt: at,
      sources: [source],
    });
  };

  const markDestroyed = targetId => {
    const existing = targets.get(targetId);
    if (existing && existing.destroyedAt === undefined) {
      existing.destroyedAt = Date.now();
    }
  };

  const snapshot = async (client, label) => {
    const { targetInfos } = await client.send('Target.getTargets');
    for (const info of targetInfos) record(info, `getTargets:${label}`);
    const compact = targetInfos
      .map(info => ({
        targetId: info.targetId,
        type: info.type,
        url: info.url,
        attached: Boolean(info.attached),
      }))
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
    const signature = JSON.stringify(
      compact.map(info => [info.type, info.url])
    );
    const previous = snapshots[snapshots.length - 1];
    if (!previous || previous.signature !== signature) {
      snapshots.push({ at: Date.now(), label, signature, targets: compact });
    }
    return targetInfos;
  };

  return { targets, snapshots, record, markDestroyed, snapshot };
}

function serializeTargets(ledger) {
  return [...ledger.targets.values()]
    .map(target => ({
      ...target,
      firstSeenAtIso: new Date(target.firstSeenAt).toISOString(),
      lastSeenAtIso: new Date(target.lastSeenAt).toISOString(),
      destroyedAtIso:
        target.destroyedAt === undefined
          ? undefined
          : new Date(target.destroyedAt).toISOString(),
    }))
    .sort((left, right) => left.firstSeenAt - right.firstSeenAt);
}

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
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`cannot reach ${url}`);
}

function evaluate(cdp, sessionId, expression, { awaitPromise = true } = {}) {
  return cdp
    .send(
      'Runtime.evaluate',
      { expression, awaitPromise, returnByValue: true },
      sessionId,
      180000
    )
    .then(result => {
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            'evaluation failed'
        );
      }
      return result.result?.value;
    });
}

/**
 * Render the one-bubble Japanese fixture.
 *
 * The text has to be in the pixels: the extension sends the image itself, so
 * lettering drawn in HTML is invisible to both the model and Tesseract.
 */
async function buildFixtureImage(tmpDir) {
  const htmlPath = path.join(tmpDir, 'ocr-fixture.html');
  const pngPath = path.join(tmpDir, 'ocr-fixture.png');
  await writeFile(
    htmlPath,
    `<!doctype html><html><head><meta charset="utf-8" /><style>
      html, body { margin: 0; padding: 0; width: 600px; height: 300px; background: #fff; }
      body { display: flex; align-items: center; justify-content: center; }
      .bubble {
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-weight: 700; font-size: 48px; color: #111;
      }
    </style></head><body><div class="bubble">STOP RIGHT THERE</div></body></html>`,
    'utf8'
  );

  await new Promise((resolve, reject) => {
    const chrome = spawn(
      findChrome(),
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--screenshot=${pngPath}`,
        '--window-size=600,300',
        pathToFileURL(htmlPath).href,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    chrome.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    chrome.on('exit', code => {
      if (code === 0 && existsSync(pngPath)) resolve();
      else reject(new Error(`fixture screenshot failed (${code}): ${stderr}`));
    });
  });

  return readFile(pngPath);
}

async function startServer(png) {
  const requests = [];
  const server = createServer((req, res) => {
    if (
      req.method === 'GET' &&
      (req.url === '/' || req.url === '/index.html')
    ) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html lang="ja"><head><meta charset="utf-8" />' +
          '<title>offline OCR fixture</title></head><body>' +
          '<img id="page" src="/page.png" alt="manga page" />' +
          '</body></html>'
      );
      return;
    }
    if (req.method === 'GET' && req.url === '/page.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'offline-vision', object: 'model' }],
        })
      );
      return;
    }
    if (req.method === 'GET' && req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = null;
        }
        const promptText = JSON.stringify(parsed?.messages ?? '');
        const hybrid = promptText.includes('SEPARATE cropped blocks');
        requests.push({
          hybrid,
          bytes: body.length,
          authorization: req.headers.authorization ?? '',
        });
        const content = hybrid
          ? JSON.stringify({
              /*
               * The strip is a vertical stack of crops; each region needs a
               * box that lands inside its crop. Twelve evenly spaced boxes
               * cover three OCR regions with room to spare, and extra boxes
               * on the same crop do not create extra entries.
               */
              textAreas: Array.from({ length: 12 }, (_, index) => ({
                x: 0.02,
                y: index / 12 + 0.01,
                width: 0.96,
                height: 0.06,
                originalText: '待って！',
                translatedText: '等等！',
              })),
            })
          : '{"textAreas":[]}';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'offline-fixture',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop',
              },
            ],
          })
        );
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, requests };
}

/**
 * A proxy that refuses everything.
 *
 * `--host-resolver-rules` proved unreliable on this Chrome build (the CDN
 * was still reachable), so the offline guarantee is enforced one layer up:
 * Chrome sends every non-loopback request to this proxy, and the proxy
 * answers 502. Loopback is on the bypass list, so the fixture page and the
 * fake provider still work.
 */
async function startBlockingProxy() {
  const attempts = [];
  const server = createServer((req, res) => {
    attempts.push(req.url ?? '');
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('offline evidence: external request blocked');
  });
  server.on('connect', (req, socket) => {
    socket.on('error', () => undefined);
    attempts.push(`CONNECT ${req.url ?? ''}`);
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
  server.on('clientError', (_error, socket) => {
    socket.destroy();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, attempts };
}

/**
 * Read the config key and envelope version from source.
 *
 * The value is generated into the bundle; reading it here keeps the script
 * working without copying the secret into the evidence file.
 */
function readConfigContract() {
  const source = readFileSync(
    path.join(repoRoot, 'src', 'shared', 'app-config.ts'),
    'utf8'
  );
  const key = /APP_CONFIG_STORAGE_KEY = '([^']+)'/.exec(source)?.[1];
  const version = Number(/APP_CONFIG_VERSION = (\d+)/.exec(source)?.[1] ?? '0');
  if (!key || !version) {
    throw new Error('cannot read APP_CONFIG_STORAGE_KEY / APP_CONFIG_VERSION');
  }
  return { key, version };
}

function buildStoredConfig({ version }, baseUrl) {
  const provider = {
    // validateConfig rejects anything shorter than 20 characters; build the
    // dummy at runtime so it never looks like a real key in this file.
    apiKey: ['offline', 'fixture', 'key', '0'.repeat(24)].join('-'),
    baseUrl,
    model: 'offline-vision',
  };
  return {
    state: {
      enabled: true,
      provider: 'openai-compatible',
      openaiCompatible: provider,
      providers: {
        'openai-compatible': provider,
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          model: 'llava',
        },
        'lm-studio': {
          apiKey: '',
          baseUrl: 'http://localhost:1234/v1',
          model: '',
        },
      },
      targetLanguage: 'zh-CN',
      translationStylePreset: 'natural-zh',
      autoContinueEnabled: false,
      autoTranslateHosts: [],
      onboardingCompleted: true,
      maxImageSize: 1024,
      parallelLimit: 3,
      cacheEnabled: false,
      translationPipeline: 'full-image-vlm',
      regionBatchSize: 10,
      fallbackToFullImage: true,
      overlayStyle: {
        backgroundColor: 'rgb(240, 240, 235)',
        textColor: '#111111',
        minFontSize: 10,
        maxFontSize: 22,
        verticalText: false,
      },
    },
    version,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(options.dist, 'manifest.json'))) {
    throw new Error(`no manifest in ${options.dist}; run pnpm build:public`);
  }

  let transportSummary = null;

  await mkdir(options.out, { recursive: true });
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'manga-offline-'));
  const png = await buildFixtureImage(userDataDir);
  const { server, port, requests: apiRequests } = await startServer(png);
  const proxy = await startBlockingProxy();
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  const chrome = spawn(
    findChrome(),
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate,DnsOverHttps',
      '--disable-background-networking',
      // Every hostname but loopback is unresolvable, and the proxy refuses
      // anything that still reaches it. If the OCR path reached for a CDN it
      // would fail here rather than quietly succeed.
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `--proxy-server=http://127.0.0.1:${proxy.port}`,
      '--proxy-bypass-list=127.0.0.1;localhost',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );

  let cdp;
  const network = [];
  const exceptions = [];
  const consoleErrors = [];
  const consoleLog = [];
  const logEntries = [];
  const sessions = new Map();
  const ledger = createTargetLedger();

  const cleanup = async () => {
    cdp?.close();
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      chrome.kill('SIGKILL');
    }
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => proxy.server.close(resolve));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(300);
      }
    }
  };

  try {
    const devtoolsPort = await waitForDevToolsPort(userDataDir);
    const version = await fetchJson(
      `http://127.0.0.1:${devtoolsPort}/json/version`
    );
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    cdp.on('Target.targetCreated', params => {
      ledger.record(params.targetInfo, 'targetCreated');
    });
    cdp.on('Target.targetInfoChanged', params => {
      ledger.record(params.targetInfo, 'targetInfoChanged');
    });
    cdp.on('Target.targetDestroyed', params => {
      ledger.markDestroyed(params.targetId);
    });

    cdp.on('Network.requestWillBeSent', (params, sessionId) => {
      const rawUrl = params.request.url;
      const at = Date.now();
      network.push({
        sessionId,
        at,
        atIso: new Date(at).toISOString(),
        // Data URLs carry whole images; the log only needs to know one was
        // decoded locally, not the bytes.
        url: rawUrl.startsWith('data:')
          ? `${rawUrl.slice(0, rawUrl.indexOf(',') + 1)}… (${rawUrl.length} chars)`
          : rawUrl,
        method: params.request.method,
        type: params.type,
        initiator: params.initiator?.type ?? '',
      });
    });
    cdp.on('Runtime.exceptionThrown', (params, sessionId) => {
      exceptions.push({
        sessionId,
        text:
          params.exceptionDetails?.exception?.description ??
          params.exceptionDetails?.text ??
          'unknown exception',
      });
    });
    cdp.on('Runtime.consoleAPICalled', (params, sessionId) => {
      const text = params.args
        .map(arg => arg.value ?? arg.description ?? arg.type)
        .join(' ');
      consoleLog.push({ sessionId, type: params.type, text });
      if (params.type !== 'error' && params.type !== 'assert') return;
      consoleErrors.push({ sessionId, type: params.type, text });
    });
    cdp.on('Log.entryAdded', (params, sessionId) => {
      if (params.entry.level !== 'error') return;
      logEntries.push({
        sessionId,
        text: params.entry.text,
        url: params.entry.url,
      });
    });
    cdp.on('Target.attachedToTarget', async (params, sessionId) => {
      const targetSession = params.sessionId ?? sessionId;
      sessions.set(targetSession, params.targetInfo);
      ledger.record(params.targetInfo, 'attachedToTarget');
      try {
        await cdp.send('Network.enable', {}, targetSession);
      } catch {
        // target may have gone
      }
      try {
        await cdp.send('Runtime.enable', {}, targetSession);
      } catch {
        // target may have gone
      }
      try {
        await cdp.send('Log.enable', {}, targetSession);
      } catch {
        // target may have gone
      }
      /*
       * Auto-attach has to be re-armed on the target itself, not only on the
       * browser. The Tesseract worker is a child of the offscreen document;
       * without this it is never attached, so its requests for the WASM core
       * and the traineddata files never reach the network log and the worker
       * performance entries are never collected — the asset check then
       * reports the packaged files as "missing" even though OCR worked.
       */
      try {
        await cdp.send(
          'Target.setAutoAttach',
          { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
          targetSession
        );
      } catch {
        // not every target kind accepts auto-attach
      }
      if (params.waitingForDebugger) {
        try {
          await cdp.send('Runtime.runIfWaitingForDebugger', {}, targetSession);
        } catch {
          // target may have gone
        }
      }
    });

    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    /*
     * Discovery is what turns "the offscreen document exists at some point"
     * into a record: a target that is created and destroyed between two
     * `getTargets` polls still leaves a targetCreated/targetDestroyed pair.
     */
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', {
      path: options.dist,
    });
    check('the extension loads on a clean profile', Boolean(extensionId));
    await ledger.snapshot(cdp, 'extension-loaded').catch(() => undefined);

    // The service worker may already be attached through setAutoAttach.
    let workerSession = null;
    const deadline = Date.now() + 30000;
    while (!workerSession && Date.now() < deadline) {
      for (const [sessionId, info] of sessions) {
        if (
          info.type === 'service_worker' &&
          info.url.startsWith(`chrome-extension://${extensionId}/`)
        ) {
          workerSession = sessionId;
          break;
        }
      }
      if (!workerSession) await sleep(150);
    }
    if (!workerSession) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const worker = targetInfos.find(
        target =>
          target.type === 'service_worker' &&
          target.url.startsWith(`chrome-extension://${extensionId}/`)
      );
      if (worker) {
        const { sessionId } = await cdp.send('Target.attachToTarget', {
          targetId: worker.targetId,
          flatten: true,
        });
        await cdp.send('Runtime.enable', {}, sessionId);
        workerSession = sessionId;
      }
    }
    check('the service worker starts', Boolean(workerSession));
    if (!workerSession) throw new Error('no service worker session');

    // The worker's execution context may not exist yet.
    for (let i = 0; i < 60; i += 1) {
      const ready = await evaluate(
        cdp,
        workerSession,
        "typeof chrome !== 'undefined' && !!chrome.storage",
        { awaitPromise: false }
      ).catch(() => false);
      if (ready) break;
      await sleep(150);
    }

    const contract = readConfigContract();
    const stored = buildStoredConfig(contract, baseUrl);
    const writeConfig = `(async () => {
      await chrome.storage.local.set(${JSON.stringify({
        [contract.key]: stored,
      })});
      return 'written';
    })()`;
    const readConfig = `(async () => {
      const got = await chrome.storage.local.get(${JSON.stringify(contract.key)});
      const value = got[${JSON.stringify(contract.key)}];
      return JSON.stringify({
        enabled: value?.state?.enabled,
        provider: value?.state?.provider,
        baseUrl: value?.state?.providers?.['openai-compatible']?.baseUrl,
        version: value?.version,
      });
    })()`;

    /*
     * The worker initialises its default config on startup. Writing storage
     * before that finishes lets the default write clobber this one — the
     * preflight then reads the shipped MiniMax endpoint and reports the test
     * key as invalid. Write until the stored value has stayed ours across
     * several reads.
     */
    let persisted = '';
    let stable = 0;
    for (let attempt = 0; attempt < 20 && stable < 3; attempt += 1) {
      await evaluate(cdp, workerSession, writeConfig);
      await sleep(500);
      persisted = String(await evaluate(cdp, workerSession, readConfig));
      const ours =
        persisted.includes('127.0.0.1') &&
        persisted.includes('"enabled":true') &&
        persisted.includes('"version":4');
      stable = ours ? stable + 1 : 0;
    }
    check(
      'the extension is configured against the local fake provider',
      stable >= 3,
      persisted
    );

    // ---- the fixture page ------------------------------------------------
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId: pageSession } = await cdp.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    await cdp.send('Page.enable', {}, pageSession);
    await cdp.send('Runtime.enable', {}, pageSession);
    // Dedicated workers are children of the page, not of the browser; without
    // this the Tesseract worker's asset loads never reach the network log.
    await cdp.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
      pageSession
    );
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      pageSession
    );
    await cdp.send(
      'Page.navigate',
      { url: `http://127.0.0.1:${port}/` },
      pageSession
    );
    await sleep(1500);

    const tabId = await evaluate(
      cdp,
      workerSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(item => item.url && item.url.includes('127.0.0.1:${port}'));
        return tab ? tab.id : null;
      })()`
    );
    check('the fixture page is open in a tab', tabId !== null);

    let contentAlive = false;
    for (let i = 0; i < 40 && !contentAlive; i += 1) {
      contentAlive = await evaluate(
        cdp,
        workerSession,
        `chrome.tabs.sendMessage(${tabId}, { type: 'GET_STATE' })
           .then(r => Boolean(r && r.state))
           .catch(() => false)`
      );
      if (!contentAlive) await sleep(250);
    }
    check('the content script is alive on the page', contentAlive);

    const translationStartedAt = Date.now();
    await evaluate(
      cdp,
      workerSession,
      `chrome.tabs.sendMessage(${tabId}, { type: 'TRANSLATE_PAGE' });
       'sent'`,
      { awaitPromise: false }
    );

    let pageInfo = { overlays: 0, processed: 0, text: '' };
    const overlayDeadline = Date.now() + 120000;
    let waitedSeconds = 0;
    while (Date.now() < overlayDeadline) {
      pageInfo = JSON.parse(
        await evaluate(
          cdp,
          pageSession,
          `JSON.stringify({
            overlays: document.querySelectorAll('.manga-translator-overlay').length,
            processed: document.querySelectorAll('img.manga-translator-processed').length,
            text: [...document.querySelectorAll('.manga-translator-overlay')]
              .map(el => el.textContent || '')
              .join(' | ')
          })`
        )
      );
      await ledger.snapshot(cdp, 'during-translation').catch(() => undefined);
      if (pageInfo.overlays > 0) break;
      waitedSeconds += 1;
      if (waitedSeconds % 15 === 0) {
        console.log(
          `[runtime] waiting: ${Math.round((Date.now() - translationStartedAt) / 1000)}s processed=${pageInfo.processed} api=${apiRequests.length}`
        );
      }
      await sleep(1000);
    }
    await sleep(2000);

    const pageText = await evaluate(
      cdp,
      pageSession,
      'document.body ? document.body.innerText.slice(0, 600) : ""'
    ).catch(() => '');
    const contentState = await evaluate(
      cdp,
      workerSession,
      `chrome.tabs.sendMessage(${tabId}, { type: 'GET_STATE' })
         .then(r => JSON.stringify(r && r.state ? r.state : r))
         .catch(error => 'ERR:' + error.message)`
    ).catch(error => `ERR:${error.message}`);
    console.log('[runtime] page text:', String(pageText).replace(/\s+/g, ' '));
    console.log('[runtime] content state:', String(contentState).slice(0, 800));
    console.log('[runtime] console:');
    for (const entry of consoleLog.slice(-40)) {
      console.log(`  [${entry.type}] ${entry.text.slice(0, 300)}`);
    }
    console.log('[runtime] targets:');
    for (const [sessionId, info] of sessions) {
      console.log(`  ${info.type} ${info.url} (${sessionId.slice(0, 8)})`);
    }
    console.log('[runtime] all network requests:');
    for (const event of network) {
      console.log(`  ${event.type} ${event.method} ${event.url.slice(0, 160)}`);
    }

    check(
      'the OCR fallback draws a translation overlay',
      pageInfo.overlays > 0,
      `overlays=${pageInfo.overlays} processed=${pageInfo.processed} text=${pageInfo.text.slice(0, 80)}`
    );
    check(
      'the overlay carries the model translation',
      pageInfo.text.includes('等等！'),
      pageInfo.text.slice(0, 80)
    );

    const hybridRequests = apiRequests.filter(request => request.hybrid);
    const fullImageRequests = apiRequests.filter(request => !request.hybrid);
    check(
      'the model answered the full image with zero text, then the OCR strip was translated',
      fullImageRequests.length >= 1 && hybridRequests.length >= 1,
      `full-image=${fullImageRequests.length} hybrid=${hybridRequests.length}`
    );
    check(
      'the provider request carried the configured key',
      apiRequests.every(request => request.authorization.startsWith('Bearer ')),
      apiRequests.map(request => request.authorization).join(', ')
    );

    const duringTranslation = network.filter(
      event => event.at >= translationStartedAt
    );
    const expectedAssets = [
      'tesseract/worker.min.js',
      'tesseract/tesseract-core-simd-lstm.wasm.js',
      'tesseract/lang/chi_sim.traineddata.gz',
      'tesseract/lang/jpn.traineddata.gz',
      'tesseract/lang/eng.traineddata.gz',
      'tesseract/lang/kor.traineddata.gz',
    ];
    const loadedUrls = duringTranslation.map(event => event.url);
    const missingAssets = expectedAssets.filter(
      asset => !loadedUrls.some(url => urlLoadsExtensionAsset(url, asset))
    );

    /*
     * Ask every attached target what it loaded. Network events from a worker
     * can be missed when it exits before the event arrives, and the offscreen
     * document's own loads are invisible to the page session; the performance
     * entries are the second, independent record.
     */
    await ledger.snapshot(cdp, 'overlay-detected').catch(() => undefined);
    const sessionResources = [];
    for (const [sessionId, info] of sessions) {
      const resources = await evaluate(
        cdp,
        sessionId,
        `JSON.stringify(performance.getEntriesByType('resource').map(entry => entry.name))`
      ).catch(() => null);
      if (typeof resources === 'string') {
        sessionResources.push({
          sessionId,
          type: info.type,
          url: info.url,
          resources: JSON.parse(resources),
        });
      }
    }
    const workerResources = sessionResources
      .filter(entry => entry.type === 'worker')
      .map(entry => ({ url: entry.url, resources: entry.resources }));

    /*
     * The offscreen document is the transport this run is supposed to use.
     * Its target is identified by exact URL: the iframe fallback opens the
     * same page with `#ocr-frame=<token>`, so equality separates the two
     * roles and stays correct after the iframe channel is removed.
     */
    const offscreenUrl = `chrome-extension://${extensionId}/${OFFSCREEN_DOCUMENT_PATH}`;
    const offscreenTargetInfos = await ledger
      .snapshot(cdp, 'offscreen-probe')
      .catch(() => []);
    const offscreenRecord = [...ledger.targets.values()].find(
      target => target.url === offscreenUrl
    );
    const offscreenTarget =
      offscreenTargetInfos.find(info => info.url === offscreenUrl) ??
      offscreenRecord ??
      null;
    /*
     * The target was auto-attached while it was still navigating, so its
     * session carries an empty URL in `sessions`; match on targetId instead.
     */
    let offscreenSession =
      (offscreenTarget &&
        [...sessions].find(
          ([, info]) => info.targetId === offscreenTarget.targetId
        )?.[0]) ||
      null;
    if (!offscreenSession && offscreenTarget) {
      try {
        const attached = await cdp.send('Target.attachToTarget', {
          targetId: offscreenTarget.targetId,
          flatten: true,
        });
        offscreenSession = attached.sessionId;
        await cdp.send('Runtime.enable', {}, offscreenSession);
      } catch {
        offscreenSession = null;
      }
    }
    const offscreenLive = offscreenSession
      ? await evaluate(
          cdp,
          offscreenSession,
          `JSON.stringify({
            href: location.href,
            isTopLevel: window.top === window,
            visibility: document.visibilityState,
            readyState: document.readyState
          })`
        )
          .then(value => JSON.parse(value))
          .catch(() => null)
      : null;
    const offscreenResources = offscreenSession
      ? await evaluate(
          cdp,
          offscreenSession,
          `JSON.stringify(performance.getEntriesByType('resource').map(entry => entry.name))`
        )
          .then(value => JSON.parse(value))
          .catch(() => [])
      : [];
    const allLoadedUrls = [
      ...loadedUrls,
      ...workerResources.flatMap(entry => entry.resources),
      ...sessionResources.flatMap(entry => entry.resources),
      ...offscreenResources,
    ];
    const stillMissing = missingAssets.filter(
      asset => !allLoadedUrls.some(url => urlLoadsExtensionAsset(url, asset))
    );
    check(
      'every Tesseract asset was loaded from the extension, not the network',
      stillMissing.length === 0,
      stillMissing.length ? `missing: ${stillMissing.join(', ')}` : ''
    );

    const remote = duringTranslation.filter(event => {
      const url = event.url;
      return (
        (url.startsWith('http://') &&
          !url.startsWith(`http://127.0.0.1:${port}/`)) ||
        url.startsWith('https://') ||
        url.startsWith('//')
      );
    });
    check(
      'the translation made zero requests outside the local fixture server',
      remote.length === 0,
      remote.length ? remote.map(event => event.url).join(', ') : ''
    );

    const cdnAttempts = proxy.attempts.filter(attempt =>
      /jsdelivr|unpkg|tessdata|tesseract/i.test(attempt)
    );
    check(
      'no CDN request reached the blocking proxy',
      cdnAttempts.length === 0,
      cdnAttempts.join(', ')
    );

    /*
     * Snapshot the console before the control fetch: that fetch fails on
     * purpose, and its network error is not part of the translation run.
     */
    const consoleSnapshot = consoleErrors.slice();
    const logSnapshot = logEntries.slice();
    // The control fetch below is expected to reach the proxy and be refused;
    // keep the run's own attempts separate from that deliberate failure.
    const proxyAttemptsDuringRun = proxy.attempts.slice();

    // ---- the control that proves the network is really off ---------------
    const { targetId: controlTarget } = await cdp.send('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId: controlSession } = await cdp.send(
      'Target.attachToTarget',
      { targetId: controlTarget, flatten: true }
    );
    await cdp.send('Runtime.enable', {}, controlSession);
    const control = await evaluate(
      cdp,
      controlSession,
      `fetch('https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js', {
        signal: AbortSignal.timeout(8000)
      }).then(response => 'reachable:' + response.status).catch(error => 'blocked:' + error.message)`
    ).catch(error => `blocked:${error.message}`);
    check(
      'external hosts are unreachable in this browser (jsdelivr control)',
      String(control).startsWith('blocked:'),
      String(control).slice(0, 120)
    );

    const extensionExceptions = exceptions.filter(entry => {
      const info = sessions.get(entry.sessionId);
      return info?.url?.startsWith('chrome-extension://');
    });
    check(
      'no extension exception was thrown during the run',
      extensionExceptions.length === 0,
      extensionExceptions
        .map(entry => entry.text)
        .join(' | ')
        .slice(0, 240)
    );
    // Tesseract prints config warnings through console.error and the Log
    // domain. They describe parameters absent from the LSTM-only build, not
    // failures.
    const benignTesseract =
      /^(Warning: Parameter not found|Estimating resolution)/;
    const realConsoleErrors = consoleSnapshot.filter(
      entry => !benignTesseract.test(entry.text)
    );
    const realLogEntries = logSnapshot.filter(
      entry => !benignTesseract.test(entry.text)
    );
    check(
      'no error-level console output during the run',
      realConsoleErrors.length === 0 && realLogEntries.length === 0,
      [...realConsoleErrors, ...realLogEntries]
        .map(entry => entry.text)
        .join(' | ')
        .slice(0, 240)
    );

    /*
     * ---- negative assertions ----------------------------------------------
     *
     * Everything above proves the OCR worked. These prove it worked without
     * the things the Blue Argon rejection was about, and on the transport
     * this build is supposed to use:
     *
     *   - no bare `tesseract-core-*.wasm` binary was fetched; the packaged
     *     `.wasm.js` core is the only core, so a `.wasm` request means a
     *     second copy is in the package and in play;
     *   - the extension's offscreen document existed during the run, as a
     *     real top-level document rather than the page iframe;
     *   - no `blob:` worker target existed — the page-origin fallback
     *     bootstraps its worker from a blob, and that path must not run.
     */
    await ledger.snapshot(cdp, 'end').catch(() => undefined);

    const allRunUrls = [
      ...network.map(event => event.url),
      ...sessionResources.flatMap(entry => entry.resources),
      ...offscreenResources,
    ];
    const wasmCoreUrls = [
      ...new Set(
        allRunUrls.filter(url => /tesseract-core-.*\.wasm\.js$/.test(url))
      ),
    ];
    const deadWeightUrls = [
      ...new Set(allRunUrls.filter(url => DEAD_WEIGHT_WASM.test(url))),
    ];
    check(
      'no bare tesseract-core-*.wasm binary was requested (.wasm.js is the only core)',
      deadWeightUrls.length === 0,
      deadWeightUrls.length
        ? `requested: ${deadWeightUrls.join(', ')}`
        : `${allRunUrls.length} URLs checked; ${wasmCoreUrls.length} .wasm.js core request(s)`
    );

    const offscreenTargets = [...ledger.targets.values()].filter(
      target => target.url === offscreenUrl
    );
    const offscreenTopLevel = offscreenLive
      ? offscreenLive.isTopLevel === true
      : null;
    const offscreenOk =
      offscreenTargets.length > 0 && offscreenTopLevel !== false;
    check(
      'the OCR ran in the extension offscreen document (chrome-extension://…/offscreen.html)',
      offscreenOk,
      offscreenOk
        ? `type=${offscreenTargets.map(target => target.type).join('+')} topLevel=${offscreenTopLevel} firstSeen=${new Date(offscreenTargets[0].firstSeenAt).toISOString()} via=${offscreenTargets[0].sources.join('+')}`
        : `no top-level target with url ${offscreenUrl}; seen: ${[...ledger.targets.values()].map(target => `${target.type}:${target.url}`).join(', ')}`
    );

    const blobTargets = [...ledger.targets.values()].filter(target =>
      target.url.startsWith('blob:')
    );
    const blobWorkerTargets = blobTargets.filter(isWorkerTarget);
    check(
      'no page-origin blob: worker was created during the run',
      blobWorkerTargets.length === 0,
      blobWorkerTargets.length
        ? blobWorkerTargets
            .map(target => `${target.type} ${target.url}`)
            .join(', ')
        : `worker targets seen: ${[...ledger.targets.values()].filter(isWorkerTarget).length}, none blob:`
    );

    const transport =
      offscreenOk && blobWorkerTargets.length === 0
        ? 'offscreen'
        : blobWorkerTargets.length > 0
          ? 'blob-worker'
          : 'unknown';
    transportSummary = {
      used: transport,
      basis: [
        `${offscreenTargets.length} target(s) with url ${offscreenUrl} (type=${offscreenTargets.map(target => target.type).join('+') || 'none'}, topLevel=${offscreenTopLevel})`,
        `${blobWorkerTargets.length} blob: worker target(s)`,
        `${deadWeightUrls.length} bare .wasm request(s)`,
      ].join('; '),
      offscreen: {
        url: offscreenUrl,
        found: offscreenTargets.length > 0,
        targets: offscreenTargets.map(target => ({
          targetId: target.targetId,
          type: target.type,
          url: target.url,
          firstSeenAt: target.firstSeenAt,
          firstSeenAtIso: new Date(target.firstSeenAt).toISOString(),
          lastSeenAt: target.lastSeenAt,
          lastSeenAtIso: new Date(target.lastSeenAt).toISOString(),
          sources: target.sources,
        })),
        live: offscreenLive,
        resources: offscreenResources,
      },
      blobWorkerTargets: blobWorkerTargets.map(target => ({
        targetId: target.targetId,
        type: target.type,
        url: target.url,
        firstSeenAt: target.firstSeenAt,
        firstSeenAtIso: new Date(target.firstSeenAt).toISOString(),
        sources: target.sources,
      })),
      allBlobTargets: blobTargets.map(target => ({
        type: target.type,
        url: target.url,
      })),
      deadWeightWasmRequests: deadWeightUrls,
      wasmJsCoreRequests: wasmCoreUrls,
    };

    console.log('[runtime] target ledger:');
    for (const target of serializeTargets(ledger)) {
      console.log(
        `  ${target.type || '?'} ${target.url || '(no url)'} firstSeen=${target.firstSeenAtIso} sources=${target.sources.join('+')}`
      );
    }

    const screenshot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png' },
      pageSession
    );
    await writeFile(
      path.join(options.out, 'runtime-offline-ocr.png'),
      Buffer.from(screenshot.data, 'base64')
    );

    await mkdir(options.out, { recursive: true });
    await writeFile(
      path.join(options.out, 'runtime-network.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          extensionId,
          source: `http://127.0.0.1:${port}`,
          transport: transportSummary,
          targets: serializeTargets(ledger),
          targetSnapshots: ledger.snapshots.map(snapshot => ({
            at: snapshot.at,
            atIso: new Date(snapshot.at).toISOString(),
            label: snapshot.label,
            targets: snapshot.targets,
          })),
          checks: results,
          requests: duringTranslation,
          allRequests: network,
          workerResources,
          sessionResources,
          offscreenResources,
          apiRequests,
          proxyAttemptsDuringRun,
          proxyAttemptsAll: proxy.attempts,
        },
        null,
        2
      ),
      'utf8'
    );

    console.log('[runtime] api requests:');
    apiRequests.forEach((request, index) => {
      console.log(
        `  #${index + 1} ${request.hybrid ? 'hybrid-strip' : 'full-image'} bytes=${request.bytes} auth=${request.authorization}`
      );
    });
    console.log('[runtime] network during translation:');
    const byOrigin = new Map();
    for (const event of duringTranslation) {
      let origin = 'other';
      try {
        origin = new URL(event.url).origin;
      } catch {
        origin = event.url.slice(0, 40);
      }
      byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
    }
    for (const [origin, count] of byOrigin) {
      console.log(`  ${origin}: ${count}`);
    }
  } finally {
    await cleanup();
  }

  if (transportSummary) {
    console.log(`[runtime] transport=${transportSummary.used}`);
    console.log(`[runtime] transport basis: ${transportSummary.basis}`);
  }

  const failed = results.filter(result => !result.ok);
  console.log(
    `[runtime] ${results.length - failed.length}/${results.length} checks passed`
  );
  if (failed.length > 0) {
    for (const result of failed) {
      console.error(`[runtime] FAILED: ${result.name} ${result.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`[runtime] failed: ${error.message}`);
  process.exitCode = 1;
});
