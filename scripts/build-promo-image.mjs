#!/usr/bin/env node
/**
 * Build the Chrome Web Store promo image from the screenshots that are
 * already on disk.
 *
 * The promo image is the one listing asset that was still marked "not made
 * yet" while the screenshots next to it existed. It is a marketing image:
 * a headline, three claims, and the product actually doing its job. None of
 * that needs a model, an API key or a network connection — which matters,
 * because the screenshots themselves are expensive to re-take (they need a
 * live provider) while this composite is free to re-make.
 *
 * The rendering is done by headless Chrome loading a local HTML file.
 * Chrome's `--screenshot` needs no DevTools handshake, and a `file://` page
 * never touches the network stack — so this runs on a machine whose Chrome
 * cannot reach the internet, which is a real condition on some hosts.
 *
 * Usage:
 *   node scripts/build-promo-image.mjs
 *   node scripts/build-promo-image.mjs --out store/listing/promo-1280x800.png
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const listingDir = join(repoRoot, 'store', 'listing');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function parseArgs(argv) {
  const options = { out: join(listingDir, 'promo-1280x800.png') };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--out') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--out needs a path');
      }
      options.out = resolve(value);
      index++;
    } else if (arg.startsWith('--out=')) {
      options.out = resolve(arg.slice('--out='.length));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
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

/**
 * The promo page.
 *
 * The screenshots are the real thing — a real translation of a real page —
 * so the image does not have to pretend. The text beside them is the
 * smallest set of claims the product actually keeps: the translation lands
 * in place, the key never leaves the machine, and the long strips work.
 */
function buildHtml({ panelScreenshot, extensionVersion }) {
  return `<!doctype html>
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
    padding: 0 56px;
    /* A single cyan bloom behind the screenshot, so the picture sits in a
       lit space instead of on a flat black rectangle. */
    background:
      radial-gradient(900px 620px at 78% 42%, rgba(34, 211, 238, 0.16), transparent 68%),
      radial-gradient(700px 520px at 8% 88%, rgba(99, 102, 241, 0.14), transparent 70%);
  }
  .copy { width: 430px; flex: none; }
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
    font-size: 62px;
    line-height: 1.08;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .sub {
    margin: 18px 0 0;
    font-size: 24px;
    line-height: 1.55;
    color: #a5b4c8;
  }
  .sub b { color: #22d3ee; font-weight: 600; white-space: nowrap; }
  ul { margin: 30px 0 0; padding: 0; list-style: none; }
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
  .shot {
    position: relative;
    margin-left: 56px;
    width: 700px;
    height: 560px;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.35);
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6);
    background: #0b1020;
  }
  .shot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* The interesting part of the capture is the comic plus the reading
       panel on its right; shifting right keeps both in frame instead of
       cutting the panel in half. */
    object-position: 88% 50%;
    display: block;
  }
  .shot .tag {
    position: absolute;
    left: 14px; top: 14px;
    padding: 5px 11px;
    border-radius: 999px;
    background: rgba(2, 6, 23, 0.86);
    border: 1px solid rgba(148, 163, 184, 0.28);
    font-size: 13px;
    color: #cbd5e1;
  }
  .foot {
    position: absolute;
    left: 56px; bottom: 26px;
    font-size: 13px;
    color: #64748b;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="copy">
      <span class="eyebrow">Chrome 扩展</span>
      <h1>漫画翻译助手</h1>
      <p class="sub">在原页面就地把日文漫画<br />翻成<b>简体中文</b>，不跳转、不重排版。</p>
      <ul>
        <li><span class="tick">✓</span><span>译文直接覆盖在原文气泡上，保留原图排版</span></li>
        <li><span class="tick">✓</span><span>API Key 只存在本机浏览器里，不随账号同步</span></li>
        <li><span class="tick">✓</span><span>长条条漫自动切片，译文坐标映射回原图</span></li>
      </ul>
    </div>
    <div class="shot">
      <img src="${panelScreenshot}" alt="" />
      <div class="tag">译文阅读面板：逐条列出本页译文</div>
    </div>
  </div>
  <div class="foot">漫画翻译助手 v${extensionVersion} · 支持任意 OpenAI 兼容接口与本地 Ollama / LM Studio</div>
</body>
</html>
`;
}

async function runChrome(chromeBinary, url, outPath) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'promo-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1280,800',
    '--virtual-time-budget=4000',
    `--user-data-dir=${userDataDir}`,
    `--screenshot=${outPath}`,
    url,
  ];
  let stderr = '';
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chromeBinary, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`chrome did not exit in time:\n${stderr}`));
    }, 90_000);
    child.on('error', error => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      // The exit code is not a signal here. Headless Chrome on macOS writes
      // the screenshot and then tears the display link down, which it
      // reports as a failure on the way out ("CVDisplayLinkCreateWithCGDisplay
      // failed", "Teardown watchdog expired"). The screenshot is the thing
      // that matters, so the file is checked below instead of the code.
      resolvePromise();
    });
  });
  await rm(userDataDir, { recursive: true, force: true });

  if (!existsSync(outPath)) {
    throw new Error(`chrome produced no screenshot:\n${stderr}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const screenshot = join(listingDir, 'screenshot-1280x800.png');
  const panelScreenshot = join(listingDir, 'screenshot-panel-1280x800.png');
  for (const file of [screenshot, panelScreenshot]) {
    if (!existsSync(file)) {
      throw new Error(
        `missing ${file}\nRun \`node scripts/capture-store-assets.mjs\` first.`
      );
    }
  }

  const chromeBinary = findChrome();
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, 'package.json'), 'utf8')
  );
  const extensionVersion = packageJson.version ?? '0.0.0';

  // The HTML lives next to the screenshots so the <img> can be a plain
  // relative path; a file:// page loading file:// images is ordinary
  // browser behaviour and needs no extra Chrome flags.
  const htmlPath = join(listingDir, '.promo.html');
  const html = buildHtml({
    panelScreenshot: pathToFileURL(panelScreenshot).href,
    extensionVersion,
  });
  await writeFile(htmlPath, html, 'utf8');

  try {
    // Rendered to a scratch path first: a run that dies half-way must not
    // leave a truncated file where the listing expects a finished image.
    const scratch = join(tmpdir(), `promo-${process.pid}-${Date.now()}.png`);
    try {
      await runChrome(chromeBinary, pathToFileURL(htmlPath).href, scratch);
      await copyFile(scratch, options.out);
    } finally {
      await rm(scratch, { force: true });
    }
  } finally {
    await rm(htmlPath, { force: true });
  }

  const produced = await readFile(options.out);
  console.log(
    `[promo] wrote ${options.out} (${(produced.length / 1024).toFixed(1)} KB)`
  );
}

main().catch(error => {
  console.error(`[promo] ${error.message}`);
  process.exit(1);
});
