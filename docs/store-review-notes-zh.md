# Chrome 商店审核备注（中文，可直接粘贴）

Chrome Web Store 未在官方文档或 API 参考中公布审核备注（test instructions）字段的字符上限；此前写的「约 4000 字符」是内部假设，不是商店公布值。以下文本按自设的 4,000 字符预算组织，五个代码块合计 3,951 字符（不含本说明与 FAQ）。

## 单一功能说明

```
本扩展的单一功能是：在用户主动请求时，把当前网页上漫画/条漫图片中的外文翻译成用户选择的语言（默认简体中文），并把译文叠加在原图上。不含广告、用户追踪、社交功能、后台上传、远程代码执行或与翻译无关的页面抓取。

扩展不会自行翻译任何页面。触发方式只有：
1) 点击工具栏图标；
2) 右键菜单「翻译当前页面」或「翻译这张图片」；
3) 快捷键 Ctrl/⌘+Shift+Y 翻译当前页、+X 忽略缓存重翻、+E 清除覆盖层、+S 译文面板；
4) 手动把站点加入自动翻译白名单（默认为空）。

「忽略缓存重翻」是唯一绕过缓存、重新请求本页图片的动作，会产生额外费用；无论从弹窗按钮还是快捷键触发，都会先弹出一个确认框，写明本次会重新请求多少张图片，不确认不发出请求。右键菜单没有这一项。安装后不会自动上传任何图片。
```

## 权限与理由

```
权限清单与用途：

storage —— 在浏览器本地保存服务商配置、界面偏好、翻译缓存与用量统计。不使用 storage.sync，API Key 不随 Google 账号同步。

contextMenus —— 在页面右键菜单中提供两个入口：「翻译当前页面」与「翻译这张图片」，仅在 http/https 页面出现，点击后才产生服务商请求。

alarms —— 翻译开启期间每 30 秒唤醒一次后台 service worker，使其被 Chrome 回收后重启时能从 storage 重读配置，而不是沿用内存旧值。该定时器不读取也不上传页面数据。如实说明：并发数可以在设置页的「画质与并发」中调整（默认 3），所以重读并发配置并非幂等；该定时器不阻止 Chrome 回收 worker。

offscreen —— 创建隐藏扩展页 offscreen.html，让 OCR 的 Tesseract worker 在扩展自身 origin 运行，宿主页 CSP（如 worker-src 'none'）不能阻止本地 OCR。该页只加载随包 OCR 资源，不读页面内容、不发网络请求；首次 OCR 时创建并复用。WORKERS reason 自 Chrome 113 起提供；扩展最低 110，110–112 上 createDocument 被拒，OCR 自动走页内兜底（见 OCR 一节）。

host_permissions: <all_urls> —— 目标漫画/条漫站点无法预先枚举；页面 <img> 常被 CORS 限制、降采样或懒加载，页面内 canvas 无法可靠取得视觉模型所需的原始字节，后台需以 GET 直接向该页图床/CDN 取图。

该取图为普通 GET，从用户浏览器直连页面自身图床，使用 credentials: 'omit'，不携带该站 Cookie；扩展不架代理。取图仅发生在用户已请求翻译的图片上。取图前校验地址：协议只允许 http/https，localhost、*.localhost、metadata.google.internal 与私有/回环地址一律拒绝。图床可以把请求重定向到别处，浏览器会先跟随、再把结果交给我们，我们无法在跟随前拦下；但重定向后的最终地址同样要过上面这道校验，不合格的响应会被丢弃，内容不交给内容脚本。

content_security_policy: script-src 'self' 'wasm-unsafe-eval'
'wasm-unsafe-eval' 仅用于实例化随扩展打包的 Tesseract OCR WebAssembly 核心（本地运行，不下载远程代码）。其余脚本来源锁定 'self'，object-src 为 'self'。扩展不执行任何远程代码。

web_accessible_resources 仅声明 tesseract/*：页内 blob worker 通过它加载打包的 worker.min.js（页面上下文只能加载声明为 web-accessible 的扩展资源）。offscreen.html 不在其中：只由扩展自己的 service worker 通过 chrome.offscreen 创建，网页既不需要、也无法嵌入。content script 本身以普通静态文件方式注册，由浏览器直接注入，不经过网页，因此无需声明为 web-accessible。

密钥只存在于 service worker 与扩展自有页面，明文密钥不进入 content script 的导入闭包。构建有两道断言：content script 导入图一旦能到达持有密钥的模块即失败；dist/content.js 一旦出现密钥即失败。内容脚本拿不到明文密钥，只拿到端点、模型名、「是否已配置密钥」布尔值与翻译设置。
```

## OCR worker 的加载方式与已知限制

