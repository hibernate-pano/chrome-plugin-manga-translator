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
 * 采集页面用的是 file://，不是 http://。这不是图省事，是 http:// 在很多机器
 * 上根本走不通：只要系统里装了接管流量的网络扩展（Clash、Surge 这一类），
 * Chrome 新起的实例对 127.0.0.1 的请求就会卡在"连上了但一个字节都不发"的
 * 状态里，既不报错也不超时，脚本只能干等。file:// 不走网络栈，在这台机器
 * 上 7 毫秒就加载完了。
 *
 * 代价是内容脚本默认不会被注入 file:// 页面 —— Chrome 给扩展的"允许访问
 * 文件网址"开关默认是关的。脚本在启动 Chrome 之前把这个开关写进临时
 * profile，并且用 --allow-file-access-from-files 让页面能读同目录的图片
 * （否则 canvas 会被污染，取不出像素）。
 *
 * 不依赖任何 npm 包：Node 22 自带 WebSocket 和 fetch。
 *
 * 用法：
 *   node scripts/build-demo-page.mjs && pnpm build
 *   node scripts/capture-store-assets.mjs
 *   node scripts/capture-store-assets.mjs --serve   # 用 http:// 采集（排查用）
 *   node scripts/capture-store-assets.mjs --forward # Chrome 出不了外网时走本机中转
 *   node scripts/capture-store-assets.mjs --page http://127.0.0.1:8000/demo.html
 *   node scripts/capture-store-assets.mjs --dump       # 顺带导出排查用数据
 *   node scripts/capture-store-assets.mjs --keep-open   # 录完不关浏览器
 *   node scripts/capture-store-assets.mjs --popup       # 只拍弹窗（不要翻译）
 *   node scripts/capture-store-assets.mjs --warmup 0    # 不预热（录的那一遍真的翻）
 *   node scripts/capture-store-assets.mjs --hold 6      # 翻完之后多停几秒
 *
 * 录屏默认先预热（真的翻一遍，等它翻完），录的是命中缓存的第二遍 ——
 * 否则录到的三十秒全是"正在翻译"，因为翻一页整漫画要几分钟，而商店的
 * 演示视频最长 30 秒。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Cdp, sleep } from './lib/cdp.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT = { width: 1280, height: 800 };
/**
 * How long the recording runs at most.
 *
 * The budget: the store's video limit is 30 seconds, and the recording is
 * followed by a hold (4s) and the scroll-through (~5s). 18 + 4 + 5 = 27,
 * which leaves room for the frames that land on the boundaries.
 */
const RECORD_SECONDS = Number(process.env.RECORD_SECONDS ?? 18);
/**
 * The store's limit on a listing video.
 *
 * Chrome Web Store: an optional promotional video must be MP4 or WebM and
 * no longer than 30 seconds. The artifact this script produces used to be
 * 45 seconds — which is exactly the kind of thing that is rejected at
 * upload, after the review has already been queued.
 */
const MAX_STORE_VIDEO_SECONDS = 30;

