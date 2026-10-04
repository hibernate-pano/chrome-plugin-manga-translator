import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const targetDir = path.join(rootDir, 'public', 'tesseract');

// 确保目标目录存在
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 待拷贝文件映射：[源文件路径（相对于 node_modules）, 目标文件名]
//
// Only the SIMD core pair is copied. `text-detector.ts` passes an explicit
// `corePath` ending in `.js`, and tesseract.js's worker uses such a path
// verbatim instead of auto-selecting a variant. That makes the non-SIMD
// (`tesseract-core-lstm.*`) and the non-LSTM variants unreachable, and they
// were 6.8 MB of dead weight in every package. SHA-256 of the payload is not
// affected because these files ship as-is.
const filesToCopy = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  [
    'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
  ],
  [
    'tesseract.js-core/tesseract-core-simd-lstm.wasm',
    'tesseract-core-simd-lstm.wasm',
  ],
];

// eslint-disable-next-line no-console
console.log('[CopyTesseract] 开始拷贝 Tesseract 本地脚本和 WASM 核心...');

let successCount = 0;

for (const [srcRelPath, destName] of filesToCopy) {
  const srcPath = path.join(rootDir, 'node_modules', srcRelPath);
  const destPath = path.join(targetDir, destName);

  if (fs.existsSync(srcPath)) {
    try {
      fs.copyFileSync(srcPath, destPath);
      // eslint-disable-next-line no-console
      console.log(`[CopyTesseract] 成功拷贝: ${destName}`);
      successCount++;
    } catch (error) {
      console.error(`[CopyTesseract] 拷贝失败 ${destName}:`, error);
    }
  } else {
    console.error(`[CopyTesseract] 找不到源文件: ${srcPath}`);
  }
}

// eslint-disable-next-line no-console
console.log(
  `[CopyTesseract] 拷贝完成。成功: ${successCount}/${filesToCopy.length}`
);
if (successCount < filesToCopy.length) {
  process.exit(1);
}
