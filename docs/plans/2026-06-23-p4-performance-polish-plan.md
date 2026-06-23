# P4: Performance & Polish — Implementation Plan

**Branch:** `feat/p4-performance-polish`
**Spec:** `docs/specs/2026-06-23-p4-performance-polish-spec.md`
**Date:** 2026-06-23

本计划把 P4 spec 拆成 7 个可执行 commit，每个 commit 完成后跑 4 个 gate（type-check / lint / test / build），不破坏已有功能。

---

## Commit 顺序（按依赖关系）

```
1. docs: spec                          (已 commit 05a15d9)
2. docs: plan                          (本文件)
3. test(perf): baseline micro-bench    ← P4.1 起点
4. test(perf): cache hit path bench    ← P4.1 缓存路径
5. feat(usage): cache hit rate stat    ← P4.3 Phase A
6. feat(options): cache hit rate UI    ← P4.3 Phase A 完成
7. feat(hud): progress bar polish      ← P4.2
8. feat(hud): translating ETA          ← P4.2
9. feat(renderer): hover fade polish   ← P4.4
10. feat(renderer): pin toggle fade    ← P4.4
11. docs(perf): P3b baseline trace     ← P4.5
12. docs(perf): P4 after trace         ← P4.5
13. chore(deps): validate build        ← P4.5
```

> **为什么 11+12 是 P3b baseline + P4 after**？perf trace 需要真浏览器跑，没法自动化。所以 commit 顺序是先实现所有代码 → 跑 trace → commit trace 文件。

---

## Commit 3: test(perf) — baseline micro-bench (P4.1 起点)

**目标**：建立 perf baseline，让后续 commit 能比较。

**步骤**：
1. 新建 `src/test/perf/translation-throughput.bench.test.ts`
   - 测 `processInParallel` mock provider 50 张图，总耗时
   - 测单图 LLM call 模拟（mock 50ms 延迟）
2. 新建 `src/test/perf/cache-hit.bench.test.ts`
   - 测「第一次翻译」vs「第二次翻译（缓存命中）」的耗时比
3. 新建 `src/test/perf/dom-throughput.bench.test.ts`
   - 测 overlay 创建 100 个、销毁 100 个、碰撞解决 100 次的耗时

**代码模板**（简化）：

```typescript
// src/test/perf/translation-throughput.bench.test.ts
import { describe, it, expect } from 'vitest';
import { processInParallel } from '@/utils/image-priority';

describe('perf: translation throughput', () => {
  it('processes 50 images with mock provider in <500ms', async () => {
    const images = Array.from({ length: 50 }, () => createMockImage());
    const start = performance.now();
    await processInParallel(images, async () => {
      await new Promise(r => setTimeout(r, 50));
    }, { maxConcurrent: 3 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000); // 50 / 3 ≈ 17 batches × 50ms = 850ms baseline
  });
});
```

**Verify**：`pnpm test:run -- src/test/perf/` 全绿

**风险**：perf test 是 best-effort，不同机器差异大。设阈值要宽（用 2-3x 安全系数）。

---

## Commit 4: test(perf) — cache hit path (P4.1 缓存路径)

**目标**：确认缓存命中是真正的「零延迟」。

**步骤**：
1. 在 `src/test/perf/cache-hit.bench.test.ts` 测两路径：
   - Cold path: 第一次翻译（含 mock 50ms LLM）
   - Hot path: 第二次翻译（缓存命中，**0ms LLM**）
2. 断言：Hot path 耗时 < 5ms（纯 DOM 渲染 + LRU hash 查询）

**Verify**：测试通过，记录基线数字到 `perf-baseline.json`

---

## Commit 5: feat(usage) — cache hit rate stat (P4.3 Phase A 起点)

**目标**：`useUsageStore` 能算命中率。

**步骤**：
1. 看 `src/stores/usage-store.ts` 现有结构（`addRecord` 已有 `cached` 字段）
2. 加 selector：`getCacheHitRate()` 返回 `{ hit, miss, rate }`
3. 测试：mock 5 records（3 cached=true, 2 cached=false），断言 rate = 60%

**Verify**：单测过

---

## Commit 6: feat(options) — cache hit rate UI (P4.3 Phase A 完成)

**目标**：Options 页有命中率显示。

**步骤**：
1. 在 Options 页找到「本地错误统计」组件（同款位置）
2. 仿写一个「缓存命中率」卡片，复用 cva + cn 模式
3. 使用 `useUsageStore` 的新 selector
4. 注意：单测 mock store，断言组件渲染

**Verify**：lint + test + build

---

## Commit 7: feat(hud) — progress bar polish (P4.2)

**目标**：进度条 transition 从 0.3s → 150ms linear。

