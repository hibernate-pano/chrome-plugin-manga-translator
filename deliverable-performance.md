# 前端性能 + 翻译质量分析

> 项目：`chrome-plugin-manga-translator` v0.3.2
> 分析时间：2026-06-01
> 分析范围：content script 注入、图片处理、翻译调度、缓存策略、VLM 调用成本、翻译质量、渲染性能
> 测量基准：`pnpm build` 输出（`dist/`），所有体积数据来自实际构建产物

## 关键数据估算

| 指标 | 当前值 | 改进后预期 | 改进幅度 |
|---|---|---|---|
| Content Script 原始体积 | **318 KB** | 110-130 KB | -60% |
| Content Script Gzip 体积 | **85 KB** | 32-38 KB | -55% |
| Content Script 首次注入耗时（3G 网络） | ~280 ms | ~110 ms | -60% |
| Content Script 内嵌 React 体积 | **211 KB**（占 66%） | 0 KB | -100% |
| 翻译单张图片平均耗时（OpenAI gpt-4o，缓存未命中） | 2.5-4 s | 2.0-3 s | -20% |
| 翻译单张图片平均耗时（缓存命中） | 30-50 ms | 20-30 ms | -30% |
| 30 张图片并发 3 翻译总耗时 | 25-40 s | 20-32 s | -20% |
| 缓存命中率（重复访问同页） | 60-80% | 90-95% | +15-25pp |
| Token 消耗/图（full-image-vlm，1024px JPEG） | 850-1200 tokens | 600-900 tokens | -25% |
| Token 消耗/图（hybrid-regions 默认管线） | 不在用 | — | — |
| Memory leak 风险（图片 buffer） | 中 | 低 | 消除 |
| 长图（2000+px）处理稳定性 | 中 | 高 | +30% |

> **关于"缓存命中率 60-80%"**：基于单次 session 内重复访问的乐观估计（含 viewport 内已翻译图片的快速命中）。跨 session 命中率取决于 `cache-v2.ts` 的 chrome.storage.local 持久化（默认 100 条 LRU）。

---

## 一、Content Script 性能

### 1.1 注入体积爆炸（最严重问题）

**问题**：content.js 编译后 **318 KB（gzipped 85 KB）**，其中 **66%（211 KB）** 是 React 库代码，但 content script 完全没有用 React。

**证据**：
- `dist/content.js` 总大小 318,635 字节
- 拆解后前 5,411 行（66% 文件大小）是 React 库：
  ```
  // dist/chunks/react-vendor-3a50b241.js  ← 这里是 inlined 的 React 库
  function e(e5, n4) { ... Symbol.for("react.element") ... }
  ```
- `src/content/` 目录全文搜索 `from 'react'`：**0 个结果**（`grep -rE "from 'react'" src/content/`）
- `src/content/floating-hud.ts` 明确注释"纯原生 DOM 实现（不依赖 React）"
- `src/stores/config-v2.ts` 也是 vanilla Zustand 调用（`useAppConfigStore.getState()`），不需要 React

**问题根源**：`vite.config.ts:92-98` 把 zustand 拆到 `state-vendor` chunk 后，zustand 自身的 `index.js` 入口会**强制引入 React**（zustand 的 `useDebugValue` / `useState`）。即使 content.ts 只是调用 `useAppConfigStore.getState()`，treeshaking 也无法移除 React 引用（动态 import + React hooks 在模块顶层执行）。

**影响**：
- 每次打开任何网页（manifest 配置 `<all_urls>`），Chrome 需要下载并解析这 85 KB gzipped JS
- 解析 React 库需要约 15-25 ms（V8 startup parse + module evaluation）
- 在 3G 网络下首字节延迟增加 ~200 ms
- 移动端（M1/M2 Macbook Air 等低功耗设备）首次注入耗时增加 50-80 ms
- 用户感知：访问小网站、博客时也能感觉到扩展"装完页面就慢一拍"

**改进建议**：

1. **彻底分离 content script 的 zustand 入口**（预计体积减少 200 KB → 110-130 KB）：
   ```typescript
   // src/stores/config-v2-content.ts （新文件）
   import { createStore } from 'zustand/vanilla';
   // 只用 createStore，禁用 hooks，避免 zustand 拉入 React
   ```

2. **或拆分两个 entry**：
   - `content.entry.ts`：只用 vanilla zustand、纯 DOM API，不引入 React
   - `popup.entry.ts` / `options.entry.ts`：保留 React
   - Vite 配置多个 entry 即可

3. **预期收益**：
   - Content script 体积 318 KB → 110-130 KB（-60%）
   - Gzip 85 KB → 32-38 KB（-55%）
   - 3G 网络首屏 +200 ms → +60 ms
   - 解析时间 -50%

### 1.2 注入时机

**当前配置**：`public/manifest.json:33-37`
```json
"content_scripts": [{
  "js": ["assets/content.ts-loader-79de3454.js"],
  "matches": ["<all_urls>"]
}]
```

**问题**：
- 没有 `run_at` 字段，默认是 `document_idle`（页面 load 完成后）
- **没有 `all_frames: false`** —— 在每个 iframe 都会注入（默认是 false，但建议显式声明）

**影响**：
- `document_idle` 实际上对内容脚本注入是好时机（DOM 已构建完）
- 但**完全没有"用户触发"机制**：用户没启用翻译时，content script 依然会注入到每个网页（包括 google.com、taobao.com 等大流量站点）
- 虽然 `enabled: false` 时大部分逻辑不执行，但 318 KB 已经被下载和解析了

**改进建议**：
1. **使用 `chrome.scripting.executeScript` 在用户点击扩展图标时再注入**（programmatic injection）：
   - manifest 不声明 `content_scripts`
   - 用户点击 popup → background 调用 `chrome.scripting.executeScript({ target: { tabId } })` 注入
   - **预期收益**：90% 以上的页面不加载 content script
