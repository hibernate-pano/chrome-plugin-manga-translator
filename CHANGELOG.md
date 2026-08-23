# Changelog

All notable changes to the chrome-plugin-manga-translator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-XX-XX

The first stable release of Manga Translator. Four phases of focused work
that took the project from "working but unpositioned" to "focused,
ethically guarded, OSS-ready".

### Headline

- Ships with `enabled=false` by default. Users must complete the onboarding
  modal before any translation runs. Closes the silent-billing risk.
- Reading-mode side panel + numbered image anchors (the differentiator).
- Errors are repair menus, not complaints. Copy-the-shell-snippet buttons
  for the common Ollama / model / CORS issues.
- English-first docs, frozen legacy backend, 3500+ lines of dead code removed.

### Stability

- `type-check`: 0 errors
- `lint:strict`: 0 warnings, 0 errors
- `vitest`: 302 tests pass (was 278 at v0.3.4; +24 new tests for onboarding,
  reading panel, anchors, HUD staged progress, copy-command actions)
- `vite build`: clean production build, content bundle ~332 KB unminified,
  ~27 KB gzipped

### Migration from v0.3.x

- v0.3.x → v1.0.0: existing users are NOT re-prompted through onboarding
  (v2 → v3 persisted-config migration sets `onboardingCompleted=true`
  automatically). They get the new reading panel + improved error UX
  immediately on upgrade.
- `server/` Python backend is no longer maintained. Users with that path
  configured should switch to `OpenAI-compatible` or `Ollama` in Settings
  → Backend. The direct paths cover every case.

## [0.7.0] - 2026-XX-XX

### Added

- **English-first README**: international positioning with quick start,
  backend comparison table, and project structure overview.
- **`ARCHITECTURE.md`**: contexts diagram, message protocol, translation
  pipeline, state layout, reading-mode internals, error contract,
  privacy/security notes.
- **`CONTRIBUTING.md`**: code layout, dev setup, conventions, "how to add a
  new provider / error code / UI component", and explicit anti-patterns.
- **`ROADMAP.md`**: 90-day plan, what we are NOT doing, open questions,
  performance budget.

### Deprecated

- **`server/` directory frozen**: the Python OCR-first backend is no longer
  maintained. The plugin's `full-image-vlm` pipeline handles all the cases
  this server used to handle. The server directory will be removed in v1.0.
  See `server/README.md` for the deprecation notice and migration guidance.

## [0.6.0] - 2026-XX-XX

### Added

