# Round 1 audit — consolidated findings

Four independent reviewers (product director, visual designer, staff architect,
product strategist) audited the extension, plus a direct pass over every UI
surface. Baseline before any change: 924 tests pass, `pnpm build` green,
`dist/content.js` 131.7 KB / 200 KB.

Findings below are the ones **verified against the source** before dispatching
work. Severity: P0 = loses money / breaks the product / lies to the user;
P1 = major friction; P2 = polish.

## P0 — correctness and money

1. **`clearAll()` leaves `failedImages` populated** (`src/content/content.ts:1351`).
   It clears `processedImages` and `failedImageKeys` but not `failedImages`, so
   after "clear this page" the failed images are still queued for
   `retranslateFailedImages()` and get billed again. The other two reset sites
   (`handleRouteChange` :1887, cleanup :2025) clear all three.

2. **Two writers, two shapes, one storage key** (`src/background/background.ts:376`,
   `:416`, `:433`). Zustand's persist writes `{state, version}`; the worker's
   `setConfig` writes a flat object. On an extension *update*
   (`onInstalled` reason `'update'` → `migrateSettings()` → `setConfig(...)`),
   the flat object is written; zustand then reads `deserializedStorageValue.state`
   → `undefined` → `merge(undefined, current)` → defaults → and **writes the
   defaults back to disk**. The user's API key, endpoint, model and
   auto-translate allowlist are gone and unrecoverable.

3. **The credential gate is a no-op** (`src/background/background.ts:462`).
   `sender.id === chrome.runtime.id` is true for this extension's *own content
   scripts* too, so `isExtensionOrigin` does not mean "extension page". The
   `getConfig` / `setConfig` / `JOB_TRANSLATE_IMAGE` guards at `:478` and `:491`
   therefore never fire for a content script, which can read the deobfuscated
   key and rewrite the endpoint. `background-auth.test.ts:213` passes only
   because the mock sender omits `id`.

4. **The only "this page is spending your money" warning is inside a collapsed
   `<details>`** (`src/components/Popup/PopupApp.tsx:872`, warning at `:958`).
   `autoContinueEnabled` defaults to `true`, so after one manual translate a
   webtoon keeps translating and billing — and the only notice is invisible.
   `PopupApp.test.tsx:193` passes because jsdom finds `<details>` content with
   `getByText`.

5. **The style prompts hardcode Chinese** (`src/utils/translation-style.ts:19-53`).
   All four presets say "Simplified Chinese" / "Chinese onomatopoeia", and
   `getMangaTranslationPrompt` appends them to every request — while
   `targetLanguage` offers `en` / `ja` / `ko`. Picking English sends
   "translate to en" *and* "read like polished natural Simplified Chinese".

6. **The reading-panel toggle does nothing on first press**
   (`src/content/content.ts:1531-1537`). On a never-translated page the panel
   is created with `visible = true`, then immediately `setVisible(false)`. The
   popup also flips its own label optimistically (`PopupApp.tsx:460`), so it
   claims "hide the panel" while the page shows nothing.

7. **The price shown before the click systematically under-counts**
   (`src/content/content.ts:515`, `popup-state.ts:327`). `COUNT_IMAGES` counts
   only `img.complete === true`; lazy-loaded comic pages usually have 2–4
   loaded images and 40+ pending. The number never refreshes after the run.

8. **The force-retranslate confirm dialog gives no count**
   (`src/components/Popup/PopupApp.tsx:1150`) while the adjacent "retry failed"
   dialog does (`:1163`). `pageImageCount` is in the same component's state.

## P1 — friction and honesty

9. "Auto-translate this site" is the only unattended-billing switch and carries
   no cost warning in either surface (`PopupApp.tsx:880`, `OptionsApp.tsx:835`).
10. "Force retranslate" stays enabled while a run is in flight
    (`PopupApp.tsx:1086`) — it waits for the current (billed) run, then
    re-runs the whole page with the cache bypassed: two rounds of charges.
11. Four keyboard shortcuts and two context-menu items appear nowhere in the
    UI (`public/manifest.json:32`, `grep` finds nothing in `src/components/`).
12. The onboarding never mentions that comic images leave the machine, nor
    that it costs money, at the exact moment the user enables the extension
    (`OnboardingApp.tsx:254-285`). The only such disclosure is a dismissible
    banner on the settings page.
13. The onboarding modal has no focus trap and installs a global `Enter`
    handler (`OnboardingApp.tsx:68-85`) — pressing Enter in a field behind the
    modal silently completes onboarding and enables the extension.
14. `TARGET_LANGUAGES` is duplicated in `PopupApp.tsx:40` and
    `OptionsApp.tsx:43`; the popup's comment already warns that they drifted
    once.
15. `maxImageSize`, `translationPipeline`, `parallelLimit`, `regionBatchSize`
    and `fallbackToFullImage` are persisted but have **no UI at all** —
    including the resolution knob that dominates both quality and cost.
16. The popup reports no version and no way to export diagnostics
    (`grep chrome.runtime.getManifest` → 0 hits).
17. The store listing says onboarding happens in the popup
    (`docs/store-listing-zh.md:55`) but it only renders in the settings page.
18. `ConfirmDialog` loses focus return: the effect depends on `onCancel`, and
    all six call sites pass a fresh inline arrow, so any parent re-render
    resets the focus trap and the return-to-trigger focus never lands
    (`src/components/ui/confirm-dialog.tsx:50-111`).
19. Contrast failures measured on real computed styles: `text-slate-600` on the
    onboarding panel 2.36:1 (`OnboardingApp.tsx:124`), `text-slate-500` on a
    popup card 4.04:1 (`PopupApp.tsx:947`), `text-slate-500` on the stepper
    3.31:1 (`OnboardingApp.tsx:145`), disabled primary button 3.07:1
    (`PopupApp.tsx:730`).
20. `<summary>` has no focus ring — it falls back to the UA default blue,
    contradicting the "one focus colour" claim in `src/index.css:39`.
    `src/index.css:80`'s selector list omits `summary`.
21. The API-key show/hide button is 16×16 px (`OptionsApp.tsx:635`), under the
    24×24 WCAG 2.5.8 minimum.
22. There is no `prefers-reduced-motion` anywhere, and three `scrollIntoView`
    calls force smooth scrolling on a third-party page
    (`src/content/reading-panel.ts:430,437,501`).
23. `--primary` is pure white (`src/index.css:27`) while the product accent is
    cyan, so the switch and slider thumb read as white in a cyan product and
    the thumb measures 1.02:1 against the page.
24. Card elevation is flat: card fill vs page is 1.05:1 and card border vs card
    fill is 1.28:1.

## P2 — polish

25. The store's own screenshot shows the reading panel covering the bubble it
    is listing (`store/listing/screenshot-panel-1280x800.png`).
26. No translated-image export — the user pays for tokens and cannot keep the
    result.
27. The original text is unreachable in the reading panel, though
    `originalText` is already carried in the data.
28. No provider presets: `provider-label.ts` already maps 12 services but the
    user must type a base URL and model by hand.
29. No font control, although the renderer honours `style.fontFamily`.
30. No in-app version, changelog or diagnostics surface.
31. `'chapter'` is in the `JobScope` union but no call site ever uses it.

## Deliberately NOT changing

- Single dark theme (deliberate, `src/index.css`).
- Allowlist empty by default (deliberate, security).
- `chrome.storage.local` only (deliberate, credential boundary).
- Two message envelopes (documented migration, not a rename).
- Content-script size budget and the split vendor chunks.
- No invented per-token price table (it was wrong for every provider).