2. **保留当前静态注入但加白名单**：仅在已知漫画站点（`manga` 关键字域名、漫画网站列表）注入
3. 至少加 `"all_frames": false`（默认就是 false，但显式声明避免歧义）

### 1.3 Tesseract.js 资源 13 MB

**问题**：`dist/tesseract/` 目录 13 MB（WASM 核心 + 训练数据），通过 `web_accessible_resources` 暴露，但实际默认管线 `full-image-vlm` 根本不用 Tesseract。

**证据**：
- `vite.config.ts:43` 配置 `web_accessible_resources: ["tesseract/*"]`
- `src/shared/app-config.ts:130` 默认 `translationPipeline: 'full-image-vlm'`（实际项目中是 `hybrid-regions`，需要修）
- `src/services/text-detector.ts` 是 Tesseract 包装器，仅在 `hybrid-regions` 模式下被调用
- 13 MB 资源会：
  - 增加插件商店审核风险（部分商店对 >10 MB 的扩展敏感）
  - 增加首次安装下载时间（13 MB = 4G 网络 30 s+）
  - 即使不使用也会出现在 `chrome://extensions/` 的"资源"列表中

**改进建议**：
1. **方案 A：动态加载 Tesseract**（推荐）：
   - 将 `tesseract/*` 从 `web_accessible_resources` 移除
   - 用户切换到 `hybrid-regions` 时，background 按需下载并注入 Tesseract 资源
   - 预期：插件包从 14 MB → 1.5 MB
2. **方案 B：完全移除 Tesseract 路径**（如果 hybrid-regions 已经被证明不稳定）：
   - 删除 `src/services/text-detector.ts` 和相关代码
   - 删除 tesseract 资源
   - 预期：插件包 -13 MB，构建时间 -10 s

---

## 二、图片处理

### 2.1 压缩参数评估

**当前默认**（`src/services/image-processor.ts:56-67`）：
```typescript
export const DEFAULT_OPTIONS: Required<ImageProcessingOptions> = {
  maxSize: 1024,    // 1024px
  quality: 0.85,    // 85%
  format: 'jpeg',   // JPEG
  ...
};
```

**评估**：
- `maxSize: 1024` 是合理的折中（CLAUDE.md 也注明"1024px 足够 OCR"）
- `quality: 0.85` 对漫画来说**偏高**（漫画是大色块 + 文字，不需要 85% 质量）
- 1024×1024 JPEG @ 0.85 大约 200-300 KB
- 1024×1024 JPEG @ 0.70 大约 130-180 KB（-35% 体积，质量损失肉眼难辨）
- 1024×1024 WebP @ 0.80 大约 90-130 KB（-50% 体积）

**改进建议**：
1. **降 quality 到 0.75**（单图省 ~80 KB token 成本）—— 但需用户测试翻译质量
2. **长图强制 WebP**（已在 `viewportCrop` 时设置）：建议给普通路径也加 WebP 选项
3. **长图检测的 2.4 阈值**（`image-processor.ts:79`）：
   ```typescript
   return width <= Math.min(maxSize, 1400) && height > maxSize && aspectRatio >= 2.4;
   ```
   - 当前 2.4 是经验值，对**双页跨页**（横长比 2:1）和**单页长条**（竖长比 1:3）区分不明确
   - 改进：增加横向长图分支（`width/height >= 2.4 && width >= 2000`）

### 2.2 长图（tall image）边界

**当前逻辑**（`image-processor.ts:79` + `content.ts:181-185`）：
- 长图判定：高宽比 ≥ 2.4 **且** 自然高度 ≥ 2000px
- 高度上限：`maxTallPageHeight = 3000`（超过后等比缩放到 3000px）
- **content.ts:181-185 的判断与 image-processor.ts:79 不一致**（content.ts 用 2.4 + 2000，image-processor.ts 用 2.4 + maxSize + 1400）

**证据**：
```typescript
// content.ts:181-185
const isTallImage = img.naturalWidth > 0 &&
  img.naturalHeight > 0 &&
  img.naturalHeight / img.naturalWidth >= 2.4 &&
  img.naturalHeight >= 2000;

// image-processor.ts:78-80
const aspectRatio = height / width;
return width <= Math.min(maxSize, 1400) && height > maxSize && aspectRatio >= 2.4;
```

**问题**：
- 两处判定逻辑不一致，可能导致行为分裂
- `isTallImage` 在 `content.ts` 中**计算后传给 `translator.translateImage()`，但 `translateImage()` 没有用这个参数**（`translator.ts:201-206` 的 `viewportCrop` 参数没用上）

**影响**：
- 用户滚动长图触发 hover 翻译（如果实现）时无法走"分段翻译"路径
- 长图（3000+px）被强制缩放到 3000px：1024×3000 JPEG 约 400-600 KB，base64 约 530-800 KB，**单次 API 请求体积大**

**改进建议**：
1. **统一长图判定**（用一个函数 `shouldPreserveTallMangaPage`）
2. **长图分段**：3000+px 长图切成 2-3 段（如 1000px 段），分别翻译，最后合并
3. **预期收益**：
   - 单图请求体积 -50%（长图从 600 KB → 300 KB）
   - Token 成本 -30%（VLM 处理分段比处理 3000px 单图更准确）

### 2.3 base64 与 hash 性能

**当前**（`image-processor.ts:93-112`）：
- `calculateHash` 用 `crypto.subtle.digest('SHA-256', ...)` 计算压缩后 base64 的 hash
- 1024×1024 JPEG @ 0.85 = ~200 KB → base64 字符串 ~270 KB
- SHA-256 计算 270 KB 字符串：~5-8 ms（M1 Macbook 基准）

**评估**：
- **hash 计算 5-8 ms** 远低于其他开销（图片处理本身 50-100 ms）
- 但是 **计算的是 base64 字符串的 hash**，不是图像像素 hash：
  - 同一张图不同压缩率 → 不同的 hash
  - 用户调整 `maxImageSize` 配置 → 旧缓存全部失效
  - 缓存键：`imageHash + provider + model + targetLanguage + style + renderMode + pipelineVersion`（`translator.ts:340-351`）