**步骤**：
1. 改 `floating-hud.ts:294` `transition: width 0.3s ease` → `transition: width 0.15s linear`
2. 改 `transition` 在 0.3s 之后导致「假进度」感的问题——但实际不是假进度，是「ease 看起来滞后」。linear 更诚实
3. 测试：snapshot 旧 CSS string（不要硬编码）→ 验证新 CSS 包含 0.15s

**Verify**：test pass

---

## Commit 8: feat(hud) — translating ETA (P4.2)

**目标**：HUD 显示「X / Y 张 · 约 Z 秒」。

**步骤**：
1. 在 `ContentState` 类型加 `etaSeconds?: number`
2. 在 `translatePage` 计算 ETA：`(已用时间 / 已完成数) × 剩余数`
3. HUD `renderState` translating 分支加 ETA 显示
4. 测试：mock setState 序列，断言 ETA 在最后一帧消失

**Verify**：单测过

---

## Commit 9: feat(renderer) — hover fade polish (P4.4)

**目标**：hover 时透明度是 transition，不是 snap。

**步骤**：
1. 改 `renderer.ts:415-417` 删 `.${OVERLAY_CLASS}:hover { opacity: 0.15 !important }`
2. 改 `.${WRAPPER_CLASS}:hover .${OVERLAY_CLASS}` 加 `opacity: 0.5; transition: opacity 150ms`
3. 但 `.${OVERLAY_CLASS}` 已有 `transition: opacity 0.18s ease-in-out`，所以只要把 hover 状态从「snap」改为「参与 transition」即可
4. 测试：snapshot 旧 CSS 不再含 `!important`

**Verify**：测试过

---

## Commit 10: feat(renderer) — pin toggle fade (P4.4)

**目标**：📌 切换原文/译文有 200ms 渐变。

**步骤**：
1. 改 `renderer.ts:562-566` 的 `overlay.textContent = ...` 立即替换
2. 改为：用两个并存的 overlay 实例，一个 opacity 1 一个 opacity 0，200ms 内 swap
3. **简化方案**：保留单 overlay，用 `overlay.style.opacity = '0'; setTimeout(200ms, () => { overlay.textContent = ...; overlay.style.opacity = '1' })`
4. 测试：mock click 事件，断言 200ms 内 opacity 变化

**Verify**：测试过

---

## Commit 11: docs(perf) — P3b baseline trace (P4.5)

**目标**：把 P3b 版本的 perf trace 留下来。

**步骤**：
1. 在 P3b 分支（`feat/p3b-translation-transparency`）跑 Chrome DevTools 翻译 5 张图，导出 trace
2. `gzip` 后保存到 `docs/perf-traces/p3b-baseline.trace.json.gz`
3. 在 P4 分支 cherry-pick 这个 commit（或直接添加文件，因为 git 不会去重 .gz）

**注**：这步可能要 Jasper 手动跑（人工）。如果跑不动，commit 11-12 改用 perf micro-bench 数据代替。

**Verify**：trace 文件可读

---

## Commit 12: docs(perf) — P4 after trace (P4.5)

**目标**：把 P4 版本的 perf trace 留下来。

**步骤**：同 commit 11，但用 P4 分支代码跑。

**Verify**：两份 trace 大小相近，差异在 ±5% 之内

---

## Commit 13: chore(deps) — validate build (P4.5)

**目标**：确认 build 没退化。

**步骤**：
1. 跑 `pnpm build`
2. 对比 `dist/content.js` 大小（gzip 后）与 P3b
3. 如果变化 > 5%，找原因；否则只 commit 一个 `chore: validate p4 build size` 空 commit（或加 benchmark 数字到 README）

**Verify**：build 成功

---

## 最终验证（PR 前）

```bash
cd /Users/panbo/conductor/workspaces/chrome-plugin-manga-translator/geneva
pnpm type-check  # 必须 0 error
pnpm lint        # 必须 0 warning
pnpm test:run    # 必须 233+ 测试全过 (P3b baseline 233)
pnpm build       # 必须成功
```

如果 gate 全绿，push + PR。

---

## Rollback Plan

如果 P4 中途发现某个 commit 引入回归：
- 找到引入回归的 commit（用 `git bisect` 或 `pnpm test:run` 跑发现）
- `git revert <commit-sha>` 单独撤回
- 继续后续 commit

如果整个 P4 方向错了（比如发现 P4.3 批处理需要 LLM 支持）：
- 标记 spec §3 「非目标」里漏写了什么
- 更新 spec，commit `docs: amend p4 spec`
- 继续

---

## 时间估算

| Commit | 工作量 |
|---|---|
| 3-4 (perf bench) | 1 小时 |
| 5-6 (cache 埋点 + UI) | 2 小时 |
| 7-8 (HUD) | 1 小时 |
| 9-10 (renderer) | 1.5 小时 |
| 11-13 (trace + verify) | 1.5 小时 + Jasper 手动 |
| **总计** | **~7 小时** + perf trace 人工 |

可一次性完成。
