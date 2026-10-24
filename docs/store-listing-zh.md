# Chrome 商店上架文案（中文）

创建新条目时逐字段复制。括号内是限制说明，**不要**填进输入框。

## 商品详情（必填）

**名称**（≤45 字符）

```
漫画翻译助手 - AI 漫画翻译与叠加
```

**简短说明**（≤132 字符）

```
在网页原位翻译漫画与条漫图片，译文叠在原文气泡上。支持 OpenAI 兼容接口与本地 Ollama、LM Studio，密钥仅存本地。
```

**详细说明**

```
漫画翻译助手是一个「就地翻译」工具：它在你正在阅读的漫画页面上直接叠加译文，不会跳转到另一个页面。译文画在原文所在位置的一块覆盖层上，气泡里的文字会被这块覆盖层遮住，画面其余部分保持原样。

■ 核心能力

· 原位叠加译文：识别漫画图片中的文字，把译文渲染回原图对应位置。
· 支持多种阅读形态：普通漫画分镜、长条条漫（webtoon）会切片处理（切块分别送模型，译文坐标再映射回原图）。
· 译文直接覆盖在原文字区域上：使用与原文字框相同的位置与样式渲染译文；覆盖层默认是不透明的浅色底，原文气泡区域会被完整遮住，覆盖层底色可在设置里调整。
· 本地 OCR 兜底：视觉模型没有识别出文字时，内置 Tesseract OCR 可继续工作（使用 Ollama 时不启用该兜底）。
· 翻译缓存：翻译成功的图片不重复请求，节省额度；缓存仅保存在本机浏览器内。
· 画质与并发可调：设置页可选择图片分辨率（标准 1024 / 高清 1536 / 最高 2048）与同时翻译的图片数，分辨率越高识别越准、费用也越高。
· 目标语言可选：简体中文、繁体中文、English、日本語、한국어；所选语言会真正传给模型，翻译风格提示也随之切换。
· 服务商一键预设：设置页列出 MiniMax、SiliconFlow、OpenRouter、Gemini、OpenAI，点一下就填好接口地址与模型名，API Key 仍由你自己填写。
· 译文可对照原文：译文阅读面板里每条译文都能展开查看识别到的原文（模型读到的日文、韩文或英文原文）。
· 译文可存为图片：翻译完点图上的「⬇」按钮，这张图连同译文会合成成一张 PNG，弹窗里预览后下载到本地。合成在浏览器本地完成；过程中会向图片所在的站点再取一次原图（同一个地址、同一个站点，不会发给任何新目的地）。
· 手动/自动两种模式：点击工具栏按钮，或在页面右键菜单选择「翻译当前页面」/「翻译这张图片」；也可把常用站点加入自动翻译白名单（默认为空）。
· 自动翻译状态一目了然：弹窗会直接写明当前页面是否正在自动翻译新加载的图片（云端服务商会产生费用，本地服务商不会），需要时可一键停掉，不会出现开关都关着却仍在自动翻译的情况。
· 键盘快捷键：Ctrl/⌘+Shift+Y 翻译当前页、+X 忽略缓存重翻、+E 清除覆盖层、+S 开关译文阅读面板。
· 译文阅读面板：页面右侧列出本页所有译文，按阅读顺序编号，可从面板跳到对应图片。

■ 支持的服务商

· 任意 OpenAI 兼容接口（可自定义 base URL 与模型名）。安装后的默认端点为 MiniMax（https://api.minimaxi.com/v1，模型 MiniMax-M3），你可以在设置里改成任意其他 OpenAI 兼容服务，或改成本地服务。
· Ollama（本地，默认 http://localhost:11434）
· LM Studio（本地，默认 http://localhost:1234/v1）

■ 关于隐私

· 开发者不收集、不接收、不存储任何用户数据，没有统计、没有遥测、没有崩溃上报，没有广告 SDK。
· 开发者不运行任何服务器，不会收到你的图片、密钥或浏览记录。
· 需要说明的是：翻译时，你正在阅读的页面上的漫画图片会被发送至「你自行配置的服务商」，这构成 Website content 的传输；该服务商如何处理这些数据，适用其自身的隐私政策。
· 若希望图片完全不离开本机，请使用本地服务商（Ollama 或 LM Studio）。
· API Key 仅保存在本机 chrome.storage.local，不随 Google 账号同步。
· 报障用的诊断信息在本地生成，由你自己决定是否粘贴：设置页的「复制诊断信息」只含版本号、所选服务商与用量统计，不含 API Key、接口地址或你浏览的页面。
· 页面图片由浏览器直接向该页自己的图床发起 GET 请求（不携带你的 Cookie），不是开发者架设的代理。
· OCR 语言包在首次使用 OCR 兜底时从 jsdelivr 公开 CDN 下载（不含任何图片或页面内容）。
· 卸载扩展即删除全部本地数据。

■ 使用方式

1. 安装后点击工具栏图标，在弹窗中点「开始设置」，跟随引导完成配置。
2. 选择服务商（设置页有一键预设）与目标语言，填入 API Key，点击「测试配置」确认连通。
3. 打开含漫画图片的网页，点击工具栏图标，或右键「翻译当前页面」/「翻译这张图片」，也可以直接按快捷键。

■ 常见问题

· 没有识别到文字？先确认服务商可用；若视觉模型未返回文本，扩展会自动尝试内置 OCR（使用 Ollama 时不启用该兜底）。
· 某站点不生效？自动翻译只对白名单里的站点生效（白名单默认为空）；手动触发（点工具栏图标或右键菜单）在任何普通网页上都可用。
· 图片加载不出？部分站点图片受 CORS 或防盗链限制，扩展会尝试由后台直接取图；若站点本身需要登录态，可能仍失败。

本项目开源：https://github.com/hibernate-pano/chrome-plugin-manga-translator
```

