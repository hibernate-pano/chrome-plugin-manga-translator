# Add local error statistics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local `chrome.storage.local` counter that increments on every translation-flow failure (by `TranslationErrorCode`), and render the running counts in a new "诊断" card at the bottom of the Options page, with a single "清零" button.

**Architecture:** One new utility module owns the storage key and three async functions. The content script's translation-failure path calls `incrementErrorStats(friendly.code)` (fire-and-forget). The Options page reads on mount + on `chrome.storage.onChanged` and renders a simple table sorted by count desc. Empty state = card hidden.

**Tech Stack:** Chrome MV3, TypeScript strict, React, shadcn/ui (existing `Card` and `Button` from `src/components/ui/`), Vitest. No new dependencies.

---

## File structure

**New:**
- `src/utils/error-stats.ts` — three async functions, single storage key, `ErrorStats` type.

**Modified:**
- `src/content/content.ts` — add `import { incrementErrorStats } from '@/utils/error-stats';` and one `void` call at the translation-failure site.
- `src/components/Options/OptionsApp.tsx` — add a new `Card` at the bottom of the rendered page with a table and a "清零" button.

**Not modified:**
- `src/utils/error-handler.ts` — `TranslationErrorCode` and `parseTranslationError` are used as-is.
- `src/background/background.ts` — error stats are local-only; no background involvement.
- `CHANGELOG.md` — deferred to the v0.3.5 release that bundles P1a + P1b + P0-C + P2.

---

### Task 1: Create `src/utils/error-stats.ts`

**Files:**
- Create: `src/utils/error-stats.ts`

- [ ] **Step 1: Create the file**

Write `src/utils/error-stats.ts` with the following content:

```ts
import { TranslationErrorCode } from '@/utils/error-handler';

const STORAGE_KEY = 'manga-translator-error-stats';

export type ErrorStats = Partial<Record<TranslationErrorCode, number>>;

export async function incrementErrorStats(
  code: TranslationErrorCode
): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const counts: ErrorStats =
    (result[STORAGE_KEY] as ErrorStats | undefined) ?? {};
  counts[code] = (counts[code] ?? 0) + 1;
  await chrome.storage.local.set({ [STORAGE_KEY]: counts });
}

export async function getErrorStats(): Promise<ErrorStats> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ErrorStats | undefined) ?? {};
}

export async function clearErrorStats(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/utils/error-stats.ts
git commit -m "feat(error-stats): add local error counter module

Three async functions backed by chrome.storage.local at
'manga-translator-error-stats':
- incrementErrorStats(code): sparse Partial<Record<TranslationErrorCode, number>>
- getErrorStats(): returns the counts object (empty on first read)
- clearErrorStats(): removes the storage key

Lives next to the error handler module so adding a new counter
call site is a one-line import."
```

---

### Task 2: Wire `incrementErrorStats` into the translation-failure path in `content.ts`

**Files:**
- Modify: `src/content/content.ts` (top imports + line 379 area)

- [ ] **Step 1: Read the import block at the top of `content.ts`**

Run: `sed -n '1,35p' src/content/content.ts`
Expected: shows existing imports. Find where `parseTranslationError` is imported from `@/utils/error-handler`.

- [ ] **Step 2: Add the new import**

Add this import alongside the existing `parseTranslationError` import:

```ts
import { incrementErrorStats } from '@/utils/error-stats';
```

- [ ] **Step 3: Read the translation-failure block around line 379**

Run: `sed -n '370,395p' src/content/content.ts`
Expected: shows a block ending with `setState({ status: 'error', message: friendly.message, suggestion: friendly.suggestion });` (or similar — exact whitespace may differ).

- [ ] **Step 4: Add the increment call**

Add a single line immediately after the `setState({ status: 'error', ... })` call:

```ts
void incrementErrorStats(friendly.code);
```

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/content/content.ts
git commit -m "feat(content): count translation-flow errors by code

The translation failure path in content.ts now increments a local
counter keyed by TranslationErrorCode. The init-failure path (line
~146) is intentionally NOT counted — it fires once per page load
and would add noise to the diagnostics view.

