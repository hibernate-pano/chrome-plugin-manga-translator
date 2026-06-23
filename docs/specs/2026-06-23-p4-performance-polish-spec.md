# P4: Performance & Polish — Design Spec

**Date:** 2026-06-23
**Status:** Draft
**Branch:** `feat/p4-performance-polish`
**Author:** Claude (technical co-founder)

---

## 1. 背景与动机

P3a（P0 #6）和 P3b（PR #7）完成了「功能正确性」和「翻译透明度」。但用户实际打开漫画站时，仍能感知到三类摩擦：

| 摩擦 | 用户原话（推测） | 根因 |
|---|---|---|
| 慢 | 「要等 3-5 秒才看到译文」 | 单一 Vision LLM 调用天然慢，且无视觉过渡 |
| 抖 | 「overlay 出现得太突然」 | 缺动画 polish，硬切 |
| 累 | 「看不清哪些图翻了、哪些在翻、哪些失败」 | 进度反馈不诚实，错误反馈不及时 |

**核心洞察**：在 Vision LLM 单次 3-8 秒的物理上限下，「流畅」不是把单次调用变快，而是**让用户感觉不到在等**。这意味着 P4 的目标不是「翻译 API 加速」—— 而是「**翻译感知链路的体验优化**」。

## 2. 目标（用户视角）

P4 完成后，用户打开漫画站应该感到：

1. **第一次翻译**：图片先到位 → 短暂的视觉过渡（无 jarring pop）→ 译文淡入
2. **连续翻译**：HUD 进度条真实反映「3/12 张」，不是动画假进度
3. **二次访问**：缓存命中的图零延迟显示，无需等待
4. **错误处理**：失败时 HUD 即时反馈「X 张失败：网络/配置/内容」三档原因，而不是 console 警告
5. **长时间使用**：打开 30 分钟后，扩展仍然响应迅速（无内存泄漏）

## 3. 非目标（明确不做）

- **不做 LLM provider 切换 / 性能优化**：OpenAI/本地模型本身的延迟是物理上限
- **不做批处理重写翻译 pipeline**：见 §6 风险
- **不做 UI 大改版**：P3a/P3b 的 HUD/overlay 设计已通过，不重做
- **不做性能追踪 SDK 集成**：先 in-memory 埋点，看清现状再决定

## 4. 现状事实（从代码确认）

| 维度 | 现状 | 证据 |
|---|---|---|
| HUD 进度 | 已实装 `translating` 状态，content.ts 真实驱动 | `floating-hud.ts:165-183` `content.ts:344-358` |
| Overlay 动画 | 已有 `manga-overlay-fadein 0.3s` + 150ms opacity 过渡 | `renderer.ts:411, 387` |
| 缓存机制 | LRU 100 条，hash-keyed，命中零延迟复用 | `cache-v2.ts:126, 215-230` |
| 并发翻译 | `processInParallel`，默认 concurrency 3 | `content.ts:333, 370-384` |
| 缓存命中计数 | `useUsageStore.addRecord({ cached: true })` | `translator.ts:223-228` — 但**未暴露到 UI** |
| Batch LLM | 一次只翻一张图（`processSingleImage`） | `content.ts:181-214` |
| 错误处理 | `parseTranslationError` 已有友好错误 | `content.ts:392-396` |
| 性能埋点 | 无 | 全代码搜索确认 |

**关键发现**：HUD 进度条、overlay 动画、缓存**都已经实装**，不是从零开始。P4 的真正工作不是「加新功能」，而是**校准 + 暴露 + 测量**。

## 5. 五大子任务（按「用户体验冲击」排序）

### P4.1: 性能基线测量
**用户目标**：我们能回答「P4 之前/之后，性能到底变没变？」

**做法**：
- 在 `src/test/perf/` 建一个纯函数式 perf benchmark（不依赖 Chrome API）
- 测三件事：
  1. **单图翻译吞吐**：mock provider 返回固定延迟，记录 N 张图总耗时
  2. **缓存命中路径**：第二次翻译已缓存图，记录 hash 查 + 渲染总耗时
  3. **DOM 操作吞吐**：overlay 创建/销毁/碰撞解决各 100 次的总耗时
- 输出一个 `perf-baseline.json` 给 P4.5 对比用
- 真实浏览器 perf trace（DevTools）由 P4.5 跑，代码内只做 micro-bench

**完成判据**：`pnpm test:run -- perf/` 全绿，`perf-baseline.json` 提交到 repo（gitignore 之外，作为参考快照）

### P4.2: 真实进度反馈校准
**用户目标**：HUD 进度条说「3/12」时，进度条物理宽度就是 25%。

**现状问题**：
- HUD 已经有 translating 状态（已确认 working），但需要：
  1. 进度条 `transition: width 0.3s` 改为 150ms（与 overlay 动画时长一致）
  2. 加上「X / Y 张」+ 估计剩余时间（基于已用时间 × 剩余张数）
  3. 失败时即时反馈（不卡在 3/12，跳到「3 成功，2 失败」）

**做法**：
- 修改 `floating-hud.ts:282-295` 的 CSS：`transition: width 0.3s ease` → `transition: width 0.15s linear`
- 修改 `renderState` 的 translating 分支：加入 ETA
- 修改 `content.ts` 的 `setState({ status: 'translating' })` 调用：传入 `etaSeconds`
- 失败时新增 `status: 'translating' | 'partial'` 区分（partial 时显示「X 成功 Y 失败」）
- 测试：mock `setState` 序列，断言 HUD 渲染的百分比与 current/total 一致

