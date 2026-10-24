# Roadmap

The plan is split into 90-day phases from the v0.4.0 reset. Status as of
release notes below; the live version is whatever's at the top of
[`CHANGELOG.md`](./CHANGELOG.md).

## Phase 1 — Done (v0.4.0)

- First-run onboarding modal with provider picker + data-flow disclosure
- Default `enabled=false` and `onboardingCompleted=false` until the user opts in
- ~3500 lines of dead UI / util code removed
- README positioning updated, provider list aligned with reality

## Phase 2 — Done (v0.5.0 + v0.6.0)

- Reading-mode side panel + numbered image anchors
- Error info → actionable fix-it entries (copy-command buttons with real
  shell snippets, not human-readable text)
- HUD staged progress (scanning / translating / rendering)
- Cache-hit visibility + filtered-image reporting

## Phase 3 — Done (v0.7.x → v1.1.0)

- English-first README, ARCHITECTURE.md, CONTRIBUTING.md
- `server/` Python backend frozen + deprecation notice
- Zero-config personal setup via `.env` injection (v1.1.0)

## Phase 4 — Done (v1.0 → v1.3.x)

- First stable release (v1.0.0) + anchor-click fix (v1.0.1)
- **Tiled webtoon pipeline** (v1.2.0): overlapping slices for long strips;
  fixes "long strip downscaled to thumbnail → text illegible / token
  ceiling" that made Korean webtoons sometimes fail to translate.
- **Auto-degradation + Korean prompts** (v1.3.0): zero-text "false success"
  now falls back to Tesseract hybrid; `kor` added to OCR languages; prompts
  and `natural-zh` style handle 반말/-요/-습니다 and webtoon slang.
- Parallel tile translation (v1.3.1) + tiled results cached (v1.3.2).

## Phase 5 — Next

- Smoke-test the parts of the release that need a provider. `pnpm smoke:public`
  now covers the other half automatically: it drives the credential-free
  `pnpm build:public` artifact in a clean Chrome profile and checks that it
  loads, that nothing in it holds an API key, that `chrome.storage.sync` stays
  empty, that the popup asks the user for a provider instead of using the
  author's defaults, and that the content script is alive. The steps that
  actually translate something still need a live provider and a page served
  over HTTP — the fixture is `smoke-test-page.html` and the checklist is in
  `docs/chrome-web-store-release.md`.
- Create the Chrome Web Store item in the dashboard and submit the package.
  The upload, the publish request and the rollout percentage are explicit
  arguments of `pnpm release:publish` now, and the listing copy, the
  permission justifications and the smoke-test checklist are in
  `docs/chrome-web-store-release.md`. What the command cannot do is create
  the listing itself — there is no create-item endpoint.
- Publish a release artifact and seed 5-10 users with clear install feedback.
- Add provider-aware price estimates to the usage panel; token counts and cache
  hit rate are already visible. A hardcoded per-token rate table used to sit in
  `usage-store.ts` and produced dollar figures for endpoints it knew nothing
  about (`openai-compatible` prices $0.005/$0.015 per 1K tokens, which is wrong
  for MiniMax, SiliconFlow, OpenRouter, or any self-hosted endpoint, and
  `lm-studio` was missing entirely). It was never surfaced in the UI and has
  been removed. Any future cost display must derive rates from the configured
  model or from user-entered rates, not from a built-in constant.

## Recently closed