The increment is fire-and-forget (void) so the error UI doesn't
wait on storage I/O."
```

---

### Task 3: Add "诊断" card to `OptionsApp.tsx`

**Files:**
- Modify: `src/components/Options/OptionsApp.tsx` (top imports + add a new card at the bottom of the page)

- [ ] **Step 1: Read the current import block and the last card in `OptionsApp.tsx`**

Run: `sed -n '1,40p' src/components/Options/OptionsApp.tsx`
Expected: shows the existing React / shadcn / store imports.

Then run: `tail -40 src/components/Options/OptionsApp.tsx`
Expected: shows the closing of the last card and the page wrapper.

- [ ] **Step 2: Add new imports**

Add these imports (preserve alphabetical order / existing style):

```ts
import { useEffect, useState } from 'react';
import { getErrorStats, clearErrorStats, type ErrorStats } from '@/utils/error-stats';
import { TranslationErrorCode } from '@/utils/error-handler';
```

(If `useEffect` and `useState` are already imported from `react`, do not add a duplicate line — extend the existing one. Same for `Card` and `Button` from `@/components/ui/`.)

- [ ] **Step 3: Build the diagnostics card component**

Add a new component inside the same file, just before the default-exported `OptionsApp` function:

```tsx
function ErrorStatsCard() {
  const [stats, setStats] = useState<ErrorStats>({});

  useEffect(() => {
    void getErrorStats().then(setStats);

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') return;
      if (changes['manga-translator-error-stats']) {
        void getErrorStats().then(setStats);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const entries = Object.entries(stats).sort(
    ([, a], [, b]) => (b ?? 0) - (a ?? 0)
  );

  if (entries.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>诊断</CardTitle>
        <CardDescription>本地累计的翻译失败次数（按错误码）</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">错误码</th>
              <th className="text-right py-2">次数</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([code, count]) => (
              <tr key={code} className="border-b last:border-0">
                <td className="py-2 font-mono">{code}</td>
                <td className="py-2 text-right">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          onClick={() => {
            void clearErrorStats().then(() => setStats({}));
          }}
        >
          清零
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 4: Render the new card**

Find the end of the page wrapper (just before the closing `</div>` of the outermost page container) and add:

```tsx
<ErrorStatsCard />
```

The exact placement: after the last existing card / section, before the final closing wrapper. Verify by reading the surrounding JSX to find the right spot.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: exit 0. If a shadcn component is missing (e.g. `CardFooter`), check whether it exists in `src/components/ui/` and import it; otherwise inline a `<div>`.

- [ ] **Step 6: Lint**

Run: `pnpm lint:strict`
Expected: exit 0 with no warnings. If there are warnings, fix them (most likely an unused import if the parent component doesn't need `useState` for anything else).

- [ ] **Step 7: Commit**

```bash
git add src/components/Options/OptionsApp.tsx
git commit -m "feat(options): add diagnostics card with per-code error counts

New '诊断' card at the bottom of the Options page renders a
table of TranslationErrorCode → count, sorted by count desc.
A '清零' button clears the storage key. The card is hidden when
the storage is empty (no errors recorded yet) — no empty-state
placeholder, just absent.

The card re-fetches on chrome.storage.onChanged events for the
'manga-translator-error-stats' key, so updates from the content
script show up without a manual reload."
```

---

### Task 4: Final verification

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
pnpm type-check && pnpm lint:strict && pnpm test:run && pnpm build
```
Expected: all four exit 0.

- [ ] **Step 2: Verify the residual grep is clean**

Run:
```bash
grep -rEn "manga-translator-error-stats" src/ public/
```
Expected: 3 hits — one in `src/utils/error-stats.ts` (STORAGE_KEY constant), one in `src/components/Options/OptionsApp.tsx` (the storage key check in the onChanged listener).

---

## Self-Review Notes

This plan covers every section of the spec:

| Spec section | Covered by |
|---|---|
| New `src/utils/error-stats.ts` with 3 functions | Task 1 |
| Modify `content.ts:379` to call `incrementErrorStats` | Task 2 |
| Add diagnostics card to `OptionsApp.tsx` | Task 3 |
| Empty state = card hidden | Task 3 (early `return null`) |
| Re-fetch on storage change | Task 3 (onChanged listener) |
| Verification (type-check, lint, test, build, grep) | Task 4 |

No placeholders. Every step has the exact code, command, and expected output. The plan is small enough (~80 LoC of new code) that no subagent decomposition is needed — the implementer does all 3 tasks in one sitting.