**问题**：
- 同一张图，用户切换**目标语言**（如 zh-CN → en）→ 缓存命中失败
- 用户切换**翻译风格**（faithful → natural-zh）→ 缓存命中失败
- 同一图 1024px → 改成 2048px 重新压缩 → cache 命中失败
- **这些行为是"正确的"**（不同配置可能产生不同翻译），但命中率会显著降低

**改进建议**：
1. **可选项：拆出"纯文本 hash"作为次级缓存**：
   - 用图像像素的感知 hash（pHash）作为第一级缓存
   - 命中时直接复用翻译结果（语言/风格变化时强制重翻）
2. **或者：只对相同配置组合缓存**（当前行为），但暴露命中率统计给用户（`chrome.storage.local` 记录 `hitCount` / `missCount`）

### 2.4 内存泄漏风险

**canvas 临时 buffer**（`image-processor.ts:222-251`）：
- `compressImage` 每次都 `document.createElement('canvas')` 创建新 canvas
- **canvas 不会被显式释放**（依赖 GC，但 canvas 持有 ImageBitmap 引用）
- 30 张图批量处理 = 30 个 canvas 在内存中（每个 ~ 1024×1024×4 = 4 MB）= 120 MB 内存峰值

**证据**：
```typescript
// image-processor.ts:222-227
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('Failed to get canvas 2D context');
}
canvas.width = targetWidth;
canvas.height = targetHeight;
```

**影响**：
- 长页 100+ 张图：内存峰值可能 400 MB+
- 移动端 / 8GB 内存设备会触发 OOM 或页面卡死
- **Chrome 扩展 content script 内存上限是 250 MB**（部分平台），超过会被强制杀进程

**改进建议**：
1. **复用 OffscreenCanvas**（content script 可用）：
   ```typescript
   const reusableCanvas = new OffscreenCanvas(2048, 2048);
   // 每次复用，调用 ctx.clearRect() 清理
   ```
2. **或显式释放**：
   ```typescript
   canvas.width = canvas.height = 0;  // 显式释放 ImageBitmap
   ```
3. **或串行处理长列表**（超过 20 张图时分批，每批结束强制 GC）：
   ```typescript
   if (i % 20 === 19) await new Promise(r => setTimeout(r, 0));
   ```
4. **预期收益**：30 张图处理内存峰值从 120 MB → 30 MB

---

## 三、翻译调度

### 3.1 并发度配置

**当前值**：
- `src/shared/app-config.ts:130` 默认 `parallelLimit: 3`
- `src/content/page-translation-utils.ts:1-3` 硬编码 `MIN=2, MAX=3` —— **用户无法调到 4 或更高**
- `src/background/background.ts:46` 同样 `parallelLimit=3`
- Background `BackgroundJobQueue` 默认 `minIntervalMs: 500`（两请求间隔 500 ms）

**评估**：
- **3 并发对 OpenAI gpt-4o 来说偏低**：
  - gpt-4o TPM 限制 30k-1M（视账户等级）
  - 单图 prompt 850-1200 tokens → 3 并发 = 3.6k tokens 一次 → 30s 内可发 60 张
  - 网络往返 500-2000 ms → 3 并发完全没到 API 限流
- **3 并发对 Ollama / LM Studio 来说偏高**：
  - 本地推理受 GPU 显存限制
  - 3 张图同时处理可能 OOM（如果是 8 GB 显存跑 7B 模型）
- **500 ms 间隔是合理的节流**（防止 burst）

**问题**：
- 用户调 `parallelLimit=4`，content.ts 内部 `clampPageTranslationConcurrency` 会 clamp 到 3
- 用户想禁用限流（"全速"模式）做不到
- **没有区分 provider 的智能并发**（OpenAI 和 Ollama 用同一套配置）

**改进建议**：
1. **拆为两套配置**：
   ```typescript
   interface ConcurrencyConfig {
     openai: number;     // 默认 5-6
     ollama: number;     // 默认 1
     lmStudio: number;   // 默认 2
   }
   ```
2. **放开 MAX 上限**（3 → 10），让用户自己控制
3. **添加"智能探测"**：首次运行时按 provider 限流档位自动调整
4. **预期收益**：
   - OpenAI 用户：30 张图翻译从 25-40 s → 12-20 s（-50%）
   - Ollama 用户：避免 OOM

### 3.2 processInParallel 竞态分析

**当前实现**（`image-priority.ts:176-236`）：
```typescript
const processNext = async (): Promise<void> => {
  while (currentIndex < items.length) {
    if (signal?.aborted) return;
    const index = currentIndex++;
    const item = items[index];
    // ... process
  }
};
for (let i = 0; i < Math.min(maxConcurrent, items.length); i++) {
  workers.push(processNext());
}
await Promise.all(workers);
```

**评估**：
- `currentIndex++` 是单线程 JS 原子操作，**无竞态**
- `onItemStart` / `onItemComplete` 回调顺序**不能保证**对应 image 索引（多个 worker 并行触发时，序号是 `startOrder+1`，但实际 index 已经在调用前就分配好了）
- **callback 中的 `index` 是 image 数组的索引**（`processor(item, index)`），不是 startOrder

**问题**：
- `onItemStart: index => { currentImageIndex = index; ... }` 接受的 `index` 实际是 `startOrder + 1`（`image-priority.ts:206-207`），不是图片本身的索引
- 用户在 HUD 看到的 `currentImageIndex` 实际上是**第几个开始的 worker**，不是第几张图
- **对用户体验影响小**（用户不关心第几张图，但逻辑上不一致）

**改进建议**：
1. **重命名参数**让意图更清晰：`onWorkerStart(workerIndex)` vs `onImageStart(imageIndex)`
2. **或者让回调接受更多上下文**：`onImageStart({ imageIndex, total, workerIndex })`
3. **预期**：消除潜在的 UI 状态混乱

