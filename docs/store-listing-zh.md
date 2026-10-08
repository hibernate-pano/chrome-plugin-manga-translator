# Chrome 商店上架文案（中文）

创建新条目时逐字段复制。括号内是限制说明，**不要**填进输入框。

## 商品详情（必填）

**名称**（≤45 字符）

```
漫画翻译助手 - AI 漫画翻译与叠加
```

**简短说明**（≤132 字符）

```
在网页原位翻译漫画与条漫图片，保留原画不被覆盖。支持 OpenAI 兼容接口与本地 Ollama、LM Studio，密钥仅存本地。
```

**详细说明**

```
漫画翻译助手是一个「就地翻译」工具：它在你正在阅读的漫画页面上直接叠加译文，保留原图完整显示，不会跳转到另一个页面，也不会用译文盖住画面。

■ 核心能力

· 原位叠加译文：识别漫画图片中的文字，把翻译结果渲染回原图对应位置，保留气泡、网点与作画风格。
· 支持多种阅读形态：普通漫画分镜、长条条漫（webtoon）会切片处理，超长图自动拼接。
· 文字擦除：可用识别结果遮盖原文，避免中英文字重叠。
· 本地 OCR 兜底：当视觉模型未识别出文字时，内置 Tesseract OCR 可继续工作。
· 翻译缓存：相同图片不重复请求，节省额度；缓存仅保存在本机浏览器内。
· 手动/自动两种模式：随时点击工具栏按钮或右键菜单翻译当前页；也可把常用站点加入自动翻译白名单。

■ 支持的服务商

· 任意 OpenAI 兼容接口（可自定义 base URL 与模型名）
· Ollama（本地，默认 http://localhost:11434）
· LM Studio（本地，默认 http://localhost:1234）

■ 关于隐私

· 不收集任何用户数据，没有统计、没有遥测、没有崩溃上报，没有广告 SDK。
· 开发者不运行任何服务器，不会收到你的图片、密钥或浏览记录。
· API Key 仅保存在本机 chrome.storage.local，不随 Google 账号同步。
· 图片只会发往你自行配置的服务商；页面图片由浏览器直接向该页自己的图床发起 GET 请求（不携带你的 Cookie），不是开发者架设的代理。
· 卸载扩展即删除全部本地数据。

■ 使用方式

1. 安装后在弹窗中完成引导。
2. 选择服务商并填入 API Key 与模型名，点击「测试配置」确认连通。
3. 打开含漫画图片的网页，点击工具栏图标或右键「翻译当前页面」。

■ 常见问题

· 没有识别到文字？先确认服务商可用；若视觉模型未返回文本，扩展会自动尝试内置 OCR。
· 某站点不生效？确认该站点在自动翻译白名单中，或使用手动触发。
· 图片加载不出？部分站点图片受 CORS 或防盗链限制，扩展会尝试由后台直接取图；若站点本身需要登录态，可能仍失败。

本项目开源：https://github.com/hibernate-pano/chrome-plugin-manga-translator
```

## 分类与语言

| 字段 | 值 |
| --- | --- |
| 类别 | `Productivity`（工作与效率） |
| 语言 | 中文（简体）、English |

## 图形资产

| 资产 | 规格 | 来源 |
| --- | --- | --- |
| 商店图标 | 128×128 PNG | `public/icons/icon128.png` |
| 特色大图 | 1280×800 或 640×400 JPG/PNG | 需新制作，见下 |
| 截图 | 1280×800 或 640×400，建议 3~5 张 | 需新制作，见下 |

`public/icons/` 已有 16/32/48/64/128/256 六种尺寸，其中 `icon128.png` 可直接作为商店图标上传。

## 隐私与支持

| 字段 | 值 |
| --- | --- |
| 隐私政策 URL | `https://hibernate-pano.github.io/chrome-plugin-manga-translator/privacy-policy.html` |
| 支持网址 | 仓库 Issues：`https://github.com/hibernate-pano/chrome-plugin-manga-translator/issues` |
| 支持邮箱 | 你的开发者联系邮箱 |

Chrome 商店要求隐私政策是**可公开访问的 URL**，不能是本地文件或 GitHub raw 文本。

本项目已通过 GitHub Pages 托管：`https://hibernate-pano.github.io/chrome-plugin-manga-translator/privacy-policy.html`

源头是 `docs/privacy-policy.md`，由 Pages 直接渲染，**改文档即改线上内容**，无需维护第二份 HTML 副本。Pages 的发布配置在仓库 Settings → Pages（源 `main` / `docs`）。

