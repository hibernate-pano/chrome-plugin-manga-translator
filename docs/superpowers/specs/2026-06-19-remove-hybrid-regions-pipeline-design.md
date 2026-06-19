# Remove the hybrid-regions translation pipeline

- **Date**: 2026-06-19
- **Status**: Design (awaiting user review)
- **Author**: Claude (co-founder / architect role)
- **Target release**: v0.3.5

## Context

The project ships two translation pipelines:

- **`full-image-vlm`** (default since v0.3.3): send the whole image to a Vision LLM, get back translated `textAreas` with coordinates.
- **`hybrid-regions`** (legacy): run Tesseract.js OCR on the page to find text regions, crop them, batch them, send to VLM with `isHybridRegions: true` (numeric anchor labels drawn on the left margin of each cropped strip), get back translations indexed by region.

The default was changed to `full-image-vlm` in v0.3.3 because:

1. Most users never installed Tesseract, so the previous default silently disabled translation.
2. Tesseract coordinate mapping had a known bug.
3. VLM-direct processing produces higher-quality results.

The `hybrid-regions` code path was kept "for users who need it." Six months later, no public release has changed the default back, no test asserts hybrid is the active pipeline, and no shipped user has reported it. The codebase carries:

- ~2,500 LoC of hybrid-only code across 17 files
- A 14 MB `public/tesseract/` directory of WASM + JS shims
- A `scripts/copy-tesseract.js` build step
- Two npm dependencies: `tesseract.js` + `tesseract.js-core`
- A `web_accessible_resources` entry exposing `tesseract/*` to every web page

The user has confirmed this is a self-use + open-source project where manhwaread is the only target site. Hybrid-regions is dead weight.

## Goal

Remove every trace of `hybrid-regions` from the codebase, dependencies, and runtime artifacts. After this change:

- Only one translation pipeline exists: `full-image-vlm`.
- `translationPipeline` is gone from the user-facing config (the value is implicit and constant).
- No Tesseract.js dependency, no WASM shims, no copy script, no `web_accessible_resources` exposure.
- A user upgrading from v0.3.4 keeps their working setup; legacy config fields are dropped on migration.

## Non-goals

- Not changing the `full-image-vlm` pipeline itself.
- Not adding new pipelines.
- Not introducing telemetry, error reporting, or other features.
- Not touching the dual-protocol background dispatcher (separate task).

## Approach

**Hard delete** with a clean v2 → v3 migration. The decision tree:

| Decision | Choice | Reason |
|---|---|---|
| Keep code, gate behind feature flag? | No | YAGNI; git history preserves it. |
| Keep code as documented experimental? | No | 14MB of WASM + a build step is too much overhead for a future possibility. |
| Hard migrate stored config? | Yes | User confirmed: drop legacy fields entirely. |
| Preserve old cache entries? | No | Cache key changes; old entries are invalidated (acceptable on a major cleanup release). |

## Scope of changes

### Pure deletes (entire files removed)

- `src/services/text-detector.ts` — Tesseract.js wrapper, 370 LoC.
- `src/services/text-detector.test.ts` — 108 LoC.
- `src/services/reading-result.ts` — `ImageReadingResult`, `ReadingEntry` types, 38 LoC.
- `src/utils/ocr-provider-selector.ts` — Tesseract helpers, 472 LoC.
- `scripts/copy-tesseract.js` — pre-build script that copies WASM shims.
- `public/tesseract/` — 5 WASM/JS files, ~14 MB.

### Surgical edits