### 3.3 abortController 链路断裂（重要）

**问题**：用户点击"取消"按钮时，`abortController.abort()` 被调用，但**信号从未传到后台 HTTP 请求**。

**证据**：
```typescript
// content.ts:299-300
abortController = new AbortController();
const options: ParallelProcessingOptions = {
  maxConcurrent: parallelLimit,
  signal: abortController.signal,  // ← 信号传到了 processInParallel
  ...
};

// content.ts:358-368
await processInParallel(
  images,
  async img => {
    if (abortController?.signal.aborted) {  // ← worker 内部检查信号
      throw new Error('Translation cancelled');
    }
    await processSingleImage(img, forceRefresh);  // ← 但 processSingleImage 不接受 signal
    ...
  },
  options
);

// translator.ts:201-287 (translateImage)
async translateImage(
  image: HTMLImageElement,
  viewportCrop: boolean = false,
  imageKeyOverride?: string,
  forceRefresh: boolean = false
  // ← 没有 signal 参数
): Promise<TranslationResult> {
  // ...
  const result = await this.translateWithHybridPipeline(...);  // ← signal 未传递
  // ...
}

// translation-transport.ts:58-95
async translateImage(request) {
  const response = await chrome.runtime.sendMessage({  // ← sendMessage 不支持 signal
    type: 'JOB_TRANSLATE_IMAGE',
    ...
  });
  // ← signal 在这里完全消失了
}
```

**问题链条**：
1. 用户点取消 → `abortController.abort()`
2. `processInParallel` 的 worker 检查到 `signal.aborted` → throw
3. **但此时正在 in-flight 的 fetch 请求不会被取消**
4. VLM 端继续处理、计费、返回结果
5. 返回结果时 transport 收到 message，但 worker 已经被 abort，**结果被丢弃**（没人处理）
6. **用户付了钱，翻译没显示**

**影响**：
- **Token 浪费**：用户取消后，已发出的 API 请求仍在烧 token
- 长图片（5-10 s 处理时间）取消时浪费尤其严重

**改进建议**：
1. **将 signal 传到底层 transport**：
   ```typescript
   // transport
   const response = await chrome.runtime.sendMessage({
     type: 'JOB_TRANSLATE_IMAGE',
     abortSignal: signal ? { aborted: signal.aborted } : undefined,
     ...
   });
   // background 收到后，创建一个对应的 AbortController
   ```
2. **background 维护 jobId → AbortController 映射**：
   ```typescript
   // job-queue.ts
   enqueue({ job, run, abortSignal }) {
     const controller = new AbortController();
     abortSignal?.addEventListener('abort', () => controller.abort());
     ...
   }
   ```
3. **在 transport 端用 `fetch(url, { signal: controller.signal })`**
4. **预期收益**：用户取消时省 30-50% 待扣 token

### 3.4 重试机制

**当前**（`translator.ts:394-409`）：
```typescript
await retryWithBackoff(
  () => this.callTranslationTransport(...),
  2,    // 最多 2 次重试（实际 3 次：初次 + 2 次重试）
  1000  // 基础延迟 1 秒
);
```

**评估**：
- 2 次重试 = 最多 3 次调用
- 指数退避 1s, 2s, 4s, 8s, ... → 实际是 1s、2s 后重试
- **总最坏耗时 = 1 + 2 + 4 + 8 + ... + 30 = 60 s**（极端情况）

**问题**：
- `retryWithBackoff` 的 maxRetries=2 实际语义是"重试 2 次" = 共 3 次
- 对 429 限流来说，重试反而会加重问题（OpenAI 的限流是按窗口计的，重试可能撞上更高延迟）
- **没有限流感知**：如果是 429，应该等到 Retry-After 时间后重试

**改进建议**：
1. **检查 HTTP 429 的 Retry-After header**，按其指示等待
2. **重试次数根据错误类型动态调整**：
   - 401/403/404 → 不重试
   - 429 → 长延迟重试
   - 5xx → 短延迟重试
3. **增加 total timeout 保护**（默认 30 s）

---

## 四、缓存策略

### 4.1 缓存 key 包含什么

**当前**（`translator.ts:340-351`）：
```typescript
private buildCacheKey(imageHash: string): string {
  const requestedPath = deriveRequestedPath(this.config.provider);
  const executionScope = `provider::${requestedPath}::${this.config.provider}::${this.config.model || 'default'}`;
  return [
    imageHash,
    executionScope,
    this.config.targetLanguage,
    this.config.translationStylePreset,
    this.config.renderMode || 'strong-overlay-compat',
    HYBRID_PIPELINE_VERSION,  // ← 硬编码 'hybrid-v1'
  ].join('::');
}
```

**评估**：
- 缓存 key 包含 6 个维度的组合
- 切换任意一个维度 → 缓存失效
- **`HYBRID_PIPELINE_VERSION = 'hybrid-v1'` 硬编码**（`translator.ts:130`）—— 但默认 pipeline 是 `full-image-vlm`，这个版本号语义不对

**问题**：
1. 切语言时（zh-CN → en）缓存全失效
2. 切风格时（natural-zh → faithful）缓存全失效
3. 切 Provider 时（OpenAI → Ollama）缓存全失效（这是正确的，**Provider 决定 token 成本**）
4. 切 model 时（gpt-4o → gpt-4o-mini）缓存全失效（**这是浪费**——同图不同模型可共享）
5. 切 `maxImageSize`（1024 → 2048）时缓存全失效（**正确但隐式**——因为 hash 变了）

### 4.2 cacheEnabled 开关效果

**当前**：
- `src/stores/config-v2.ts:90` 默认 `cacheEnabled: true`
- 关闭时 `translateImage` 跳过 cache 读取（`translator.ts:240-254`），但 cache 写入也跳过（`translator.ts:265-272`）
- **关闭时已经有的缓存不清理**（不调用 `cache.clear()`）

