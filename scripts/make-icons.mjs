import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME =
  process.env['CHROME_PATH'] ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * The extension icon.
 *
 * The old icon put two lines of kanji, a lightning bolt and a globe into a
 * 128-pixel square. At 128 that reads; at 16 — which is the size Chrome
 * actually draws in the toolbar, and the one place the onboarding tells the
 * user to look for the extension — it collapsed into an illegible smudge.
 *
 * Two rules, then:
 *
 *  1. The 16-pixel version carries no lettering at all. It is a solid
 *     speech bubble with a globe on its shoulder: a shape that still reads
 *     as "translate" when it is sixteen pixels wide.
 *  2. Everything from 32 pixels up carries one large character, drawn as
 *     paths rather than as text so the icon does not depend on a font
 *     being installed on whoever regenerates it.
 *
 * Run: node scripts/make-icons.mjs
 */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 128 128" style="display:block">
  <defs>
    <linearGradient id="bubble" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e2e8f0"/>
    </linearGradient>
    <linearGradient id="globe" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#67e8f9"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
    <clipPath id="globeClip">
      <circle cx="92" cy="36" r="26"/>
    </clipPath>
  </defs>

  <circle cx="92" cy="36" r="26" fill="url(#globe)"/>
  <g clip-path="url(#globeClip)" stroke="#e0f2fe" stroke-width="4" fill="none" opacity="0.9">
    <ellipse cx="92" cy="36" rx="11" ry="26"/>
    <line x1="66" y1="36" x2="118" y2="36"/>
    <path d="M70 20 Q92 30 114 20"/>
    <path d="M70 52 Q92 42 114 52"/>
  </g>
  <circle cx="92" cy="36" r="26" fill="none" stroke="#0b3b57" stroke-width="5"/>

  <path d="M30 84 h-4 a20 20 0 0 1 -20 -20 v-28 a20 20 0 0 1 20 -20 h46 a20 20 0 0 1 20 20 v28 a20 20 0 0 1 -20 20 h-30 l-16 16 v-16 z"
        fill="url(#bubble)" stroke="#0f172a" stroke-width="6" stroke-linejoin="round"/>

  <!-- 文, drawn as strokes: a dot, a horizontal, and the two crossing sweeps. -->
  <g id="glyph" transform="translate(14, 24) scale(0.78)" stroke="#0e7490" stroke-width="7"
     stroke-linecap="round" fill="none">
    <path d="M31 3 L40 14"/>
    <path d="M4 23 H66"/>
    <path d="M44 27 C40 41 30 55 14 66"/>
    <path d="M26 27 C32 41 44 55 60 66"/>
  </g>
</svg>`;

/** Below this size the character is a smudge, so it is left out. */
const SIZES = [16, 32, 48, 64, 128, 256];
const WITH_GLYPH_FROM = 32;

const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..'
);
const outDir = path.join(projectRoot, 'public', 'icons');

const userDataDir = mkdtempSync(path.join(tmpdir(), 'manga-icon-'));
const chrome = spawn(
  CHROME,
  [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] }
);

const portFile = path.join(userDataDir, 'DevToolsActivePort');
let port = null;
for (let i = 0; i < 100 && port === null; i++) {
  await new Promise(resolve => setTimeout(resolve, 150));
  try {
    port = Number.parseInt(readFileSync(portFile, 'utf8').split('\n')[0], 10);
  } catch {
    /* not written yet */
  }
}
if (port === null) {
  chrome.kill();
  throw new Error('Chrome did not expose a debugging port');
}

const version = await (
  await fetch(`http://127.0.0.1:${port}/json/version`)
).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(resolve =>
  ws.addEventListener('open', resolve, { once: true })
);

let messageId = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}, sessionId) => {
  const id = ++messageId;
  return new Promise(resolve => {
    pending.set(id, resolve);
    ws.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      })
    );
  });
};

mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const markup =
    size >= WITH_GLYPH_FROM
      ? SVG
      : SVG.replace(/<g id="glyph"[\s\S]*?<\/g>/, '');
  const page =
    `<!doctype html><html><body style="margin:0;padding:0;overflow:hidden;` +
    `width:${size}px;height:${size}px;background:transparent">${markup}</body></html>`;

  const {
    result: { targetId },
  } = await send('Target.createTarget', { url: 'about:blank' });
  const {
    result: { sessionId },
  } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send(
    'Emulation.setDefaultBackgroundColorOverride',
    {
      color: { r: 0, g: 0, b: 0, a: 0 },
    },
    sessionId
  );
  await send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: size,
      height: size,
      deviceScaleFactor: 1,
      mobile: false,
    },
    sessionId
  );
  await send(
    'Page.navigate',
    {
      url: `data:text/html;charset=utf-8,${encodeURIComponent(page)}`,
    },
    sessionId
  );
  await new Promise(resolve => setTimeout(resolve, 500));

  const {
    result: { data },
  } = await send(
    'Page.captureScreenshot',
    {
      format: 'png',
      fromSurface: true,
    },
    sessionId
  );
  writeFileSync(
    path.join(outDir, `icon${size}.png`),
    Buffer.from(data, 'base64')
  );
  await send('Target.closeTarget', { targetId });
  console.log(`icons/icon${size}.png`);
}

chrome.kill();
process.exit(0);
