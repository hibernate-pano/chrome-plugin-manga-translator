# Remove the hybrid-regions pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physically remove the `hybrid-regions` translation pipeline (Tesseract.js, WASM shims, ~2,500 LoC of code, two npm deps, the `copy-tesseract.js` build step, and the three hybrid-related config fields) and migrate stored user config from `version: 2` to `version: 3` by dropping the legacy fields.

**Architecture:** Hard delete + migration. The pipeline is dead code; we are not gating it behind a flag. The only remaining translation path is `full-image-vlm`. `version: 3` migration in `useAppConfigStore.persist.migrate` deletes the three legacy config keys (`translationPipeline`, `regionBatchSize`, `fallbackToFullImage`) and the cache store drops the `hybrid-v1` token from cache keys. Tests are updated as the code they pin is removed.

**Tech Stack:** Vite + CRXJS, TypeScript (strict), Vitest, Zustand `persist`, Chrome MV3. No new dependencies added; two removed (`tesseract.js`, `tesseract.js-core`).

---

## File structure

**Deleted entirely:**

- `src/services/text-detector.ts`
- `src/services/text-detector.test.ts`
- `src/services/reading-result.ts`
- `src/utils/ocr-provider-selector.ts`
- `scripts/copy-tesseract.js`
- `public/tesseract/` (5 files, ~14 MB)
- `src/services/config-change.test.ts` (entire file, all 7 tests are hybrid pipeline-switching)

**Modified — surgical removal:**

- `src/services/translator.ts` — drop `translateWithHybridPipeline`, `translateRegionsWithHybrid`, `translateRegionBatch`, `prepareTextRegions`, `findNearestSegment`, `mapTextAreasToOriginalImage`, `toOriginalRegion`, `textAreasToReadingResult`, `readingEntriesToTextAreas`, `HYBRID_PIPELINE_VERSION`, `MAX_REASONABLE_REGION_COUNT`, `MAX_ALLOWED_MISSING_RATIO`. Simplify `translateImage` to a single linear path.
- `src/services/image-processor.ts` — drop `isHybridRegions` field, drop `cropRegions`, `combineCroppedRegions`, and any orphan types they leave behind.
- `src/utils/image-priority.ts` — drop `splitIntoBatches`.
- `src/providers/base.ts` — drop the `isHybridRegions: true` branch in `getMangaTranslationPrompt`; drop the `isHybridRegions?` parameter on `VisionProvider.analyzeAndTranslate`. Update the `VisionProvider` interface and all three implementations.
- `src/providers/openai.ts`, `src/providers/ollama.ts`, `src/providers/lm-studio.ts` — drop the `isHybridRegions?` parameter from `analyzeAndTranslate` signatures.
- `src/shared/app-config.ts` — drop `translationPipeline`, `regionBatchSize`, `fallbackToFullImage` from the interface and `DEFAULT_CONFIG`.
- `src/stores/config-v2.ts` — same three fields; drop `setRegionBatchSize`, `setFallbackToFullImage`, `setPipeline` actions; bump `version` to 3 and add migration step that deletes those fields.
- `src/stores/cache-v2.ts` — drop the `hybrid-v1` token from `buildCacheKey` (or wherever the pipeline version is appended).
- `src/types/index.ts` — drop the `'hybrid-regions' | 'full-image-vlm'` union.
- `package.json` — drop `tesseract.js` and `tesseract.js-core`; strip the leading `node scripts/copy-tesseract.js &&` from `dev` and `build` scripts.
- `public/manifest.json` — `web_accessible_resources` becomes `["icons/*"]`.

**Tests updated:**

- `src/services/cache-integration.test.ts` — drop the 2 `HYBRID_PIPELINE_VERSION` tests.
- `src/services/image-processor.test.ts` — drop the 5 `isHybridRegions` tests; if the file is mostly gone, delete it.
- `src/providers/base.test.ts` — drop the hybrid-prompt-branch test.
- `src/utils/image-priority.test.ts` — drop `splitIntoBatches` tests; keep the rest.

**Docs:**

- `CLAUDE.md` — drop the hybrid-regions subsection and the `tesseract/*` mention.
- `README.md` — drop the bullet "你想用 Tesseract.js 做离线翻译".
- `CHANGELOG.md` — add a new `[Unreleased]` entry describing the removal.

---

## Task ordering rationale

Tasks 1-3 prep the build system (so subsequent test runs work without tesseract), Tasks 4-9 remove source code in dependency order (provider layer first, then translator, then store, then tests), Task 10 updates the migration, Tasks 11-13 update docs and verify. Each task is a single commit.

---

### Task 1: Strip `copy-tesseract.js` from build scripts in `package.json`

**Files:**
- Modify: `package.json:7-8` (the `dev` and `build` script lines)

- [ ] **Step 1: Read current `dev` and `build` lines**

Run: `grep -n '"dev"\|"build"' package.json`
Expected output:
```
7:    "dev": "node scripts/copy-tesseract.js && vite",
8:    "build": "node scripts/copy-tesseract.js && tsc && vite build",
```