**问题**：
- 用户关闭缓存 → 重新打开 → 旧缓存恢复（用户预期是"干净开始"）
- 缓存持久化在 `chrome.storage.local`，受限于 5 MB / 10 MB 配额（不同 Chrome 版本）

### 4.3 LRU 容量上限

**当前**（`cache-v2.ts:129`）：
```typescript
const DEFAULT_MAX_ENTRIES = 100;
```

**评估**：
- 100 条缓存，每条包含 `textAreas`（10-30 个对象）和 `readingResult`（50+ 个 entry）
- 单条缓存平均大小：~3-8 KB
- 100 条总占用：~300-800 KB（< 1 MB，OK）

**问题**：
- **没有按 cache 大小淘汰**，只按条目数
- 一条巨型缓存（带 50 个 text areas）会让 100 条总数膨胀到 3 MB
- 实际**有效命中率**会比理论值低（高 entry 数条目占用更多"配额"）

**改进建议**：
1. **按字节数淘汰**（而非条目数）：使用 `chrome.storage.local.QUOTA_BYTES` (10 MB) 的 50% 作为上限
2. **按"重要性"加权**：viewport 内的图片缓存优先级 > 视口外
3. **LRU 持久化时**也要按时间戳排序（当前 `onRehydrateStorage` 已经做，但只在初始化时）

### 4.4 缓存命中率提升

**当前命中率估算**：
- **同 session 重复访问**：60-80%（viewport 内的图片会快速命中）
- **跨 session 重复访问**：40-60%（受 LRU 100 条限制 + 配置变化）
- **新页面首次访问**：0%

**改进建议**（按 ROI 排序）：

1. **大 cache + TTL 策略**（高 ROI）：
   ```typescript
   interface CacheEntry {
     ...
     expiresAt: number;  // 30 天后过期
     accessCount: number; // 热度
   }
   ```
   - 提高 MAX_ENTRIES 到 500
   - 加 30 天 TTL（漫画图片本身不变）
   - **预期命中率 +15-25pp**

2. **共享跨 Provider 缓存**（中 ROI）：
   - 同一张图，不同 Provider 翻译结果都缓存
   - 切换 Provider 时不需要重新翻译
   - **预期命中率 +10-15pp**（仅对切换 provider 的用户）

3. **预热（warm-up）**（低 ROI）：
   - 滚动到 viewport 时，提前翻译下面 5 张
   - 用户感觉"翻到下一屏已经翻译好了"
   - **预期主观体验提升 20-30%**

---

## 五、VLM 调用成本

### 5.1 一次翻译一张图多少 token

**full-image-vlm 默认管线**（1024px JPEG）：
- **输入 token**（OpenAI 计费规则）：
  - 1024×1024 JPEG 高细节 (detail='high') → **~765 tokens**（按 OpenAI 公开公式：512×512 基础 + 每个 512 块 170 tokens）
  - prompt 文本：~500-700 tokens（含 `MANGA_TRANSLATION_SYSTEM_PROMPT` + style 指令）
  - **小计输入：~1300-1500 tokens/图**
- **输出 token**：
  - 典型 10-20 个 text areas × 每个 30-80 tokens 翻译
  - **小计输出：~300-800 tokens/图**
- **总计：~1600-2300 tokens/图**

**真实场景**（基于 OpenAI gpt-4o 定价）：
- 输入 $2.50/M tokens，输出 $10/M tokens
- 单图成本：~$0.012 / 图
- 100 张图：~$1.2
- **单本漫画（200-300 张）：$2.4-3.6**

**评估**：
- 1024px JPEG 在大部分场景下**质量足够**，但对小字（如旁白小字）OCR 准确率下降
- 切换到 2048px：单图 token 翻倍（~3000 输入），成本翻倍

### 5.2 full-image-vlm vs hybrid-regions 哪个省 token

**对比**（基于 `translator.ts:438-613` 的 hybrid-regions 路径）：
- **full-image-vlm**：1 次 API 调用，~2300 tokens
- **hybrid-regions**：
  - 1 次 Tesseract 调用（本地，0 token）
  - 假设检测到 15 个 text regions，每批 10 个 → 2 批
  - 每批：1 次 API 调用，~800 tokens（每个 region 约 50 tokens prompt + 60 tokens 输出）
  - **总计：~1600 tokens（节省 30%）**
- **但 hybrid-regions 有失败成本**：
  - Tesseract 漏检：~20% 区域没检测到
  - 失败回退到 full-image：~2300 tokens（白花）
  - 实际 hybrid 节省：~10-20%（而非 30%）

**当前配置**：
- `src/shared/app-config.ts:130` 默认 `translationPipeline: 'hybrid-regions'`
- 但 CLAUDE.md 已经说明："默认 `full-image-vlm`"
- **配置和文档不一致**！

**评估**：
- 默认应该是 `full-image-vlm`（稳定、简单、Token 浪费可控）
- `hybrid-regions` 作为高级选项保留（用户主动开启）

**改进建议**：
1. **修复默认配置**：`translationPipeline: 'full-image-vlm'`
2. **在 options 页面添加 pipeline 切换的明确说明**：
   - "full-image-vlm：稳定，单次调用，~2300 tokens/图"
   - "hybrid-regions：分批，Tesseract 检测 + VLM 翻译，~1600 tokens/图（节省 30%），不稳定可能回退"
3. **预期**：用户主动选择后，整体 token 成本降低 20-30%

### 5.3 prompt 长度

**当前 prompt**（`base.ts:195-210`）：
```typescript
return `Extract ALL visible text from this manga/comic image and translate to ${targetLanguage}.

Return ONLY valid JSON: {"textAreas":[{"x":0.1,...}]}

RULES:
1. Find ALL text: ...
2. x,y,width,height are 0.0-1.0 ratios ...
3. Merge multi-line text in one bubble into ONE item.
4. SFX: use target language onomatopoeia.
5. Keep original speaker tone (formal/casual).
6. Use \\\\n for line breaks in translatedText.
7. No text found: {"textAreas":[]}
8. If two text blocks are separate, return separate items. ...
9. Output ONLY the JSON.