- **Copy-command actions carry the runnable command**
  (`src/utils/error-handler.ts`): `ErrorAction` now has an optional
  `command` field separate from `suggestion`. `copy-command` buttons copy
  the command, not the human-readable explanation. Wired to:
  - `OLLAMA_NOT_RUNNING`     -> `ollama serve`
  - `OLLAMA_ORIGIN_NOT_ALLOWED` -> `OLLAMA_ORIGINS=chrome-extension://* ollama serve`
  - `MODEL_NOT_FOUND`        -> `ollama pull <model>` (model name substituted
    at render time from the active provider's config)
  - `CONNECTION_REFUSED`     -> `curl -v http://localhost:11434/api/tags`
- **Staged HUD progress**: distinct `scanning` state with candidate
  count + `translating` phase indicator ('translating' | 'rendering').
- **Cache-hit visibility**: HUD `complete` state now shows how many
  translations came from the cache (`其中 N 张来自缓存`).
- **Filtered-image reporting**: HUD `complete` state reports how many
  images on the page were skipped due to size / position / duplication
  (`已跳过 N 张（尺寸/位置不匹配）`).

### Changed

- **`processSingleImage`** (`src/content/content.ts`): now accepts an
  optional `onCacheHit` callback so the calling site can count cache hits.
- **`ContentState.scanning`**: gains `candidateCount?: number` so the
  scan-stage HUD can tell the user how many images will be translated.
- **`ContentState.translating`**: gains `phase?: 'translating' | 'rendering'`
  so future phases (e.g. post-processing) can be surfaced.
- **`ContentState.complete`**: gains `skippedCount?: number` so the HUD
  can report filtering without re-scanning.
- **`scanImages()`** (new internal helper): returns total / filter-skipped /
  duplicate-skipped / translatable counts so callers don't need to redo
  the pass.

## [0.5.0] - 2026-XX-XX

### Added

- **Reading mode side panel** (`src/content/reading-panel.ts`): right-side
  floating panel that lists every translated image in reading order. Each
  entry shows the image's 1-based index, a preview of the first translated
  bubble, and the full list of translations when the image has 2+ bubbles.
  Click an entry to scroll the matching image into view + flash highlight
  it for 1.2s. Collapsible header. Auto-resets with `clearAll`.
- **Numbered image anchors** (`src/content/reading-anchors.ts`): a small
  cyan badge anchored at the top-right of every translated image. Clicking
  a badge dispatches `reading-anchor-click`, which scrolls the matching
  panel entry into view + flashes it. Repositioned on scroll and resize.

### Changed

- **Content script integration** (`src/content/content.ts`): after a
  successful single-image translation, `processSingleImage` now upserts
  into the panel and anchors in addition to rendering overlays. `clearAll`
  resets both. The panel and anchors are lazily created on first
  translation and reused for the lifetime of the page.

## [0.4.0] - 2026-XX-XX

### Added (in progress)

- **First-run onboarding modal** (`src/components/Onboarding/OnboardingApp.tsx`):
  a 3-step modal that appears in the Options page when
  `onboardingCompleted === false`. Steps: welcome + data-flow disclosure →
  provider picker (OpenAI-compatible / Ollama / LM Studio) → ready + finish.
  Keyboard support: `Enter` advances, `Escape` skips. The `Skip` / `Escape`
  path marks onboarding as completed without enabling translation, so users
  who want to configure later are not pestered again.
- **`onboardingCompleted` config flag** (`RuntimeAppConfig`): persisted via
  the existing `chrome.storage.local` adapter and partialised in the Zustand
  store. Defaults to `false` for new installs.
- **`setOnboardingCompleted` store action** (`config-v2.ts`): imperative
  setter for the onboarding flow.

### Changed (in progress)

- **Product positioning in README**: extended usage section to cover the
  3-step onboarding; updated Provider list to include LM Studio alongside
  OpenAI-compatible and Ollama.
- **Persisted config version** (`config-v2.ts`): bumped from `2` to `3`.
  v2 → v3 migration marks `onboardingCompleted: true` for existing users so
  they are not re-prompted after upgrade. New installs (no persisted state)
  see the modal as designed.

### Removed

- **Redundant "First-time usage guide" panel** in OptionsApp. The inline
  quick-pick panel duplicated the new onboarding step 2 (provider picker)
  and conflicted with it. The onboarding modal is now the single, consistent
  entry path for new users.
- **Dead UI components** (~2459 lines) removed from `src/components/ui/`:
  `accessibility`, `animated-container`, `dropdown-menu`, `feedback`,
  `layout`, `navigation`, `radio-group`, `select`, `spinner`, `tabs`,
  `textarea`. None of these had any importers anywhere in `src/`; they
  were speculative library code shipped as "亮但不亮" UI surface area.
- **Dead utility modules** (~1051 lines) removed from `src/utils/`:
  `batch-translation-manager`, `manga-translation-prompt`,
  `ocr-provider-selector`. None had any importers.

### Security & ethics

- The extension now ships with `enabled=false` and `onboardingCompleted=false`.
  Until the user finishes the onboarding (or explicitly skips), the extension
  will not run any VLM translation and the user will not be billed. This
  closes the prior gap where a fresh install could start charging API costs
  before the user understood what they had just installed.

## [0.3.4] - 2026-06-01

### Added

- **CI pipeline** (`.github/workflows/ci.yml`): every push to `main` and every
  PR runs `pnpm install --frozen-lockfile`, `pnpm lint:strict`,
  `pnpm type-check`, `pnpm test:run`, and `pnpm build` with a pnpm cache.
  Main-branch runs upload the built `dist/` as a 7-day artifact for
  manual smoke-testing.
- **README product positioning**: replaced the "two direct paths" intro
  with a section that names the target user, the unsuitable use cases,
  and the default translation pipeline (`full-image-vlm`).
- **CHANGELOG.md**: this file. Future releases document here.

### Changed

- **Cleaned 35 pre-existing lint warnings** so the CI gate can run
  `lint:strict` (`--max-warnings 0`). Any new warning now fails CI.
  - `scripts/copy-tesseract.js`: 3 `console.log` calls annotated
    with `eslint-disable` (intentional build-script output).
  - `src/background/{background,job-queue}.ts`: 2 non-null assertions
    replaced with explicit checks.
  - `src/content/config-snapshot.ts`: `Record<string, any>` →
    `Record<string, unknown>`, with property accesses switched to
    bracket notation to satisfy `noPropertyAccessFromIndexSignature`.
  - `src/content/site-adapters.test.ts`: 1 non-null assertion
    replaced with a null-check + cast.
  - `src/services/text-detector.ts`: `Record<string, any>` → `unknown`,
    the one remaining `any` cast localised with `eslint-disable`.
  - `src/services/image-processor.test.ts`: introduced a
    `MockCanvasContext` helper type and `buildCanvasContextMock()`
    factory; 21 `as any` casts on Image / canvas mocks became
    `as unknown as typeof Image` / `as unknown as CanvasRenderingContext2D`.
- **CI gate upgraded**: workflow now runs `pnpm lint:strict` (was
  `pnpm lint`). With zero warnings in the tree, the strict gate is
  the new floor.

### Removed

- **`coverage/` from git**: 671 generated test-coverage files removed
  via `git rm --cached`; `coverage/` is now in `.gitignore`.
  Coverage can still be generated locally via `pnpm test:coverage`
  for inspection.

## [0.3.3] - 2026-06-01

### Fixed (P0 — must-have for v0.3.1 → v0.3.3 upgrade path)

- **CORS fallback image proxy** (`image-processor.ts:317`): was reading the legacy
  `response.base64` field while the background handler now returns `imageBase64`,
  causing every CORS-tainted image to fail with a misleading "Unknown error".
  Tests have been updated and a regression-guard test added.
- **Zustand persist upgrade migration** (`config-v2.ts`): v0.3.1 users upgrading
  had their `providers` map silently replaced with the old shape
  (`{ openai, ollama }`), so `providers['openai-compatible']` and
  `providers['lm-studio']` were `undefined` and the Options / Popup UI threw
  `TypeError` on every render. Added `version: 2` + `migrate` + custom `merge`
  that rebuilds the three new provider entries from the legacy shape.
- **Background sender trust boundary** (`background.ts:198-208`): any content
  script running in any tab could call `getConfig` (receiving deobfuscated API
  keys) or `setConfig` (overwriting the configuration). Sensitive actions
  (`getConfig`, `setConfig`) now require `isExtensionOrigin`; job / fetch
  endpoints still accept content scripts.

### Fixed (high)

- **`preserveFormat` is no longer a dead default** (`image-processor.ts`):
  the field was advertised and defaulted to `true` but never read, so PNG
  images silently lost the alpha channel. Removed the field.
- **API key obfuscation field list** (`utils/crypto.ts`): `processAllApiKeys`
  only matched the literal field name `apiKey`, so a future provider field
  (e.g. `accessToken`) would bypass obfuscation. Now backed by a
  `SENSITIVE_KEYS` Set with a `registerSensitiveKey` extension hook.
- **Options UI copy and presets** (`OptionsApp.tsx`):
  - Subtitle updated from "two direct paths" to "three direct paths" to
    reflect the addition of LM Studio.
  - Removed the DeepSeek `deepseek-chat` API preset (text-only model, no
    Vision — UX trap).
- **LM Studio routing inconsistency** (`translation-transport.ts:104`):
  `resolveRequestedPath` was only branching on `'ollama'`, so LM Studio
  fell through to `plugin-direct` while `runtime-contracts.ts` routed it
  to `ollama-direct`. The two functions now agree.
- **LM Studio API key requirement** (`app-config.ts:250`): `allowApiKey: true`
  was inconsistent with Ollama and showed a useless API key input in the
  LM Studio card. Set to `false`.
- **Test coverage** (regression guards):
  - `translation-transport.test.ts`: +5 tests (explicit `requestedPath`,
    background-no-response, job-envelope flatten, pageKey fallback chain,
    lm-studio routing).
  - `content.test.ts`: +5 tests for the previously-untested `handleMessage`
    switch (`GET_STATE`, `CANCEL_TRANSLATION`, `CLEAR_ALL`, unknown type,
    `TRANSLATE_PAGE` keep-open semantics).
  - `provider-direct-client.test.ts`: +3 tests (happy-path `pipeline` value,
    unknown provider rejection, invalid style preset rejection).
  - `image-processor.test.ts`: regression guard that the old `base64` field
    is no longer accepted.

### Changed

- **Default `translationPipeline`** (`app-config.ts:101`): was
  `hybrid-regions` (requires Tesseract.js OCR), now `full-image-vlm` to
  match the documented default in `CLAUDE.md`. Most users never installed
  Tesseract, so the previous default silently disabled translation.
- **`pageKey` for translation jobs** (`translator.ts:308-320`): was set to
  `metadata.imageKey`, which collapsed every image on a page into a single
  job slot. Now derived from `pageUrl || window.location.href`. Background
  page-level dedup now works as designed.
- **Two-protocol background dispatcher** is now explicitly documented in
  `background.ts` and `CLAUDE.md`:
  - Action-based (`{ action, ... }`): legacy, used by image proxy and
    Popup/Options config read/write.
  - Type-based (`{ type: 'JOB_*', ... }`): new, used by translation
    transport with job-queue semantics.

### Added

- **CHANGELOG.md**: this file. Future releases will document here.
- **`.env` gitignore patterns** (`.gitignore`): `.env`, `*.env`, and
  `server/.env` are now ignored. Prevents accidental secret commits.

### Removed

- **`PROVIDER_INFO` constant** (`providers/index.ts`): exported but had zero
  importers; the Options and Popup UI ship their own per-provider display
  arrays. Replaced with a `ProviderDisplayInfo` type-only stub for future
  reuse.
- **`nvidia` legacy provider key** (`app-config.ts`, `config-v2.ts`): no
  provider implementation exists; it only added dead migration branches.
- **`product-readiness.ts` and its test**: pre-existing v0.3.2 deletion;
  the `file://` semantics it guarded were re-implemented inline. (See
  separate commit.)

## [0.3.2] - 2026-05-31

### Changed

- Consolidated direct provider flows: removed `claude`, `deepseek`,
  `siliconflow`, and `dashscope` providers; only `openai-compatible` and
  `ollama` remain. Added LM Studio as a third option.
- Replaced the ad-hoc `{ action: 'translateImage' }` message with a
  structured `JOB_TRANSLATE_IMAGE` job envelope using
  `src/shared/runtime-contracts.ts`.
- Removed the hover-to-select image translation mode; replaced with
  `FORCE_RETRANSLATE_PAGE`.
- Image processor: added `viewportCrop` and `shouldPreserveTallMangaPage`
  to handle very long manga pages without losing aspect ratio.
- Config store: added `autoContinueEnabled`, `renderMode`,
  `translationPipeline`, `overlayStyle`, `translationStylePreset`, and
  related setters.
- New `provider-direct-client.ts` for direct (non-server) provider calls.

[0.3.3]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.3.3
[0.3.2]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.3.2
