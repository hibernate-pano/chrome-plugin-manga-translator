import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  TESSERACT_CORE_FILES,
  TESSERACT_LANGUAGES,
  TESSERACT_WORKER_SOURCE,
  patchWorkerSource,
  trainedDataRelativePath,
} from './lib/tesseract-assets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const nodeModulesDir = path.join(rootDir, 'node_modules');
const targetDir = path.join(rootDir, 'public', 'tesseract');
const langDir = path.join(targetDir, 'lang');

/**
 * Prepare the local Tesseract assets.
 *
 * Three kinds of file are copied:
 *
 *   1. `worker.min.js`, with tesseract.js's two jsdelivr defaults rewritten to
 *      paths inside this directory. Copying it verbatim is what produced the
 *      Blue Argon finding: the defaults stayed in the package even though the
 *      extension overrode them at runtime, and the store reviews the package.
 *   2. The SIMD-LSTM core pair. `text-detector.ts` names the `.js` file
 *      explicitly, so tesseract.js never auto-selects another variant.
 *   3. The four traineddata files, pinned through the `@tesseract.js-data/*`
 *      packages in package.json. They are the `4.0.0_best_int` variant that
 *      tesseract.js selects for `createWorker(lang, 1)` — the same files the
 *      CDN used to serve, now inside the extension.
 *
 * Everything here is generated. `public/tesseract/lang/` is gitignored; the
 * worker and core files are tracked because they were before this change.
 */

fs.mkdirSync(targetDir, { recursive: true });
// Rebuild the language directory from scratch: a language removed from
// TESSERACT_LANGUAGES must not survive in the package as a stale file.
fs.rmSync(langDir, { recursive: true, force: true });
fs.mkdirSync(langDir, { recursive: true });

console.log('[CopyTesseract] 准备本地 Tesseract worker、WASM 核心与语言包...');

let copied = 0;
let failed = 0;
let totalBytes = 0;

function copyFile(srcPath, destPath, label) {
  if (!fs.existsSync(srcPath)) {
    console.error(`[CopyTesseract] 找不到源文件: ${srcPath}`);
    failed += 1;
    return false;
  }
  try {
    fs.copyFileSync(srcPath, destPath);
    const bytes = fs.statSync(destPath).size;
    totalBytes += bytes;
    copied += 1;
    console.log(
      `[CopyTesseract] ${label}: ${bytes.toLocaleString('en-US')} bytes`
    );
    return true;
  } catch (error) {
    console.error(`[CopyTesseract] 拷贝失败 ${label}:`, error);
    failed += 1;
    return false;
  }
}

// 1. Worker script, with the remote defaults rewritten.
const workerSourcePath = path.join(nodeModulesDir, TESSERACT_WORKER_SOURCE);
if (!fs.existsSync(workerSourcePath)) {
  console.error(`[CopyTesseract] 找不到 worker 源文件: ${workerSourcePath}`);
  process.exit(1);
}
try {
  const source = fs.readFileSync(workerSourcePath, 'utf8');
  const patched = patchWorkerSource(source);
  const workerDest = path.join(targetDir, 'worker.min.js');
  fs.writeFileSync(workerDest, patched);
  const bytes = Buffer.byteLength(patched);
  totalBytes += bytes;
  copied += 1;
  console.log(
    `[CopyTesseract] worker.min.js: ${bytes.toLocaleString('en-US')} bytes ` +
      `(本地化 2 处远程默认值, 源 ${source.length.toLocaleString('en-US')} bytes)`
  );
} catch (error) {
  console.error('[CopyTesseract] worker 本地化失败:', error.message);
  process.exit(1);
}

// 2. SIMD-LSTM WASM core.
for (const file of TESSERACT_CORE_FILES) {
  copyFile(
    path.join(nodeModulesDir, 'tesseract.js-core', file),
    path.join(targetDir, file),
    file
  );
}

// 3. Traineddata for every language the detector recognizes.
for (const lang of TESSERACT_LANGUAGES) {
  const relative = trainedDataRelativePath(lang);
  const dest = path.join(langDir, `${lang}.traineddata.gz`);
  if (
    !copyFile(
      path.join(nodeModulesDir, relative),
      dest,
      `lang/${lang}.traineddata.gz`
    )
  ) {
    continue;
  }

  // A gzip file starts with 1f 8b. Checking it here catches a package that
  // shipped a Git LFS pointer or an HTML error page under the right name —
  // a failure that would otherwise surface as an OCR error on a user's page.
  const head = Buffer.alloc(2);
  const fd = fs.openSync(dest, 'r');
  try {
    fs.readSync(fd, head, 0, 2, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    console.error(
      `[CopyTesseract] lang/${lang}.traineddata.gz is not a gzip file`
    );
    failed += 1;
  }
}

const expected = 1 + TESSERACT_CORE_FILES.length + TESSERACT_LANGUAGES.length;

console.log(
  `[CopyTesseract] 完成: ${copied}/${expected} 个文件, ` +
    `${(totalBytes / 1024 / 1024).toFixed(2)} MB`
);

if (failed > 0 || copied !== expected) {
  console.error(
    `[CopyTesseract] 失败 ${failed} 个; 期望 ${expected} 个文件, 实际 ${copied} 个`
  );
  process.exit(1);
}