## 分类与语言

| 字段 | 值 |
| --- | --- |
| 类别 | `Productivity`（工作与效率） |
| 语言 | 中文（简体） |

扩展的界面文案目前只有中文（`src/` 里没有 `_locales/`、`default_locale` 或 `t()`），所以这一栏只能填中文。填上 English 会让英文用户以为界面有英文版——一个他们装完才会发现的落差。哪天做了 i18n 再回来加。

## 图形资产

| 资产 | 规格 | 来源 |
| --- | --- | --- |
| 商店图标 | 128×128 PNG | `public/icons/icon128.png` |
| 特色大图 | 1280×800 JPG/PNG | `store/listing/promo-1280x800.png` |
| 截图 | 1280×800，建议 3~5 张 | `store/listing/screenshot-1280x800.png`、`store/listing/screenshot-panel-1280x800.png`、`store/listing/screenshot-popup-1280x800.png`、`store/listing/screenshot-options-1280x800.png`（4 张） |
| 演示视频（选填） | ≤30 秒 MP4 | `store/listing/demo.mp4`——商店的视频是**选填**的，目前这个文件还没有生成（采集需要机器能连上模型服务）；要交的话按 `docs/chrome-web-store-release.md` 里的流程跑一遍 |

`public/icons/` 已有 16/32/48/64/128/256 六种尺寸，其中 `icon128.png` 可直接作为商店图标上传。

特色大图由 `node scripts/build-promo-image.mjs` 从那两张截图合成——它只用本地文件渲染，不需要模型、不需要网络，因此在任何机器上都能重做。截图与演示视频则需要真实翻译，由 `node scripts/capture-store-assets.mjs` 采集（需要能连通模型服务的机器）。

演示视频最长 30 秒（商店的上限，超了会在上传时被拒），而翻一页整漫画要几分钟，所以采集脚本先真的翻一遍把译文放进缓存，录的是命中缓存的第二遍——于是三十秒里有"译文落在原图上"，而不是三十秒的"正在翻译"。脚本会把成片长度读回来核对，超了就直接失败。