- [ ] **Step 2: Edit `dev` script**

Replace `"dev": "node scripts/copy-tesseract.js && vite"` with `"dev": "vite"`.

- [ ] **Step 3: Edit `build` script**

Replace `"build": "node scripts/copy-tesseract.js && tsc && vite build"` with `"build": "tsc && vite build"`.

- [ ] **Step 4: Verify edit**

Run: `grep -n '"dev"\|"build"' package.json`
Expected output:
```
7:    "dev": "vite",
8:    "build": "tsc && vite build",
```

- [ ] **Step 5: Run lint to confirm package.json is still valid JSON-ish (eslint will load it)**

Run: `pnpm lint`
Expected: succeeds (no errors referencing package.json).

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "chore(build): drop copy-tesseract step from dev and build scripts"
```

---

### Task 2: Remove `tesseract.js` and `tesseract.js-core` from `dependencies`

**Files:**
- Modify: `package.json:59-60`

- [ ] **Step 1: Read current dependency lines**

Run: `grep -n 'tesseract' package.json`
Expected output:
```
59:    "tesseract.js": "^7.0.0",
60:    "tesseract.js-core": "^7.0.0",
```

- [ ] **Step 2: Delete both lines**

Delete the two lines containing `tesseract.js` and `tesseract.js-core`.

- [ ] **Step 3: Refresh lockfile**

Run: `pnpm install`
Expected: removes tesseract packages from `node_modules` and updates `pnpm-lock.yaml`. Look for lines like:
```
... removed tesseract.js ...
```

- [ ] **Step 4: Verify they're gone**

Run: `ls node_modules/tesseract.js 2>&1 | head -1`
Expected: `ls: node_modules/tesseract.js: No such file or directory`

- [ ] **Step 5: Run type-check (sanity, expect no error yet because source still imports them)**

Run: `pnpm type-check`
Expected: should still pass because source files that import tesseract are still present. Errors will come after Task 5+.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): remove tesseract.js and tesseract.js-core"
```

---

### Task 3: Delete `scripts/copy-tesseract.js` and `public/tesseract/`

**Files:**
- Delete: `scripts/copy-tesseract.js`
- Delete: `public/tesseract/` (entire directory)

- [ ] **Step 1: Confirm directory size before deletion (verification baseline)**

Run: `du -sh public/tesseract`
Expected: about `14M`.

- [ ] **Step 2: Delete `copy-tesseract.js`**

Run: `rm scripts/copy-tesseract.js`
Expected: no output.

- [ ] **Step 3: Delete `public/tesseract/` directory**

Run: `rm -rf public/tesseract`
Expected: no output.

- [ ] **Step 4: Verify both gone**

Run: `ls scripts/copy-tesseract.js 2>&1; ls -d public/tesseract 2>&1`
Expected: both lines are "No such file or directory".

- [ ] **Step 5: Commit**

```bash
git add -A scripts/copy-tesseract.js public/tesseract
git commit -m "chore(build): remove copy-tesseract.js script and public/tesseract assets"
```

---

### Task 4: Drop `tesseract/*` from `web_accessible_resources` in `manifest.json`

**Files:**
- Modify: `public/manifest.json:40`

- [ ] **Step 1: Read the current `web_accessible_resources` block**

Run: `sed -n '38,43p' public/manifest.json`
Expected output:
```json
  "web_accessible_resources": [
    {
      "resources": ["icons/*", "tesseract/*"],
      "matches": ["<all_urls>"]
    }
  ]
```

- [ ] **Step 2: Edit the resources array**

Replace `"resources": ["icons/*", "tesseract/*"]` with `"resources": ["icons/*"]`.

- [ ] **Step 3: Verify**

Run: `sed -n '38,43p' public/manifest.json`
Expected output:
```json
  "web_accessible_resources": [
    {
      "resources": ["icons/*"],
      "matches": ["<all_urls>"]
    }
  ]
```

- [ ] **Step 4: Commit**

```bash
git add public/manifest.json
git commit -m "chore(manifest): drop tesseract/* from web_accessible_resources"
```

---

### Task 5: Delete `src/utils/ocr-provider-selector.ts`

**Files:**
- Delete: `src/utils/ocr-provider-selector.ts`

- [ ] **Step 1: Confirm no production code outside the file imports it**

Run: `grep -rn "ocr-provider-selector\|OCRProviderSelector" src/ --include='*.ts' --include='*.tsx' | grep -v 'ocr-provider-selector.ts'`
Expected: empty output (no other importers).

- [ ] **Step 2: Delete the file**

Run: `rm src/utils/ocr-provider-selector.ts`

