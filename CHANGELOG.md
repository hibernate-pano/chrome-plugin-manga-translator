# Changelog

All notable changes to the chrome-plugin-manga-translator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

A full audit of the 2.0.0 reliability work. Every fix below is paired with a
test that fails without it, and the ones that changed behaviour were confirmed
by mutation rather than by reading.

### Fixed

- **The retry button never retried.** `TranslateImageJobRequest` carried
  `forceRefresh` all the way to the worker, but the job queue collapsed on
  `pageKey` without reading it, so a retry on an image whose job was still in
  flight resolved to the very result it was meant to discard.
- **One corrupt setting discarded all the others.** `mergeProvider` called
  `.trim()` straight on stored values, so a hand-edited `apiKey: 123` threw
  inside zustand's `merge` and aborted hydration for the whole snapshot —
  language, concurrency and the enabled flag silently reverted to defaults.
- **Art-only webtoon strips were billed twice.** An empty tiled result was
  reported as a pipeline failure and fell through to a second, full-image
  request that could only return the same nothing.
- **One click armed auto-translation for the life of the tab.** The observer
  re-entered `translatePage` on every batch of new images with no bound, each
  time rebuilding the translator and re-paying. Follow-up runs now draw from a
  budget that an explicit request refills.
- **The allowlist was broader than it looked.** Ports were stripped, so
  `localhost:8080` also authorised `localhost:22`; `*.com` passed validation and
  matched every .com site on the internet. The popup switch also compared hosts
  with a plain `includes`, so a `*.example.com` entry showed as off while the
  worker was actively translating the page, and switching it off removed nothing.
- **Overlay re-layout ran on every resize event.** Each pass re-ran collision
  resolution with per-character text measurement, so drag-resizing a long
  chapter was a measurement storm per event; it now coalesces to one frame.
- **A disposed renderer was handed back out.** `getRenderer()` cached the
  instance but `dispose()` never cleared the cache, so any page that
  re-initialised after teardown — a bfcache restore, or an error path followed by
  another translate — got a renderer with no `ResizeObserver` and no resize
  listener, and overlays quietly stopped following the art.
- **The worker's own claims were wrong.** `chrome.alarms` does not hold a worker
  open — it schedules wake-ups for one already restarted — and the documented
  minimum period is 0.5 minutes, so the authored 0.34 was clamped and the "~20s"
  it described never happened. The period is now 0.5 and the comment says what
  actually keeps in-flight jobs reachable.

### Security

- **Vestigial `web_accessible_resources` pruned — and the prune itself fixed.**
  The bundler listed the content script's chunks as web-accessible before they
  were inlined; after inlining, `content.js` referenced none of them but the
  declarations stayed, leaving the key-obfuscation chunk, the config store and
  the React vendor readable by any page. Pruning them the first way was
  wrong and shipping-blocking: the content script Chrome registers is a CRXJS
  loader that does `import(chrome.runtime.getURL('content.js'))`, so dropping
  `content.js` made the extension fail to start on every page — silently, because
  the loader swallows the rejection into `console.error`. The rule is now
  "keep what the source declares plus whatever a built file resolves through
  `getURL()`", and `pnpm release:check` fails if a runtime-loaded path is ever
  missing again. `content.js` is retained; the seven vestigial chunks are not.
- **An explicit `content_security_policy`** is declared; previously there was
  none at all.
- **Plaintext base URLs are warned about.** The API key travels as a Bearer
  header, so typing `http://api.example.com` sent the credential in the clear
  with nothing saying so. https and loopback http (Ollama, LM Studio) stay
  unaffected.
- The unreachable `JOB_QUERY_STATUS` message branch is removed.

### Fixed

- **A partially-failed tiled run reported success and stopped retrying.** The
  first cut of the double-billing fix counted "not null" as answered, but
  `processInParallel` writes `undefined` for slots it never ran, and a
  `translateTile` that throws returns `null`. So three failed tiles plus one
  honest empty answer returned `success: true` with zero areas: the full-image
  fallback was skipped, three quarters of the chapter was never translated, the
  image was marked processed so it was not retried, and the user saw a blank page
  with no error. Only a run where every tile answered may now be treated as
  "genuinely no text".
