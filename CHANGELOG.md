# Changelog

All notable changes to the chrome-plugin-manga-translator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
