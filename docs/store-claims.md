# 对外承诺 → 代码锚点对照表

这张表是商店文案、隐私政策与审核备注的**事实底稿**。

背景：上架文案是对外申报材料，写进去的每一条能力都会被审核员当作承诺。仓库里
已经犯过两次同类错误——v2.0.0 删掉了虚构的「文字擦除」功能，v2.0.3 之前又出现
了「超长图自动拼接」这种换个说法重来的承诺。靠人读文档是抓不住这类问题的，
所以每一条承诺都要在这里登记一个代码锚点，交给 `scripts/check-store-claims.mjs`
机器校验。

## 表的格式

| 列 | 含义 |
| --- | --- |
| 承诺 | 对外做出这句承诺的事实本身（人读） |
| 代码锚点 | 支撑它的代码位置，格式 `文件路径:符号名` 或 `文件路径:行号`；多个锚点用 `;` 分隔 |
| 文案 | 这条承诺在哪些文档里出现，以及它们必须包含的原文片段。格式 `文档: 原文片段`，多个用 `;` 分隔。片段 `yes` 表示"直接用承诺列的原文" |

脚本做两件事：

1. **正向**：每个锚点的文件必须存在，锚点指向的符号（或那一行）必须还在。
   符号被改名或删掉 → 这条承诺失去支撑 → 构建失败。
2. **反向**：每个标记了文档的承诺，其原文片段必须仍出现在那份文档里。
   文档删掉了这句话 → 文案与事实脱节 → 构建失败。

文档键：`listing` = `docs/store-listing-zh.md`，`privacy` = `docs/privacy-policy.md`，
`review` = `docs/store-review-notes-zh.md`，`readme` = `README.md`，
`release` = `docs/chrome-web-store-release.md`。

## 对照表

