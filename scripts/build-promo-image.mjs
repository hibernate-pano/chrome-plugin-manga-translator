#!/usr/bin/env node
/**
 * Build the Chrome Web Store promo images from the screenshots that are
 * already on disk.
 *
 * The promo images are the listing assets that were still marked "not made
 * yet" while the screenshots next to them existed. They are marketing
 * images: a headline, the claims the product actually keeps, and the
 * product doing its job. None of that needs a model, an API key or a
 * network connection — which matters, because the screenshots themselves
 * are expensive to re-take (they need a live provider) while these
 * composites are free to re-make.
 *
 * The store wants three promo images, and each one has to be laid out for
 * its own size:
 *   - 1280x800  the main promo image
 *   -  440x280  small promo tile, shown as a thumbnail in the listing
 *   - 1400x560  large promo tile, shown across the top of the listing
 * A tile that is a scaled copy of the main image is unreadable at 440x280,
 * so every size gets its own composition instead of a resize.
 *
 * The rendering is done by headless Chrome loading a local HTML file.
 * Chrome's `--screenshot` needs no DevTools handshake, and a `file://`
 * page never touches the network stack — so this runs on a machine whose
 * Chrome cannot reach the internet, which is a real condition on some
 * hosts.
 *
 * Every output is verified before it lands in the listing folder: the PNG
 * header has to report the exact pixel size, and the file must not carry
 * an alpha channel — the Chrome Web Store rejects alpha PNGs outright.
 *
 * Usage:
 *   node scripts/build-promo-image.mjs
 *   node scripts/build-promo-image.mjs --out store/listing/promo-1280x800.png
 *   node scripts/build-promo-image.mjs --only small
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

/**
 * The three store images. The sizes are fixed by the Chrome Web Store:
 * a mismatch is a rejection, not a warning.
 */
const MAIN_VARIANT = {
  key: 'main',
  file: 'promo-1280x800.png',
  width: 1280,
  height: 800,
};
const SMALL_VARIANT = {
  key: 'small',
  file: 'promo-small-440x280.png',
  width: 440,
  height: 280,
};
const LARGE_VARIANT = {
  key: 'large',
  file: 'promo-large-1400x560.png',
  width: 1400,
  height: 560,
};
const VARIANTS = [MAIN_VARIANT, SMALL_VARIANT, LARGE_VARIANT];

function parseArgs(argv) {
  const options = { out: null, only: null };
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
    } else if (arg === '--only') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--only needs a variant name');
      }
      options.only = value;
      index++;
    } else if (arg.startsWith('--only=')) {
      options.only = arg.slice('--only='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.out && options.only) {
    throw new Error(
      '--out writes the 1280x800 main image, so it cannot be combined ' +
        'with --only'
    );
  }
  if (options.only && !VARIANTS.some(variant => variant.key === options.only)) {
    const names = VARIANTS.map(variant => variant.key).join(', ');
    throw new Error(
      `unknown --only value: ${options.only} (expected ${names})`
    );
  }
  return options;
}

/**
 * Which images this run produces.
 *
 * `--out` keeps its old meaning exactly: render the 1280x800 main image
 * and write it to that path. With no arguments every store image is
 * rendered to its place in the listing folder.
 */