第三张「弹窗」截图由 `node scripts/capture-store-assets.mjs --popup` 采集：它不翻译任何东西，弹窗自己数出这一页有多少张图，所以不需要模型也不产生费用。截图里的站点名是 `comic.example.com`——IANA 保留给示例用的域名，不指向任何真实站点；弹窗背后的漫画页是真的，弹窗里的图片数量是内容脚本真数出来的。

第四张「设置页」截图由 `node scripts/capture-store-assets.mjs --options` 采集，截的是**公开版**（`pnpm build:public`）：API Key 输入框是空的。商店用户装完打开设置页看到的就是这个样子，而作者 Key 的那串圆点不会出现在商店的图片里。

截图目前 4 张，商店建议 3~5 张。

## 隐私与支持

| 字段 | 值 |
| --- | --- |
| 隐私政策 URL | `https://hibernate-pano.github.io/chrome-plugin-manga-translator/privacy-policy.html` |
| 支持网址 | 仓库 Issues：`https://github.com/hibernate-pano/chrome-plugin-manga-translator/issues` |
| 支持邮箱 | 你的开发者联系邮箱 |

Chrome 商店要求隐私政策是**可公开访问的 URL**，不能是本地文件或 GitHub raw 文本。

本项目已通过 GitHub Pages 托管：`https://hibernate-pano.github.io/chrome-plugin-manga-translator/privacy-policy.html`

源头是 `docs/privacy-policy.md`，由 Pages 直接渲染，**改文档即改线上内容**，无需维护第二份 HTML 副本。Pages 的发布配置在仓库 Settings → Pages（源 `main` / `docs`）。

## CWS 数据使用披露（Data Usage Disclosure）

Chrome 商店的新建条目流程会要求逐项填写数据使用披露。下面是本扩展**照抄即可**的填写建议。

### 单一用途声明

```
The extension's single purpose is to translate text in comic images on the
page the user is reading, and overlay the translation on that page.
```

### 数据使用披露表格

| 数据类型 | 是否收集 | 是否与用户身份关联 | 是否用于广告 | 收集目的 | 数据去向 |
| --- | --- | --- | --- | --- | --- |
| Website content | 是（仅传输给用户配置的服务商，开发者不接收） | 否 | 否 | 应用功能：翻译用户请求翻译的漫画图片 | 传输给用户自行配置的第三方 Vision LLM 服务商；开发者不接收、不存储 |
| User activity | 否 | — | — | — | — |
| Website content（浏览记录） | 否 | — | — | — | — |
| Information about the user | 否 | — | — | — | — |
| PII or financial information | 否 | — | — | — | — |
| Health information | 否 | — | — | — | — |
| Authentication information | 否 | — | — | — | — |
| Personal communications | 否 | — | — | — | — |
| Location | 否 | — | — | — | — |
| Web history | 否 | — | — | — | — |
| Identifiers | 否 | — | — | — | — |
| Diagnostics | 否 | — | — | — | — |

**关于 "Website content" 这一项的说明（填进备注框，可选但建议填）：**

```
Website content is transmitted only when the user explicitly asks for a
translation (toolbar button, context menu, or a site the user added to the
auto-translate list). The comic images being translated are sent from the
user's browser directly to the Vision LLM provider the user configured. The
extension developer operates no server, receives no data, and stores no
data. Users who configure a local provider (Ollama or LM Studio) send
nothing off their own machine at all.
```

### 远程代码执行

选 **"No"**。扩展不加载任何远程代码；`'wasm-unsafe-eval'` 仅用于实例化随包发布的 Tesseract OCR WASM 核心。

### 数据处理方式

选 **"Not applicable — the developer collects no user data"**（若商店要求在"数据收集者"一栏选择，沿用"开发者不收集"这一表述，不要勾选任何暗示开发者会接收数据的选项）。