- **A translated page can be saved as a picture.** The question below ("should
  a translated image be exportable") is answered in the affirmative: the
  overlay's export button composes the original image and its translations
  into one PNG and downloads it. The renderer already drew to a canvas, so
  the work was mostly packaging.
- **The store assets exist.** `store/artwork/` holds the generated manga
  pages, `store/demo/` the same pages with the Japanese dialogue burned into
  the pixels (lettering drawn in HTML would be invisible to the vision model,
  so the demo would show the original with the translation floating beside it),
  and `store/listing/` the screenshot and the demo recording. Every promise in
  the listing, the review notes and the privacy policy is checked against the
  code by `scripts/check-store-claims.mjs`, so the store cannot be told
  something the extension does not do. The 特色大图 that the listing still
  marked 「需新制作」 is composited from the screenshots by
  `scripts/build-promo-image.mjs` — no model, no API key, no network — and a
  third screenshot, of the popup counting the page's images before the button
  that spends money, is taken by `capture-store-assets.mjs --popup`, which
  needs no provider either.
- **Provider presets shipped.** The open question below ("should we ship a
  bundled quick presets panel") is now answered in the affirmative: the
  Settings page lists MiniMax, SiliconFlow, OpenRouter, Gemini and OpenAI,
  each with a documented vision-capable model. The "presets rot" trade-off is
  real, so the list is deliberately short — five entries, each one a model the
  service documents, and no entry for a service without a confirmed vision
  model. A preset whose model has been retired is worse than no preset.
- **Image resolution and concurrency are settings, not constants.** Both were
  unreachable code paths for a user; the same lever used to live in
  `app-config.ts` where only an editor could move it. They are now in the
  Settings page with the cost trade-off written next to each choice.
- **The target language is honoured.** The prompt and the style presets were
  Chinese-only, so choosing English still produced Chinese instructions. The
  presets now carry per-language rules and the prompt names the language.
- **A support bundle exists.** The extension collects nothing, which is the
  privacy story — but it also left users with nowhere to go when a page would
  not translate. Settings can copy a diagnostics block built locally, with the
  API key, the endpoint and the page URLs all excluded.

- Config storage no longer loops: the persisted-snapshot comparison matched on
  key count (19 persisted vs 42 runtime), so every write re-triggered itself and
  pushed `obf:`-obfuscated API keys back into memory, breaking every cloud
  provider. Now compared by value over a shared field whitelist.
- A stale storage echo could revert a newer edit (a typed API key silently
  became its previous value). Self-writes are now recognised and dropped.
- Automatic page translation is opt-in per host (`autoTranslateHosts`, empty by
  default). Previously, enabling the extension translated every navigation in
  every tab, sending images from banking/webmail/intranet pages to the provider.
- The background image proxy is no longer an open fetcher: sender-scoped,
  private-address blocked, credential-free, size- and time-bounded.
- Content script bundle cut from ~366 KB to ~127 KB (React and ReactDOM kept out
  of it), with a 200 KB budget now enforced by the build.
- The public-build credential guard actually works (its regex never matched the
  generated file's shape) and now scans the emitted bundle, not just the source.
- Coverage threshold is enforced (70%); it was configured in a shape Vitest 0.34
  ignores, so it never applied.
- Long-strip images now always enter the tiled pipeline instead of translating
  only their visible viewport slice.
- CORS image fallback preserves tile crop regions instead of resending the full
  strip for every tile.
- Provider settings are editable at runtime again; public builds are guarded
  against embedding private credentials.
- Package and manifest versions are checked during every build.
- Audit pass over the above (see `[Unreleased]` in the changelog). The retry
  button actually retries now — `forceRefresh` reached the worker but the queue
  ignored it. One corrupt stored field no longer blanks the whole snapshot.
  Art-only strips are billed once instead of twice, and a single click no longer
  arms auto-translation for the life of the tab.
- Allowlist matching is honest: ports scope, bare `*.com` wildcards are refused,
  and the popup switch reads through the same matcher the worker uses instead of
  disagreeing with it.
- The coverage gate stopped hiding untested files. Vitest 0.34 only scores files
  a test imported, so the service worker — the extension's whole sender-
  authorisation and SSRF boundary — was absent from the denominator behind an
  81% pass. It is tested now, and `scripts/check-coverage-scope.mjs` fails the
  build when any `src/` file is neither covered nor explicitly exempted.
- The privacy policy matches the code. It had claimed the OCR download was the
  only non-provider request, which the image proxy contradicts, and described
  reversible XOR as a protection.
- `web_accessible_resources` no longer exposes the extension's own modules to
  every page after the chunks were inlined into `content.js`.

## What we are NOT doing

To keep the scope honest, these are explicitly out:

- **User accounts, cloud sync, hosted SaaS.** The extension is local-first by
  design. A hosted offering would be a separate project built on this one's
  provider protocol — don't expect it to land here.
- **A paid tier.** TBD; depends on whether a hosted backend emerges as a
  separate project.
- **Crowd-sourced translation quality scoring.** Useful, but pulls the project
  into a content-moderation problem we don't have the resources to own.
- **Multi-language UI.** The extension's interface is Chinese only — there is
  no `_locales/`, no `default_locale` and no `t()` call anywhere in `src/`, so
  every string is a literal. The store listing says 中文（简体） for that
  reason, and would be wrong to claim English. Localising the interface is a
  separate piece of work from localising the *translations*, which already
  honour the target language.

## Open questions

These are unresolved and we'd like feedback:

- Should the reading panel dock left when the user scrolls past the first
  translated image? Currently it stays at `top: 80px; right: 16px` always.
- For Ollama, should the extension ship a one-click "install recommended
  model" flow that triggers `ollama pull llava` from a button? It's
  technically possible but crosses into "the extension shells out to the
  user's machine" territory.

## Performance budget

- The content script is injected into every page, so its size is paid on page
  load, not on install. `pnpm build` fails if `dist/content.js` exceeds
  **200 KB** (enforced by `scripts/check-release-consistency.mjs`, run before
  and after the build, and in CI). Current size is ~165 KB / ~41 KB gzipped.
  The largest contributors are `content.ts`, `renderer.ts`, `translator.ts`,
  `reading-panel.ts` and `floating-hud.ts` — no single vendor dominates,
  because React, ReactDOM and the icon set are all kept out of this bundle
  entirely (see `docs/architecture-notes.md`). If any one module grows past
  ~100 KB, reconsider splitting it into a per-page lazy chunk — and note that
  a lazy chunk would have to be web-accessible again, which is exactly what
  the current single-file bundle was built to avoid.
- HUD updates throttle to one render per ~100 ms. Don't bypass this without
  a measured reason.

## How to propose changes

Open an issue with the **proposal** tag. We try to keep proposals short
(one paragraph) and outcome-oriented. Implementation details belong in
the PR, not the proposal.