function parseArgs(argv) {
  const options = {
    page: null,
    outDir: path.join(repoRoot, 'store', 'listing'),
    keepOpen: false,
    dump: false,
    serve: false,
    forward: false,
    popup: false,
    options: false,
    /*
     * 先真的翻一遍（等它翻完），再录第二遍。
     *
     * 录的那一遍命中缓存，几秒钟就画完 —— 于是三十秒的片子里有"译文落
     * 在原图上"，而不是三十秒的"正在翻译"。0 表示不预热。
     */
    warmup: 300,
    /* 翻完之后停一会儿，让"完成了"这一帧留在片子里。 */
    hold: 4,
    /*
     * 弹窗截图里显示的站点名。
     *
     * 采集页面是 file:// 的 —— 这台机器上 Chrome 连 127.0.0.1 都走不通，
     * http:// 的页面根本加载不出来（见文件头）。而 file:// 明确在扩展的
     * "不支持的页面"名单里，弹窗会如实地说"当前页面不支持扩展脚本"。
     *
     * 所以弹窗看到的站点名是这里给的一个演示域名。它用的是 IANA 为示例
     * 保留的 example.com（RFC 2606），不是任何真实站点；弹窗背后的页面
     * 是真的漫画演示页，弹窗里的图片数量是内容脚本真的数出来的。
     */
    demoHost: 'https://comic.example.com/chapter/12',
    dist: path.join(repoRoot, 'dist'),
    /*
     * Extra flags for the Chrome instance.
     *
     * The machine's network setup decides whether Chrome can reach anything
     * at all, and the answer is not the same everywhere: a machine with a
     * traffic-taking-over extension (Clash, Surge and friends) can leave
     * Chrome's own connections stuck, while curl and Node sail through. The
     * capture has to be able to try a different network setup without
     * editing this file, so the flags are an option.
     */
    chromeFlags: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--page') options.page = argv[++i];
    else if (arg === '--out') options.outDir = path.resolve(argv[++i]);
    else if (arg === '--keep-open') options.keepOpen = true;
    else if (arg === '--dump') options.dump = true;
    else if (arg === '--serve') options.serve = true;
    else if (arg === '--forward') options.forward = true;
    else if (arg === '--popup') options.popup = true;
    else if (arg === '--options') options.options = true;
    else if (arg === '--demo-host') options.demoHost = argv[++i];
    else if (arg === '--warmup') options.warmup = Number(argv[++i]);
    else if (arg === '--hold') options.hold = Number(argv[++i]);
    else if (arg === '--dist') options.dist = path.resolve(argv[++i]);
    else if (arg === '--chrome-flag') options.chromeFlags.push(argv[++i]);
    else if (arg.startsWith('--chrome-flag=')) {
      options.chromeFlags.push(arg.slice('--chrome-flag='.length));
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

// ==================== 小工具 ====================

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
 * Chrome 给未打包扩展分配的 ID 是路径的哈希：SHA256(绝对路径) 的前 32 个
 * 十六进制位，每一位换成 'a' 加那位本身的数值。换句话说 ID 由路径决定，
 * 目录改了 ID 就变了。
 *
 * 需要算出 ID，是因为"允许访问文件网址"这个开关必须写进 profile，而
 * profile 得在 Chrome 启动之前就写好 —— 扩展那时候还没加载。
 */
function deriveExtensionId(distPath) {
  const digest = createHash('sha256').update(distPath).digest('hex');
  return [...digest.slice(0, 32)]
    .map(digit => 'abcdefghijklmnop'[Number.parseInt(digit, 16)])
    .join('');
}

/**
 * 在临时 profile 里打开扩展的"允许访问文件网址"。
 *
 * Chrome 默认不让内容脚本跑在 file:// 页面上。采集页面就是 file:// 的，
 * 不打开这个开关，内容脚本根本不会被注入，采集脚本会一直等到超时，然后
 * 报一句"内容脚本没有回应" —— 听起来像是扩展坏了，其实是开关没开。
 */
async function grantFileAccess(userDataDir, extensionId) {
  const prefsDir = path.join(userDataDir, 'Default');
  await mkdir(prefsDir, { recursive: true });
  const prefsPath = path.join(prefsDir, 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(await readFile(prefsPath, 'utf8'));
  } catch {
    // profile 还是空的，用一份空的开始。
  }
  prefs.extensions ??= {};
  prefs.extensions.settings ??= {};
  prefs.extensions.settings[extensionId] ??= {};
  prefs.extensions.settings[extensionId].allow_file_access = true;
  await writeFile(prefsPath, JSON.stringify(prefs));
}

/**
 * 把扩展的请求原样转到真实端点的本地中转。
 *
 * 有些机器上 Chrome 出不了外网：系统里装着接管流量的网络扩展（Clash、Surge
 * 这一类）时，Chrome 的请求会连上代理却一个字节都不发，既不报错也不超时，
 * 一直挂到自己的超时为止。扩展拿不到译文，采集脚本拍出来的那张"翻译失败"
 * 的截图对商店毫无意义。
 *
 * 中转跑在本机：扩展照常把请求发到 http://127.0.0.1:端口，中转用 Node 的
 * 网络栈把请求转到真实端点 —— Node 这条路是通的。请求头（包括 API Key）
 * 原样带过去，响应原样带回来，扩展察觉不到中间有人。
 *
 * 只有显式加 --forward 才启用。采集素材默认直接连真实端点，多一层中转就
 * 多一层可能出错的地方。
 */
async function startForwarder(targetBaseUrl) {
  const target = targetBaseUrl.replace(/\/+$/, '');
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', async () => {
      console.log(
        `[capture] forwarder: ${request.method} ${request.url} arrived (${Buffer.concat(chunks).length} bytes)`
      );
      const headers = { ...request.headers };
      // Host 得由 fetch 自己按目标算；Origin/Referer 是发往本机的，
      // 带过去会让真实端点以为这是一个网页请求；accept-encoding 交给
      // Node 处理，免得回来的是压缩过的字节而扩展按 JSON 解析。
      delete headers.host;
      delete headers.origin;
      delete headers.referer;
      delete headers['accept-encoding'];
      delete headers['content-length'];
      try {
        const startedAt = Date.now();
        const upstream = await fetch(target + request.url, {
          method: request.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        const outHeaders = {};
        upstream.headers.forEach((value, key) => {
          if (key !== 'content-encoding' && key !== 'content-length') {
            outHeaders[key] = value;
          }
        });
        response.writeHead(upstream.status, outHeaders);
        response.end(body);
        console.log(
          `[capture] forwarder: ${request.method} ${request.url} -> ${upstream.status} in ${Date.now() - startedAt}ms`
        );
      } catch (error) {
        console.log(
          `[capture] forwarder: ${request.method} ${request.url} failed: ${error.message}`
        );
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: {
              message: `the forwarder could not reach ${target}: ${error}`,
            },
          })
        );
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('connection', socket => {
    console.log(
      `[capture] forwarder: a client connected (${socket.remoteAddress})`
    );
  });
  return { server, url: `http://127.0.0.1:${port}` };
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
 * How long the assembled video is, in seconds.
 *
 * The store rejects a listing video longer than 30 seconds, and it rejects it
 * at upload — after the listing has been written and the review queued. The
 * number is read back from the file that was actually produced rather than
 * assumed from the recording window, because the scroll animation adds to it.
 */
async function videoDurationSeconds(file) {
  const output = await new Promise((resolve, reject) => {
    const ffprobe = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    ffprobe.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    ffprobe.on('error', reject);
    ffprobe.on('exit', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`ffprobe exited ${code}`));
    });
  });
  const seconds = Number.parseFloat(output);
  return Number.isFinite(seconds) ? seconds : 0;
}

/**
 * 在 service worker 里执行一段表达式。
 *
 * 扩展页面（options.html）不能用作入口：Chrome 会挡下自动化客户端
 * 直接导航到 chrome-extension:// 的请求（ERR_BLOCKED_BY_CLIENT），
 * service worker 没有这个问题。
 */
async function evaluateInWorker(cdp, sessionId, expression, timeoutMs = 60000) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
    timeoutMs
  );
  if (result.exceptionDetails) {
    throw new Error(
      `worker evaluation failed: ${result.exceptionDetails.text ?? 'unknown error'}`
    );
  }
  return result.result?.value;
}

/**
 * Keep the reading panel from sitting on top of the manga.
 *
 * The panel is a fixed overlay in the top-right corner of the viewport — by
 * design, it floats over the page. On a real reader the page is usually
 * narrower than the window, so the panel lands in the margin. In a 1280px
 * screenshot of a centred 920px page it does not: the panel covers the right
 * edge of the page, and the store listing's thumbnail shows a bubble hidden
 * behind a box of text.
 *
 * So for the panel screenshot only, the demo page is given a right margin the
 * width of the panel. Nothing about the extension changes; only the page the
 * screenshot is taken of.
 */
async function applyPanelSafeLayout(cdp, sessionId, enabled) {
  const expression = `(() => {
    const id = 'store-asset-panel-safe-layout';
    const existing = document.getElementById(id);
    if (!${enabled ? 'true' : 'false'}) {
      existing?.remove();
      return false;
    }
    if (existing) return true;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = [
      'main { padding-right: 380px !important; }',
      'img.page { width: min(920px, 100%) !important; }',
    ].join('\\n');
    document.head.appendChild(style);
    return true;
  })()`;
  await cdp
    .send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
    .catch(() => undefined);
  // The page has to lay out again before the frame is taken.
  await sleep(400);
}

