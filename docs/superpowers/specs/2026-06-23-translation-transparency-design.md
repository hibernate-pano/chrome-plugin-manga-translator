# Translation transparency: no-backdrop loading + always-pinned overlays

- **Date**: 2026-06-23
- **Status**: Design (awaiting user review)
- **Author**: Claude (co-founder / architect role)
- **Target release**: next minor (v0.4.0)
- **Branch**: `feat/p3b-translation-transparency`

## Context

P3a removed the configuration wall at install + first-visit. P3b fixes the **translation experience itself** so that the user never has a "black box" moment:

1. **Currently** when a manga image starts translating, `renderer.renderLoading()` (renderer.ts:665-691) covers the image with a `rgba(0, 0, 0, 0.4)` + `backdrop-filter: blur(2px)` overlay plus a centered spinner. This means the user **loses the original image** for 3-8 seconds while the LLM responds. For a reader, that is a hard read-stop.

2. **Currently** translated overlays default to `hover-to-show` (`renderer.ts:386-395`): the user must mouse over the image to see the Chinese translation, and the translation auto-hides on `mouseleave` after 120ms. This means the reader has to wave the mouse over each panel before reading it — for a page with 8 panels, that's 8+ mouse moves and 8+ moments of "is the translation showing yet?". `autoPinned` exists as a parameter but **no caller in the codebase passes `true`** (verified — the only call site in `content.ts:processSingleImage` omits the third arg).

3. **Currently** the auto-translate observer (content.ts:236-268) only fires on DOM mutations and is **deactivated until the user enables the extension** (the old default was `enabled: false`). With P3a's `enabled: true` default, the observer now runs by default — but only on new images. The images that were already on the page when the content script loaded are **not** translated automatically. The user has to open the Popup and click "翻译当前页面". This is the "first click" that breaks the zero-friction promise.

## Goal

The user opens a manga page and:

- **Immediately sees the original images** (no black-box overlay during translation).
- **Sees the translation appear as soon as it's ready** for each image, one panel at a time, with a brief fade-in.
- **Does not need to move the mouse** to see translations; they are always visible once the image is translated.
- **Does not need to click "翻译当前页面"** — the page translates itself on load.
- **Knows that an image is still being translated** via a small corner spinner, not a backdrop.

## Non-goals

