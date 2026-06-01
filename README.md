# 漫画翻译助手 Chrome 插件

## 这是什么 / 给谁用

一个**轻量的 Chrome 扩展**，在你阅读外文漫画网页时直接调用 Vision LLM，把图片里的文字翻译成你选的语言，**以覆盖层形式贴在原图上**——保留排版、保留画风、不污染原页面。

**适合**：
- 你已经在用 OpenAI 兼容的 Vision LLM（OpenAI / Qwen-VL / Gemini via OpenRouter 等），想在网页上直接读外文漫画
- 你有 Ollama 或 LM Studio 在本地跑，想**零成本、零数据外传**地翻漫画
- 你用 i18n 翻页站（漫画站、扫描组发布站），需要"打开就翻"，不需要切到独立 app

**不适合**：
- 你想要自动 OCR 整本 PDF 漫画——这是浏览器扩展，不是桌面 OCR 工具
- 你想用 Tesseract.js 做离线翻译——v0.3.3 的默认管线是 `full-image-vlm`（VLM 直出），Tesseract 仅在显式开启 `hybrid-regions` 模式时使用
- 你想免费白嫖——VLM API 要么花钱，要么本地跑模型（Ollama/LM Studio 都要本机 GPU）

## 当前能力

- **页内翻译**：直接在当前网页上翻译整页漫画图片
- **自动续翻**：开启后，页面内后续出现的新图片会继续翻译
- **强制重翻**：清空当前页覆盖层与已处理状态后重新执行
- **彻底重置**：移除当前页 overlay 和处理痕迹
- **三种后端**：
  - `OpenAI-compatible`：商用 API（OpenAI、SiliconFlow、OpenRouter 等任何 OpenAI 格式端点）
  - `Ollama`：本地模型，隐私优先、免费
  - `LM Studio`：本地 OpenAI 兼容服务器，离线开发演示用
- **页内 HUD**：展示扫描、翻译进度、完成和错误状态
- **多语言目标**：简体中文、繁体中文、English、日本語、한국어

## 技术架构

- `src/content/content.ts`
  页面内状态机，负责找图、调度翻译、自动续翻与 HUD
- `src/services/translator.ts`
  主翻译管线，串联图片处理、直连调用、缓存与回退逻辑
- `src/services/text-detector.ts`
  基于 Tesseract.js 的文字区域检测
- `src/services/renderer.ts`
  将译文作为 overlay 渲染回原图
- `src/stores/config-v2.ts`
  基于 Zustand 的配置存储，持久化到 Chrome Storage
- `src/components/Popup/PopupApp.tsx`
  操作驱动型弹窗，负责发起整页翻译、强制重翻、清理覆盖层
- `src/components/Options/OptionsApp.tsx`
  双 provider 配置页与基础行为设置

## 安装与开发

### 开发

```bash
pnpm install
pnpm dev
```

### 构建

```bash
pnpm build
```

构建完成后，在 Chrome 的 `chrome://extensions/` 中开启开发者模式，加载仓库里的 `dist/` 目录。

## 使用方式

1. 安装并加载扩展
2. 打开扩展设置页，选择 `OpenAI-compatible` 或 `Ollama`
3. 填写必要的 API Key / 本地地址
4. 选择目标翻译语言
5. 按需开启“启用扩展”和“自动续翻”
6. 在漫画页面打开弹窗
7. 选择：
   - “翻译当前页面”
   - “强制重翻”
   - 或“彻底重置”

翻译完成后，可以在页面内通过 overlay 控件固定/移除译文。

## 插件直连说明

- 插件只保留两条路径：`OpenAI-compatible` API 直连与 `Ollama` 本地直连
- 支持整页翻译、自动续翻、强制重翻、彻底重置
- 不再包含服务端加速、hover 选图和多云 provider 路径

## Provider 说明

直连配置目前仅支持以下 Provider：

- `openai-compatible`
- `ollama`

## 验证命令

提交前建议至少运行：

```bash
pnpm build
pnpm lint
pnpm test:run
```

如果你正在专门清理历史 warning，可以额外运行：

```bash
pnpm lint:strict
```

## 已知方向

当前版本重点在三件事：

- 提高 `manhwaread` 主路径的稳定性
- 保持插件直连路径可诊断、可验证
- 在不牺牲稳定性的前提下继续优化速度和渲染效果

后续更适合继续深化的是主路径质量、错误可诊断性和覆盖层可读性，而不是继续扩展多站点、多模式或复杂配置能力。
