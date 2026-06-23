# Translation transparency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "black box" moments in the translation flow. The original image stays fully visible during translation (corner spinner only, no backdrop). Translations appear immediately as they complete and are always visible (no hover-to-show). The page auto-translates on load — the user does not need to click "翻译当前页面" in the Popup.

**Architecture:** Three surgical changes:
1. `content.ts:processSingleImage` passes `autoPinned: true` to `renderer.render(...)` so the overlay is always shown.
2. `content.ts:initialize` schedules a one-shot auto-translate after `syncAutoTranslateMode` resolves, so the page translates on load.
3. `renderer.ts` replaces the full-image loading overlay (black backdrop + centered spinner) with a 20×20 px corner spinner, and the 📌 toggle's semantics flip to "show original".

**Tech Stack:** Chrome MV3, TypeScript strict, Vitest. No new dependencies.

---

## File structure

**Modified:**
- `src/content/content.ts` — 2 call-site changes (autoPinned: true + one-shot auto-translate in `initialize`).
- `src/services/renderer.ts` — replace the full-image loading overlay with a corner spinner; flip the 📌 toggle's semantics.

**Not modified:**
- `src/content/floating-hud.ts` — unchanged.
- `src/services/translator.ts` — LLM call is unchanged.
- `src/services/image-processor.ts` — image fetch is unchanged.
- `src/stores/*` — config store is unchanged.
- `CHANGELOG.md` — deferred to v0.4.0.

---

### Task 1: Default overlay to always-visible

**Files:**
- Modify: `src/content/content.ts:188-204` (the only `renderer.render` call site)

- [ ] **Step 1: Read `processSingleImage`**

Run: `sed -n '186,210p' src/content/content.ts`
Expected: shows the call `renderer.render(img, result.textAreas)` (no third arg).

- [ ] **Step 2: Pass `true` for `autoPinned`**

Find: `renderer.render(img, result.textAreas);`
Replace with: `renderer.render(img, result.textAreas, true);`

- [ ] **Step 3: Type-check + test**

Run: `pnpm type-check && pnpm test:run`
Expected: both pass. (The `autoPinned` parameter already exists in the renderer signature, so the type-check should not require changes.)

- [ ] **Step 4: Commit**

```bash
git add src/content/content.ts
git commit -m "feat(content): default translated overlays to always-visible

The only call to renderer.render now passes autoPinned: true,
making translated text always visible. The 📌 toggle still
works per-image, but the default state is now 'show translation'
instead of 'show on hover'.

This is the single-line change that delivers 'no mouse movement
required to read' — the most impactful UX win in the read flow."
```

---

### Task 2: Auto-translate the page on load

**Files:**
- Modify: `src/content/content.ts:initialize` (add a one-shot auto-translate after `syncAutoTranslateMode`)

- [ ] **Step 1: Read the bottom of `initialize`**

Run: `sed -n '550,600p' src/content/content.ts`
Expected: shows the `initialize` function. Look for the line `await syncAutoTranslateMode();` and the line `setupHudEventListeners();`.

- [ ] **Step 2: Schedule a one-shot auto-translate**

Add the following **immediately after** the `await syncAutoTranslateMode();` line:

```ts
    // Translate the page on load (one-shot). The auto-translate
    // observer handles new images; this handles images that were
    // already in the DOM when the content script injected.
    // shouldAutoTranslateFollowUp already maps 'onboarding' to
    // 'idle' (see P3a fix), so this is a no-op when the user is
    // not configured.
    autoTranslateScheduler.schedule();
```

(The `autoTranslateScheduler` constant is already defined at module scope and is debounced by ~300ms. The single schedule call coalesces with any in-flight DOM-mutation schedules.)

- [ ] **Step 3: Type-check + test**

Run: `pnpm type-check && pnpm test:run`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/content/content.ts
git commit -m "feat(content): auto-translate the page on load

The auto-translate observer handles images added to the DOM
after injection, but images that were already there when the
content script ran were silently ignored — forcing the user to
click '翻译当前页面' in the Popup. Schedule a one-shot
auto-translate after syncAutoTranslateMode resolves, so the
page translates on its own within ~300ms of injection.

The shouldAutoTranslateFollowUp gate (P3a) ensures this is a
no-op when the provider is not configured."
```

---

### Task 3: Replace the full-image loading overlay with a corner spinner

**Files:**
- Modify: `src/services/renderer.ts:462-506` (CSS) and `renderer.ts:665-704` (renderLoading + removeLoading)

- [ ] **Step 1: Read the current loading CSS**

Run: `sed -n '460,510p' src/services/renderer.ts`
Expected: shows the `.manga-translator-loading`, `.manga-translator-spinner`, and `@keyframes manga-spin` rules.

- [ ] **Step 2: Replace the loading CSS**

Find the block from `.manga-translator-loading {` (line ~462) through the closing `}` of `@keyframes manga-spin { to { transform: rotate(360deg); } }` (line ~485).

Replace with:

```css
    .manga-translator-loading {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 20px;
      height: 20px;
      pointer-events: none;
      z-index: 1001;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .manga-translator-loading-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: manga-spin 0.8s linear infinite;
    }

    @keyframes manga-spin {
      to { transform: rotate(360deg); }
    }
```

- [ ] **Step 3: Drop the old full-image backdrop and loading-text classes**

Find and delete these classes (they are no longer used):
- `.manga-translator-loading-content`
- `.manga-translator-loading-text`

These should be at lines ~492-505.

- [ ] **Step 4: Read the current `renderLoading` implementation**

Run: `sed -n '665,710p' src/services/renderer.ts`
Expected: shows `renderLoading(image)` and `removeLoading(image)`. Note the inner HTML uses `.manga-translator-loading-content` and `.manga-translator-loading-text`.

- [ ] **Step 5: Replace `renderLoading`'s inner HTML**

Find the `loading.innerHTML = ...` block inside `renderLoading`:

```ts
    loading.innerHTML = `
      <div class="manga-translator-loading-content">
        <div class="manga-translator-spinner"></div>
        <div class="manga-translator-loading-text">翻译中...</div>
      </div>
    `;