- Not changing the underlying LLM call, the cache, or the provider layer.
- Not adding per-image progress bars (the small corner spinner is enough — a page has many images; per-image progress would be visual noise).
- Not changing the auto-translate observer's debounce behavior (300ms is fine).
- Not removing the user's ability to toggle a single overlay's pinned state (the 📌 button is preserved — it now becomes a "show original / show translation" toggle, since "always show translation" is the new default).
- Not changing Popup behavior or the manual "翻译当前页面" button (it's still useful for "force a fresh translation ignoring cache").

## Approach

Three coordinated changes, all small:

| Decision | Choice | Reason |
|---|---|---|
| Default overlay state on render | `autoPinned: true` (always-visible) | The user said "fluent" — hover-to-show is not fluent. The 📌 button flips the default back to hover for users who want to compare original + translation side-by-side. |
| Loading indicator | Corner-only spinner (top-right, 16×16 px, semi-transparent), original image fully visible | Reader's eye never loses the panel. |
| Page-load translation | Auto-translate observer's `startAutoTranslateObserver` schedules a one-shot `translatePage()` immediately on init (not just on mutations) | Page is translated without a user click. |
| 📌 toggle semantics | Now means "show original" (inverts the autoPinned state per-image) | A user looking at a translation can tap 📌 to peek at the original text. |
| Overlay fade-in | Already exists (`manga-overlay-fadein` 0.3s keyframe, renderer.ts:487-490) | Reused. |
| Backwards compatibility | `autoPinned: false` parameter still works (callers that explicitly want hover-only can still pass it; we just change the default at the only call site) | The signature stays the same. |

## Scope of changes

### Modified: `src/content/content.ts:processSingleImage` (line 188-204)
Change the only `renderer.render(...)` call to pass `true` for `autoPinned`:

```ts
renderer.render(img, result.textAreas, true);
```

That single change makes translated overlays always visible.

### Modified: `src/content/content.ts:startAutoTranslateObserver` (line 236-268)
The observer already schedules a debounced `translatePage()` on DOM mutations. Add an **immediate** one-shot call at the bottom of `startAutoTranslateObserver` (or in a separate `useEffect`-like bootstrap in `initialize()`) so that the page translates without waiting for mutations.

Concretely: add a one-shot call to `autoTranslateScheduler.schedule()` at the end of `startAutoTranslateObserver` and **also** after `syncAutoTranslateMode` resolves (in `initialize()`) when `isAutoTranslateEnabled` is true. The 300ms debounce coalesces the call with any in-flight mutation; the page translates within ~300ms of injection.

The existing `shouldAutoTranslateFollowUp` gate (which I already made `onboarding`-aware in P3a) is reused — if the extension is not configured, this is a no-op.

### Modified: `src/services/renderer.ts`
1. **Loading overlay (line 462-506 + 665-704)**: replace the full-image `rgba(0, 0, 0, 0.4)` + `backdrop-filter: blur(2px)` overlay with a 20×20 px corner spinner pinned to the top-right of the wrapper. The image remains fully visible.
2. **Pin toggle behavior (line 589-601)**: invert the meaning. With `autoPinned: true` (the new default), the 📌 icon now reads "show original" (👁 stays for "show translation"). When clicked, the user sees the **original** text and the 📌 button becomes a "back to translation" affordance. This is per-image; toggling does not affect other images.

   Implementation: when `pinned` is true (showing translation), clicking the button sets `pinned` to false AND replaces the overlay text with the original (using `overlay.getAttribute('data-original')`); when `pinned` is false, the overlay text is restored from `area.translatedText`. The `hover-active` class on the wrapper is removed so the CSS shows the original. On second click, restore.

   The simpler version: when `pinned` is true, hover-active is also true (CSS already shows overlays); when user clicks the 📌 button, `pinned` toggles to false, hover-active is removed, and overlay textContent is replaced with the original. On a re-hover, the overlay container is opacity 0 (per CSS), so the user sees the original image. On click again, the overlay textContent is restored to translated, pinned is true, hover-active is true.

3. **CSS for the new corner spinner (line 462-506)**: drop the full-image wrapper. The new class is `manga-translator-loading` but the styles are scoped to a 20×20 px absolutely-positioned element at the top-right corner with `pointer-events: none`. Reuse the existing `@keyframes manga-spin`.

### Not modified
- `src/content/floating-hud.ts` — the HUD is for status (translating, complete, error). The P3a onboarding card lives in the HUD. P3b does not change the HUD.
- `src/services/translator.ts` — the LLM call is unchanged.
- `src/services/image-processor.ts` — the image fetch is unchanged.
- `src/stores/*` — config store is unchanged.
- `CHANGELOG.md` — deferred to the v0.4.0 release that bundles P3a + P3b.

## Migration / Backwards compatibility

- **Existing users with `enabled: false`**: preserved by the Zustand persist layer. The new `autoPinned: true` only affects the rendering of newly translated images. The auto-translate observer only fires when `enabled: true`.
- **Existing users with `enabled: true`**: nothing visible changes immediately on upgrade, but on the next page load the auto-translate observer now also schedules a one-shot translate, so the first manga page they open will translate without a Popup click. (This is the intended improvement.)
- **No stored data is migrated or deleted.**

## Verification

1. `pnpm type-check` exits 0.
2. `pnpm lint:strict` exits 0 with no warnings.
3. `pnpm test:run` is fully green.
4. `pnpm build` succeeds.
5. `grep -nE "autoPinned" src/content/content.ts src/services/renderer.ts` returns at least one `true` in `content.ts` (the call site).
6. **Manual smoke** (not gated but listed for the user to try):
   - Open a manga page on a fresh install (or with `enabled: true` and a valid API key). The page should translate without clicking "翻译当前页面" in the Popup.
   - During translation, the original image should remain visible (no black overlay); a small spinner should appear in the top-right corner of the image.
   - As translations complete, the translated overlays should appear with a 0.3s fade-in.
   - Hovering the image should not change the overlay visibility (they are always shown).
   - Clicking the 📌 button on a translated image should temporarily show the original text. Clicking it again restores the translation.

## Risks

- **Negligible**: The 300ms debounce on auto-translate means a page that loads with all images already in the DOM (most cases) starts translating within ~300ms of content-script injection. Not perceptible.
- **Negligible**: Concurrent in-flight images + an immediate auto-translate could queue up a large number of LLM calls. The existing `BackgroundJobQueue` (parallelLimit default 3) caps this. No change needed.
- **Negligible**: The 📌 toggle semantics change (was "pin translation", now "show original"). Users who relied on the old behavior — clicking 📌 to "always show translation" — get the opposite. But since the new default is "always show translation", the 📌 button is now "show original" — which is the more useful action (you don't need a button to keep the default).
- **Negligible**: A user who actually wants hover-to-show can... well, they can't anymore in this design. Spec explicitly trades that for the zero-friction gain. Users who specifically want hover-only can be addressed in a future release if it becomes a real complaint.

## Out of scope (separate tasks)

- v0.4.0 release.
- Renaming `requestedPath: 'ollama-direct'` → `'local-server-direct'`.
- Per-image progress bars.
- Provider/date dimension on error stats.
- Cross-tab onboarding-state sync.

## Open questions

None.