- **The content script kept a disposed renderer.** `cleanup()` called
  `renderer.dispose()` but left the module reference set, and
  `ensureServicesInitialized` only re-creates when it is null — so the next run
  on the same page got a renderer with no observer and no resize listener,
  exactly the symptom the dispose-clearing in `getRenderer()` was meant to
  remove. The reference is nulled on cleanup now.
- **A forced retry finishing first unmapped the job it replaced.** Dedup is now
  a per-key stack rather than a single slot, so a duplicate arriving while the
  original still runs collapses onto it instead of paying for a third request.
- **The popup could not create a port-scoped allowlist entry.** `hostFromUrl`
  returned the bare hostname, so a dev reader on `localhost:8080` stored
  `localhost` — which covers every port on the machine, the widening the port
  rules exist to prevent. Non-default ports are preserved.
- **Legacy allowlist entries were stuck.** `removeAutoTranslateHost` compared
  against `normalizeHostEntry(host)`, so once a rule tightened (a `*.com` the old
  normaliser accepted is now refused) the entry could be seen and offered for
  removal but never actually removed. Falls back to the raw value.

### Tests

- `background-auth.test.ts` added, covering the sender-authorisation boundary
  and the image proxy's sender scoping — including that an extension page is
  refused the fetch primitive and that a cross-origin non-image URL is not
  treated as a general fetch proxy. Verified by mutation: relaxing the sender
  check fails four of them.
- The new pipeline test pins the partial-failure case above; the dedup stack test
  fails without the stack fix.

### Changed

- **Privacy policy corrected.** It claimed the OCR language-model download was
  "the only network request the extension makes that is not directed at the
  vision provider" — false, the image proxy fetches arbitrary page CDNs on your
  behalf — described reversible XOR with a bundle-shipped salt as protection
  against other extensions, and said the OCR engine ships fully locally while
  the traineddata in fact comes from jsdelivr. All three now describe the code.
- **Coverage now counts the service worker.** Vitest 0.34 only scores files a
  test imported, so the worker, both app shells and all three UI primitives were
  *absent* rather than 0%, and an 81% pass hid 2147 untested lines including the
  entire sender-authorisation boundary. `background.ts` gained nine tests, the
  primitives gained their own, and `scripts/check-coverage-scope.mjs` now fails
  the build unless every `src/` file is in the report or explicitly exempted.
- **The build guard scripts are linted.** `eslint --ext` omitted `.mjs`, so every
  script that can fail a build was outside the gates; covering them immediately
  surfaced three dead `eslint-disable` directives and a rule violation.
- **Documented pre-PR gate matches CI.** AGENTS.md and README prescribed
  `pnpm lint && pnpm test:run`, which pass on a tree CI would reject.
- The worker no longer exposes `JOB_QUERY_STATUS`, which had a handler and types
  but no caller in any context.

### Tests

Five tests could not fail. `Font Size Calculation` re-implemented
`calculateFontSize` in its own body and asserted against that copy, so deleting
the production function changed nothing; it now imports the real one and is
verified to fail when the CJK width weighting is removed. Four more asserted
only a count, or a state sampled after the work had settled, or merely that
rendering did not throw.

### Removed

293 lines of code with no importer anywhere — including the selector hooks
AGENTS.md advertised as idiomatic, the translator singleton every caller
bypassed, and three friendly-error accessors.

## [2.0.0] - 2026-10-05

Reliability, security and build-integrity work.

### BREAKING

- **Automatic page translation is off by default and opt-in per site.** In
  1.3.x, turning the extension on translated every navigation in every tab. From
  2.0.0 a page is only translated unprompted when its host is on the new
  `autoTranslateHosts` allowlist (empty by default). Existing users who relied on
  automatic translation must re-add their manga/webtoon sites — from the popup
  ("auto translate this site") or the Options page. Manual translation (popup
  button, context menu) is unchanged and still works on any site. This is the
  reason for the major bump: it is a user-visible behaviour change.

### Security

- The `autoTranslateHosts` allowlist (see BREAKING) gates both auto-translate
  entry points — `tabs.onUpdated` and the content script's `READY` — through a
  single `shouldAutoTranslatePage(config, url)` check with boundary-aware host
  matching (`example.com` does not match `notexample.com`). Previously both paths
  fired on the master switch alone, with `<all_urls>` and no site control.
