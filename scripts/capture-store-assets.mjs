#!/usr/bin/env node
/**
 * 采集 Chrome Web Store 上架素材：截图 + 演示录屏。
 *
 * 商店要两样东西：一张"译文就叠在页面上"的截图，和一段演示录屏。这份脚本
 * 用 CDP 驱动一个装了扩展的 Chrome，把两样都录出来。
 *
 * 产物落在 store/listing/：
 *   screenshot-1280x800.png        主图，只留译文盖住原文这一件事
 *   screenshot-panel-1280x800.png  带阅读面板的那张
 *   demo.mp4                       演示录屏
 *   .debug/                        排查用的中间数据（--dump），不是商店素材
 *
 * 加载扩展用的是 Chrome 137+ 之后唯一还能用的方式：`--load-extension`
 * 已经被关掉了，只能带着 `--enable-unsafe-extension-debugging` 启动，
 * 再用 `Extensions.loadUnpacked` 加载 dist/。
 *
 * 不依赖任何 npm 包：Node 22 自带 WebSocket 和 fetch。
 *
 * 用法：
 *   node scripts/build-demo-page.mjs && pnpm build
 *   node scripts/capture-store-assets.mjs
 *   node scripts/capture-store-assets.mjs --page http://127.0.0.1:8000/demo.html
 *   node scripts/capture-store-assets.mjs --dump       # 顺带导出排查用数据
 *   node scripts/capture-store-assets.mjs --keep-open   # 录完不关浏览器
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT = { width: 1280, height: 800 };
const RECORD_SECONDS = Number(process.env.RECORD_SECONDS ?? 30);

function parseArgs(argv) {
  const options = {
    page: null,
    outDir: path.join(repoRoot, 'store', 'listing'),
    keepOpen: false,
    dump: false,
    dist: path.join(repoRoot, 'dist'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--page') options.page = argv[++i];
    else if (arg === '--out') options.outDir = path.resolve(argv[++i]);
    else if (arg === '--keep-open') options.keepOpen = true;
    else if (arg === '--dump') options.dump = true;
    else if (arg === '--dist') options.dist = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

// ==================== CDP 客户端 ====================

/**
 * 一层薄薄的 CDP 客户端。
 *
 * 只实现了这里用得上的部分：发命令、等回复、收事件。命令可以带
 * sessionId —— 扁平会话模式下，页面的命令要挂在会话里发。
 */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        } else {
          entry.resolve(message.result);
        }
        return;
      }
      for (const handler of this.handlers.get(message.method) ?? []) {
        handler(message.params, message.sessionId);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener(
        'error',
        () => {
          reject(new Error(`cannot connect to ${url}`));
        },
        { once: true }
      );
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // 已经关掉了就算了。
    }
  }
}

// ==================== 小工具 ====================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDevToolsPort(userDataDir, timeoutMs = 30000) {
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const contents = await readFile(portFile, 'utf8');
      const port = Number.parseInt(contents.split('\n')[0], 10);
      if (Number.isFinite(port)) return port;
    }
    await sleep(120);
  }
  throw new Error('Chrome never published a DevTools port');
}

async function fetchJson(url, attempts = 40) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`cannot read ${url}: ${lastError}`);
}

/**
 * 起一个只服务本地目录的静态服务器。
 *
 * 演示页必须走 http:// 而不是 file://：内容脚本在 file:// 下拿不到正常的
 * 页面环境，图片也会走另一条分支，录出来的演示就不是用户在真实网站里
 * 看到的样子了。
 */