| 承诺 | 代码锚点 | 文案 |
| --- | --- | --- |
| 译文叠加在原图对应位置，不跳转页面 | `src/services/renderer.ts:OverlayRenderer`; `src/services/translator.ts:mapTextAreasToOriginalImage` | listing: 把译文渲染回原图对应位置; listing: 不会跳转到另一个页面 |
| 覆盖层默认接近不透明，原文气泡区域会被遮住 | `src/services/renderer.ts:rgba(240, 240, 235, 0.94)`; `src/services/renderer.ts:this.style.backgroundColor` | listing: 覆盖层默认是接近不透明的浅色底; release: an almost-opaque panel |
| 覆盖层底色可在设置里调整 | `src/components/Options/OptionsApp.tsx:setOverlayStyle` | listing: 覆盖层底色可在设置里调整 |
| 长条条漫（webtoon）切片处理 | `src/services/translator.ts:translateImageTiled`; `src/services/translator.ts:computeTiles`; `src/services/translator.ts:translateTile` | listing: 长条条漫（webtoon）会切片处理; release: for the tiled pipeline |
| 视觉模型零文字时用内置 Tesseract OCR 兜底（Ollama 除外） | `src/services/translator.ts:translateWithHybridPipeline`; `src/services/translator.ts:this.config.provider !== 'ollama'`; `src/services/translator.ts:translateRegionsWithHybrid` | listing: 内置 Tesseract OCR 可继续工作（使用 Ollama 时不启用该兜底） |
| OCR 语言包从 jsdelivr 公开 CDN 下载 | `src/services/text-detector.ts:jsdelivr`; `src/services/text-detector.ts:workerPath`; `src/services/text-detector.ts:corePath` | listing: OCR 语言包在首次使用 OCR 兜底时从 jsdelivr 公开 CDN 下载; privacy: the official `@tesseract.js-data` package on jsdelivr |
| 翻译缓存：相同图片不重复请求 | `src/services/translator.ts:buildCacheKey`; `src/stores/cache-v2.ts:CACHE_STORAGE_KEY` | listing: 翻译缓存：相同图片不重复请求; review: 启用缓存 |
| 右键菜单「翻译当前页面」与「翻译这张图片」 | `src/background/background.ts:CONTEXT_MENU_TRANSLATE_PAGE`; `src/background/background.ts:CONTEXT_MENU_TRANSLATE_IMAGE`; `src/background/background.ts:翻译这张图片` | listing: 「翻译当前页面」/「翻译这张图片」; review: 「翻译当前页面」或「翻译这张图片」 |
| 键盘快捷键翻译 / 重译 / 清覆盖层 / 开关阅读面板 | `src/background/commands.ts:COMMAND_SHORTCUTS`; `src/background/commands.ts:resolveCommandAction`; `public/manifest.json:translate-page`; `public/manifest.json:clear-overlays` | listing: Ctrl/⌘+Shift+Y 翻译当前页、+X 忽略缓存重译、+E 清除覆盖层、+S 开关译文阅读面板; review: Ctrl/⌘+Shift+Y 翻译当前页、+X 忽略缓存重新翻译 |
| 译文阅读面板按阅读顺序列出全部译文并可跳转 | `src/content/reading-panel.ts:ReadingPanel`; `src/content/reading-anchors.ts:ReadingAnchors` | listing: 译文阅读面板：页面右侧列出本页所有译文; readme: Reading mode side panel |
| 弹窗写明当前页面是否正在自动翻译，并可一键停掉 | `src/components/Popup/popup-state.ts:describeAutoTranslate`; `src/components/Popup/PopupApp.tsx:handleStopAutoTranslate`; `src/content/content.ts:autoContinueArmed` | listing: 自动翻译状态一目了然; readme: The popup says so in as many words |
| 默认端点是 MiniMax（api.minimaxi.com，模型 MiniMax-M3） | `src/shared/app-config.ts:https://api.minimaxi.com/v1`; `src/shared/app-config.ts:MiniMax-M3`; `src/shared/app-config.ts:DEFAULT_OPENAI_COMPATIBLE_CONFIG` | listing: 安装后的默认端点为 MiniMax（https://api.minimaxi.com/v1，模型 MiniMax-M3）; privacy: the endpoint the extension ships with by default |
| Ollama 默认 http://localhost:11434 | `src/shared/app-config.ts:http://localhost:11434`; `src/shared/app-config.ts:DEFAULT_OLLAMA_CONFIG` | listing: Ollama（本地，默认 http://localhost:11434）; privacy: All data stays on your local machine (`localhost:11434`) |
| LM Studio 默认 http://localhost:1234/v1 | `src/shared/app-config.ts:http://localhost:1234/v1`; `src/shared/app-config.ts:DEFAULT_LM_STUDIO_CONFIG` | listing: LM Studio（本地，默认 http://localhost:1234/v1） |
| 使用本地服务商时图片完全不离开本机 | `src/shared/app-config.ts:http://localhost:11434`; `src/shared/app-config.ts:http://localhost:1234/v1` | listing: 若希望图片完全不离开本机，请使用本地服务商（Ollama 或 LM Studio）; privacy: the images never leave your machine at all |
| API Key 只存在本机 chrome.storage.local，不随 Google 账号同步 | `src/stores/config-v2.ts:chromeStorage`; `src/stores/config-v2.ts:chrome.storage.local`; `src/utils/crypto.ts:obfuscateAllApiKeys` | listing: API Key 仅保存在本机 chrome.storage.local，不随 Google 账号同步; privacy: Stored locally in your browser using Chrome's `storage.local` API (not synced across devices via your Google account); readme: API keys entered in Settings live in `chrome.storage.local` only |
| 明文密钥不进 content script，网页里运行的脚本拿不到它 | `src/shared/app-config.ts:apiKey: ''`; `src/shared/env-credentials.ts:ENV_CREDENTIALS`; `scripts/check-release-consistency.mjs:checkCredentialBoundary`; `scripts/check-release-consistency.mjs:checkNoCredentialsInContentScript` | privacy: The plaintext key is held only by the extension's service worker; review: 明文密钥不进入 content script 的导入闭包 |
| 密钥是 XOR 混淆，不是加密 | `src/utils/crypto.ts:obfuscateApiKey`; `src/utils/crypto.ts:SALT` | privacy: obfuscation, not encryption; review: 这是混淆而非加密; readme: obfuscated, not encrypted |
| 开发者不收集、不接收、不存储任何用户数据 | `src/stores/config-v2.ts:chrome.storage.local`; `src/stores/cache-v2.ts:chrome.storage.local`; `src/stores/usage-store.ts:chrome.storage.local` | listing: 开发者不收集、不接收、不存储任何用户数据; privacy: The extension developer does not collect, receive, or store any user data; review: 本扩展的开发者不收集、不接收、不存储任何用户数据 |
| 没有统计、遥测、崩溃上报与广告 SDK | `src/stores/usage-store.ts:chrome.storage.local`; `src/stores/usage-store.ts:按天聚合` | listing: 没有统计、没有遥测、没有崩溃上报，没有广告 SDK; privacy: no analytics, no tracking scripts, no telemetry, and no crash reporting; review: 无统计、无遥测、无崩溃上报、无广告 SDK |
| 出站请求只有三类 | `src/utils/http-client.ts:httpRequest`; `src/background/image-fetch-guard.ts:fetch`; `src/services/text-detector.ts:jsdelivr` | privacy: The extension makes outbound requests to exactly three kinds of destination; review: 出站请求仅三类 |
| 页面图片由浏览器直连该页自己的图床 GET，不带 Cookie | `src/background/image-fetch-guard.ts:credentials: 'omit'` | listing: 页面图片由浏览器直接向该页自己的图床发起 GET 请求（不携带你的 Cookie），不是开发者架设的代理; privacy: sent with `credentials: 'omit'`; review: 使用 credentials: 'omit' |
| 取图只允许 http/https 并拒绝内网地址 | `src/background/image-fetch-guard.ts:parsed.protocol !== 'http:'`; `src/background/image-fetch-guard.ts:metadata.google.internal` | review: 协议只允许 http/https; privacy: `metadata.google.internal` and private/loopback IPv4 and IPv6 literals are refused |
| 图片取不到时由后台直接取图 | `src/background/image-fetch-guard.ts:fetch`; `src/background/image-fetch-guard.ts:isSafeImageUrl` | listing: 扩展会尝试由后台直接取图; release: fetches comic images from arbitrary image CDNs |
| 自动翻译白名单默认为空，不启用即不自动翻译 | `src/shared/app-config.ts:autoTranslateHosts: []`; `src/shared/app-config.ts:hostMatchesAllowlist` | listing: 自动翻译白名单（默认为空）; privacy: The auto-translate list is empty by default; readme: Per-site automation, off by default |
| 「测试配置」按钮做真实连通性验证 | `src/components/Options/OptionsApp.tsx:testConnection`; `src/providers/openai-compatible-base.ts:testConnection` | listing: 点击「测试配置」确认连通; review: 点击「测试配置」确认连通性验证生效 |
| 卸载扩展即删除全部本地数据 | `src/stores/config-v2.ts:chrome.storage.local`; `src/stores/cache-v2.ts:chrome.storage.local` | listing: 卸载扩展即删除全部本地数据; privacy: Uninstalling the extension removes all stored data |
| content script 以静态文件注册，不对网页可见 | `vite.config.ts:promoteContentScriptToStaticEntry`; `scripts/check-release-consistency.mjs:checkNoSecretsExposed` | review: content script 本身以普通静态文件方式注册; release: content script itself is **not** web-accessible |
| web_accessible_resources 只声明 tesseract/* | `public/manifest.json:tesseract/*`; `public/manifest.json:web_accessible_resources` | review: web_accessible_resources 仅声明 tesseract/*; release: declares exactly one thing |
| CSP 只允许自身脚本与本地 WASM | `public/manifest.json:wasm-unsafe-eval`; `public/manifest.json:object-src 'self'` | review: 'wasm-unsafe-eval' 仅用于实例化随扩展打包的 Tesseract OCR WebAssembly 核心; release: script-src 'self' 'wasm-unsafe-eval' |
| 申请 <all_urls> 主机权限 | `public/manifest.json:<all_urls>`; `src/background/background.ts:SUPPORTED_PAGE_URL_PATTERNS` | review: host_permissions: <all_urls>; release: `<all_urls>` host permission |
| storage 权限保存配置、偏好、缓存与用量统计 | `src/stores/cache-v2.ts:CACHE_STORAGE_KEY`; `src/stores/usage-store.ts:chrome.storage.local`; `src/stores/config-v2.ts:APP_CONFIG_STORAGE_KEY` | review: 在浏览器本地保存服务商配置、界面偏好、翻译缓存与用量统计; release: Save provider settings, UI preferences, the local translation |
| alarms 唤醒 worker 重读配置；并发数没有设置界面，恒为 3 | `src/background/background.ts:KEEPALIVE_ALARM`; `src/background/background.ts:syncQueueLimit`; `src/shared/app-config.ts:parallelLimit: 3`; `src/stores/config-v2.ts:setParallelLimit` | review: 存储中的值恒为默认值 3; release: the concurrency limit has no settings UI |
| alarms 不阻止 Chrome 回收 worker，长任务靠消息通道维持 | `src/background/background.ts:KEEPALIVE_ALARM`; `src/background/background.ts:startKeepalive` | review: 该定时器不阻止 Chrome 回收 worker; release: does **not** keep the worker alive |
| contextMenus 提供两个菜单入口 | `src/background/background.ts:chrome.contextMenus.create`; `src/background/commands.ts:CONTEXT_MENU_TRANSLATE_IMAGE` | review: contextMenus —— 在页面右键菜单中提供两个入口; release: Add two page context menu items |
| v0.3.5 起配置从 storage.sync 迁到 storage.local 并删除旧副本 | `src/background/background.ts:migrateConfigFromSyncToLocal` | privacy: v0.3.5 moved all configuration to `chrome.storage.local` |
| 公共构建产物不含服务商 API Key | `scripts/inject-env-config.mjs:apiKey: ''`; `scripts/check-public-build.mjs:PUBLIC_REFERENCE_PATTERNS` | release: Public release artifacts contain no provider API keys. |
| MiniMax-M3 才关闭思考模式 | `src/providers/openai-compatible-base.ts:isMiniMaxM3Model`; `src/providers/openai-compatible-base.ts:thinking` | readme: when the configured model name is MiniMax-M3 |
| 三个后端：OpenAI 兼容 / Ollama / LM Studio | `src/providers/openai-compatible-base.ts:OpenAICompatibleProvider`; `src/providers/ollama.ts:OllamaProvider`; `src/providers/lm-studio.ts:LMStudioProvider` | readme: any endpoint that speaks Chat Completions works |
| 错误带可复制的修复命令 | `src/utils/error-handler.ts:OLLAMA_ORIGINS=chrome-extension://* ollama serve`; `src/utils/error-handler.ts:ollama serve` | readme: Errors as repair menus |
| HUD 显示扫描/翻译/渲染阶段与缓存、跳过计数 | `src/content/floating-hud.ts:cachedCount`; `src/content/floating-hud.ts:skippedCount` | readme: HUD with stages |
| 翻译后继续翻译后续加载的图片 | `src/shared/app-config.ts:autoContinueEnabled`; `src/content/auto-translate-observer.ts:shouldAutoTranslateFollowUp` | readme: once you have translated a page, images that load later |
| 用户启用扩展前不做任何图像处理 | `src/shared/app-config.ts:enabled: false`; `src/shared/app-config.ts:onboardingCompleted: false` | release: performs no image processing until the user enables the extension |

## 已知的检查盲区

脚本能守住的是「承诺所依赖的代码还在」和「文案没有悄悄改口」。它守不住下面这些：

- **语义漂移**：符号还在，但它做的事变了。例如 `translateImageTiled` 还在，但它
  开始真的输出一张拼接图——脚本不会知道。改这类函数时要手动回来核对本表。
- **否定式承诺**：「开发者不收集任何数据」这类承诺没有正面实现可指，锚点只能指向
  本地存储适配器。它能发现的是「本地存储适配器被删了」，发现不了「有人加了一个
  遥测上报函数」。
- **文案里新写的句子**：脚本只认表里登记过的承诺。文案里冒出一句新的能力描述而
  没有登记，脚本不会报错——需要人工把新承诺补进本表。
- **表里没有登记的文档**：`docs/architecture-notes.md`、`CHANGELOG.md`、
  `docs/index.md` 不在检查范围内。
