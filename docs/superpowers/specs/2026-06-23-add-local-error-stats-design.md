# Add local error statistics

- **Date**: 2026-06-23
- **Status**: Design (awaiting user review)
- **Author**: Claude (co-founder / architect role)
- **Target release**: next minor

## Context

`src/utils/error-handler.ts` defines 16 `TranslationErrorCode` values. When a translation fails, the content script converts the raw error into a `FriendlyError` (via `parseTranslationError`) and shows it in the HUD. But the count of how often each error has been triggered is **lost** — the user has no way to know "I've hit `RATE_LIMIT` 47 times this week" or "I've never seen `OLLAMA_NOT_RUNNING`".

The original PRDs discuss surfacing error info to the user, but until now there's no concrete mechanism. This is a minimal V1: a local counter, viewable in Options, manually resettable. No telemetry, no provider/dimension breakdown, no chart, no date range.

## Goal

Add a local counter that increments on every translation-flow failure, and a "诊断" card in Options that displays the running counts per `TranslationErrorCode` with a single "清零" button.

## Non-goals

- No provider/date dimension (V1 keeps it dead simple).
- No HUD/Popup display (Options only).
- No chart, no export, no test coverage.
- No automatic reset, no per-page reset, no "first time seen" tracking.
- No migration logic — if storage is empty, the card shows nothing.

## Approach

A single shared module owns the storage key and three functions. The content script calls increment on the one site that matters. The Options page reads on mount and on storage change.

| Decision | Choice | Reason |
|---|---|---|
| Storage backend | `chrome.storage.local` | API key + config already live there (P0-C). No new permission. |
| Storage key | `manga-translator-error-stats` | Scoped to extension, descriptive. |
| Counter granularity | `Partial<Record<TranslationErrorCode, number>>` | Sparse — only codes that fired show up. |
| Count which call site? | `content.ts:379` only | Translation flow. The init-fail at line 146 fires once per page-load; counting it is noise. |
| Wiring in content script | Fire-and-forget `void` | UI must not wait on storage write. |
| UI placement | Bottom of `OptionsApp.tsx` (single-page, no tabs) | Natural append point. |
| Empty state | Show nothing | A "no errors recorded" line adds noise. |
| Test coverage | None | V1 is throwaway — premature. |
| Zustand store? | No | It's a single key in storage, no derived state. Direct `chrome.storage.local` calls are simpler. |

## Scope of changes

### New file: `src/utils/error-stats.ts` (~40 LoC)

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

### Modify: `src/content/content.ts:379`

After the existing `setState({ status: 'error', ... })`, add one line:

```ts
void incrementErrorStats(friendly.code);
```

The new import line goes at the top of the file alongside the existing `parseTranslationError` import.

### Modify: `src/components/Options/OptionsApp.tsx`

Add a new `<Card>` at the bottom of the rendered page (after the existing cards, before the closing wrapper). ~30 LoC:

- `useEffect` on mount → `getErrorStats()` → `setStats`
- `useEffect` listening to `chrome.storage.onChanged` → re-fetch on `STORAGE_KEY` change (so the card updates without a reload)
- Render a `<Table>` (or a simple grid) of code → count rows, sorted by count desc
- "清零" button → `clearErrorStats()` → setStats({})
- Skip rendering if `Object.keys(stats).length === 0`

Reuse the existing `Card` / `Button` shadcn components in `src/components/ui/`. No new shadcn components.

## Migration

None. Empty storage → empty UI.

## Verification

1. `pnpm type-check` exits 0.
2. `pnpm lint:strict` exits 0 with no warnings.
3. `pnpm test:run` is fully green.
4. `pnpm build` succeeds.

Manual smoke (not gated):
- Force a known failure (e.g. set a bogus API key), trigger translation, open Options, see the corresponding code counted.
- Click 清零, refresh, counts gone.

## Risks

- **Negligible**: If `chrome.storage.local.set` fails (quota, race), the increment is lost. Acceptable for V1.
- **Negligible**: The `chrome.storage.onChanged` listener fires across all storage changes; the `if (key === STORAGE_KEY)` guard is required (will include in implementation).
- **Negligible**: If the user clears site data / uninstalls the extension, the counts vanish. Acceptable.

## Out of scope (separate tasks)

- Provider/date dimension.
- HUD/Popup display.
- Export / chart.
- Test coverage.
- v0.3.5 release that bundles P1a + P1b + P0-C.
- Renaming `requestedPath: 'ollama-direct'` → `'local-server-direct'`.

## Open questions

None.