async function serveDirectory(dirPath) {
  const server = createServer((request, response) => {
    const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const filePath = path.join(dirPath, path.normalize(requested));
    if (!filePath.startsWith(dirPath) || !existsSync(filePath)) {
      response.writeHead(404).end('not found');
      return;
    }
    const type = filePath.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : filePath.endsWith('.png')
        ? 'image/png'
        : 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
    });
    response.end(readFileSync(filePath));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/` };
}

/**
 * 把录屏帧拼成 mp4。
 *
 * Chrome 的 screencast 每帧自带时间戳，帧率不是恒定的，所以按时间戳生成
 * concat 清单，而不是按固定帧率喂给 ffmpeg —— 那样出来的视频会忽快忽慢。
 */
async function assembleVideo(framesDir, timestamps, outputFile) {
  if (timestamps.length < 2) {
    throw new Error('the screencast produced too few frames to assemble');
  }
  const lines = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const next = timestamps[i + 1] ?? timestamps[i] + 0.04;
    lines.push(`file 'frame_${String(i).padStart(5, '0')}.jpg'`);
    lines.push(`duration ${(next - timestamps[i]).toFixed(4)}`);
  }
  const listFile = path.join(framesDir, 'frames.txt');
  await writeFile(listFile, `${lines.join('\n')}\n`, 'utf8');

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-vf',
        'scale=1280:-2:flags=lanczos,format=yuv420p',
        '-r',
        '30',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '23',
        outputFile,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    ffmpeg.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

/**
 * 在 service worker 里执行一段表达式。
 *
 * 扩展页面（options.html）不能用作入口：Chrome 会挡下自动化客户端
 * 直接导航到 chrome-extension:// 的请求（ERR_BLOCKED_BY_CLIENT），
 * service worker 没有这个问题。
 */
async function evaluateInWorker(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error(
      `worker evaluation failed: ${result.exceptionDetails.text ?? 'unknown error'}`
    );
  }
  return result.result?.value;
}

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
      const { sessionId } = await cdp.send('Target.attachToTarget', {
        targetId: worker.targetId,
        flatten: true,
      });
      await cdp.send('Runtime.enable', {}, sessionId);
      // 挂上会话不等于执行上下文已经建好：早一步 evaluate 会在一个没有
      // chrome.* 的上下文里跑，报 "chrome is not defined"。等到能用为止。
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
    }
    await sleep(200);
  }
  throw new Error('the extension service worker never showed up');
}

// ==================== 主流程 ====================

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(options.dist)) {
    throw new Error(`${options.dist} does not exist — run "pnpm build" first`);
  }

  const demoDir = path.join(repoRoot, 'store', 'demo');
  const demoPage = path.join(demoDir, 'demo-manga-page.html');
  if (!options.page && !existsSync(demoPage)) {
    throw new Error(
      `${demoPage} does not exist — run "node scripts/build-demo-page.mjs" first`
    );
  }

  await mkdir(options.outDir, { recursive: true });
  // 调试产物单独放一个目录：它们是排查用的中间数据，不是商店素材。
  const debugDir = path.join(options.outDir, '.debug');
  await mkdir(debugDir, { recursive: true });

  const { server, url: servedUrl } = await serveDirectory(demoDir);
  const pageUrl = options.page ?? `${servedUrl}demo-manga-page.html`;
  console.log(`[capture] page: ${pageUrl}`);

  const userDataDir = path.join(
    os.tmpdir(),
    `manga-store-assets-${Date.now()}`
  );
  await mkdir(userDataDir, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );

  let browser;
  const cleanup = async () => {
    browser?.close();
    if (!options.keepOpen) {
      // Chrome 是一组进程，杀掉父进程不够：渲染进程会留下来，把临时
      // profile 目录占着。整组一起杀。
      try {
        process.kill(-chrome.pid, 'SIGKILL');
      } catch {
        chrome.kill('SIGKILL');
      }
      // 进程被 SIGKILL 之后，内核要等它们真正退出会话，临时目录才拿得
      // 干净。这时候 rm 会报 ENOTEMPTY。素材已经录好了，清理失败不该
      // 把整次采集变成失败，所以重试几轮，还不行就把它留在临时目录里。
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
    }
    server.close();
  };

  try {
    const port = await waitForDevToolsPort(userDataDir);
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    browser = await Cdp.connect(version.webSocketDebuggerUrl);
    console.log(`[capture] connected to ${version.Browser}`);

    const { id: extensionId } = await browser.send('Extensions.loadUnpacked', {
      path: options.dist,
    });
    console.log(`[capture] extension loaded: ${extensionId}`);

    const workerSession = await findWorkerSession(browser, extensionId);

    // 把主开关和引导标记打开，等于替用户走完设置页。
    // 键值原样写回：存的是混淆过的 API Key，脚本不该碰它。
    await evaluateInWorker(
      browser,
      workerSession,
      `(async () => {
        const KEY = 'manga-translator-config-v2';
        const raw = await chrome.storage.local.get(KEY);
        const stored = raw[KEY] ?? {};
        const patch = { enabled: true, onboardingCompleted: true };
        const next =
          stored && typeof stored.state === 'object' && stored.state
            ? { ...stored, state: { ...stored.state, ...patch } }
            : { ...stored, ...patch };
        await chrome.storage.local.set({ [KEY]: next });
        return { patched: true, hadConfig: Boolean(raw[KEY]) };
      })()`
    );

    const { targetId } = await browser.send('Target.createTarget', {
      url: pageUrl,
    });
    const { sessionId: pageSession } = await browser.send(
      'Target.attachToTarget',
      { targetId, flatten: true }
    );
    await browser.send('Page.enable', {}, pageSession);
    await browser.send('Runtime.enable', {}, pageSession);
    await browser.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      pageSession
    );

    // 等内容脚本就位：它注册好之后 GET_STATE 才会有回音。
    const tabId = await evaluateInWorker(
      browser,
      workerSession,
      `(async () => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find(item => item.url && item.url.startsWith(${JSON.stringify(
            new URL(pageUrl).origin
          )}));
          if (!tab) { await new Promise(r => setTimeout(r, 200)); continue; }
          try {
            const reply = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' });
            if (reply && reply.state) return tab.id;
          } catch { /* 内容脚本还没注册 */ }
          await new Promise(r => setTimeout(r, 200));
        }
        throw new Error('the content script never answered on ' + ${JSON.stringify(pageUrl)});
      })()`
    );
    console.log(`[capture] content script is live on tab ${tabId}`);

    // ==================== 录屏 ====================

    const framesDir = path.join(options.outDir, '.frames');
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });

    const frameTimestamps = [];
    browser.on('Page.screencastFrame', async (params, sessionId) => {
      if (sessionId !== pageSession) return;
      const index = frameTimestamps.length;
      frameTimestamps.push(params.metadata.timestamp);
      await writeFile(
        path.join(framesDir, `frame_${String(index).padStart(5, '0')}.jpg`),
        Buffer.from(params.data, 'base64')
      );
      await browser
        .send(
          'Page.screencastFrameAck',
          { sessionId: params.sessionId },
          pageSession
        )
        .catch(() => undefined);
    });

    await browser.send(
      'Page.startScreencast',
      { format: 'jpeg', quality: 85, everyNthFrame: 1 },
      pageSession
    );

    await evaluateInWorker(
      browser,
      workerSession,
      `chrome.tabs.sendMessage(${tabId}, { type: 'TRANSLATE_PAGE' })`
    ).catch(error =>
      console.warn(`[capture] translate trigger: ${error.message}`)
    );
    console.log('[capture] translation started');

    const startedAt = Date.now();
    let lastState = null;
    while ((Date.now() - startedAt) / 1000 < RECORD_SECONDS) {
      await sleep(1000);
      const state = await evaluateInWorker(
        browser,
        workerSession,
        `chrome.tabs.sendMessage(${tabId}, { type: 'GET_STATE' }).then(r => r && r.state).catch(() => null)`
      );
      if (state) {
        lastState = state;
        console.log(
          `[capture] ${Math.round((Date.now() - startedAt) / 1000)}s status=${state.status} ${state.current ?? ''}/${state.total ?? ''}`
        );
        if (state.status === 'complete' || state.status === 'error') break;
      }
    }

    // 译文落地之后慢慢往下滚一遍，再回到顶部。
    // 截图和视频都要停在"译文已经盖住原文"的那一刻 —— 商店看的是结果，
    // 不是过程。
    const scrollScript = `(async () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const steps = 24;
      for (let i = 0; i <= steps; i += 1) {
        window.scrollTo(0, (max * i) / steps);
        await new Promise(r => setTimeout(r, 90));
      }
      await new Promise(r => setTimeout(r, 1500));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 1200));
    })()`;
    await browser
      .send(
        'Runtime.evaluate',
        { expression: scrollScript, awaitPromise: true },
        pageSession
      )
      .catch(() => undefined);

    await browser
      .send('Page.stopScreencast', {}, pageSession)
      .catch(() => undefined);
    console.log(`[capture] recorded ${frameTimestamps.length} frames`);

    if (options.dump) {
      // 把覆盖层的真实几何打印出来：截图只能靠眼睛量，量出来的数没法定责。
      const dump = await browser.send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const img = document.querySelector('img.page');
            const rect = img ? img.getBoundingClientRect() : null;
            const overlays = [...document.querySelectorAll('.manga-translator-overlay')].map(el => {
              const r = el.getBoundingClientRect();
              const translated = el.querySelector('.manga-translator-text-translated');
              return {
                text: translated ? translated.textContent : el.textContent,
                rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                style: el.getAttribute('style'),
              };
            });
            return JSON.stringify({
              image: rect ? {
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                natural: { width: img.naturalWidth, height: img.naturalHeight },
              } : null,
              overlays,
            });
          })()`,
          returnByValue: true,
        },
        pageSession
      );
      const file = path.join(debugDir, 'overlay-geometry.json');
      await writeFile(file, dump.result.value ?? '{}', 'utf8');
      console.log(`[capture] geometry -> ${file}`);

      // 缓存里存的是模型给的框（精修之前）。把它导出来，才能把"模型给的
      // 位置"和"最终画出来的位置"分开看。
      const cached = await evaluateInWorker(
        browser,
        workerSession,
        `(async () => {
          const raw = await chrome.storage.local.get('manga-translator-cache-v2');
          const stored = raw['manga-translator-cache-v2'];
          const state = stored && stored.state ? stored.state : stored;
          const entries = state?.entries ?? {};
          const list = Array.isArray(entries)
            ? entries
            : Object.values(entries);
          return JSON.stringify(list.map(entry => ({
            key: entry.key ?? entry.imageHash ?? null,
            areas: (entry.result?.textAreas ?? entry.textAreas ?? entry.value?.textAreas ?? []).map(a => ({
              x: a.x, y: a.y, width: a.width, height: a.height,
              originalText: a.originalText, translatedText: a.translatedText,
            })),
          })));
        })()`
      );
      if (cached) {
        const cacheFile = path.join(debugDir, 'model-boxes.json');
        await writeFile(cacheFile, cached, 'utf8');
        console.log(`[capture] model boxes -> ${cacheFile}`);
      }

      // 把图片的原始像素也导出来：精修器的行为只能靠像素复现，光看截图
      // 猜不出来它是把哪个墨块并进来的。
      const pixels = await browser.send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const img = document.querySelector('img.page');
            if (!img) return null;
            const read = (w, h) => {
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              const data = ctx.getImageData(0, 0, w, h).data;
              let binary = '';
              const chunk = 0x8000;
              for (let i = 0; i < data.length; i += chunk) {
                binary += String.fromCharCode.apply(null, data.subarray(i, i + chunk));
              }
              return btoa(binary);
            };
            // 精修器分析的是缩到最长边 1400 的那份，必须按同样的方式缩，
            // 否则复现出来的墨块和线上的不是同一批。
            const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
            const aw = Math.max(1, Math.round(img.naturalWidth * scale));
            const ah = Math.max(1, Math.round(img.naturalHeight * scale));
            return JSON.stringify({
              width: img.naturalWidth,
              height: img.naturalHeight,
              rgba: read(img.naturalWidth, img.naturalHeight),
              analysis: { width: aw, height: ah, rgba: read(aw, ah) },
            });
          })()`,
          returnByValue: true,
        },
        pageSession
      );
      if (pixels.result?.value) {
        const parsed = JSON.parse(pixels.result.value);
        const pixelsFile = path.join(debugDir, 'pixels.json');
        await writeFile(pixelsFile, JSON.stringify(parsed), 'utf8');
        console.log(`[capture] pixels -> ${pixelsFile}`);
      }
    }

    const videoPath = path.join(options.outDir, 'demo.mp4');
    await assembleVideo(framesDir, frameTimestamps, videoPath);
    console.log(`[capture] video -> ${videoPath}`);

    // ==================== 截图 ====================

    /*
     * 截图的滚动位置由内容决定，不由拍脑袋决定。
     *
     * 漫画页是竖的，视口是横的，两者对不上：随便滚到一个位置，翻译框就会
     * 被视口下沿切一半，商店缩略图上一看就是"没画完"。所以这里先量一遍
     * 每个译文框在页面里的位置，挑一个能让最多的译文框完整露出来的滚动
     * 位置 —— 完整露出的算 1 分，只露一半的算半分。
     */
    const bestScroll = await browser
      .send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const boxes = [...document.querySelectorAll('.manga-translator-overlay')].map(el => {
              const r = el.getBoundingClientRect();
              return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
            });
            // 第一页是读者打开页面看到的第一页，优先把它放完整。
            const firstPage = document.querySelector('img.page');
            const firstRect = firstPage ? firstPage.getBoundingClientRect() : null;
            const firstTop = firstRect ? firstRect.top + window.scrollY : 0;
            const firstBottom = firstRect ? firstRect.bottom + window.scrollY : 0;
            if (boxes.length === 0) return 0;
            const vh = window.innerHeight;
            const max = Math.max(0, document.documentElement.scrollHeight - vh);
            const clamp = y => Math.max(0, Math.min(max, y));

            // 视口的上下两条边都不能落在译文框中间：被切掉一半的白框看着
            // 像渲染出了错，比少露一个框糟糕得多。所以只考虑整框在视口里、
            // 或者整框在视口外的位置。
            const edgeCuts = y =>
              boxes.some(box => {
                const cutsTop = y > box.top && y < box.bottom;
                const cutsBottom = y + vh > box.top && y + vh < box.bottom;
                return cutsTop || cutsBottom;
              });
            const candidates = new Set([0, max]);
            for (const box of boxes) {
              candidates.add(clamp(Math.round(box.top)));
              candidates.add(clamp(Math.round(box.bottom)));
              candidates.add(clamp(Math.round(box.top) - vh));
              candidates.add(clamp(Math.round(box.bottom) - vh));
            }

            // 视口的上沿也不该落在漫画页中间 —— 顶上留一条别的页的边，
            // 看着像没截好。
            const images = [...document.querySelectorAll('img.page')].map(el => {
              const r = el.getBoundingClientRect();
              return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
            });
            const cutsImage = y =>
              images.some(image => y > image.top && y < image.bottom);

            let best = 0;
            let bestScore = -1;
            for (const y of candidates) {
              if (edgeCuts(y)) continue;
              let shown = 0;
              let area = 0;
              let firstShown = 0;
              for (const box of boxes) {
                if (box.top >= y && box.bottom <= y + vh) {
                  shown += 1;
                  area += box.bottom - box.top;
                  if (box.top >= firstTop && box.bottom <= firstBottom) {
                    firstShown += 1;
                  }
                }
              }
              const score =
                (cutsImage(y) ? 0 : 1000000) +
                firstShown * 100000 +
                shown * 10000 +
                area;
              if (score > bestScore) { bestScore = score; best = y; }
            }
            return best;
          })()`,
          returnByValue: true,
        },
        pageSession
      )
      .then(result => result.result?.value ?? 0)
      .catch(() => 0);
    await browser
      .send(
        'Runtime.evaluate',
        { expression: `window.scrollTo(0, ${Math.round(bestScroll)})` },
        pageSession
      )
      .catch(() => undefined);
    await sleep(800);
    console.log(
      `[capture] screenshot scroll offset: ${Math.round(bestScroll)}px`
    );

    const capture = async name => {
      const { data } = await browser.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false },
        pageSession
      );
      const file = path.join(
        options.outDir,
        `${name}-${VIEWPORT.width}x${VIEWPORT.height}.png`
      );
      await writeFile(file, Buffer.from(data, 'base64'));
      console.log(`[capture] screenshot -> ${file}`);
    };

    // 第一张带阅读面板：面板按页列出全部译文，本身就是卖点。
    await capture('screenshot-panel');

    // 主图把面板收起来，只留"译文盖在原文上"这一件事。面板默认挂在右上角，
    // 正好压在漫画上 —— 商店列表页的缩略图很小，译文被面板一挡就白搭了。
    const panelState = await browser
      .send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const panel = document.querySelector('[data-manga-translator-reading-panel]');
            return panel ? panel.style.display !== 'none' : false;
          })()`,
          returnByValue: true,
        },
        pageSession
      )
      .catch(() => null);
    if (panelState?.result?.value) {
      await evaluateInWorker(
        browser,
        workerSession,
        `chrome.tabs.sendMessage(${tabId}, { type: 'TOGGLE_READING_PANEL' })`
      ).catch(() => undefined);
      await sleep(600);
    }
    await capture('screenshot');

    await writeFile(
      path.join(options.outDir, '.debug', 'last-page-state.json'),
      JSON.stringify(lastState, null, 2)
    );

    // 帧留在磁盘上就没用了；调用方需要时可以自己保留 --keep-open。
    if (!options.keepOpen) {
      await rm(framesDir, { recursive: true, force: true });
    }

    if (options.keepOpen) {
      console.log(`[capture] Chrome left running on ${userDataDir}`);
    }
  } finally {
    await cleanup();
  }

  const produced = await readdir(options.outDir);
  console.log(`[capture] done: ${produced.join(', ')}`);
}

main().catch(error => {
  console.error(`[capture] failed: ${error.message}`);
  process.exitCode = 1;
});