async function findWorkerSession(
  cdp,
  extensionId,
  timeoutMs = 20000,
  required = true
) {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const target of targetInfos) {
      if (target.type === 'service_worker') {
        seen.add(target.url);
      }
    }
    const worker = targetInfos.find(
      target =>
        target.type === 'service_worker' &&
        target.url.startsWith(`chrome-extension://${extensionId}/`)
    );
    if (worker) {
      /*
       * 挂上会话不等于执行上下文已经建好：早一步 evaluate 会在一个没有
       * chrome.* 的上下文里跑，报 "chrome is not defined"。等到能用为止。
       *
       * 会话本身也可能死掉 —— service worker 被回收再拉起的时候，旧会话
       * 就再也等不到回复了，而 Runtime.enable 会一直挂着直到超时。那种
       * 情况下重新找一次 worker，比把整个采集判成失败好。
       */
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
        // 会话没了或者命令超时：回到循环里再找一个。
      }
    }
    await sleep(200);
  }
  if (!required) {
    return null;
  }
  const seenList = [...seen].join(', ');
  throw new Error(
    `the extension service worker never showed up${
      seenList ? ` (the service workers that did show up: ${seenList})` : ''
    }`
  );
}

// ==================== 弹窗截图 ====================

/**
 * 设置页截图。
 *
 * 设置页是这个产品里唯一一处把"我能调什么"一次说完的地方：服务商一键
 * 预设、目标语言、分辨率与并发、覆盖层样式。它也是一个普通的扩展页，
 * 不问"当前标签页"是谁，所以这一张连弹窗那点替换都不需要。
 *
 * 商店要求截图正好是 1280×800，所以像素密度是 1 —— 页面本身就是这个尺寸。
 */
async function captureOptions({ cdp, extensionId, outDir }) {
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
    {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    },
    sessionId
  );
  await cdp.send(
    'Page.navigate',
    { url: `chrome-extension://${extensionId}/src/options.html` },
    sessionId
  );

  // 等引导弹窗退场。设置页第一次打开会盖一个两步引导，等它渲染完再拍，
  // 否则拍到的是"欢迎使用"，不是设置页。
  const readState = () =>
    cdp
      .send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const text = document.body.innerText || '';
            const dialog = document.querySelector('[role="dialog"]');
            return JSON.stringify({
              hasSettings: text.includes('漫画翻译助手 · 设置'),
              hasDialog: Boolean(dialog),
            });
          })()`,
          returnByValue: true,
        },
        sessionId
      )
      .then(result => {
        try {
          return JSON.parse(result.result?.value ?? '{}');
        } catch {
          return {};
        }
      })
      .catch(() => ({}));

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const state = await readState();
    if (state.hasSettings) break;
    await sleep(250);
  }
  const dialogDeadline = Date.now() + 5000;
  while (Date.now() < dialogDeadline) {
    const state = await readState();
    if (!state.hasDialog) break;
    await sleep(250);
  }
  await sleep(900);

  // 滚到服务商那一段。设置页的第一屏是"数据流向说明"和"基础行为"，
  // 而商店的读者先想知道的是"支持哪些服务、译成什么语言、能调多细"——
  // 那几段都在服务商卡片下面。
  await cdp
    .send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const target = document.getElementById('section-providers');
          if (target) {
            target.scrollIntoView({ block: 'start' });
            window.scrollBy(0, -24);
            return true;
          }
          return false;
        })()`,
        returnByValue: true,
      },
      sessionId
    )
    .catch(() => undefined);
  await sleep(700);

  const { data } = await cdp.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    sessionId
  );
  const outPath = path.join(outDir, 'screenshot-options-1280x800.png');
  await writeFile(outPath, Buffer.from(data, 'base64'));
  console.log(`[capture] screenshot -> ${outPath}`);
}

/**
 * 弹窗截图。
 *
 * 商店建议 3~5 张截图，现有两张拍的都是"译文盖在页面上"。弹窗是产品
 * 的门面，也是唯一一处写着"这次要花多少钱"的地方 —— 它值得第三张，而且
 * 这一张不需要模型：页面不翻译，只让弹窗自己去数。
 *
 * 弹窗并不知道"当前标签页"是谁：它问浏览器
 * `chrome.tabs.query({active:true, currentWindow:true})`。把它当普通标签页
 * 打开时，它问到的是自己，于是会显示"未找到当前标签页"的空壳。真实的
 * 弹窗里这个查询由浏览器代答，指向弹出它的那一页。
 *
 * 这里把同样的语义换上去：让查询指回漫画页那个标签页。弹窗剩下的逻辑
 * —— 计数、可用性、按钮状态 —— 全都照常跑，读到的是内容脚本真实上报
 * 的数据，不是编出来的。
 */
