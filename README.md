# 漫画翻译助手 Chrome 插件

一个面向漫画阅读场景的 Chrome 扩展，当前版本只保留两条直连路径：

- `OpenAI-compatible` API 直连
- `Ollama` 本地直连

它会在网页内识别可翻译图片，把译文以覆盖层的形式渲染回页面，尽量保持阅读连续性。

## 当前定位

当前版本围绕单一、可维护的最小闭环：

- 打开章节页面
- 扫描可翻译图片
- 通过 `OpenAI-compatible` 或 `Ollama` 发起翻译
- 把译文稳定渲染回页面
- 出错时给出可定位的错误信息

## 当前能力

- 页内翻译：直接在当前网页上翻译整页漫画图片
- 自动续翻：开启后，页面内后续出现的新图片会继续翻译
- 强制重翻：清空当前页覆盖层与已处理状态后重新执行
- 彻底重置：移除当前页 overlay 和处理痕迹
- 双直连后端：`OpenAI-compatible` 与 `Ollama`
- 页内 HUD：展示扫描、翻译进度、完成和错误状态

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