- **The background image proxy is no longer an open fetcher.** Requests are now
  sender-scoped (extension pages refused, cross-origin limited to image-shaped
  URLs), private address ranges are blocked (including CGNAT, `0.x`, `224+`,
  IPv4-mapped IPv6), credentials are omitted, and responses are bounded by
  timeout, `content-length` and a byte cap.
- **The public-build credential guard was inert.** Its regex looked for
  `apiKey:\s*"..."` while the generated file is JSON-shaped (`"apiKey": "..."`),
  so it matched nothing and always reported success. It now scans both the
  generated source and the emitted `dist/` bundle, at both the pre-build and
  post-build stages, and CI scans the artifact before upload.
- **The theme preference no longer syncs.** It was written to
  `chrome.storage.sync`, contradicting the privacy policy and re-introducing
  what the background worker deletes on startup. Now `storage.local`.
- `web_accessible_resources` no longer exposes `icons/*`; only the Tesseract
  worker files the content script actually loads remain.

### Fixed

- **Config storage feedback loop.** The persisted snapshot was compared to the
  full runtime store by key count (19 vs 42, the difference being action
  functions), so it always reported a change: every write re-triggered
  `onChanged`, which re-applied the snapshot, which wrote again — unbounded. It
  also pushed `obf:`-obfuscated API keys back into memory, so the provider layer
  sent garbage and every cloud call failed auth. Comparison is now by value over
  a shared `PERSISTED_CONFIG_FIELDS` whitelist, and snapshots are deobfuscated
  before being applied.
- **Stale echo reverting edits.** `persist` writes asynchronously, so an older
  write's `onChanged` could arrive after a newer edit and overwrite it — a typed
  API key silently became its previous value (reproduced at ~4 runs in 10).
  Self-writes are now recognised by payload and dropped.
- **Ollama / LM Studio endpoints were discarded.** `normalizeRuntimeAppConfig`
  read the stored Ollama settings and then dropped them via `void ollamaSource`,
  so anything typed in Settings was reverted on the next echo.
- **The Settings "test connection" button lied for cloud providers.** It called
  `validateConfig`, which only checks that a key is present and long enough, so
  a wrong base URL, revoked key or nonexistent model all reported success. A new
  optional `testConnection()` probes the endpoint (`/models`, falling back to a
  one-token chat completion) and reports auth, URL and model problems distinctly.
  `validateConfig` stays network-free because the content script's preflight runs
  under the page's CORS rules.
- **Overlays drifted on resize.** They were positioned from the image box
  captured at render time with no re-layout, so any window resize or responsive
  reflow left the text off the artwork (the reading anchors already repositioned;
  the overlays did not). A shared `ResizeObserver` plus a window-resize fallback
  now re-lays them out, and `dispose()` releases both.

### Changed

- **Content script bundle ~366 KB to ~127 KB.** `manualChunks` lumped React and
  ReactDOM together, and the post-build rebundler (not minifying) inlined all of
  ReactDOM into a bundle that uses no React. The two are separate chunks now and
  the rebundler minifies. A 200 KB budget is enforced by the build and CI.
- **MV3 service worker stays alive during long translations** via an
  `alarms`-based keepalive (only while translation is enabled), and the job map is
  capped at 500 terminal records instead of growing for the worker's lifetime.
- **Coverage threshold is real.** It was configured in the nested
  `coverage.thresholds.global` shape that Vitest 0.34 ignores, so the documented
  70% never applied. Moved to the top-level keys 0.34 reads, and CI runs
  `test:coverage`. Verified by setting an impossible limit and confirming the run
  fails.
- **Base64 encoding no longer uses `btoa` plus per-byte string concatenation**
  (quadratic on multi-megabyte strips, and unreliable under jsdom). A table
  encoder is pinned against Node's `Buffer` reference output in tests.
- **Tesseract language data no longer comes from `npm.elemecdn.com`**, an
  unofficial third-party mirror that contradicted the privacy policy and failed
  wherever that host is blocked. Leaving `langPath` unset uses the library's own
  canonical source. The non-SIMD core pair (unreachable, since an explicit
  `corePath` is passed) was removed, taking the OCR payload from 13.8 MB to
  6.6 MB; `minimum_chrome_version` is pinned to 110.
