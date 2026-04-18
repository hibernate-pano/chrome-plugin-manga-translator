# 漫画翻译助手 Chrome 插件

一个面向漫画阅读场景的 Chrome 扩展。
它会在网页内识别可翻译图片，调用视觉模型完成翻译，并把译文以覆盖层的形式直接渲染回页面，尽量保持阅读连续性。

## 当前产品形态

- 页内翻译：直接在当前网页上翻译整页漫画图片
- 选图翻译：进入 hover 选图模式，只翻译你点中的那张图
- 自动翻译：开启后，刷新页面或切换章节时自动开始翻译
- 多 Provider：支持 SiliconFlow、DashScope、OpenAI、Claude、DeepSeek、Ollama
- 本地缓存：相同图片优先命中缓存，减少重复请求
- 成本优化：默认启用文字区域检测与裁剪，尽量减少发送给 VLM 的无关像素
- 页内 HUD：展示扫描、翻译进度、完成和错误状态

## 技术架构

- `src/content/content.ts`
  页面内状态机，负责找图、调度翻译、控制 hover 选图与 HUD
- `src/services/translator.ts`
  主翻译管线，串联图片处理、文字检测、Provider 调用、缓存与回退逻辑
- `src/services/text-detector.ts`
  基于 Tesseract.js 的文字区域检测
- `src/services/renderer.ts`
  将译文作为 overlay 渲染回原图
- `src/stores/config-v2.ts`
  基于 Zustand 的配置存储，持久化到 Chrome Storage
- `src/components/Popup/PopupApp.tsx`
  操作驱动型弹窗，负责发起整页翻译、选图翻译、清理覆盖层
- `src/components/Options/OptionsApp.tsx`
  Provider、模型、语言与连接测试配置页

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
2. 打开扩展设置页，配置一个可用的 Provider 和 API Key
3. 选择目标翻译语言
4. 在漫画页面打开弹窗
5. 选择：
   - “翻译当前页面”
   - “点击选图翻译”
   - 或开启“自动翻译新页面”

翻译完成后，可以在页面内通过 overlay 控件固定/移除译文。

## Provider 说明

- `siliconflow`
  默认首选，适合中文用户，成本和速度更平衡
- `dashscope`
  适合使用通义千问视觉模型
- `openai`
  通用云端方案
- `claude`
  偏重理解能力
- `deepseek`
  中文场景性价比较高
- `ollama`
  本地部署方案，适合隐私敏感或离线使用场景

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

- 提高页内翻译的稳定性
- 降低视觉模型 token 成本
- 让多 Provider 配置和真实用户流程保持一致

后续更适合继续深化的是主路径质量、页面兼容性和覆盖层可读性，而不是继续堆叠额外设置项。