| File | What is removed |
|---|---|
| `src/services/translator.ts` | `translateWithHybridPipeline`, `translateRegionsWithHybrid`, `translateRegionBatch`, `prepareTextRegions`, `findNearestSegment`, `mapTextAreasToOriginalImage`, `toOriginalRegion`, `textAreasToReadingResult`, `readingEntriesToTextAreas`, `HYBRID_PIPELINE_VERSION`, `MAX_REASONABLE_REGION_COUNT`, `MAX_ALLOWED_MISSING_RATIO`. The remaining `translateImage` becomes a single linear path: `processImage` → cache check → `callTranslationTransport` → cache write. No conditional branches. |
| `src/services/image-processor.ts` | `isHybridRegions` field in `ImageProcessingOptions`; the conditional label-drawing branch inside `combineCroppedRegions`. After this, `cropRegions` and `combineCroppedRegions` have no remaining callers (only hybrid used them); delete them along with their `ImageData` types if they become orphaned. |
| `src/utils/image-priority.ts` | `splitIntoBatches`. Keep `getViewportFirstImages`, `processInParallel`. |
| `src/providers/base.ts` | The `isHybridRegions: true` branch of `getMangaTranslationPrompt`; the `isHybridRegions?` parameter on `VisionProvider.analyzeAndTranslate`. |
| `src/shared/app-config.ts` | `translationPipeline` field (no longer needed; the pipeline is constant); `regionBatchSize`; `fallbackToFullImage`. |
| `src/stores/config-v2.ts` | Same three fields; `setRegionBatchSize`, `setFallbackToFullImage`, `setPipeline` actions; any references in selectors. |
| `src/stores/cache-v2.ts` | Pipeline dimension in cache keys; the `HYBRID_PIPELINE_VERSION` token. |
| `src/types/index.ts` | The `'hybrid-regions' \| 'full-image-vlm'` enum/union. |
| `src/shared/runtime-contracts.ts` | No structural change — `pipeline: 'ocr-first' \| 'region-fallback' \| 'full-image-fallback'` on `TranslateImageJobResponse` stays (it's the response field, and `full-image-fallback` is the value that survives). |

### Test surgery

| File | Action |
|---|---|
| `src/services/config-change.test.ts` | Delete the 7 pipeline-switching tests; if the file has no remaining useful tests after that, delete the whole file. |
| `src/services/cache-integration.test.ts` | Delete the 2 `HYBRID_PIPELINE_VERSION` tests; keep the rest. |
| `src/services/image-processor.test.ts` | Delete the 5 `isHybridRegions` tests; if `cropRegions` / `combineCroppedRegions` tests were the majority, delete the whole file. |
| `src/providers/base.test.ts` | Delete the hybrid-prompt-branch test. |
| `src/utils/image-priority.test.ts` | Delete `splitIntoBatches` tests; keep `getViewportFirstImages` / `processInParallel` tests. |

### Build & manifest

- `package.json`:
  - Remove `tesseract.js` and `tesseract.js-core` from `dependencies`.
  - Strip the leading `node scripts/copy-tesseract.js &&` from `dev` and `build` scripts.
- `public/manifest.json`:
  - `web_accessible_resources` becomes `["icons/*"]` (drop `tesseract/*`).

### Docs

- `CLAUDE.md`: remove the "Translation Pipeline" subsection (lines 67–72 in current commit) entirely; remove the `web_accessible_resources` mention of `tesseract/*`.
- `README.md`: remove the bullet "你想用 Tesseract.js 做离线翻译" (line 14).
- `CHANGELOG.md`: add a new unreleased section above `[0.3.4]` titled `[Unreleased]` (or `[0.3.5]` if we ship this as v0.3.5) with a `Removed` block:
  > **`hybrid-regions` translation pipeline removed.** Tesseract.js, its WASM assets, the pre-build copy script, and the `web_accessible-resources` exposure are gone. Saved `translationPipeline`, `regionBatchSize`, and `fallbackToFullImage` config fields are dropped on migration; cache entries written under the old `hybrid-v1` version token are invalidated. v0.3.5 is a no-feature cleanup release; users on v0.3.4 keep working with no behavior change beyond the migration.

## Migration

`src/stores/config-v2.ts` `persist` config bumps `version: 2` → `version: 3`:

```ts
{
  name: 'manga-translator-config',
  version: 3,
  migrate: (persistedState: unknown, version: number) => {
    let state = (persistedState ?? {}) as Record<string, unknown>;

    // Existing v0 → v1, v1 → v2 migrations preserved as-is.

    if (version < 3) {
      delete state.translationPipeline;
      delete state.regionBatchSize;
      delete state.fallbackToFullImage;
    }

    return state;
  },
}
```

Notes:

- `translationPipeline: 'hybrid-regions'` users (if any) are silently coerced into the only remaining pipeline. No banner, no warning. This matches the user's choice of "hard migrate, no notification."
- `useTranslationCacheStore` cache keys drop the `hybrid-v1` token, so old entries do not match. They become unreachable and are eventually evicted. No explicit cache wipe needed.
- No new `migrateConfigFromSyncToLocal` interaction — that's a separate v0.3.4 → v0.3.5 concern.

## Verification

After all edits:

1. `pnpm type-check` exits 0.
2. `pnpm lint:strict` exits 0 with no warnings.
3. `pnpm test:run` is fully green.
4. `pnpm build` succeeds; `unzip -l dist/content.js | grep -i tesseract` returns nothing; `ls dist/tesseract 2>/dev/null` returns nothing.
5. Final grep across `src/ public/ scripts/ package.json` for `hybrid|tesseract|TextRegion|ImageReadingResult|ReadingEntry|HYBRID_PIPELINE` returns 0 hits outside of `CHANGELOG.md` (which intentionally references the removed names in the historical entry).

## Risks

- **Low**: An existing v0.3.4 user who manually switched to `hybrid-regions` will, on first launch of v0.3.5, get the config migrated silently and see the full-image pipeline active. This is acceptable because (a) full-image was already the default and works, (b) the migration logs to console for debugging.
- **Low**: Cache invalidation. ~14 MB of WASM gets removed but `node_modules` after `pnpm install` will reclaim disk; users who already cached translations get re-translated. Acceptable for a cleanup release.
- **Negligible**: Tesseract.js upgrade churn in the future. If a future user asks "can I have hybrid back," it's `git revert` and ~2,500 LoC restored — the commit boundary is clean.

## Out of scope (separate tasks)

- Merging the dual-protocol background dispatcher (action vs type).
- Renaming `requestedPath: 'ollama-direct'` → `'local-server-direct'`.
- Adding local error statistics.
- Releasing v0.3.5 (the `chrome.storage.sync` → `chrome.storage.local` migration in c2ded40).

## Open questions

None.