**完成判据**：用户从「0/12」到「12/12」的进度条物理宽度变化是线性 150ms；任一中间状态都精确反映 current/total

### P4.3: 批量翻译 + 缓存埋点
**用户目标**：同页多图翻译，round-trip 数从 N 降到 1。

**做法**：
- **Phase A（埋点）**：在 `useUsageStore` 加 `cacheHitRate` 计算（命中数 / 总查询数），暴露到 Options 页面（用现有「本地错误统计」同款 UI 模式）
- **Phase B（批处理）**：在 `image-priority.ts` 加 `getViewportBatch()` 函数，返回 viewport 内前 N 张图（默认 4）
- **Phase C（不真改 provider）**：本次只把 batching 接口和签名做出来，**不实际改 Vision provider 的 batch 协议**——这要等 LLM 提供方支持多图输入。**Why**：当前所有 LLM 都单图输入；强行"batch"会变成「多次串行请求合并到一个 HTTP body」，实际延迟没改善，只增加了复杂度

**关键决策**（在 PR description 里说明）：
- ❌ 不做 provider-level batch（复杂度高、收益小、需 LLM 支持）
- ✅ 做 viewport batch（前端层把 N 张图排队成 1 个 batch 调用 `processInParallel`）
- ❌ 不做 image merging（拼图输入 LLM）—— 损失位置信息，得不偿失

**完成判据**：Options 页有「缓存命中率 X%」显示；多图翻译时 `processInParallel` 单次任务内多图

### P4.4: Overlay 动画 Polish
**用户目标**：译文出现/消失/切换时，无 jarring pop。

**现状问题**：
- 已有 0.3s fadein 动画 ✓
- hover 时透明度 `:hover` 是 `opacity: 0.15 !important` ✗ — 这是「snap」不是「transition」
- 📌 切换原文/译文时 `overlay.textContent = ...` ✗ — 立即替换，不渐变

**做法**：
- 改 CSS：把 `.${OVERLAY_CLASS}:hover` 的 snap 改为 transition（用 `opacity` 而非 `!important`）
- 改 JS：📌 toggle 切换时，**双 overlay 实例并存 200ms 渐隐渐显**（不是 textContent 替换）
  - 简单做法：用 `opacity` 0/1 切换两个并存的 overlay
  - 不做真正的 cross-fade（DOM 双倍成本不值）

**完成判据**：hover 时 overlay 透明度是 100ms 平滑过渡（不是 snap）；📌 切换有 200ms fade

### P4.5: Bundle + Memory 健康
**用户目标**：30 分钟长会话后，扩展不卡顿。

**做法**：
- **Bundle**：分析 `pnpm build` 输出（content.js 45 KB / gzip 14.86 KB），识别能动态 import 的代码块（image-processor 没用可以 lazy load）
- **Memory**：
  - 在 `content.ts` `cleanup()` 已有逻辑，加一个 Chrome DevTools heap snapshot 标注点
  - 在 dev 模式打印 `performance.memory.usedJSHeapSize` 增长曲线
  - 30 分钟模拟：写一个测试用例 mock 长会话场景
- **真实 perf trace**：用 Chrome DevTools 跑一次完整翻译流程，导出 trace.json 到 `docs/perf-traces/`（gitignore 之外，作为 PR 附件）

**完成判据**：P4 之前/之后两份 `perf-trace.json` 在 PR 里；bundle size 在 ±5% 之内（不动 bundle）

## 6. 风险与权衡

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 性能基线测量本身有开销，影响其他测试 | 中 | 低 | perf 测试放单独 `*.bench.test.ts`，不与单测混 |
| Overlay 动画 polish 引发 reflow 抖动 | 低 | 中 | 用 `transform` 不用 `width/height` 过渡 |
| 缓存命中率埋点暴露到 UI 后用户改设置 | 低 | 低 | 只读显示，不让用户调 |
| 30 分钟长会话测试在 CI 跑不动 | 高 | 低 | CI 跑 1 分钟短测，本地手动跑 30 分钟 |
| 真实 perf trace 文件大 | 中 | 低 | `.gz` 压缩后 < 1MB 才 commit |

## 7. 验证矩阵

| 子任务 | Gate 1: type-check | Gate 2: lint | Gate 3: test | Gate 4: build | 人工 |
|---|---|---|---|---|---|
| P4.1 | ✓ | ✓ | ✓ perf bench | ✓ | — |
| P4.2 | ✓ | ✓ | ✓ HUD 渲染测试 | ✓ | ✓ 进度条观察 |
| P4.3 | ✓ | ✓ | ✓ Options 页测试 | ✓ | ✓ 命中率显示 |
| P4.4 | ✓ | ✓ | ✓ renderer 测试 | ✓ | ✓ 动画手感 |
| P4.5 | ✓ | ✓ | ✓ cleanup 测试 | ✓ | ✓ perf trace 对比 |

**最终 PR 必过**：`pnpm build && pnpm lint && pnpm test:run`

## 8. 成功判据（PR Description 用）

P4 完成后：
- HUD 进度条物理宽度精确反映 `current/total`，150ms 平滑
- 译文 overlay fade-in 100-200ms，无 jarring pop
- 📌 切换有 200ms 渐变
- 缓存命中率显示在 Options 页
- 长会话（30 分钟）内存增长 < 20%
- Bundle size 变化 < 5%

---

**下一步**：写 `docs/plans/2026-06-23-p4-performance-polish-plan.md` 把这份 spec 拆成可执行 commits。