function selectJobs(options) {
  if (options.out) {
    return [{ variant: MAIN_VARIANT, out: options.out }];
  }
  if (options.only) {
    const variant = VARIANTS.find(item => item.key === options.only);
    return [{ variant, out: join(listingDir, variant.file) }];
  }
  return VARIANTS.map(variant => ({
    variant,
    out: join(listingDir, variant.file),
  }));
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

/**
 * The small promo tile (440x280).
 *
 * The store shows this one as a thumbnail next to the listing, so the only
 * things that survive the downscale are the headline and a single promise.
 * Everything else is noise: one claim, one picture, and type big enough to
 * read without zooming.
 *
 * The picture is not a scaled version of the main image — it is a wide
 * crop of the comic strip itself, because a strip of panels with the
 * translated text inside is the one thing that explains the product at a
 * glance.
 */
function buildSmallHtml({ screenshot }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    width: 440px;
    height: 280px;
    overflow: hidden;
    background: #020617;
    color: #f8fafc;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background:
      radial-gradient(300px 210px at 94% 4%, rgba(34, 211, 238, 0.20), transparent 70%),
      radial-gradient(260px 190px at 4% 96%, rgba(99, 102, 241, 0.16), transparent 72%);
  }
  .copy {
    position: absolute;
    left: 22px;
    top: 20px;
    width: 396px;
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid rgba(34, 211, 238, 0.45);
    border-radius: 999px;
    background: rgba(34, 211, 238, 0.08);
    color: #67e8f9;
    font-size: 12px;
    line-height: 1.45;
    letter-spacing: 0.06em;
  }
  .eyebrow::before {
    content: "";
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #22d3ee;
  }
  h1 {
    margin: 9px 0 0;
    font-size: 40px;
    line-height: 1.05;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .claim {
    margin: 8px 0 0;
    font-size: 17px;
    line-height: 1.45;
    color: #a5b4c8;
    white-space: nowrap;
  }
  .claim b {
    color: #22d3ee;
    font-weight: 500;
    /* A heavier CJK face is wider than the regular one, so the first
       highlighted glyph crowds the character before it. The small gap
       keeps the two runs from touching. */
    margin-left: 0.14em;
  }
  .band {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 150px;
    overflow: hidden;
    border-top: 1px solid rgba(34, 211, 238, 0.30);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.55);
    background: #0b1020;
  }
  .band img {
    position: absolute;
    /* The capture is 1280x800; this crop shows the top comic panel, with
       the translated bubbles in it, scaled to fill the strip. */
    left: -131px;
    top: -65px;
    width: 671px;
    height: 419px;
    display: block;
  }
  .band::after {
    content: "";
    position: absolute;
    left: 0; right: 0; top: 0; height: 46px;
    background: linear-gradient(180deg, rgba(2, 6, 23, 0.95), rgba(2, 6, 23, 0));
    pointer-events: none;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="copy">
      <span class="eyebrow">Chrome 扩展</span>
      <h1>漫画翻译助手</h1>
      <p class="claim">译文直接<b>覆盖在原文气泡上</b>，保留原图排版</p>
    </div>
    <div class="band">
      <img src="${screenshot}" alt="" />
    </div>
  </div>
</body>
</html>
`;
}

/**
 * The large promo tile (1400x560).
 *
 * This one runs across the top of the listing page, so it has room for the
 * headline, the three claims and the product doing its job. The layout
 * mirrors the main image — copy on the left, screenshot on the right — but
 * the crop is wider and the type is scaled to the bigger canvas.
 */
function buildLargeHtml({ panelScreenshot, extensionVersion }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    width: 1400px;
    height: 560px;
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
      radial-gradient(900px 620px at 76% 44%, rgba(34, 211, 238, 0.16), transparent 68%),
      radial-gradient(760px 540px at 6% 90%, rgba(99, 102, 241, 0.14), transparent 70%);
  }
  .copy { width: 540px; flex: none; }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 6px 16px;
    border: 1px solid rgba(34, 211, 238, 0.45);
    border-radius: 999px;
    background: rgba(34, 211, 238, 0.08);
    color: #67e8f9;
    font-size: 18px;
    line-height: 1.45;
    letter-spacing: 0.06em;
  }
  .eyebrow::before {
    content: "";
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #22d3ee;
  }
  h1 {
    margin: 24px 0 0;
    font-size: 72px;
    line-height: 1.06;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .sub {
    margin: 20px 0 0;
    font-size: 25px;
    line-height: 1.5;
    color: #a5b4c8;
  }
  .sub b { color: #22d3ee; font-weight: 600; white-space: nowrap; }
  ul { margin: 30px 0 0; padding: 0; list-style: none; }
  li {
    display: flex;
    align-items: flex-start;
    gap: 13px;
    margin-top: 15px;
    font-size: 21px;
    line-height: 1.45;
    color: #cbd5e1;
  }
  li .tick {
    flex: none;
    width: 26px; height: 26px;
    margin-top: 1px;
    border-radius: 50%;
    background: rgba(34, 211, 238, 0.14);
    border: 1px solid rgba(34, 211, 238, 0.4);
    color: #67e8f9;
    font-size: 15px;
    line-height: 24px;
    text-align: center;
  }
  .shot {
    position: relative;
    margin-left: 56px;
    width: 676px;
    height: 430px;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.35);
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6);
    background: #0b1020;
  }
  .shot img {
    position: absolute;
    /* The capture is 1280x800; this crop keeps the comic page and the
       reading panel side by side, the way the main image shows them. */
    left: -166px;
    top: -55px;
    width: 865px;
    height: 541px;
    display: block;
  }
  .shot .tag {
    position: absolute;
    left: 16px; top: 16px;
    padding: 6px 13px;
    border-radius: 999px;
    background: rgba(2, 6, 23, 0.86);
    border: 1px solid rgba(148, 163, 184, 0.28);
    font-size: 15px;
    color: #cbd5e1;
  }
  .foot {
    position: absolute;
    left: 64px; bottom: 30px;
    font-size: 15px;
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

/**
 * The markup for one variant.
 *
 * Every variant gets its own page: the three sizes are three different
 * layouts, not three scales of one layout.
 */
function buildVariantHtml(variant, context) {
  if (variant.key === 'small') {
    return buildSmallHtml(context);
  }
  if (variant.key === 'large') {
    return buildLargeHtml(context);
  }
  return buildHtml(context);
}

async function runChrome(chromeBinary, url, outPath, variant) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'promo-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${variant.width},${variant.height}`,
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

/**
 * Run a command and collect its output. A non-zero exit is reported, not
 * thrown, so the caller can decide what a failure means.
 */
function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', code => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

/**
 * The PNG header, read straight out of the file.
 *
 * The IHDR chunk is the ground truth for the pixel size and for the
 * presence of an alpha channel: colour types 4 (grey + alpha) and 6
 * (truecolour + alpha) carry one, the others do not.
 */
async function readPngHeader(file) {
  const buffer = await readFile(file);
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error(`${file} is not a PNG`);
  }
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`${file} has no PNG IHDR chunk`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

/**
 * Ask sips what it thinks of the file.
 *
 * sips is the tool the store listing workflow already uses, and it is the
 * one that reports `hasAlpha` the way the Chrome Web Store checks it.
 * It only exists on macOS, so a missing sips is reported rather than
 * treated as a failure — the header check still runs either way.
 */
async function inspectWithSips(file) {
  let result;
  try {
    result = await runCommand('sips', [
      '-g',
      'pixelWidth',
      '-g',
      'pixelHeight',
      '-g',
      'hasAlpha',
      file,
    ]);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (result.code !== 0) {
    throw new Error(`sips failed on ${file}:\n${result.stderr}`);
  }
  const width = /pixelWidth:\s*(\d+)/.exec(result.stdout);
  const height = /pixelHeight:\s*(\d+)/.exec(result.stdout);
  const alpha = /hasAlpha:\s*(yes|no)/.exec(result.stdout);
  if (!width || !height || !alpha) {
    throw new Error(`cannot read sips output for ${file}:\n${result.stdout}`);
  }
  return {
    width: Number(width[1]),
    height: Number(height[1]),
    hasAlpha: alpha[1] === 'yes',
  };
}

/**
 * Refuse to publish an image the store would reject.
 *
 * The size has to match exactly — the store crops or rejects anything
 * else — and the file must not have an alpha channel, which the store
 * rejects outright.
 */
async function verifyImage(file, variant) {
  const header = await readPngHeader(file);
  if (header.width !== variant.width || header.height !== variant.height) {
    throw new Error(
      `${file} is ${header.width}x${header.height}, ` +
        `expected ${variant.width}x${variant.height}`
    );
  }
  if (header.colorType === 4 || header.colorType === 6) {
    throw new Error(
      `${file} has an alpha channel (PNG colour type ${header.colorType}); ` +
        'the Chrome Web Store rejects alpha PNGs'
    );
  }
  const sips = await inspectWithSips(file);
  if (sips) {
    if (sips.width !== variant.width || sips.height !== variant.height) {
      throw new Error(
        `${file} is ${sips.width}x${sips.height} per sips, ` +
          `expected ${variant.width}x${variant.height}`
      );
    }
    if (sips.hasAlpha) {
      throw new Error(
        `${file} has an alpha channel per sips; ` +
          'the Chrome Web Store rejects alpha PNGs'
      );
    }
  }
  return { header, sips };
}

async function renderVariant(chromeBinary, variant, out, context) {
  // The HTML lives next to the screenshots so the <img> can be a plain
  // relative path; a file:// page loading file:// images is ordinary
  // browser behaviour and needs no extra Chrome flags.
  const htmlPath = join(listingDir, `.promo-${variant.key}.html`);
  await writeFile(htmlPath, buildVariantHtml(variant, context), 'utf8');

  try {
    // Rendered to a scratch path first: a run that dies half-way must not
    // leave a truncated file where the listing expects a finished image.
    const scratch = join(
      tmpdir(),
      `promo-${variant.key}-${process.pid}-${Date.now()}.png`
    );
    try {
      await runChrome(
        chromeBinary,
        pathToFileURL(htmlPath).href,
        scratch,
        variant
      );
      // Checked before the copy, so a bad render never reaches the
      // listing folder.
      await verifyImage(scratch, variant);
      await copyFile(scratch, out);
    } finally {
      await rm(scratch, { force: true });
    }
  } finally {
    await rm(htmlPath, { force: true });
  }

  // And checked again on the published file, so the report describes
  // exactly what is on disk.
  const { sips } = await verifyImage(out, variant);
  const produced = await readFile(out);
  const alphaNote = sips
    ? `alpha: ${sips.hasAlpha ? 'yes' : 'no'} (sips)`
    : `alpha: no (PNG header)`;
  console.log(
    `[promo] wrote ${out} ` +
      `(${variant.width}x${variant.height}, ${alphaNote}, ` +
      `${(produced.length / 1024).toFixed(1)} KB)`
  );
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
  const context = {
    screenshot: pathToFileURL(screenshot).href,
    panelScreenshot: pathToFileURL(panelScreenshot).href,
    extensionVersion,
  };

  for (const job of selectJobs(options)) {
    await renderVariant(chromeBinary, job.variant, job.out, context);
  }
}

main().catch(error => {
  console.error(`[promo] ${error.message}`);
  process.exit(1);
});