- **Quality gates are enforced.** `.husky/` had no hook files, so `lint-staged`
  never ran; a `pre-commit` hook now exists. `format:check` covers the whole
  repository, and CI runs format, lint, type-check, coverage, build, the size
  budget and a credential scan.

### Removed

- ~1500 lines of dead code (font-style-matcher, validation, provider-strategy,
  content/image-fetch, content/page-context, the empty `src/types/`, unused
  stores/services barrels, ten unused shadcn primitives) and their tests, which
  had tested the mocks rather than the code.
- 15 unused dependencies (13 Radix packages, zod, react-hook-form,
  @hookform/resolvers, framer-motion, tailwindcss-animate,
  class-variance-authority). `dependencies` went from 29 to 10.
- The fabricated per-token price table in `usage-store.ts`. It priced every
  `openai-compatible` endpoint at $0.005/$0.015 per 1K tokens — wrong for MiniMax,
  SiliconFlow, OpenRouter and any self-hosted endpoint — omitted `lm-studio`
  entirely, and was never rendered. Removed rather than shipped.
- `fix-typescript-errors.sh` (a `sed` script that rewrote source in place),
  `build.sh` (a broken duplicate of `pnpm build`), and the dead `resetRenderer()`
  singleton helper (which leaked its resize listeners).

### Documentation

- `AGENTS.md` described a different project: TanStack Query, React Hook Form,
  Zod, Framer Motion, `src/api/` and `src/hooks/`, none of which were ever
  installed or imported. Corrected, and `docs/architecture-notes.md` added to
  record the contracts that are easy to break (config round-trip, bundle budget,
  image-proxy gating, worker lifetime, OCR core selection).