```
OCR 默认在扩展自身 origin 的 offscreen 文档中运行（Chrome 113 及以上），宿主页的 CSP 不能阻止本地 OCR；Chrome 110–112 退回页内 blob。按序尝试两种传输，首个成功者在本次会话固定：

1) offscreen：service worker 通过 chrome.offscreen（reason: WORKERS）创建 offscreen.html，经 runtime.Port 发送识别任务；该页在扩展 origin 上用 chrome.runtime.getURL('tesseract/worker.min.js') 直接创建 Web Worker，宿主页 CSP（worker-src、script-src）不适用。
2) 页内 blob（兜底）：offscreen 不可用时退回 2.3.2 方案——内容脚本创建 blob，内容只有一行 importScripts("chrome-extension://<扩展 ID>/tesseract/worker.min.js")，再用 blob URL 构造 Worker；受宿主页 CSP 约束。

没有扩展 origin iframe 通道：把扩展页嵌进宿主页等于把扩展 origin 入口交给页面脚本；原每会话令牌在 iframe URL fragment 中，页面脚本可读。该通道已删除，offscreen.html 也不再是 web-accessible。

只有传输方式本身不可用（transport/unsupported）才降级；识别失败按失败处理、不进翻译缓存，不静默降级为「没有文字」。Chrome 110–112 未提供 WORKERS reason，createDocument 被拒，这三个版本上 OCR 始终走页内 blob，页面 CSP 依然生效，worker-src 'none' 这类严格 CSP 站点在这三个版本上仍无法使用 OCR。

OCR 兜底所用的 Tesseract worker、WASM 核心与韩/日/英/简中四种语言包均随扩展打包，运行时从扩展本地目录读取，不产生任何网络请求。worker.min.js、单文件 WASM 核心（tesseract-core-simd-lstm.wasm.js，内嵌 WebAssembly）与四种语言包全部随包，执行的代码 100% 来自扩展自身，没有任何远程代码。
```

## 数据收集声明

```
本扩展的开发者不收集、不接收、不存储任何用户数据。无统计、无遥测、无崩溃上报、无广告 SDK、无第三方分析 SDK，不使用 Cookie，不做用户追踪。开发者不运行任何接收数据的服务器。

如实说明：翻译时，扩展会把「用户正在阅读的页面上的漫画图片」发送至用户自行配置的视觉模型服务商，属商店数据使用披露中的 Website content 传输；该服务商适用自身隐私政策，开发者不接收、不存储。使用本地服务商（Ollama / LM Studio）时图片完全不出本机。

出站请求仅两类：1) 用户配置的视觉模型服务商（翻译时上传图片）；2) 用户正在阅读的页面自身图床（取图，使用 credentials: 'omit'）。

API Key 仅保存在本机 chrome.storage.local，以固定盐值 XOR 混淆写入（这是混淆而非加密，用于避免在存储查看器中一眼可读，不作为安全边界）。
```

## 供审核参考的测试方式

```
仓库根目录的 smoke-test-page.html 是自包含测试页：日英韩三种气泡、4000px 长条漫、应被跳过的内容（页眉 logo、小于 200px 的图）。除第 3 栏跨域图例取自 upload.wikimedia.org 需联网外，图片均内联生成。请用本地 HTTP 服务打开，不要用 file://（扩展取图只允许 http/https，Chrome 默认也不在 file:// 注入内容脚本）。

三步验证：
1. 安装扩展，点击工具栏图标，在弹窗中点「开始设置」，跟随引导完成配置（设置页也可以随时用「重新查看引导」打开）；选任一 OpenAI 兼容服务商（有一键预设，也可手填 base URL + model + API Key），点击「测试配置」确认连通性验证生效。
2. 在仓库根目录运行 python3 -m http.server 8000，打开 http://localhost:8000/smoke-test-page.html，点击工具栏图标翻译。
3. 预期：第 1 栏三个气泡、第 2 栏条漫四个气泡与跨域图片均被翻译，第 4 栏被跳过；再翻同一页（启用缓存）不再发出服务商请求；切换服务商或模型后缓存不复用；打开未加入白名单的普通网站不会自动翻译。
```

## 容易被问到的问题

| 问题 | 回答 |
| --- | --- |
| 为什么需要 `<all_urls>`？ | 目标站点无法预先枚举，且需从页面自身的图床取图。见「权限与理由」。 |
| 为什么要 `offscreen` 权限？ | OCR 的 Tesseract worker 需要在扩展自身 origin 运行，才不受宿主页 CSP 限制（Chrome 113 及以上；110–112 上该 reason 不可用，OCR 走页内兜底）。该 offscreen 文档只加载随包的 OCR 资源，不读取页面内容、不联网。见「权限与理由」。 |
| 为什么不只申请用户主动点击时的 `activeTab`？ | `activeTab` 只授予当前标签页的一次性权限，不足以在自动翻译模式下于页面加载后取图。 |
| 是否会远程加载代码？ | 不会。`'wasm-unsafe-eval'` 仅用于本地打包的 WASM 核心，其余脚本来源锁定为 `'self'`。 |
| 是否上传浏览历史？ | 不会。只有用户请求翻译的图片会发往其自行配置的服务商。 |
| API Key 存储安全吗？ | 本地 `storage.local` + XOR 混淆。这是混淆不是加密，文案与隐私政策均如实说明，未声称加密。 |
| 是否使用远程服务器中转图片？ | 没有。取图为浏览器直连页面自身图床的 GET，开发者无服务器。 |
| 是否收集用户数据？ | 开发者不收集、不接收、不存储任何用户数据。但翻译时页面图片会发送至用户配置的服务商，属 Website content 传输，该服务商适用自身政策。 |
| content.js 是否可被网页读取？ | 不可。content script 以静态文件方式注册，由浏览器直接注入，不在 web_accessible_resources 中；构建流程有断言阻止其被重新暴露。 |
