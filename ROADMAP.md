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

## Phase 3 — In progress

- English-first README, ARCHITECTURE.md, CONTRIBUTING.md (this file)
- `server/` Python backend frozen and slated for extraction to its own repo
- v0.7.0 release

## Phase 4 — Next

- Chrome Web Store listing with screenshots + a 30s demo GIF
- A "show HN" / "show r/ChromeExtensions" post with the demo
- Seed 5-10 users and gather feedback for v1.0
- v1.0 release with stable public API

## What we are NOT doing

To keep the scope honest, these are explicitly out:

- **User accounts, cloud sync, hosted SaaS.** The extension is local-first by
  design. If you want a hosted offering, fork `server/` and build one —
  don't expect it to land here.
- **A paid tier.** TBD; depends on whether a hosted backend emerges as a
  separate project.
- **Crowd-sourced translation quality scoring.** Useful, but pulls the project
  into a content-moderation problem we don't have the resources to own.
- **Multi-language UI.** English-only docs; UI strings stay bilingual for
  now (Chinese for primary user base, English as we go international).

## Open questions

These are unresolved and we'd like feedback:

- Should the reading panel dock left when the user scrolls past the first
  translated image? Currently it stays at `top: 80px; right: 16px` always.
- For Ollama, should the extension ship a one-click "install recommended
  model" flow that triggers `ollama pull llava` from a button? It's
  technically possible but crosses into "the extension shells out to the
  user's machine" territory.
- Should we ship a bundled "quick presets" panel — pre-baked configs for
  SiliconFlow, OpenRouter, Gemini Flash — so users don't have to type
  base URLs? Tradeoff: presets rot.

## Performance budget

- Content script bundle (currently ~330 KB unminified, ~24 KB gzipped) must
  stay under 500 KB unminified. The reading panel and HUD are the largest
  contributors; if either grows past 100 KB we'll reconsider whether to
  split into per-page lazy chunks.
- HUD updates throttle to one render per ~100 ms. Don't bypass this without
  a measured reason.

## How to propose changes

Open an issue with the **proposal** tag. We try to keep proposals short
(one paragraph) and outcome-oriented. Implementation details belong in
the PR, not the proposal.