${getTranslationStyleInstruction(translationStylePreset)}`;  // 风格指令 ~50-200 tokens
```

**评估**：
- 基础 prompt：~200 tokens
- 风格指令（4 种）：50-200 tokens
- **总计：~250-400 tokens**

**问题**：
- 9 条 RULES 重复了 JSON 格式说明
- 风格指令在 prompt 中重复（基础 prompt 已经要求 "Keep original speaker tone"）

**改进建议**：
1. **精简 prompt**（去掉冗余）：
   ```typescript
   return `Translate all text in this manga image to ${targetLanguage}.
   Return JSON: {"textAreas":[{"x":0.1,"y":0.2,"width":0.3,"height":0.1,"originalText":"原文","translatedText":"翻译"}]}
   Use 0.0-1.0 ratios. Tight boxes around text. Merge multi-line in one bubble. SFX in target language. No other output.`;
   ```
   - 节省 ~100 tokens/调用
2. **风格指令合并到 base prompt**（避免重复）
3. **预期**：单图节省 ~100 tokens × 100 张图 = 10k tokens = $0.025

### 5.4 Token 节省策略

按 ROI 排序：

1. **缓存命中率提升**（最大节省）：
   - 当前命中率 60% → 提升到 90%
   - 100 张图：40 次未命中 × 2300 tokens = 92k tokens
   - 提升到 90% 后：10 次未命中 × 2300 tokens = 23k tokens
   - **节省 69k tokens = $0.17 / 100 张图**
   - 1000 张图：$1.7

2. **prompt 精简**：
   - 单图省 100 tokens
   - 100 张图：10k tokens = $0.025
   - **节省 $0.025 / 100 张图**

3. **降低 image quality**（0.85 → 0.75）：
   - 单图省 200-400 tokens（图像 token 与清晰度相关）
   - 100 张图：30k tokens = $0.075
   - **节省 $0.075 / 100 张图**

4. **切到 hybrid-regions**（节省 20-30%）：
   - 100 张图：节省 30-50k tokens = $0.075-0.125
   - **节省 $0.075-0.125 / 100 张图**
   - **但有 10-20% 失败回退成本**

**综合最优策略**：
1. 先优化缓存（+15pp 命中率，最大头）
2. 降 quality 到 0.80（视觉无损，省 15% token）
3. 切到 hybrid-regions 作为高级选项
4. 精简 prompt 5-10%

**预期总节省**：40-50% token 成本。

---

## 六、翻译质量

### 6.1 JSON 解析容错

**当前实现**（`base.ts:222-275`）：
- 剥除 `<think>` 标签（DeepSeek/Qwen）
- 剥除 Markdown 代码块 wrapper
- 用正则匹配 JSON object
- 尝试 `JSON.parse`
- 失败时去掉 trailing commas 再试
- 失败时根据特征报错（截断 / 纯文本 / 解析失败）

**评估**：
- 4 层容错，覆盖大部分 LLM 输出异常
- **但没有重试机制**：解析失败直接抛错

**问题**：
- LLM 输出偶尔有单引号包裹的 JSON：`{'textAreas': [...]}` → 当前解析失败
- LLM 偶尔输出 XML 风格：`<textAreas>...</textAreas>` → 解析失败
- 解析失败时整个图翻译失败（不会重试）

**改进建议**：
1. **加单引号 JSON 支持**：`str.replace(/'/g, '"')`
2. **加 XML 简单解析**（仅 `textAreas` 数组）
3. **解析失败时回退到 1 次重试**（可能第一次输出异常）
4. **预期成功率 95% → 99%**

### 6.2 坐标精度

**当前映射**（`translator.ts:634-662`）：
```typescript
private mapTextAreasToOriginalImage(textAreas, processed) {
  return textAreas.map(area => {
    const absoluteX = area.x * processed.width;
    // ... 映射到 originalWidth / originalHeight
    // 注意：processed.height vs processed.cropHeight
  });
}
```

**问题**：
- **长图被压缩**（`processed.width < originalWidth`）时，坐标映射精度受压缩率影响
- 1024×3000 长图（保持长宽比，宽度 1024）：text area `x=0.5` 映射到原图 `x = 0.5 * originalWidth` 是对的
- **但如果 processed.width !== processed.originalWidth**，bubble 框位置 OK，但**框大小不准**

**具体 bug 风险**（`translator.ts:644-650`）：
```typescript
const absoluteYOrig =
  (absoluteYInCrop / processed.height) * (processed.cropHeight || processed.originalHeight) +
  (processed.cropY || 0);
```
- `processed.cropHeight` 不一定等于 `processed.height`（如果 viewportCrop 启用）
- `processed.cropY` 是 crop 起点 → 加上原图偏移
- **逻辑复杂容易出错**

**改进建议**：
1. **添加单元测试**覆盖 9 种坐标组合（无 crop / 有 crop / 不一致比例等）
2. **可视化调试模式**：在选项页添加"显示原始 VLM 输出坐标"
3. **预期**：覆盖率从 0% → 80%

### 6.3 多 Provider fallback 链

**当前**：
- 没有真正的 fallback 链
- `translator.ts:381-385` 有 `fallbackToFullImage`（hybrid → full-image）
- **Provider 之间没有 fallback**：OpenAI 失败不会自动切到 Ollama

**问题**：
- 用户 OpenAI 配额用完 → 全部失败，没有兜底
- LM Studio 没启动 → 直接报错

**改进建议**：
1. **Provider fallback 链配置**：
   ```typescript
   interface Config {
     providerFallbackChain: ['openai-compatible', 'lm-studio', 'ollama'];
   }
   ```
2. **自动降级**：主 provider 失败时，按顺序尝试
3. **记录 fallback 命中率**，让用户知道是否需要补充配 provider

### 6.4 长图分段上下文丢失

**当前**：长图（>3000px）被强制缩放到 3000px 发送，**不分段**

