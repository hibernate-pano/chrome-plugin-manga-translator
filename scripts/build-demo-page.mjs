#!/usr/bin/env node
/**
 * 生成商店演示用的漫画页。
 *
 * 演示页不能直接拿 SVG 气泡凑：内容脚本把**图片本身**送去模型识别文字，
 * 画在 HTML 里的日文模型看不见，也就翻译不了 —— 气泡里会同时留着日文和
 * 中文。所以日文必须先烧进像素里。
 *
 * 做法：用无头 Chrome 把一张带日文的漫画页渲染成 PNG。
 *
 * 画面来自 store/artwork/ 下的两张漫画原图（AI 生成，空白气泡是原图自带的），
 * 坐标和台词写在下面。改了台词或挪了气泡，重跑一次即可。
 *
 * 用法：node scripts/build-demo-page.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// 素材分三层：artwork 是 AI 生成的原图，demo 是烧进日文台词的演示页，
// listing 是给商店看的东西。原图和商店素材进版本库，演示页是产物，
// 随时可以重新生成。
const artDir = path.join(repoRoot, 'store', 'artwork');
const outDir = path.join(repoRoot, 'store', 'demo');

/**
 * 两页漫画。坐标是 1024x1536 原图里的像素位置，和气泡在图上的实际边界
 * 对齐 —— 文字要落在气泡里面，落到外面就露馅了。
 */
const PAGES = [
  {
    source: 'manga-page-1.png',
    output: 'demo-manga-page-1.png',
    bubbles: [
      {
        // 右上那颗竖长的椭圆气泡
        x: 718,
        y: 56,
        w: 108,
        h: 232,
        size: 34,
        vertical: true,
        text: '待って！',
      },
      {
        // 街景面板里的椭圆气泡
        x: 424,
        y: 700,
        w: 62,
        h: 130,
        size: 25,
        vertical: true,
        text: '行こう',
      },
      {
        // 街景面板右上角的旁白框
        x: 742,
        y: 658,
        w: 162,
        h: 198,
        size: 21,
        text: '夕暮れの商店街。事件は突然に起きた',
      },
      {
        // 最下面那块旁白框
        x: 384,
        y: 1374,
        w: 206,
        h: 110,
        size: 23,
        text: 'その日の放課後、一通のメールが届いた',
      },
    ],
  },
  {
    source: 'manga-page-2.png',
    output: 'demo-manga-page-2.png',
    bubbles: [
      {
        // 女生旁边的椭圆气泡
        x: 545,
        y: 200,
        w: 70,
        h: 128,
        size: 26,
        vertical: true,
        text: '先輩？',
      },
      {
        // 右上角竖长的旁白框
        x: 782,
        y: 46,
        w: 126,
        h: 244,
        size: 25,
        vertical: true,
        text: '放課後の廊下',
      },
      {
        // 中间面板左侧的椭圆气泡
        x: 128,
        y: 524,
        w: 70,
        h: 142,
        size: 24,
        vertical: true,
        text: 'えっ…？',
      },
      {
        // 中间面板右侧的大椭圆气泡
        x: 618,
        y: 562,
        w: 80,
        h: 180,
        size: 24,
        vertical: true,
        text: 'メール…だと？',
      },
      {
        // 夜景面板里的旁白框
        x: 498,
        y: 902,
        w: 324,
        h: 110,
        size: 24,
        text: 'その夜、届いたメールの宛先は、失われたはずの住所だった',
      },
    ],
  },
];

function renderHtml(page) {
  const bubbles = page.bubbles
    .map(bubble => {
      const writingMode = bubble.vertical ? 'writing-mode:vertical-rl;' : '';
      return `<div class="bubble" style="left:${bubble.x}px;top:${bubble.y}px;width:${bubble.w}px;height:${bubble.h}px;font-size:${bubble.size}px;${writingMode}">${bubble.text}</div>`;
    })
    .join('\n    ');

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
      .page {
        position: relative;
        width: 1024px;
        height: 1536px;
      }
      .page > img {
        position: absolute;
        left: 0;
        top: 0;
        width: 1024px;
        height: 1536px;
      }
      .bubble {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: #111111;
        /*
         * 漫画的台词是手写实心笔画，不是印刷体的细线。
         *
         * 这不是修饰。扩展把图片交给视觉模型定位文字，模型自己也靠墨迹
         * 找字；细一像素的衬线笔画在模型眼里是模糊的，在像素精修器眼里
         * 直接被"宽高都至少 8 像素"的字形门槛筛掉 —— 演示页上的字会既不
         * 被模型框准，也不被精修器修好。实心笔画才是漫画真实的画法。
         */
        font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans",
          "Noto Sans JP", sans-serif;
        font-weight: 700;
        -webkit-text-stroke: 1px #111111;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <img src="${path.join(artDir, page.source)}" />
      ${bubbles}
    </div>
  </body>
</html>
`;
}

async function rasterize(htmlFile, outputFile) {
  await new Promise((resolve, reject) => {
    const chrome = spawn(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--screenshot=${outputFile}`,
        '--window-size=1024,1536',
        `file://${htmlFile}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    chrome.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    chrome.on('error', reject);
    chrome.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`headless chrome exited ${code}: ${stderr}`));
    });
  });
}

/**
 * 演示页：一个中性的漫画阅读页面。
 *
 * 故意不加假站名、假导航栏 —— 商店截图里出现编造的站点元素会让人以为
 * 扩展是跟某个网站绑定的，而它其实对任何漫画站都工作。
 */
function readerHtml(images) {
  const tags = images
    .map(image => `<img class="page" src="${image}" alt="漫画ページ" />`)
    .join('\n      ');

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>漫画デモページ</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: #1f2023;
      }
      main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 28px;
        padding: 28px 0 80px;
      }
      img.page {
        display: block;
        width: min(920px, 94vw);
        height: auto;
        background: #ffffff;
        box-shadow: 0 10px 34px rgba(0, 0, 0, 0.55);
      }
    </style>
  </head>
  <body>
    <main>
      ${tags}
    </main>
  </body>
</html>
`;
}

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'manga-demo-'));
  try {
    const outputs = [];
    for (const page of PAGES) {
      const htmlFile = path.join(tempDir, `${page.output}.html`);
      await writeFile(htmlFile, renderHtml(page), 'utf8');
      const outputFile = path.join(outDir, page.output);
      await rasterize(htmlFile, outputFile);
      const size = (await readFile(outputFile)).length;
      console.log(`[demo] ${page.output} (${Math.round(size / 1024)} KB)`);
      outputs.push(page.output);
    }

    const htmlFile = path.join(outDir, 'demo-manga-page.html');
    await writeFile(htmlFile, readerHtml(outputs), 'utf8');
    console.log(`[demo] ${path.relative(repoRoot, htmlFile)}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`[demo] failed: ${error.message}`);
  process.exitCode = 1;
});
