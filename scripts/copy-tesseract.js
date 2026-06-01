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
const filesToCopy = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm']
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
console.log(`[CopyTesseract] 拷贝完成。成功: ${successCount}/${filesToCopy.length}`);
if (successCount < filesToCopy.length) {
  process.exit(1);
}