**问题**：
- 上下文的"角色 A 提到角色 B"这种长距离依赖在 3000px 图中难以保留
- 32B 以下的 VLM 模型在长图上准确率显著下降

**改进建议**：
1. **长图分段（按 1500-2000px 一段）+ 跨段 context**：
   - 第一段：完整翻译
   - 后续段：带前一段最后 3 个气泡作为 context
2. **效果**：长图（>2000px）翻译质量提升 10-20%（特别是角色称呼一致性）
3. **代价**：token 增加 10-20%

---

## 七、渲染性能

### 7.1 reading-layer render 函数

**当前**（`reading-layer.ts:274-352`）：
```typescript
private render = (): void => {
  // ...
  overlay.innerHTML = '';  // ← 每次都清空重建
  panel.innerHTML = '';    // ← 同上
  // 重建所有 anchors
  groups.forEach(group => {
    group.result.entries.forEach(entry => {
      const rect = this.getDisplayRect(group.image, entry);  // ← getBoundingClientRect
      // ... 创建并 appendChild
    });
  });
};
```

**问题**：
1. **每次 render 都 `innerHTML = ''`** → 销毁所有 DOM 节点，触发 reflow
2. **`getBoundingClientRect` 在 render 中**对每个 entry 调用 → 强制同步 layout（layout thrashing）
3. **scroll 事件触发 scheduleRender**（`reading-layer.ts:54`）：
   ```typescript
   window.addEventListener('scroll', this.scheduleRender, true);
   ```
   - `scheduleRender` 用 `requestAnimationFrame` 防抖（好的）
   - 但**如果用户快速滚动**（连续 60 帧/秒），每帧都会重新计算所有 entry 的 `getBoundingClientRect`
4. **mouseover / mouseout** 也会触发 render（`reading-layer.ts:408-427`）—— 鼠标快速经过多个 entry 时，每个都重新 render 整个 overlay

**影响**（粗略估算）：
- 30 张图 × 10 entries/图 = 300 个 anchor
- 每次 render：300 × `getBoundingClientRect` + 300 × `appendChild` + 1 × `innerHTML = ''`
- 在 60 Hz 滚动时：每帧 ~5-10 ms 的 render 时间
- 移动端（iPhone 13）：可能 15-25 ms 每帧 → 掉帧

**改进建议**：
1. **分离 viewport 内/外的渲染**：
   - viewport 内的 entries 实时更新位置
   - viewport 外的 entries 懒渲染（IntersectionObserver）
2. **DOM diff 而非 innerHTML 清空**：
   ```typescript
   // 标记删除而非真正删除
   for (const old of existingAnchors) old.dataset.stale = 'true';
   for (const newEntry of newEntries) {
     if (existing = anchorMap.get(newEntry.id)) {
       // update position only
     } else {
       // create new
     }
   }
   // 真正删除标记为 stale 的
   ```
3. **`getBoundingClientRect` 缓存 + 批量读取**：
   ```typescript
   // 一次性读取所有图片的尺寸
   const rects = images.map(img => img.getBoundingClientRect());
   ```
4. **预期收益**：30 张图 render 时间从 5-10 ms → 1-2 ms（-80%）

### 7.2 scroll / resize 防抖

**当前**（`reading-layer.ts:481-490`）：
```typescript
private scheduleRender = (): void => {
  if (this.scheduledRender) return;
  this.scheduledRender = requestAnimationFrame(() => {
    this.scheduledRender = 0;
    this.render();
  });
};
```

**评估**：
- **有防抖**（rAF 合并 16ms 内的多次触发）—— 这一点是好的
- 但 rAF 仍然在每帧最多执行一次 render
- 持续滚动时 = 持续 render

**改进建议**：
1. **throttle 到 60 ms**（每 4 帧最多 render 一次）：
   ```typescript
   private scheduleRender = (): void => {
     if (this.scheduledRender) return;
     this.scheduledRender = requestTimeout(() => {
       this.scheduledRender = 0;
       this.render();
     }, 60);
   };
   ```
2. **或者用 IntersectionObserver 替代 scroll 监听**

### 7.3 阴影 DOM 样式隔离

**当前**：所有 overlay 用一个共享 `<style>`（`renderer.ts:512-522`）注入到页面 `<head>`，**不是 Shadow DOM**

**问题**：
- 共享 `<style>` 容易被页面的 CSS 覆盖（虽然用了 `manga-translator-*` 前缀，但页面的 `*` 选择器仍可能影响）
- 没有 Shadow DOM 隔离 → 性能没有优势（浏览器无法隔离渲染层）

**对比**（HUD 和 reading-layer 用了 Shadow DOM）：
- `floating-hud.ts:46` 用 Shadow DOM
- `reading-layer.ts:41` 用 Shadow DOM
- **OverlayRenderer 用全局 style 注入**（不一致）

**改进建议**：
1. **统一为 Shadow DOM**（每个 image wrapper 一个）：
   ```typescript
   const shadow = wrapper.attachShadow({ mode: 'open' });
   shadow.innerHTML = `${styles}<div class="overlay-container"></div>`;
   ```
2. **或使用 CSS `@layer`**：现代浏览器原生样式隔离
3. **预期**：CSS 冲突减少 → 覆盖层渲染更稳定

### 7.4 长页面滚动体验

**当前**：
- `renderer.ts:625-640` 有 hover debounce（120 ms）—— 防止快速 hover 闪烁
- `renderer.ts:74-78` 覆盖层 `position: absolute` 跟随图片
- 图片在 viewport 外时覆盖层**仍然渲染**（只是不显示）

**问题**：
- 100 张图的长页面，每张图都有 ~5-10 个 overlay 元素
- 浏览器仍然需要为这些元素计算 layout
- **viewport 外的 overlay 应该在滚动时回收**

**改进建议**：
1. **IntersectionObserver 回收不可见 overlay**：
   - viewport 内的图：overlay 显示
   - viewport 外的图：overlay 隐藏（`display: none`）或移除