- `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, the privacy policy, the Web
  Store checklist and the `ROADMAP.md` performance budget were synced to the code.
  The deprecated `server/` directory's run scripts moved into `server/` so the
  extension's `scripts/` is extension-only, and its README states plainly that
  the extension has no references to it.
- CHANGELOG version dates that read `2026-XX-XX` were filled from git history,
  and the missing 1.3.1 / 1.3.2 entries added.

## [1.3.3] - 2026-09-13

### Fixed

- **Long-strip tiling regression**: the content script marked tall images as
  viewport crops, which bypassed the v1.2+ tiled pipeline and could leave the
  lower portions of a webtoon image permanently untranslated.
- **CORS tile cropping**: the background image-fetch fallback now applies the
  requested `cropRegion` before compression, so protected CDN images no longer
  send the entire strip for every tile.
- **Duplicate page runs**: `READY` and `tabs.onUpdated` can no longer start two
  page translations concurrently during initial page load.
- **Tiled usage accounting**: token usage from every tile attempt is recorded,
  including quality-gate retries.

### Added

- Runtime-editable provider API keys, Base URLs, and models.
- `pnpm build:public`, which strips provider keys from `.env` and verifies that
  the generated bundle contains no API keys.
- Release consistency check so `package.json` and `manifest.json` versions
  cannot silently drift.

### Changed

- **MiniMax-M3 fast mode**: Manga translation requests now explicitly disable
  thinking, use `reasoning_split`, and send M3's `max_completion_tokens` field.
  This avoids spending the completion budget on `<think>` output and materially
  reduces response latency.
- Version and release documentation now track v1.3.3.
- CI and Corepack use pnpm 12.4.1 with explicit trusted build scripts.

## [1.3.2] - 2026-08-23

### Fixed

- Tiled translation results are written to the translation cache again. A
  successful tiled run previously returned its result without caching it, so
  revisiting the same page re-billed every tile.

## [1.3.1] - 2026-08-23

### Changed

- Tile translation runs concurrently (cap 3) instead of sequentially. A long
  webtoon strip translated noticeably faster, bounded by the configured
  parallel limit.

## [1.3.0] - 2026-08-23

### Added

- **P1 — Auto-degradation chain**: if the full-image path reports success
  but yields zero translated areas (a "false success" where the VLM failed
  to read the image), the translator now automatically retries via the
  Tesseract hybrid pipeline (detect regions → translate crops). This is the
  last-mile fallback so a page never silently shows blank translations.
- **P1 — Korean OCR language**: Tesseract default languages now include
  `kor` (plus jpn/eng/chi_sim), so the hybrid fallback can actually read
  Korean webtoon text instead of blanking.
- **P2 — Korean-aware prompts**: the translation prompt and the `natural-zh`
  style instruction now handle Korean source text — 반말 → casual Chinese,
  -요/-습니다 → polite Chinese, and Korean webtoon slang (ㅋㅋ → 哈哈哈,
  ㅠㅠ → 呜呜). Also added an explicit anti-hallucination rule: never invent
  bubbles.
- **P2b — Token-truncation detection**: `parseVisionResponse` now detects
  JSON that was cut off mid-output (unbalanced braces/brackets) and throws
  a clear "response was cut off" error instead of a generic parse failure.
  Raised `MAX_TOKENS` from 2048 to 4096 so large fallback pages are less
  likely to hit the ceiling.

## [1.2.0] - 2026-08-23

### Added

- **Tiled (sliding-window) pipeline for long webtoon strips**: instead of
  downscaling an 800×10000px strip to a 3000px thumbnail (which shrinks
  dialogue into illegible smudges), long images are split into overlapping
  ~1152px tiles with 96px seams. Each tile is translated as a crisp,
  near-1:1 crop — small text stays legible, output stays under the token
  ceiling, and a single model failure no longer nukes the whole page.
  - New `cropRegion` option in `image-processor.ts` (`compressImage` /
    `processImage`) to slice the ORIGINAL image by pixel coordinates.
  - `translator.ts` now auto-tiles when `naturalHeight >= 2200` and
    aspect ratio `>= 2.2`. Tile results are mapped back to original image
    coordinates, merged, and overlap-deduplicated.
  - Tile quality gate: a tile that yields no text is retried once before
    being accepted; if every tile returns empty the caller falls back to
    the classic full-image path.
  - Tiled results do not write to the hash cache when the whole page
    produced nothing; cache key now includes `tiled-v1` so pre-tiled hash
    caches are invalidated on upgrade.

### Fixed

- **Korean-manhwa (webtoon) "sometimes can't translate"**: the root cause
  was the whole-strip downscale to 3000px + the 2048-token completion
  ceiling. Tiling addresses both: legible crops and per-tile token budgets.

## [1.1.0] - 2026-08-23

### Added

- **`.env`-injected provider credentials**: new build step
  `scripts/inject-env-config.mjs` reads MiniMax / OpenCode credentials from
  `.env` (project root, or up to 3 levels up, or `MT_ENV_FILE`) and emits the
  gitignored `src/shared/env-config.generated.ts`. Every `pnpm` script
  (`build`, `dev`, `test*`, `type-check`) runs the injector first.
- **Zero-config first-run**: the extension now ships with a pre-configured
  default backend — **MiniMax M3** (primary) with **OpenCode · DeepSeek V4
  Flash** (backup) — so personal installs need no manual API key / base URL /
  model setup.
- **Preset quick-switch in Options**: provider cards now include the two
  env-injected presets, plus the existing OpenAI / SiliconFlow / OpenRouter
  presets. Clicking a preset fills base URL + model + API key in one click.
- **Onboarding simplified to 2 steps**: removed the provider picker (default
  is baked in); step 1 shows the configured default backend and step 2
  confirms + enables.

### Security

- API keys live **only** in the user's `.env` (gitignored). The generated
  `env-config.generated.ts` absorbs them at build time into `dist/` but is
  itself gitignored — the keys never enter the source tree or git history.
- Chrome Web Store publish credentials (CLIENT_ID / SECRET / REFRESH_TOKEN /
  ITEM_ID) from the user's `.env` are intentionally **NOT** injected anywhere.
  Those must never be compiled into the extension or committed.

### Changed

- `pnpm-workspace.yaml`: switched `ignoredBuiltDependencies` →
  `onlyBuiltDependencies` (pnpm 11 strict-by-default policy).

## [1.0.0] - 2026-08-23

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

## [0.7.0] - 2026-08-23

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

## [0.6.0] - 2026-08-23

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

## [0.5.0] - 2026-08-23

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

## [0.4.0] - 2026-08-23

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