async function capturePopup({ cdp, extensionId, tabId, outDir, demoHost }) {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId: popupSession } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await cdp.send('Page.enable', {}, popupSession);
  await cdp.send('Runtime.enable', {}, popupSession);
  // 两倍像素密度：弹窗只有 360 宽，直接截图在 1280 宽的商店图里会糊。
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: 360,
      height: 600,
      deviceScaleFactor: 2,
      mobile: false,
    },
    popupSession
  );

  await cdp.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `(() => {
        const real = chrome.tabs.query;
        const target = {
          id: ${tabId},
          url: ${JSON.stringify(demoHost)},
          title: '',
          active: true,
          windowId: -1,
          index: 0,
        };
        chrome.tabs.query = (info, callback) => {
          const wantsActive = !info || info.active;
          if (wantsActive) {
            if (callback) {
              callback([target]);
              return undefined;
            }
            return Promise.resolve([target]);
          }
          return real.call(chrome.tabs, info, callback);
        };
      })();`,
    },
    popupSession
  );

  await cdp.send(
    'Page.navigate',
    { url: `chrome-extension://${extensionId}/src/popup.html` },
    popupSession
  );

  // 等弹窗真的画出来。加载中是一个转圈，等它结束就够了；但如果弹窗卡在
  // "未找到当前标签页"，那也是画出来了 —— 所以判定条件是"出现了主操作
  // 按钮"，而不是"转圈没了"。转圈没了但按钮没出现，说明问错了标签页。
  const deadline = Date.now() + 20000;
  let ready = false;
  let lastText = '';
  while (Date.now() < deadline) {
    const state = await cdp
      .send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const buttons = [...document.querySelectorAll('button')];
            const main = buttons.find(b => b.textContent.includes('翻译当前页面'));
            return JSON.stringify({
              ready: Boolean(main),
              text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),
            });
          })()`,
          returnByValue: true,
        },
        popupSession
      )
      .then(result => {
        try {
          return JSON.parse(result.result?.value ?? '{}');
        } catch {
          return {};
        }
      })
      .catch(() => ({}));
    if (typeof state.text === 'string') lastText = state.text;
    if (state.ready) {
      ready = true;
      break;
    }
    await sleep(250);
  }
  if (!ready) {
    throw new Error(
      'the popup never showed its main action — it did not find the page.\n' +
        `the popup said: ${lastText || '(nothing)'}`
    );
  }
  await sleep(700);

  const measured = await cdp
    .send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const root = document.body.firstElementChild;
          const rect = root ? root.getBoundingClientRect() : null;
          return JSON.stringify({
            width: rect ? Math.ceil(rect.width) : 360,
            height: rect ? Math.ceil(rect.height) : 600,
          });
        })()`,
        returnByValue: true,
      },
      popupSession
    )
    .then(result => JSON.parse(result.result?.value ?? '{}'))
    .catch(() => ({ width: 360, height: 600 }));

  const width = Math.min(360, Math.max(320, measured.width || 360));
  const height = Math.min(1200, Math.max(220, measured.height || 600));

  const { data } = await cdp.send(
    'Page.captureScreenshot',
    {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    },
    popupSession
  );
  const popupPath = path.join(os.tmpdir(), `popup-${process.pid}.png`);
  await writeFile(popupPath, Buffer.from(data, 'base64'));
  console.log(`[capture] popup -> ${popupPath} (${width}x${height})`);

  const outPath = path.join(outDir, 'screenshot-popup-1280x800.png');
  await composePopupListing({
    cdp,
    popupPath,
    outPath,
    extensionVersion: JSON.parse(
      await readFile(path.join(repoRoot, 'package.json'), 'utf8')
    ).version,
  });
  console.log(`[capture] screenshot -> ${outPath}`);
  await rm(popupPath, { force: true });
}

/**
 * 把弹窗放到一张 1280×800 的图里。
 *
 * 商店的截图必须是 1280×800，而弹窗只有 360 宽。直接截那 360 像素，商店
 * 列表页上就是一个看不清的小方块；把它放在一张有标题的图里，读者才知道
 * 自己看到的是什么。
 */
