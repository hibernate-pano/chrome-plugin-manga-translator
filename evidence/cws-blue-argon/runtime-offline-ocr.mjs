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
 *   5. proves the network is really off with a control fetch to jsdelivr.
 *
 * Usage:
 *   node evidence/cws-blue-argon/runtime-offline-ocr.mjs [--dist dist]
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
  const options = { dist: path.join(repoRoot, 'dist') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dist') options.dist = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return options;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
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

  await mkdir(here, { recursive: true });
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

    cdp.on('Network.requestWillBeSent', (params, sessionId) => {
      const rawUrl = params.request.url;
      network.push({
        sessionId,
        at: Date.now(),
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

    const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', {
      path: options.dist,
    });
    check('the extension loads on a clean profile', Boolean(extensionId));

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

    // Network events from a worker can be missed if the worker exits before
    // the event reaches us; ask each worker target what it loaded as well.
    const workerResources = [];
    for (const [sessionId, info] of sessions) {
      if (info.type !== 'worker') continue;
      const resources = await evaluate(
        cdp,
        sessionId,
        `JSON.stringify(performance.getEntriesByType('resource').map(entry => entry.name))`
      ).catch(() => null);
      if (typeof resources === 'string') {
        workerResources.push({
          url: info.url,
          resources: JSON.parse(resources),
        });
      }
    }
    const allLoadedUrls = [
      ...loadedUrls,
      ...workerResources.flatMap(entry => entry.resources),
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

    const screenshot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png' },
      pageSession
    );
    await writeFile(
      path.join(here, 'runtime-offline-ocr.png'),
      Buffer.from(screenshot.data, 'base64')
    );

    await mkdir(here, { recursive: true });
    await writeFile(
      path.join(here, 'runtime-network.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          extensionId,
          source: `http://127.0.0.1:${port}`,
          requests: duringTranslation,
          workerResources,
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