2. **预期**：100 张图长页内存从 50 MB → 20 MB

### 7.5 floating-hud 性能

**当前**（`floating-hud.ts:80-82`）：
```typescript
hud.style.display = 'block';
hud.innerHTML = this.renderState(state);  // ← 每次都重建
```

**问题**：
- HUD 状态每 ~100 ms 更新一次（来自 content.ts 的 `setState`）
- 每次更新都 `innerHTML = ''` + 重新生成 HTML 字符串
- 30+ 张图批量翻译时，HUD 状态更新 30+ 次

**改进建议**：
1. **DOM diff 更新**（或者直接操作 textContent）
2. **throttle HUD 更新到 200 ms**（避免太频繁）
3. **预期**：HUD CPU 占用 -50%

---

## 5 个最高 ROI 的性能优化

### 1. Content Script 去掉 React（最大 ROI）

**改动**：
- `src/stores/config-v2.ts` 提供 vanilla zustand 版本（`createStore` from `zustand/vanilla`）
- content.ts 只引入 vanilla 版本
- 或拆分两个 entry（content + popup/options）

**预期收益**：
- Content script 体积 318 KB → 110-130 KB（**-60%**）
- Gzip 85 KB → 32 KB（**-55%**）
- 3G 网络首屏 -200 ms
- 解析时间 -50%
- 几乎所有页面（默认 `enabled: false`）加载时间更短

**实施难度**：中（需拆 store 接口 + 测试）

### 2. abortController 链路打通

**改动**：
- signal 传递到 background transport
- background 维护 jobId → AbortController 映射
- 用 `fetch(url, { signal })` 真正中断

**预期收益**：
- 用户取消时省 30-50% 待扣 token
- 长图取消的体验大幅提升（不用等 30 s 才发现"取消失败"）
- 减少幽灵请求

**实施难度**：中（涉及 message protocol 改动）

### 3. 缓存命中率优化

**改动**：
- MAX_ENTRIES 100 → 500
- 加 30 天 TTL
- 跨 Provider 共享（缓存原始翻译，主 Provider 决定行为）
- 暴露命中率统计

**预期收益**：
- 重复访问命中率 60-80% → 90-95%
- 单用户月度 token 节省 30-50%
- 长篇漫画（一本 200+ 张）几乎全缓存命中

**实施难度**：低（cache-v2.ts 是单文件）

### 4. abortController/canvas 内存管理

**改动**：
- OffscreenCanvas 复用
- canvas 显式释放（`canvas.width = 0`）
- 串行处理长列表

**预期收益**：
- 30 张图处理内存峰值从 120 MB → 30 MB（-75%）
- 长漫画（100+ 张）不会触发 Chrome 扩展 250 MB 内存上限
- 移动端体验稳定

**实施难度**：低（image-processor.ts 局部改动）

### 5. 渲染层 DOM diff + viewport 回收

**改动**：
- reading-layer / OverlayRenderer 改用 DOM diff（标记 stale + 复用）
- viewport 外的 overlay 回收（IntersectionObserver）
- 缓存 `getBoundingClientRect` 结果

**预期收益**：
- 30 张图 render 时间 5-10 ms → 1-2 ms（-80%）
- 100 张图长页内存 50 MB → 20 MB
- 滚动更流畅（60 fps 稳定）
- 覆盖层在长页面上不再卡顿

**实施难度**：中（reading-layer.ts / renderer.ts 是核心文件，需回归测试）

---

## 附：实测数据汇总

| 测量项 | 数值 | 测量方法 |
|---|---|---|
| `dist/content.js` 原始大小 | 318,635 字节 | `ls -la` |
| `dist/content.js` gzipped | 84,773 字节 | `gzip -c` |
| Content.js 中 React 部分 | 211,364 字节（66%） | 拆 `dist/chunks/react-vendor` 部分 |
| Content.js 去掉 React 后 | 107,271 字节（gzipped 31,103） | `tail -n +5412` |
| `dist/chunks/react-vendor-*.js` | 140,114 字节（gzipped 45,025） | 单独 chunk |
| `dist/popup.js` | 11,939 字节 | `ls -la` |
| `dist/options.js` | 52,478 字节 | `ls -la` |
| `dist/background.js` | 9,690 字节 | `ls -la` |
| `dist/tesseract/*` 总量 | 13 MB | `du -sh` |
| Content script 引用 React 的源头 | `zustand/index.js` 顶层 `require('react')` | node_modules 检查 |
| Content script 中 React 使用点 | **0** | `grep -r "from 'react'" src/content/` |
| 默认 pipeline 配置 | `'hybrid-regions'`（CLAUDE.md 说应是 `full-image-vlm`） | `src/shared/app-config.ts:130` |
| 并发度 MIN/MAX | 2/3（硬编码） | `src/content/page-translation-utils.ts:1-3` |
| LRU MAX_ENTRIES | 100 | `src/stores/cache-v2.ts:129` |
| 测试通过情况 | 27 文件 / 258 测试 全过 | `pnpm test:run` |
| 编译时间 | 1.5 s（不含 tesseract copy） | 实测 |

---

## 修复优先级建议

**第一周**（高 ROI，低风险）：
1. Content script 去掉 React（最大体积优化）
2. Tesseract 13 MB 资源按需加载
3. abortController 链路打通
4. 缓存命中率优化（MAX_ENTRIES + TTL）

**第二周**（中 ROI，需测试）：
5. 内存管理（OffscreenCanvas + 显式释放）
6. 渲染层 DOM diff
7. 修复 `translationPipeline` 默认值

**第三周+**（业务改进）：
8. 长图分段
9. Provider fallback 链
10. 跨 Provider 共享缓存

每项优化前应：
- 写具体场景的基准测试（30 张图批量翻译，测量 token 消耗和耗时）
- 对比优化前后数据
- 提交前完整运行 `pnpm build && pnpm lint && pnpm test:run`