async function composePopupListing({
  cdp,
  popupPath,
  outPath,
  extensionVersion,
}) {
  const htmlPath = path.join(os.tmpdir(), `popup-listing-${process.pid}.html`);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    width: 1280px;
    height: 800px;
    overflow: hidden;
    background: #020617;
    color: #f8fafc;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    padding: 0 64px;
    background:
      radial-gradient(820px 600px at 74% 46%, rgba(34, 211, 238, 0.16), transparent 68%),
      radial-gradient(680px 500px at 6% 86%, rgba(99, 102, 241, 0.14), transparent 70%);
  }
  .copy { width: 470px; flex: none; }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border: 1px solid rgba(34, 211, 238, 0.45);
    border-radius: 999px;
    background: rgba(34, 211, 238, 0.08);
    color: #67e8f9;
    font-size: 15px;
    letter-spacing: 0.06em;
  }
  .eyebrow::before {
    content: "";
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #22d3ee;
  }
  h1 {
    margin: 22px 0 0;
    font-size: 54px;
    line-height: 1.12;
    font-weight: 700;
  }
  .sub {
    margin: 18px 0 0;
    font-size: 23px;
    line-height: 1.55;
    color: #a5b4c8;
  }
  .sub b { color: #22d3ee; font-weight: 600; }
  ul { margin: 28px 0 0; padding: 0; list-style: none; }
  li {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    margin-top: 13px;
    font-size: 18px;
    line-height: 1.45;
    color: #cbd5e1;
  }
  li .tick {
    flex: none;
    width: 22px; height: 22px;
    margin-top: 1px;
    border-radius: 50%;
    background: rgba(34, 211, 238, 0.14);
    border: 1px solid rgba(34, 211, 238, 0.4);
    color: #67e8f9;
    font-size: 13px;
    line-height: 20px;
    text-align: center;
  }
  .popup {
    margin-left: 72px;
    width: 380px;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.35);
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6);
    background: #020617;
  }
  .popup img { display: block; width: 100%; }
  .foot {
    position: absolute;
    left: 64px; bottom: 26px;
    font-size: 13px;
    color: #64748b;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="copy">
      <span class="eyebrow">Chrome 扩展</span>
      <h1>要花多少钱<br />按下之前就知道</h1>
      <p class="sub">弹窗先数出这一页有<b>多少张图</b>、<b>多少张还没加载完</b>，<br />再让你按下那个会花钱的按钮。</p>
      <ul>
        <li><span class="tick">✓</span><span>翻译前先看价格，确认了再扣费</span></li>
        <li><span class="tick">✓</span><span>「忽略缓存重翻」会先告诉你重翻要重新计费</span></li>
        <li><span class="tick">✓</span><span>本站是否在自动翻译名单里，弹窗直接写明</span></li>
      </ul>
    </div>
    <div class="popup">
      <img src="${pathToFileURL(popupPath).href}" alt="" />
    </div>
  </div>
  <div class="foot">漫画翻译助手 v${extensionVersion} · 支持任意 OpenAI 兼容接口与本地 Ollama / LM Studio</div>
</body>
</html>
`;
  await writeFile(htmlPath, html, 'utf8');

  try {
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId: compositeSession } = await cdp.send(
      'Target.attachToTarget',
      {
        targetId,
        flatten: true,
      }
    );
    await cdp.send('Page.enable', {}, compositeSession);
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      compositeSession
    );
    await cdp.send(
      'Page.navigate',
      { url: pathToFileURL(htmlPath).href },
      compositeSession
    );
    // 图片是内嵌的 data URI 之外的文件引用，要等它解码完再拍。
    await cdp
      .send(
        'Runtime.evaluate',
        {
          expression: `(async () => {
            const img = document.querySelector('.popup img');
            if (img && !img.complete) {
              await img.decode().catch(() => undefined);
            }
            return true;
          })()`,
          awaitPromise: true,
          returnByValue: true,
        },
        compositeSession
      )
      .catch(() => undefined);
    await sleep(500);

    const { data } = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      compositeSession
    );
    await writeFile(outPath, Buffer.from(data, 'base64'));
  } finally {
    await rm(htmlPath, { force: true });
  }
}

// ==================== 主流程 ====================

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const warmupSeconds = options.warmup;
  const holdSeconds = options.hold;

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

  // 默认用 file:// 采集页面。
  //
  // 不用 http:// 是有原因的：只要系统里装了接管流量的网络扩展（Clash、Surge
  // 这一类），Chrome 新起的实例对 127.0.0.1 的请求会连上却一个字节都不发，
  // 既不报错也不超时 —— 脚本只能干等到自己超时，而报错说的是"内容脚本没有
  // 回应"，听上去像是扩展坏了。file:// 不走网络栈，在那台机器上 7 毫秒就
  // 加载完了。
  //
  // --serve 保留原来的 http 路径，留给排查用。
  let server = null;
  let pageUrl;
  if (options.page) {
    pageUrl = options.page;
  } else if (options.serve) {
    const served = await serveDirectory(demoDir);
    server = served.server;
    pageUrl = `${served.url}demo-manga-page.html`;
  } else {
    pageUrl = pathToFileURL(demoPage).href;
  }
  console.log(`[capture] page: ${pageUrl}`);

  // file:// 页面没有 origin（new URL(...).origin 是 "null"），按完整路径找
  // 标签页；http 页面还是按 origin 找。
  const tabPrefix = pageUrl.startsWith('file:')
    ? pageUrl
    : new URL(pageUrl).origin;

  const userDataDir = path.join(
    os.tmpdir(),
    `manga-store-assets-${Date.now()}`
  );
  await mkdir(userDataDir, { recursive: true });

  // 内容脚本要跑在 file:// 页面上，得先打开扩展的"允许访问文件网址"。
  await grantFileAccess(userDataDir, deriveExtensionId(options.dist));

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
      // file:// 页面默认读不了同目录的其他 file:// 资源，canvas 会被污染，
      // 取不出像素。这个开关让同目录的图片可以被读。
      '--allow-file-access-from-files',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      ...options.chromeFlags,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );

  let browser;
  // 中转服务器：建了就必须在清理时关掉，否则脚本不退出。
  let forwarder = null;
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
    server?.close();
    forwarder?.server.close();
  };

  try {
    const port = await waitForDevToolsPort(userDataDir);
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    browser = await Cdp.connect(version.webSocketDebuggerUrl);
    console.log(`[capture] connected to ${version.Browser}`);

    /*
     * The extension is loaded over CDP. Chrome 137+ turned
     * --load-extension off and it has stayed off: the switch that used to
     * bring it back no longer exists, so Extensions.loadUnpacked is the only
     * way in.
     */
    const { id: extensionId } = await browser.send('Extensions.loadUnpacked', {
      path: options.dist,
    });
    console.log(`[capture] extension loaded: ${extensionId}`);
    // 文件访问权限是按推导出来的 ID 写进 profile 的。ID 对不上，说明写错了
    // 地方 —— 与其等到内容脚本不回应时再去猜，不如现在就说清楚。
    const expectedId = deriveExtensionId(options.dist);
    if (extensionId !== expectedId) {
      throw new Error(
        `the extension id is ${extensionId} but the path derives ${expectedId}; ` +
          'the file access permission was written for the wrong id'
      );
    }

    const workerSession = await findWorkerSession(browser, extensionId);

    /*
     * The worker's console is forwarded, because that is where a failed
     * provider request explains itself.
     *
     * The page's console says what the content script did; the worker's
     * says what happened to the request the worker made on its behalf. When
     * a capture produces an untranslated page, the difference between the
     * two is the whole diagnosis — and until now the second one was thrown
     * away.
     */
    browser.on('Runtime.consoleAPICalled', params => {
      const text = (params.args ?? [])
        .map(arg =>
          arg.value !== undefined
            ? String(arg.value)
            : (arg.description ?? arg.type ?? '')
        )
        .join(' ');
      if (text.trim()) {
        console.log(
          `[console:${params.sessionId === workerSession ? 'worker' : 'other'}] ${text}`
        );
      }
    });
    browser.on('Runtime.exceptionThrown', params => {
      const details = params.exceptionDetails;
      const text =
        details?.exception?.description ?? details?.text ?? 'unknown error';
      console.log(
        `[exception:${params.sessionId === workerSession ? 'worker' : 'other'}] ${text.split('\n')[0]}`
      );
    });

    /*
     * The worker's own network is watched too.
     *
     * The provider request is made from the worker, so a request that never
     * leaves it (or leaves and hangs) is invisible from the page. Chrome
     * reports both cases here: the request that was sent, and the one that
     * never finished.
     */
    const workerRequests = new Map();
    browser.on('Network.requestWillBeSent', params => {
      if (params.sessionId !== workerSession) return;
      workerRequests.set(params.requestId, {
        url: params.request.url,
        startedAt: Date.now(),
      });
      console.log(`[worker] -> ${params.request.method} ${params.request.url}`);
    });
    browser.on('Network.loadingFinished', params => {
      if (params.sessionId !== workerSession) return;
      const request = workerRequests.get(params.requestId);
      if (!request) return;
      workerRequests.delete(params.requestId);
      console.log(
        `[worker] -> ${request.url} finished in ${Date.now() - request.startedAt}ms`
      );
    });
    browser.on('Network.loadingFailed', params => {
      if (params.sessionId !== workerSession) return;
      const request = workerRequests.get(params.requestId);
      if (!request) return;
      workerRequests.delete(params.requestId);
      console.log(
        `[worker] -> ${request.url} failed after ${Date.now() - request.startedAt}ms: ${params.errorText}`
      );
    });
    await browser.send('Network.enable', {}, workerSession);

    // 先看清楚配的是哪个服务商、端点在哪，再决定要不要中转。
    const providerInfo = await evaluateInWorker(
      browser,
      workerSession,
      `(async () => {
        const KEY = 'manga-translator-config-v2';
        const raw = await chrome.storage.local.get(KEY);
        const stored = raw[KEY] ?? {};
        const state =
          stored && typeof stored.state === 'object' && stored.state
            ? stored.state
            : stored;
        const provider = state.provider;
        const settings = state.providers ? state.providers[provider] : null;
        return {
          provider: provider ?? null,
          baseUrl: settings?.baseUrl ?? null,
          model: settings?.model ?? null,
        };
      })()`
    );
    console.log(
      `[capture] provider: ${providerInfo.provider} (${providerInfo.model})`
    );

    /*
     * The worker's own network, checked before anything is recorded.
     *
     * The extension makes the provider request from its service worker, and
     * a worker that cannot reach the network produces a page that never
     * finishes translating. The symptom is a long silence followed by a
     * timeout, which reads like "the provider is slow" — but on a machine
     * where Chrome's network is blocked (a traffic-taking-over extension
     * such as Clash or Surge is the usual reason) no amount of waiting
     * helps, and the capture can only produce an untranslated page.
     *
     * The question is therefore asked up front, with a five second budget,
     * and the answer is put in the log where the next person will look.
     */
    if (providerInfo.baseUrl) {
      const workerReach = await evaluateInWorker(
        browser,
        workerSession,
        `(async () => {
          const started = Date.now();
          try {
            const response = await fetch(${JSON.stringify(
              `${providerInfo.baseUrl.replace(/\/+$/, '')}/models`
            )}, { signal: AbortSignal.timeout(5000) });
            return 'reachable in ' + (Date.now() - started) + 'ms (status ' + response.status + ')';
          } catch (error) {
            return 'unreachable after ' + (Date.now() - started) + 'ms — ' + (error && error.message);
          }
        })()`
      ).catch(error => `probe failed: ${error.message}`);
      console.log(`[capture] worker -> provider: ${workerReach}`);
    }

    if (options.forward && providerInfo.baseUrl) {
      forwarder = await startForwarder(providerInfo.baseUrl);
      console.log(
        `[capture] forwarding ${providerInfo.baseUrl} through ${forwarder.url}`
      );
      // The worker has to be able to reach the forwarder. If it cannot, the
      // run would silently fall back to the real endpoint and hang there
      // instead, which looks like a provider problem rather than a local
      // one — so the question is asked before anything is recorded.
      const probe = await evaluateInWorker(
        browser,
        workerSession,
        `(async () => {
          const targets = [
            ${JSON.stringify(`${forwarder.url}/__probe`)},
            ${JSON.stringify(
              `http://localhost:${forwarder.url.split(':').pop()}/__probe`
            )}
          ];
          const results = [];
          for (const target of targets) {
            const started = Date.now();
            try {
              const response = await fetch(target, {
                signal: AbortSignal.timeout(5000),
              });
              results.push(target + ' -> ok ' + response.status + ' in ' + (Date.now() - started) + 'ms');
            } catch (error) {
              results.push(target + ' -> failed after ' + (Date.now() - started) + 'ms — ' + (error && error.message));
            }
          }
          return results.join(' | ');
        })()`
      ).catch(error => `probe error: ${error.message}`);
      console.log(`[capture] worker -> forwarder probe: ${probe}`);
    }
    const effectiveBaseUrl = forwarder?.url ?? providerInfo.baseUrl;

    // 把主开关和引导标记打开，等于替用户走完设置页。
    // 键值原样写回：存的是混淆过的 API Key，脚本不该碰它。
    await evaluateInWorker(
      browser,
      workerSession,
      `(async () => {
        const KEY = 'manga-translator-config-v2';
        const raw = await chrome.storage.local.get(KEY);
        const stored = raw[KEY] ?? {};
        const state =
          stored && typeof stored.state === 'object' && stored.state
            ? stored.state
            : stored;
        const patch = { enabled: true, onboardingCompleted: true };
        let nextState = { ...state, ...patch };
        ${
          effectiveBaseUrl
            ? `{
          /*
           * 两处都得改。
           *
           * 配置在存储里有两份：顶层的 openaiCompatible / ollama / lmStudio，
           * 以及 providers['openai-compatible'] 这张表。而 worker 读的是
           * normalizeRuntimeAppConfig 的结果 —— 它优先取顶层那份，只有顶层
           * 不存在时才回退到 providers 表。脚本以前只改了 providers 表，
           * 于是 --forward 看起来"改好了"，worker 却仍然拿着旧的端点去请求，
           * 中转根本没被用上。这里两处一起改。
           */
          const baseUrl = ${JSON.stringify(effectiveBaseUrl)};
          const providers = { ...(nextState.providers ?? {}) };
          const provider = nextState.provider;
          if (providers[provider]) {
            providers[provider] = { ...providers[provider], baseUrl };
          }
          const legacyKey =
            provider === 'openai-compatible'
              ? 'openaiCompatible'
              : provider === 'ollama'
                ? 'ollama'
                : provider === 'lm-studio'
                  ? 'lmStudio'
                  : null;
          if (legacyKey && nextState[legacyKey]) {
            nextState[legacyKey] = { ...nextState[legacyKey], baseUrl };
          }
          nextState = { ...nextState, providers };
        }`
            : ''
        }
        const next =
          stored && typeof stored.state === 'object' && stored.state
            ? { ...stored, state: nextState }
            : { ...stored, ...nextState };
        await chrome.storage.local.set({ [KEY]: next });
        const applied =
          nextState.openaiCompatible?.baseUrl ??
          nextState.providers?.[nextState.provider]?.baseUrl ??
          null;
        return {
          patched: true,
          hadConfig: Boolean(raw[KEY]),
          provider: nextState.provider ?? null,
          baseUrl: applied,
        };
      })()`
    ).then(result =>
      console.log(
        `[capture] config patched: provider=${result?.provider ?? '?'} baseUrl=${result?.baseUrl ?? '?'}`
      )
    );

    /*
     * The tab is created blank and then navigated, rather than created with
     * a URL.
     *
     * `Target.createTarget({ url })` does not reliably navigate: on Chrome
     * 156 the target came up with an empty navigation history, the server
     * never received a request and the tab stayed on about:blank. The
     * failure looked like a broken extension — the content script never
     * answered, because it was never injected into a page that did not
     * exist. Navigating explicitly does what the API did not.
     */
    const { targetId } = await browser.send('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId: pageSession } = await browser.send(
      'Target.attachToTarget',
      { targetId, flatten: true }
    );
    await browser.send('Page.enable', {}, pageSession);
    await browser.send('Runtime.enable', {}, pageSession);
    await browser.send('Log.enable', {}, pageSession);
    await browser.send('Page.navigate', { url: pageUrl }, pageSession);

    // The page's own complaints, collected while it loads.
    //
    // A content script that throws on the way in never registers its message
    // listener, and the symptom from the outside is "the extension does not
    // answer" — which says nothing about why. Collecting the page's console
    // turns that into an actual error message.
    const pageProblems = [];
    browser.on('Runtime.exceptionThrown', params => {
      const details = params.exceptionDetails;
      const text =
        details?.exception?.description ?? details?.text ?? 'unknown error';
      pageProblems.push(text.split('\n')[0]);
    });
    browser.on('Log.entryAdded', params => {
      const entry = params.entry;
      if (!entry) return;
      if (entry.level === 'error') {
        pageProblems.push(`${entry.source}: ${entry.text}`);
      }
      // The page's own log is forwarded as well: the content script says
      // which path it took (canvas, background proxy, OCR fallback), and
      // that is where a stalled translation usually explains itself.
      console.log(`[page] ${entry.level}: ${entry.text}`);
    });
    browser.on('Runtime.consoleAPICalled', params => {
      if (params.sessionId !== pageSession) return;
      const text = (params.args ?? [])
        .map(arg =>
          arg.value !== undefined
            ? String(arg.value)
            : (arg.description ?? arg.type ?? '')
        )
        .join(' ');
      if (text.trim()) {
        console.log(`[page] ${text}`);
      }
    });
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
    let tabId;
    try {
      tabId = await evaluateInWorker(
        browser,
        workerSession,
        `(async () => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find(item => item.url && item.url.startsWith(${JSON.stringify(
            tabPrefix
          )}));
          if (!tab) { await new Promise(r => setTimeout(r, 200)); continue; }
          try {
            // The message is raced against a timer. A sendMessage whose
            // receiver never answers never settles, and an await that never
            // settles would hang the whole probe — the deadline below would
            // never be reached and the failure would read as a timeout
            // instead of "the content script did not answer".
            const reply = await Promise.race([
              chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' }),
              new Promise(resolve => setTimeout(() => resolve(null), 2000)),
            ]);
            if (reply && reply.state) return tab.id;
          } catch { /* 内容脚本还没注册 */ }
          await new Promise(r => setTimeout(r, 200));
        }
        throw new Error('the content script never answered on ' + ${JSON.stringify(pageUrl)});
      })()`
      );
    } catch (error) {
      if (pageProblems.length > 0) {
        console.error('[capture] the page reported:');
        for (const problem of pageProblems.slice(0, 10)) {
          console.error(`  - ${problem}`);
        }
      }
      throw error;
    }
    console.log(`[capture] content script is live on tab ${tabId}`);

    /*
     * The page's own network, measured next to the worker's.
     *
     * When a capture cannot translate anything, the question is always the
     * same: is the machine's network the problem, or the extension's? The
     * page and the worker live in the same browser and reach the network
     * through the same proxy, so the two measurements together say which
     * one it is — and the answer decides whether the capture can be fixed
     * here or whether the machine's network has to change first.
     */
    if (forwarder) {
      const pageProbe = await browser
        .send(
          'Runtime.evaluate',
          {
            expression: `(async () => {
              const targets = [
                ${JSON.stringify(`${forwarder.url}/__probe`)},
                'data:text/plain,hello',
              ];
              const results = [];
              for (const target of targets) {
                const started = Date.now();
                try {
                  const response = await fetch(target, {
                    mode: 'no-cors',
                    signal: AbortSignal.timeout(5000),
                  });
                  results.push(target + ' -> ok ' + response.status + ' in ' + (Date.now() - started) + 'ms');
                } catch (error) {
                  results.push(target + ' -> failed after ' + (Date.now() - started) + 'ms — ' + (error && error.message));
                }
              }
              return results.join(' | ');
            })()`,
            awaitPromise: true,
            returnByValue: true,
          },
          pageSession
        )
        .then(result => result.result?.value ?? 'no result')
        .catch(error => `probe error: ${error.message}`);
      console.log(`[capture] page -> network probe: ${pageProbe}`);
    }

    /*
     * 弹窗截图不需要翻译，所以它不走录屏那条路：页面不翻，只让弹窗自己
     * 去数那一页有多少张图，然后把这张弹窗拍下来。
     */
    if (options.popup) {
      await capturePopup({
        cdp: browser,
        extensionId,
        tabId,
        demoHost: options.demoHost,
        outDir: options.outDir,
      });
      if (options.keepOpen) {
        console.log(`[capture] Chrome left running on ${userDataDir}`);
      }
      const produced = await readdir(options.outDir);
      console.log(`[capture] done: ${produced.join(', ')}`);
      return;
    }

    if (options.options) {
      await captureOptions({
        cdp: browser,
        extensionId,
        outDir: options.outDir,
      });
      if (options.keepOpen) {
        console.log(`[capture] Chrome left running on ${userDataDir}`);
      }
      const produced = await readdir(options.outDir);
      console.log(`[capture] done: ${produced.join(', ')}`);
      return;
    }

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

    /*
     * 先把这一页真的翻一遍，再录第二遍。
     *
     * 商店的演示视频最长 30 秒，而模型翻两张整页漫画要几分钟 —— 冷启动
     * 录下来的三十秒里，译文一个字都还没出现，录到的是一片"正在翻译"。
     *
     * 所以先跑一次真的（这一次花钱，译文进缓存），等它翻完；再录的那一遍
     * 命中缓存，几秒钟就画完。三十秒里能看到的是「扫描 → 翻译 → 译文落在
     * 原图上 → 译文阅读面板」，而不是等模型。
     */
    if (warmupSeconds > 0) {
      console.log(
        `[capture] warming the cache (up to ${warmupSeconds}s) — this run really translates`
      );
      await evaluateInWorker(
        browser,
        workerSession,
        `chrome.tabs.sendMessage(${tabId}, { type: 'TRANSLATE_PAGE' }).then(
           () => 'answered',
           error => 'refused: ' + error
         ); 'sent'`
      ).catch(error =>
        console.warn(`[capture] warm-up trigger: ${error.message}`)
      );
      const warmupDeadline = Date.now() + warmupSeconds * 1000;
      let warmState = null;
      while (Date.now() < warmupDeadline) {
        await sleep(3000);
        const state = await evaluateInWorker(
          browser,
          workerSession,
          `chrome.tabs.sendMessage(${tabId}, { type: 'GET_STATE' }).then(r => r && r.state).catch(() => null)`
        );
        if (!state) continue;
        warmState = state;
        console.log(
          `[capture] warm-up status=${state.status} ${state.count ?? 0}/${state.candidateCount ?? 0}`
        );
        if (state.status === 'complete' || state.status === 'error') {
          break;
        }
      }
      /*
       * 「complete」不等于「翻出来了」。
       *
       * 一轮翻译全失败时，状态同样是 complete —— 失败的那两张也记在
       * failedCount 里。脚本以前只看到 complete 就宣布"缓存热了"，于是
       * 录的是一遍什么都没有的"正在翻译"，而截图里是两张没被翻的漫画。
       * 素材是要挂到商店页面上的，所以这一段必须自己判断有没有翻出来。
       */
      const warmed = (warmState?.count ?? 0) + (warmState?.cachedCount ?? 0);
      if (warmed <= 0) {
        throw new Error(
          `the warm-up translated nothing${
            warmState?.lastError ? ` — ${warmState.lastError}` : ''
          }. The assets would show an untranslated page, so this run stops here instead of writing them. The usual reason is that Chrome cannot reach the provider from this machine — check the "worker -> provider" line above, and try --forward if the provider itself is reachable.`
        );
      }
      console.log(
        `[capture] the cache is warm (${warmed} translated); the recording will be a replay`
      );
    }

    await browser.send(
      'Page.startScreencast',
      { format: 'jpeg', quality: 85, everyNthFrame: 1 },
      pageSession
    );

    // The trigger is a signal, not a result.
    //
    // The content script answers TRANSLATE_PAGE when the whole translation
    // is over, and a page with a dozen images can take minutes. Awaiting
    // that answer here would stall the recording before the first frame is
    // even taken, so the request is fired and forgotten; the state polling
    // below is what says whether it worked.
    await evaluateInWorker(
      browser,
      workerSession,
      `chrome.tabs.sendMessage(${tabId}, { type: 'TRANSLATE_PAGE' }).then(
         () => 'answered',
         error => 'refused: ' + error
       ); 'sent'`
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
          `[capture] ${Math.round((Date.now() - startedAt) / 1000)}s status=${state.status} ${state.count ?? 0}/${state.candidateCount ?? 0}`
        );
        if (state.status === 'complete' || state.status === 'error') break;
      }
    }

    /*
     * 停一下，让"翻完了"这一帧留在片子里。
     *
     * 缓存命中时这一轮只要一两秒 —— 直接接着往下滚，观众看到的是一串
     * 静止的画面，连"译文已经盖上去了"都没看清。
     */
    if (holdSeconds > 0) {
      await sleep(holdSeconds * 1000);
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

    /*
     * 录完必须验一次：这三十秒里到底有没有译文。
     *
     * 状态机说 complete 不算数 —— 一轮全失败也是 complete。真正能定责的是
     * 覆盖层：.manga-translator-overlay 有没有真的画出来，因为截图和视频
     * 拍的是同一份 DOM。素材是要挂到商店页面上的，所以这一关没过就停，
     * 而不是写出一张"没有译文的漫画"交上去。
     */
    const overlayCount = await browser
      .send(
        'Runtime.evaluate',
        {
          expression:
            "document.querySelectorAll('.manga-translator-overlay').length",
          returnByValue: true,
        },
        pageSession
      )
      .then(result => result.result?.value ?? 0)
      .catch(() => 0);
    const finalState = await evaluateInWorker(
      browser,
      workerSession,
      `chrome.tabs.sendMessage(${tabId}, { type: 'GET_STATE' }).then(r => r && r.state).catch(() => null)`
    ).catch(() => null);
    const translated =
      (finalState?.count ?? 0) + (finalState?.cachedCount ?? 0);
    if (!overlayCount || translated <= 0) {
      throw new Error(
        `the recorded run translated nothing (${translated} translated, ${overlayCount} overlays on the page${
          finalState?.lastError ? ` — ${finalState.lastError}` : ''
        }). The screenshot and the video would both show an untranslated page, so this run stops here instead of writing them.`
      );
    }
    console.log(
      `[capture] the recorded page shows ${overlayCount} translation overlays (${translated} translated)`
    );

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
    const duration = await videoDurationSeconds(videoPath);
    if (duration > MAX_STORE_VIDEO_SECONDS) {
      throw new Error(
        `the recorded video is ${duration.toFixed(1)}s, and the Chrome Web Store ` +
          `rejects a listing video longer than ${MAX_STORE_VIDEO_SECONDS}s.\n` +
          'Shorten it with RECORD_SECONDS (and --hold), and warm the cache ' +
          'with --warmup so the recording is the fast replay rather than the ' +
          'wait for the model.'
      );
    }
    console.log(
      `[capture] video -> ${videoPath} (${duration.toFixed(1)}s, limit ${MAX_STORE_VIDEO_SECONDS}s)`
    );

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
    //
    // 但面板是浮在页面右上角的，它压住的地方就是漫画。给这一张单独让出
    // 右侧的空间，让漫画和面板并排 —— 商店列表页的缩略图很小，译文被面板
    // 挡掉一半，这张图就什么也没证明。
    await applyPanelSafeLayout(browser, pageSession, true);
    await capture('screenshot-panel');
    await applyPanelSafeLayout(browser, pageSession, false);

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
  console.error(error.stack);
  process.exitCode = 1;
});