- [ ] **Step 3: Verify type-check passes (the only tesseract references left should now be in code we haven't deleted yet — translator.ts, image-processor.ts, etc.)**

Run: `pnpm type-check`
Expected: still passes; this file had no tesseract imports, only OCR abstractions over it.

- [ ] **Step 4: Commit**

```bash
git add -A src/utils/ocr-provider-selector.ts
git commit -m "refactor: delete unused ocr-provider-selector helper"
```

---

### Task 6: Delete `src/services/text-detector.ts` and its test

**Files:**
- Delete: `src/services/text-detector.ts`
- Delete: `src/services/text-detector.test.ts`

- [ ] **Step 1: Find all importers of `text-detector`**

Run: `grep -rn "from.*text-detector\|from '@/services/text-detector'\|from '../text-detector'" src/ --include='*.ts' --include='*.tsx'`
Expected: shows only `src/services/translator.ts`. We will fix that importer in Task 8.

- [ ] **Step 2: Delete both files**

Run: `rm src/services/text-detector.ts src/services/text-detector.test.ts`

- [ ] **Step 3: Commit (do NOT run type-check yet — translator.ts still imports deleted symbols; expect failure until Task 8)**

```bash
git add -A src/services/text-detector.ts src/services/text-detector.test.ts
git commit -m "refactor: delete text-detector (Tesseract.js wrapper)"
```

---

### Task 7: Delete `src/services/reading-result.ts` and clean up its other importers

**Files:**
- Delete: `src/services/reading-result.ts`
- Modify: `src/types/index.ts:17-24`
- Modify: `src/stores/cache-v2.ts:13, 27`

- [ ] **Step 1: Find all importers**

Run: `grep -rn "reading-result\|ImageReadingResult\|ReadingEntry\|createReadingEntryId" src/ --include='*.ts' --include='*.tsx' | grep -v 'reading-result.ts'`
Expected: three importers — `src/services/translator.ts`, `src/types/index.ts` (re-exports `ImageReadingResult` and `ReadingEntry`), and `src/stores/cache-v2.ts` (uses `ImageReadingResult` as a `readingResult?` field type). This task fixes the latter two; Task 8 will fix `translator.ts`.

- [ ] **Step 2: Remove the re-exports from `src/types/index.ts`**

Find the import block that pulls `ImageReadingResult` and `ReadingEntry` from `@/services/reading-result`. Delete the entire import. Search the rest of `src/types/index.ts` for any references to those two type names and delete them too. After this, no code outside `translator.ts` should reference these types.

- [ ] **Step 3: Remove `readingResult` field from `src/stores/cache-v2.ts`**

The cache entry interface has `readingResult?: ImageReadingResult` (used only by hybrid). Delete that field from the type. Also delete the `import type { ImageReadingResult } from '@/services/reading-result';` line. After this, the cache stores only `{ success, textAreas, cachedAt }` (or whatever shape remains — verify by reading the file).

- [ ] **Step 4: Delete the file**

Run: `rm src/services/reading-result.ts`

- [ ] **Step 5: Commit (do NOT run type-check yet — `translator.ts` still imports deleted symbols; Task 8 fixes it)**

```bash
git add -A src/services/reading-result.ts src/types/index.ts src/stores/cache-v2.ts
git commit -m "refactor: delete reading-result types (hybrid-only); clean re-export and cache"
```

---

### Task 8: Remove hybrid branches from `src/services/translator.ts`

**Files:**
- Modify: `src/services/translator.ts`

- [ ] **Step 1: Delete imports of removed modules**

In `src/services/translator.ts`, remove these import lines:
```ts
import {
  detectTextRegions,
  mergeOverlappingRegions,
  type TextRegion,
} from '@/services/text-detector';
import {
  createReadingEntryId,
  type ImageReadingResult,
  type ReadingEntry,
} from '@/services/reading-result';
```

Also remove:
```ts
import { splitIntoBatches } from '@/utils/image-priority';
```
(splitIntoBatches is the only thing imported from image-priority here.)

- [ ] **Step 2: Delete hybrid-only constants**

Find and delete these three lines:
```ts
const HYBRID_PIPELINE_VERSION = 'hybrid-v1';
const MAX_REASONABLE_REGION_COUNT = 80;
const MAX_ALLOWED_MISSING_RATIO = 0.4;
```

- [ ] **Step 3: Replace `translateImage` with the single-path version**

Find:
```ts
async translateImage(
  image: HTMLImageElement,
  viewportCrop: boolean = false,
  imageKeyOverride?: string,
  forceRefresh: boolean = false
): Promise<TranslationResult> {
  if (isDevelopment) {
    _log('开始翻译图片');
  }

  try {
    // 步骤1：处理图片（压缩 + base64 + hash + possible viewport crop）
    if (isDevelopment) {
      _log('处理图片...');
    }

    const processOptions: ImageProcessingOptions = {
      maxSize: DEFAULT_OPTIONS.maxSize,
      quality: DEFAULT_OPTIONS.quality,
      viewportCrop: false,
      ...this.config.imageOptions, // Merge user-defined options
    };

    if (viewportCrop) {
      processOptions.maxSize = 1600;
      processOptions.quality = 0.80;
      processOptions.format = 'webp';
      processOptions.viewportCrop = true;
    }

    const processed = await processImage(image, processOptions);
    if (isDevelopment) {
      _log('图片处理完成, hash:', processed.hash.substring(0, 16));
    }

    const imageKey = imageKeyOverride || processed.hash;
    const cacheKey = this.buildCacheKey(processed.hash);

    // 步骤3：检查缓存
    if (this.config.cacheEnabled && !forceRefresh) {
      const cached = useTranslationCacheStore.getState().get(cacheKey);
      if (cached) {
        if (isDevelopment) {
          _log('使用缓存结果, 文字区域数:', cached.textAreas.length);
        }
        useUsageStore.getState().addRecord({
          provider: this.config.provider,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          cached: true,
        });
        return cached;
      }
    }

    const result = await this.translateWithHybridPipeline(
      image,
      processed,
      imageKey,
      viewportCrop,
      forceRefresh
    );

    // 步骤5：写入缓存
    if (this.config.cacheEnabled) {
      if (isDevelopment) {
        _log('存入缓存');
      }
      useTranslationCacheStore
        .getState()
        .set(cacheKey, result, this.config.provider);
    }

    return result;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.warn('[Translator] 翻译失败:', errorMessage);
    if (isDevelopment && error instanceof Error && error.stack) {
      _logError('错误堆栈:', error.stack);
    }
    return {
      success: false,
      textAreas: [],
      error: errorMessage,
    };
  }
}
```

Replace with:
```ts
async translateImage(
  image: HTMLImageElement,
  viewportCrop: boolean = false,
  imageKeyOverride?: string,
  forceRefresh: boolean = false
): Promise<TranslationResult> {
  if (isDevelopment) {
    _log('开始翻译图片');
  }

  try {
    const processOptions: ImageProcessingOptions = {
      maxSize: DEFAULT_OPTIONS.maxSize,
      quality: DEFAULT_OPTIONS.quality,
      viewportCrop: false,
      ...this.config.imageOptions,
    };

    if (viewportCrop) {
      processOptions.maxSize = 1600;
      processOptions.quality = 0.80;
      processOptions.format = 'webp';
      processOptions.viewportCrop = true;
    }

    const processed = await processImage(image, processOptions);
    if (isDevelopment) {
      _log('图片处理完成, hash:', processed.hash.substring(0, 16));
    }

    const imageKey = imageKeyOverride || processed.hash;
    const cacheKey = this.buildCacheKey(processed.hash);

    if (this.config.cacheEnabled && !forceRefresh) {
      const cached = useTranslationCacheStore.getState().get(cacheKey);
      if (cached) {
        if (isDevelopment) {
          _log('使用缓存结果, 文字区域数:', cached.textAreas.length);
        }
        useUsageStore.getState().addRecord({
          provider: this.config.provider,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          cached: true,
        });
        return cached;
      }
    }

    const response = await retryWithBackoff(
      () =>
        this.callTranslationTransport(
          processed.base64,
          processed.mimeType,
          this.config.targetLanguage,
          forceRefresh,
          {
            imageKey,
            imageUrl: image.currentSrc || image.src,
            pageUrl: window.location.href,
          }
        ),
      2,
      1000
    );

    if (response.usage) {
      useUsageStore.getState().addRecord({
        provider: this.config.provider,
        usage: response.usage,
        cached: false,
      });
    }

    const result: TranslationResult = {
      success: true,
      textAreas: response.textAreas,
    };

    if (this.config.cacheEnabled) {
      if (isDevelopment) {
        _log('存入缓存');
      }
      useTranslationCacheStore
        .getState()
        .set(cacheKey, result, this.config.provider);
    }

    return result;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.warn('[Translator] 翻译失败:', errorMessage);
    if (isDevelopment && error instanceof Error && error.stack) {
      _logError('错误堆栈:', error.stack);
    }
    return {
      success: false,
      textAreas: [],
      error: errorMessage,
    };
  }
}
```

- [ ] **Step 4: Delete hybrid helper methods**

Find and delete the entire `translateWithHybridPipeline`, `translateRegionsWithHybrid`, `translateRegionBatch`, `prepareTextRegions`, `findNearestSegment`, `mapTextAreasToOriginalImage`, `toOriginalRegion`, `textAreasToReadingResult`, `readingEntriesToTextAreas` methods. After deletion, the file should have no references to `TextRegion`, `ReadingEntry`, `ImageReadingResult`, or `'hybrid-regions'`.

- [ ] **Step 5: Update `buildCacheKey` to drop the hybrid version token**

Find:
```ts
private buildCacheKey(imageHash: string): string {
  const requestedPath = deriveRequestedPath(this.config.provider);
  const executionScope = `provider::${requestedPath}::${this.config.provider}::${this.config.model || 'default'}`;
  return [
    imageHash,
    executionScope,
    this.config.targetLanguage,
    this.config.translationStylePreset,
    this.config.renderMode || 'strong-overlay-compat',
    HYBRID_PIPELINE_VERSION,
  ].join('::');
}
```

Replace with:
```ts
private buildCacheKey(imageHash: string): string {
  const requestedPath = deriveRequestedPath(this.config.provider);
  const executionScope = `provider::${requestedPath}::${this.config.provider}::${this.config.model || 'default'}`;
  return [
    imageHash,
    executionScope,
    this.config.targetLanguage,
    this.config.translationStylePreset,
    this.config.renderMode || 'strong-overlay-compat',
  ].join('::');
}
```

- [ ] **Step 6: Run type-check**

Run: `pnpm type-check`
Expected: succeeds. If errors remain, they must reference `src/services/image-processor.ts` (next task) or `src/providers/base.ts`. Do not proceed until type-check is green.

- [ ] **Step 7: Run tests**

Run: `pnpm test:run -- src/services/translator`
Expected: passes. If a test imports from deleted helpers, the test will be removed in Task 13.

- [ ] **Step 8: Commit**

```bash
git add src/services/translator.ts
git commit -m "refactor(translator): drop hybrid-regions branches; linearize full-image path"
```

---

### Task 9: Remove `cropRegions`, `combineCroppedRegions`, and `isHybridRegions` from `src/services/image-processor.ts`

**Files:**
- Modify: `src/services/image-processor.ts`

- [ ] **Step 1: Find the `isHybridRegions` field and the `combineCroppedRegions` function**

Run: `grep -n "isHybridRegions\|combineCroppedRegions\|cropRegions\|labelWidth" src/services/image-processor.ts`
Expected: lists the field in the options interface, the helpers, and their usages.

- [ ] **Step 2: Remove `isHybridRegions` from `ImageProcessingOptions`**

Find:
```ts
export interface ImageProcessingOptions {
  /** ... existing fields ... */
  /** Whether to add visual indices for hybrid region stitching */
  isHybridRegions?: boolean;
}
```

Delete the `isHybridRegions` field and its JSDoc comment.

- [ ] **Step 3: Remove `cropRegions` and `combineCroppedRegions` functions**

Find the `combineCroppedRegions` function (uses `labelWidth` and `isHybridRegions`). Delete both `cropRegions` and `combineCroppedRegions` entirely.

- [ ] **Step 4: Verify no callers remain**

Run: `grep -rn "cropRegions\|combineCroppedRegions\|isHybridRegions" src/ --include='*.ts' --include='*.tsx'`
Expected: empty output.

- [ ] **Step 5: Run type-check**

Run: `pnpm type-check`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/services/image-processor.ts
git commit -m "refactor(image-processor): drop isHybridRegions, cropRegions, combineCroppedRegions"
```

---

### Task 10: Drop `splitIntoBatches` from `src/utils/image-priority.ts`

**Files:**
- Modify: `src/utils/image-priority.ts`

- [ ] **Step 1: Find the function and its callers**

Run: `grep -rn "splitIntoBatches" src/ --include='*.ts' --include='*.tsx'`
Expected: only `src/utils/image-priority.ts` (after Task 8 deleted translator's usage).

- [ ] **Step 2: Delete the function**

Find the `splitIntoBatches` function definition (likely takes `items: T[]` and `batchSize: number`). Delete it along with any helper types it declared locally.

- [ ] **Step 3: Verify no remaining references**

Run: `grep -rn "splitIntoBatches" src/ --include='*.ts' --include='*.tsx'`
Expected: empty output.

- [ ] **Step 4: Run type-check**

Run: `pnpm type-check`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/utils/image-priority.ts
git commit -m "refactor(image-priority): drop hybrid-only splitIntoBatches"
```

---

### Task 11: Remove `isHybridRegions` from `VisionProvider` interface and three implementations

**Files:**
- Modify: `src/providers/base.ts`
- Modify: `src/providers/openai.ts` (via `openai-compatible-base.ts`)
- Modify: `src/providers/ollama.ts`
- Modify: `src/providers/lm-studio.ts`

- [ ] **Step 1: Read the `VisionProvider` interface in `src/providers/base.ts`**

Run: `grep -n "isHybridRegions\|TranslationStylePreset" src/providers/base.ts | head -20`
Expected: shows the parameter in the interface signature and in `getMangaTranslationPrompt`.

- [ ] **Step 2: Update the interface**

Find:
```ts
analyzeAndTranslate(
  imageBase64: string,
  targetLanguage: string,
  translationStylePreset?: TranslationStylePreset,
  isHybridRegions?: boolean
): Promise<VisionResponse>;
```

Replace with:
```ts
analyzeAndTranslate(
  imageBase64: string,
  targetLanguage: string,
  translationStylePreset?: TranslationStylePreset
): Promise<VisionResponse>;
```

- [ ] **Step 3: Simplify `getMangaTranslationPrompt`**

Find the `isHybridRegions` parameter on `getMangaTranslationPrompt`. Replace the function with:
```ts
export function getMangaTranslationPrompt(
  targetLanguage: string,
  translationStylePreset: TranslationStylePreset = DEFAULT_TRANSLATION_STYLE_PRESET
): string {
  return `Extract ALL visible text from this manga/comic image and translate to ${targetLanguage}.

Return ONLY valid JSON: {"textAreas":[{"x":0.1,"y":0.2,"width":0.3,"height":0.1,"originalText":"原文","translatedText":"翻译"}]}

RULES:
1. Find ALL text: bubbles, narration, signs, SFX, tiny side text, faint small captions. Don't miss small text.
2. x,y,width,height are 0.0-1.0 ratios relative to image. x,y = top-left corner. Mark a TIGHT box around the text itself, not the whole speech bubble or empty padding.
3. Merge multi-line text in one bubble into ONE item.
4. SFX: use target language onomatopoeia.
5. Keep original speaker tone (formal/casual).
6. Use \\n for line breaks in translatedText.
7. No text found: {"textAreas":[]}
8. If two text blocks are separate, return separate items. Avoid giant boxes that overlap unrelated text.
9. Output ONLY the JSON.

${getTranslationStyleInstruction(translationStylePreset)}`;
}
```

- [ ] **Step 4: Update `OpenAICompatibleProvider.analyzeAndTranslate` in `src/providers/openai-compatible-base.ts`**

Find:
```ts
async analyzeAndTranslate(
  imageBase64: string,
  targetLanguage: string,
  translationStylePreset?: TranslationStylePreset,
  isHybridRegions?: boolean
): Promise<VisionResponse> {
```

Replace with:
```ts
async analyzeAndTranslate(
  imageBase64: string,
  targetLanguage: string,
  translationStylePreset?: TranslationStylePreset
): Promise<VisionResponse> {
```

Then find any in-body call to `getMangaTranslationPrompt(..., isHybridRegions)` and remove the trailing `isHybridRegions` argument.

- [ ] **Step 5: Update `OllamaProvider.analyzeAndTranslate` in `src/providers/ollama.ts`**

Find:
```ts
async analyzeAndTranslate(
  imageBase64: string,
  targetLanguage: string,
  translationStylePreset?: TranslationStylePreset,
  isHybridRegions?: boolean
): Promise<VisionResponse> {
```

Replace with:
```ts
async analyzeAndTranslate(
  imageBase64: string,
  targetLanguage: string,
  translationStylePreset?: TranslationStylePreset
): Promise<VisionResponse> {
```

Then find any in-body call to `getMangaTranslationPrompt(..., isHybridRegions)` and remove the trailing argument.

- [ ] **Step 6: Update `LMStudioProvider.analyzeAndTranslate` in `src/providers/lm-studio.ts`**

Find the equivalent signature and apply the same edit.

- [ ] **Step 7: Verify no remaining `isHybridRegions` references**

Run: `grep -rn "isHybridRegions" src/ --include='*.ts' --include='*.tsx'`
Expected: empty output.

- [ ] **Step 8: Run type-check and tests**

Run: `pnpm type-check && pnpm test:run -- src/providers`
Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add src/providers/base.ts src/providers/openai-compatible-base.ts src/providers/ollama.ts src/providers/lm-studio.ts
git commit -m "refactor(providers): drop isHybridRegions from VisionProvider interface"
```

---

### Task 12: Drop hybrid fields from `src/shared/app-config.ts` and `src/stores/config-v2.ts`

**Files:**
- Modify: `src/shared/app-config.ts`
- Modify: `src/stores/config-v2.ts`

- [ ] **Step 1: Find every reference to the three fields**

Run: `grep -rn "translationPipeline\|regionBatchSize\|fallbackToFullImage\|setRegionBatchSize\|setFallbackToFullImage\|setPipeline" src/ --include='*.ts' --include='*.tsx' | grep -v 'config-change.test.ts'`
Expected: lists field definitions, setters, selectors, and possibly UI consumers. UI consumers will be addressed in this task if simple.

- [ ] **Step 2: Edit `src/shared/app-config.ts`**

Remove these three lines from the `RuntimeAppConfig` interface:
```ts
  translationPipeline: 'hybrid-regions' | 'full-image-vlm';
  regionBatchSize: number;
  fallbackToFullImage: boolean;
```

Remove the corresponding three properties from `DEFAULT_CONFIG`:
```ts
  translationPipeline: 'full-image-vlm',
  regionBatchSize: 10,
  fallbackToFullImage: true,
```

If there is a UI hook or comment referencing `'hybrid-regions'`, remove it too.

- [ ] **Step 3: Edit `src/stores/config-v2.ts`**

Remove the three property accesses in the local `AppConfigState extends RuntimeAppConfig` interface, the three `SHARED_DEFAULT_CONFIG.x` lines from the initializer, the three setters (`setRegionBatchSize`, `setFallbackToFullImage`, `setPipeline`), and any selector that reads them.

- [ ] **Step 4: Bump `version` to 3 and add migration step**

Find the existing `persist({ ..., version: 2, migrate: ... })` config in `src/stores/config-v2.ts`. Replace with:
```ts
persist({
  name: 'manga-translator-config',
  version: 3,
  migrate: (persistedState: unknown, version: number) => {
    let state = (persistedState ?? {}) as Record<string, unknown>;

    // Existing v0 → v1 and v1 → v2 migrations preserved above this line.

    if (version < 3) {
      delete state.translationPipeline;
      delete state.regionBatchSize;
      delete state.fallbackToFullImage;
    }

    return state;
  },
})
```

Note: do NOT remove existing earlier-version migrations; this task only adds the v3 step. Read the current migrate function first to confirm shape before editing.

- [ ] **Step 5: Verify no remaining references**

Run: `grep -rn "translationPipeline\|regionBatchSize\|fallbackToFullImage\|setPipeline\|setRegionBatchSize\|setFallbackToFullImage" src/ --include='*.ts' --include='*.tsx' | grep -v 'config-change.test.ts'`
Expected: empty output.

- [ ] **Step 6: Run type-check**

Run: `pnpm type-check`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/shared/app-config.ts src/stores/config-v2.ts
git commit -m "refactor(config): drop hybrid fields; bump persist version to 3 with hard migration"
```

---

### Task 13: Remove `'hybrid-regions' | 'full-image-vlm'` pipeline enum (final cleanup)

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/stores/cache-v2.ts`

Note: most of the hybrid-related cleanup in these two files already happened in Task 7 (re-export removal, `readingResult?` field deletion). This task removes the remaining `'hybrid-regions' | 'full-image-vlm'` union (which the cache store may still reference for the `pipeline` field on cache entries) and any leftover `'hybrid-regions'` literal in `cache-v2.ts`.

- [ ] **Step 1: Find pipeline enum in types**

Run: `grep -n "hybrid-regions\|full-image-vlm\|TranslationPipeline" src/types/index.ts`
Expected: shows a `'hybrid-regions' | 'full-image-vlm'` union, possibly used as a `pipeline` field type.

- [ ] **Step 2: Edit types**

If `TranslationPipeline` is a type alias, narrow it to `'full-image-vlm'` (or delete the alias if unused after the narrowing). If the `'hybrid-regions'` literal appears in any other type union, remove it.

- [ ] **Step 3: Inspect cache-v2.ts for remaining hybrid references**

Run: `grep -n "hybrid\|HYBRID\|hybrid-regions\|full-image-vlm" src/stores/cache-v2.ts`
Expected: may show a `pipeline` field on cached entries or a `hybrid-regions` literal. Remove any `hybrid-regions` literal — narrow `pipeline` to `'full-image-vlm'` or remove the field if no longer meaningful.

- [ ] **Step 4: Run type-check and tests**

Run: `pnpm type-check && pnpm test:run -- src/stores`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/stores/cache-v2.ts
git commit -m "refactor(types,cache): drop hybrid-regions from pipeline enum"
```

---

### Task 14: Delete `src/services/config-change.test.ts` (all tests are hybrid pipeline-switching)

**Files:**
- Delete: `src/services/config-change.test.ts`

- [ ] **Step 1: Confirm no non-hybrid tests in the file**

Run: `head -30 src/services/config-change.test.ts`
Expected: header comments mention "Translation pipeline switching (hybrid-regions ↔ full-image-vlm)". The whole file is hybrid-only.

- [ ] **Step 2: Delete the file**

Run: `rm src/services/config-change.test.ts`

- [ ] **Step 3: Run full test suite to ensure no other test imports from it**

Run: `pnpm test:run`
Expected: passes. If any other test imports from this file (it shouldn't), that test needs separate surgery.

- [ ] **Step 4: Commit**

```bash
git add -A src/services/config-change.test.ts
git commit -m "test: delete config-change.test.ts (hybrid-only)"
```

---

### Task 15: Remove hybrid tests from `cache-integration.test.ts`, `image-processor.test.ts`, `providers/base.test.ts`, `image-priority.test.ts`

**Files:**
- Modify: `src/services/cache-integration.test.ts`
- Modify: `src/services/image-processor.test.ts`
- Modify: `src/providers/base.test.ts`
- Modify: `src/utils/image-priority.test.ts`

- [ ] **Step 1: Remove the 2 `HYBRID_PIPELINE_VERSION` tests from `cache-integration.test.ts`**

Find the `describe` blocks containing `HYBRID_PIPELINE_VERSION`. Delete only those `it(...)` blocks. Do not delete the surrounding describe block if other tests remain inside it. Run `pnpm test:run -- src/services/cache-integration` to confirm the file still passes after the edits.

- [ ] **Step 2: Remove the 5 `isHybridRegions` tests from `image-processor.test.ts`**

Find the 5 tests that pass `isHybridRegions: true|false` in their options. Delete them. If the file becomes mostly empty (e.g., fewer than 3 tests remain), delete the whole file:
```bash
rm src/services/image-processor.test.ts
```
Run `pnpm test:run -- src/services/image-processor` to confirm.

- [ ] **Step 3: Remove hybrid-prompt-branch test from `providers/base.test.ts`**

Find the test that asserts the hybrid prompt (the one with `isHybridRegions: true`). Delete it. Run `pnpm test:run -- src/providers/base` to confirm.

- [ ] **Step 4: Remove `splitIntoBatches` tests from `image-priority.test.ts`**

Find the `describe('splitIntoBatches', ...)` block. Delete it. Run `pnpm test:run -- src/utils/image-priority` to confirm.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test:run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/services/cache-integration.test.ts src/services/image-processor.test.ts src/providers/base.test.ts src/utils/image-priority.test.ts
git commit -m "test: drop hybrid-regions test cases from remaining suites"
```

---

### Task 16: Final verification — type-check, lint, full test, build, residual-grep

**Files:** none

- [ ] **Step 1: Type-check**

Run: `pnpm type-check`
Expected: exits 0.

- [ ] **Step 2: Lint strict**

Run: `pnpm lint:strict`
Expected: exits 0 with no warnings.

- [ ] **Step 3: Full test run**

Run: `pnpm test:run`
Expected: exits 0.

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: exits 0. After completion, run:
```bash
ls dist/tesseract 2>&1
grep -li tesseract dist/*.js 2>&1 | head -5
```
Expected: `dist/tesseract` is "No such file or directory"; the grep returns no tesseract-containing JS files (or only files with the literal "tesseract" in unrelated comments, which we accept).

- [ ] **Step 5: Residual grep**

Run:
```bash
grep -rEn "hybrid|tesseract|TextRegion|ImageReadingResult|ReadingEntry|HYBRID_PIPELINE" src/ public/ scripts/ package.json public/manifest.json
```
Expected: only `CHANGELOG.md` matches (intentional). If anything else matches, fix it.

- [ ] **Step 6: Add CHANGELOG entry**

Edit `CHANGELOG.md`. Add at the top (above `[0.3.4]`):
```markdown
## [Unreleased]

### Removed

- **`hybrid-regions` translation pipeline** and all its supporting code: Tesseract.js wrapper (`src/services/text-detector.ts`), reading-result types (`src/services/reading-result.ts`), OCR provider selector helper (`src/utils/ocr-provider-selector.ts`), hybrid-region detection, region batching, region cropping/label-drawing, and the `isHybridRegions` codepath in the provider layer. Also removed: `tesseract.js` and `tesseract.js-core` npm dependencies, `scripts/copy-tesseract.js`, the `public/tesseract/` 14 MB WASM directory, and the `tesseract/*` entry in `web_accessible_resources`. The only remaining translation pipeline is `full-image-vlm`. Stored config bumps to `version: 3`; legacy fields `translationPipeline`, `regionBatchSize`, and `fallbackToFullImage` are deleted on migration. Cache entries written under the old `hybrid-v1` version token are invalidated. No behavior change for users on `full-image-vlm` (the default since v0.3.3).
```

- [ ] **Step 7: Update CLAUDE.md and README.md**

In `CLAUDE.md`:
- Remove the "Translation Pipeline" subsection (the two paragraphs mentioning `hybrid-regions`).
- Remove the `tesseract/*` mention under `web_accessible_resources`.

In `README.md`:
- Remove the bullet point: `你想用 Tesseract.js 做离线翻译——v0.3.3 的默认管线是 \`full-image-vlm\`（VLM 直出），Tesseract 仅在显式开启 \`hybrid-regions\` 模式时使用`.

- [ ] **Step 8: Commit**

```bash
git add CHANGELOG.md CLAUDE.md README.md
git commit -m "docs: document hybrid-regions removal in CHANGELOG, CLAUDE, README"
```

- [ ] **Step 9: Final residual grep after docs update**

Run:
```bash
grep -rEn "hybrid|tesseract|TextRegion|ImageReadingResult|ReadingEntry|HYBRID_PIPELINE" src/ public/ scripts/ package.json public/manifest.json
```
Expected: empty. (CHANGELOG.md is allowed to mention these names in the historical entry — the spec documents this is intentional.)

---

## Self-Review Notes (do not delete; for reviewer's eyes)

This plan covers every section of the spec:

| Spec section | Covered by |
|---|---|
| Pure deletes (5 files + dir) | Tasks 3, 5, 6, 7, 14 |
| Surgical edits to `translator.ts` | Task 8 |
| Surgical edits to `image-processor.ts` | Task 9 |
| Surgical edits to `image-priority.ts` | Task 10 |
| Surgical edits to `providers/base.ts` + impls | Task 11 |
| Surgical edits to `app-config.ts` + `config-v2.ts` | Task 12 |
| Surgical edits to `types/index.ts` + `cache-v2.ts` | Task 13 |
| Test surgery | Tasks 14, 15 |
| `package.json` build + dep edits | Tasks 1, 2 |
| `manifest.json` `web_accessible_resources` | Task 4 |
| `version: 2 → 3` migration | Task 12 step 4 |
| `CHANGELOG.md`, `CLAUDE.md`, `README.md` | Task 16 steps 6–7 |
| Verification (type-check, lint, test, build, grep) | Task 16 steps 1–5, 9 |

Risks called out in the spec ("cache invalidation", "silent coerce for hybrid users") are handled by Task 8 step 5 (drop `HYBRID_PIPELINE_VERSION` from cache key) and Task 12 step 4 (silent field deletion).

No placeholders. Every step has the exact command, expected output, and code where applicable.
