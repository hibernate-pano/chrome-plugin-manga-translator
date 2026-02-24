# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Manifest V3 扩展插件，用于翻译网页上的外文漫画文字。通过 Vision LLM 检测图像中的文字区域，翻译后以覆盖层叠加在原图上，保持原有样式。

## Commands

```bash
# 开发
pnpm dev                    # Vite 开发服务器
pnpm build                  # TypeScript 类型检查 + Vite 构建
pnpm preview                # Vite 预览已构建的文件

# 测试
pnpm test                   # Vitest watch 模式
pnpm test:run               # 单次运行 (CI)
pnpm test:ui                # Vitest UI 界面
pnpm test:coverage          # 带覆盖率报告
pnpm test:run -- src/stores/config-v2.test.ts  # 单个文件

# 代码质量
pnpm lint                   # ESLint 检查
pnpm lint:fix               # ESLint 自动修复
pnpm format                 # Prettier 格式化
pnpm format:check           # Prettier 检查格式
pnpm type-check             # 仅类型检查
```

**PR 前必须通过**: `pnpm build && pnpm lint && pnpm test:run`

## Architecture

### Chrome 扩展四入口

1. **Popup** (`src/popup.tsx`): 工具栏弹窗，翻译开关和基本设置
2. **Options** (`src/options.tsx`): 完整设置页面
3. **Background** (`src/background/background.ts`): Service Worker，消息中继、配置管理、跨标签页状态同步
4. **Content Script** (`src/content/content.ts`): 注入网页，图像检测、翻译流程控制、覆盖层渲染
   - `hover-selector.ts`: 鼠标悬停图像选择
   - `floating-hud.ts`: 浮动 HUD 控制面板

通信流: Popup ↔ Background ↔ Content Script

### 翻译核心流程

图像检测 → 图像处理(压缩/Base64/哈希) → 缓存检查 → Vision LLM 调用 → JSON 响应解析(文字区域+翻译) → 覆盖层渲染

### Vision LLM Provider（策略模式）

`src/providers/` 下的 TypeScript 实现是当前主用代码:
- `base.ts`: `VisionProvider` 接口 + `BaseVisionProvider` 抽象基类
- 具体实现: `openai.ts`, `claude.ts`, `deepseek.ts`, `ollama.ts`, `dashscope.ts`, `siliconflow.ts`
- `index.ts`: `createProvider()` 工厂函数

`src/api/` 下的 JS 文件是遗留代码。

### 状态管理

- **Zustand** (`src/stores/`): 全局状态。`config-v2.ts` 是当前主配置 store，通过自定义 adapter 桥接 `chrome.storage.sync`
- **必须使用选择器 hooks**，不要订阅整个 store:
  ```typescript
  // 正确
  const enabled = useAppConfigStore(state => state.enabled);
  // 错误
  const store = useAppConfigStore();
  ```
- **React Query v5**: 服务端状态，hooks 在 `src/hooks/`

### 遗留代码共存

项目中 v1 (JS: `src/api/`, `src/content/content.jsx`) 和 v2 (TS: `src/providers/`, `src/services/`, `src/stores/*-v2.ts`) 并存。新代码应使用 v2 的 TypeScript 模块。

## Code Style

- **格式化**: Prettier — 分号, 单引号, ES5 尾逗号, 80 字符宽, 2 空格缩进
- **TypeScript**: 严格模式, 禁止 `any`(用 `unknown`), 禁止非空断言 `!`
- **路径别名**: `@/` 映射 `src/`
- **Import 顺序**: React → 三方库 → `@/` 绝对导入 → 相对导入 → `type` 导入
- **UI 组件**: shadcn/ui 风格 (`src/components/ui/`), 使用 cva 做变体, `cn()` 合并类名
- **错误处理**: 使用 `src/utils/error-handler.ts` 的统一错误系统 (`TranslationErrorCode`, `retryWithBackoff`)
- **测试**: `*.test.ts` 放在源文件旁边, Vitest 全局 API, 覆盖率阈值 70%

## Key Paths

| 路径 | 说明 |
|------|------|
| `src/providers/` | Vision LLM Provider 实现 (TS, 当前主用) |
| `src/services/translator.ts` | 翻译核心逻辑 |
| `src/services/image-processor.ts` | 图像处理 (压缩/Base64/哈希) |
| `src/services/renderer.ts` | 覆盖层渲染 |
| `src/stores/config-v2.ts` | 主配置 store |
| `src/stores/cache-v2.ts` | 缓存 store |
| `src/utils/error-handler.ts` | 统一错误处理 |
| `src/components/ui/` | shadcn/ui 基础组件 |
| `src/hooks/` | React hooks (useConfig, useTranslation, useCache 等) |
| `src/test/setup.ts` | 测试环境 (Mock Chrome Storage API, fetch) |
| `public/manifest.json` | Chrome 扩展 Manifest V3 |
