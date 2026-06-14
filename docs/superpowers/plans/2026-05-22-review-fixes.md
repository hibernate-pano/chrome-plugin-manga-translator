# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use $subagent-driven-development (if subagents available) or $executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four review findings around config drift, overlay-style propagation, long-image cache identity, and background queue drain behavior without widening product scope.

**Architecture:** Keep the current direct-extension architecture and patch behavior at the existing boundaries: config store/background normalization, content-script config consumption, translator cache identity, and queue scheduling. Prefer narrow fixes plus regression tests over new abstractions.

**Tech Stack:** TypeScript, Zustand persist, Chrome extension runtime messaging/storage, Vitest

---

### Task 1: Align Config Defaults And Overlay Config Consumption

**Files:**
- Modify: `src/stores/config-v2.ts`
- Modify: `src/background/background.ts`
- Modify: `src/content/content.ts`
- Test: `src/stores/config-v2.test.ts`

- [ ] Add regression coverage for the expected default translation pipeline and persisted overlay-style shape.
- [ ] Keep config defaults consistent between the store and background normalization paths.
- [ ] Make storage-change handling read persisted config safely whether the snapshot is wrapped in `.state` or already flattened.
- [ ] Re-run the targeted config/content tests.

### Task 2: Fix Long-Image Cache Identity

**Files:**
- Modify: `src/services/translator.ts`
- Test: `src/services/translator-e2e.test.ts`

- [ ] Add a regression test that proves full-image fallback for tall images does not use a viewport-cropped cache identity.
- [ ] Make cache key / image key selection follow the actual translation payload that gets sent on the chosen path.
- [ ] Re-run the targeted translator tests.

### Task 3: Fix Queue Drain Semantics

**Files:**
- Modify: `src/background/job-queue.ts`
- Test: `src/background/job-queue.test.ts`

- [ ] Add regression coverage that the queue fills available concurrency slots while still honoring the minimum request interval.
- [ ] Preserve the new priority behavior, but make drain continue scheduling until capacity is actually saturated.
- [ ] Re-run the targeted queue tests.

### Task 4: Verification And Cleanup

**Files:**
- Review only: working tree

- [ ] Remove no code outside the agreed write scope.
- [ ] Run targeted tests first, then broader verification (`pnpm build`, `pnpm lint`, `pnpm test:run`) if the dependency state allows it.
- [ ] Report changed files, remaining risks, and any verification blocked by environment or network conditions.