```

Replace with:

```ts
    loading.innerHTML = `<div class="manga-translator-loading-spinner"></div>`;
```

- [ ] **Step 6: Type-check + lint + test**

Run: `pnpm type-check && pnpm lint:strict && pnpm test:run`
Expected: all three pass. (The CSS classes we removed are not referenced anywhere else in TypeScript; if any test was asserting on the old spinner selector, update it.)

- [ ] **Step 7: Commit**

```bash
git add src/services/renderer.ts
git commit -m "feat(renderer): replace loading backdrop with corner spinner

The previous loading state covered the image with a black 40%
opacity + backdrop-filter blur + centered spinner. This is a
read-stop: the user loses the original panel for 3-8 seconds.

Replace with a 20x20 px corner-only spinner pinned to the top-
right of the wrapper. The original image stays fully visible.
The reader's eye never loses the panel.

Loading-time visual is now: [image] with [tiny spinner] in the
top-right corner. As the translation completes, the overlay
fades in over the original."
```

---

### Task 4: Flip the 📌 toggle's semantics

**Files:**
- Modify: `src/services/renderer.ts:589-601` (the toggle button click handler in `render`)

- [ ] **Step 1: Read the current toggle click handler**

Run: `sed -n '585,610p' src/services/renderer.ts`
Expected: shows the click handler that toggles `rendered.pinned` and swaps the icon between 📌 and 👁.

- [ ] **Step 2: Update the toggle to "show original" semantics**

Replace the toggle button's click handler with:

```ts
    // Toggle button: with autoPinned: true (the new default), the
    // user sees the translation. Clicking 📌 shows the ORIGINAL
    // text instead, so the user can compare. A second click
    // restores the translation.
    const toggleBtn = document.createElement('button');
    toggleBtn.title = '切换原文 / 译文';
    toggleBtn.textContent = rendered.pinned ? '👁' : '📌';
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rendered = this.renderedOverlays.get(image);
      if (!rendered) return;
      rendered.pinned = !rendered.pinned;
      wrapper.classList.toggle('manga-translator-pinned', rendered.pinned);
      toggleBtn.textContent = rendered.pinned ? '👁' : '📌';
      for (const overlay of rendered.overlays) {
        const area = textAreas[rendered.overlays.indexOf(overlay)];
        overlay.textContent = rendered.pinned
          ? (overlay.getAttribute('data-translated') ?? area.translatedText)
          : (overlay.getAttribute('data-original') ?? area.originalText);
      }
    });
    controls.appendChild(toggleBtn);
```

- [ ] **Step 3: Set the `data-translated` attribute on each overlay at creation time**

Find the `createOverlayElement` method (around line 707) and update the line that sets attributes:

Find:
```ts
    overlay.textContent = area.translatedText;
    overlay.setAttribute('data-original', area.originalText);
```

Replace with:
```ts
    overlay.textContent = area.translatedText;
    overlay.setAttribute('data-original', area.originalText);
    overlay.setAttribute('data-translated', area.translatedText);
```

(This stores the translated text alongside the original so the toggle can flip back without re-fetching the area data.)

- [ ] **Step 4: Type-check + lint + test**

Run: `pnpm type-check && pnpm lint:strict && pnpm test:run`
Expected: all three pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/renderer.ts
git commit -m "feat(renderer): 📌 toggle now means 'show original'

The previous 📌 toggle pinned the translation (show it on hover,
keep it shown on leave). With autoPinned: true as the new
default, translations are already always visible — so a 'pin'
button is no longer useful.

The new semantics: clicking 📌 temporarily replaces each
overlay's translated text with the original text. A second
click restores the translation. Each overlay stores the
translated text in a data-translated attribute so the toggle
can flip back without re-fetching the source data.

The icon flips between 📌 (currently showing translation) and
👁 (currently showing original)."
```

---

### Task 5: Final verification

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
pnpm type-check && pnpm lint:strict && pnpm test:run && pnpm build
```
Expected: all four exit 0.

- [ ] **Step 2: Verify the call-site change**

Run:
```bash
grep -nE "renderer\.render" src/content/content.ts
```
Expected: the line shows `renderer.render(img, result.textAreas, true);`.

- [ ] **Step 3: Verify the auto-translate scheduler is called once in `initialize`**

Run:
```bash
grep -nE "autoTranslateScheduler\.schedule" src/content/content.ts
```
Expected: at least 2 hits (one in `startAutoTranslateObserver`'s `hasNewImages` branch, one new in `initialize`).

- [ ] **Step 4: Verify the loading CSS no longer has the backdrop**

Run:
```bash
grep -nE "backdrop-filter" src/services/renderer.ts
```
Expected: empty (the old `.manga-translator-loading` backdrop-filter: blur(2px) is gone).

---

## Self-Review Notes

This plan covers every section of the spec:

| Spec section | Covered by |
|---|---|
| Default overlay to always-visible | Task 1 |
| Auto-translate page on load | Task 2 |
| Replace loading backdrop with corner spinner | Task 3 |
| Flip 📌 toggle to "show original" | Task 4 |
| Verification (type-check, lint, test, build, grep) | Task 5 |

Total LoC changed: ~80 across 2 files. No new dependencies. No spec ambiguities — the call sites are precise and the existing types already cover the change.

No placeholders. Every step has the exact code, command, and expected output.
