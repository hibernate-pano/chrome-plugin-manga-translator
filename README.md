# 漫画翻译助手 Chrome 插件

一个面向漫画阅读场景的 Chrome 扩展，当前版本以**插件直连优先**为主线。

它会在网页内识别可翻译图片，优先通过插件直连的 Provider 或 Ollama 完成翻译；如果你显式启用了本地加速服务，也可以把图片交给本地服务端做 OCR、翻译与结果整理，再把译文以覆盖层的形式渲染回页面，尽量保持阅读连续性。

## 当前定位

当前版本不是多站点、多模式并行产品，而是围绕 `manhwaread` 站点打磨一条最小可用闭环：

- 打开章节页面
- 扫描可翻译图片
- 优先走插件直连翻译
- 把译文稳定渲染回页面
- 出错时给出可定位的错误信息

本地服务仍然保留，但当前阶段定位为**可选加速能力**，不是默认主路径。

## 当前能力

- 页内翻译：直接在当前网页上翻译整页漫画图片
- 选图翻译：进入 hover 选图模式，只翻译你点中的那张图
- 自动翻译：开启后，刷新页面或切换章节时自动开始翻译
- 插件直连优先：默认围绕直连 Provider / Ollama 工作
- 失败回退：服务端取图失败时，支持从页面上下文补取图片 bytes 再重试
- 页内 HUD：展示扫描、翻译进度、完成和错误状态

## 技术架构

- `src/content/content.ts`
  页面内状态机，负责找图、调度翻译、控制 hover 选图与 HUD
- `src/services/translator.ts`
  主翻译管线，串联图片处理、插件直连调用、缓存与回退逻辑
- `src/services/text-detector.ts`
  基于 Tesseract.js 的文字区域检测
- `src/services/renderer.ts`
  将译文作为 overlay 渲染回原图
- `src/stores/config-v2.ts`
  基于 Zustand 的配置存储，持久化到 Chrome Storage
- `src/components/Popup/PopupApp.tsx`
  操作驱动型弹窗，负责发起整页翻译、选图翻译、清理覆盖层
- `src/components/Options/OptionsApp.tsx`
  运行路径、服务端地址、语言与 Provider 配置页
- `server/`
  本地 OCR-first 服务端，负责主要翻译执行链路

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
2. 打开扩展设置页，选择插件直连 Provider 或 Ollama
3. 填写必要的 API Key / 本地地址
4. 选择目标翻译语言
5. 如果你需要本地加速服务，再显式切换到服务端路径并填写服务端地址
6. 在漫画页面打开弹窗
7. 选择：
   - “翻译当前页面”
   - “点击选图翻译”
   - 或开启“自动翻译新页面”

翻译完成后，可以在页面内通过 overlay 控件固定/移除译文。

## 插件直连说明

- 插件默认围绕直连 Provider / Ollama 工作
- 本地加速服务是可选能力，需要显式切换
- 已配置的本地服务不会静默接管插件直连路径

## Provider 说明

直连配置目前支持以下 Provider：

- `siliconflow`
- `dashscope`
- `openai`
- `claude`
- `deepseek`
- `nvidia`
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
