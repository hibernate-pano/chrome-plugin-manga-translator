# Zero-friction on-boarding

- **Date**: 2026-06-23
- **Status**: Design (awaiting user review)
- **Author**: Claude (co-founder / architect role)
- **Target release**: next minor (v0.4.0)
- **Branch**: `feat/p3a-zero-friction-onboarding`

## Context

The current first-run experience forces the user through 5+ configuration fields before the extension can do anything useful:

1. Install extension → background `onInstalled` opens Options (`background.ts:129`).
2. User must pick a provider (3 choices), set baseUrl, set model, paste API key.
3. User must enable the extension via a Popup toggle (default `enabled: false`, `app-config.ts:44`).
4. User must click "Translate page" in Popup, OR remember to enable auto-translate in Options.
5. Only then can they read a translated page.

The user has explicitly asked for **"convention over configuration"** + **"as few settings as possible"** + **"smooth, fluent experience from the first second"**. The current flow violates all three. This spec removes the configuration wall from moment 0 and moment 1 (install + first-visit-to-manga-site), without touching the translation-experience itself (that is P3b).

## Goal

The user installs the extension, navigates to a manga site, and the only thing that interrupts them is a small corner card telling them **exactly** why nothing happened yet (no API key) and giving them **one click** to fix it. That's it. No Options page forced open at install. No checkboxes to remember. No Popup to open. The user does at most **one click** + **one paste** before they can read translated manga.

## Non-goals

- Not touching the translation experience itself (no-overlay mode, pre-translate, loading-spinner redesign → that's P3b).
- Not adding new providers.
- Not migrating existing user config (silent upgrade: existing users keep their settings, including `enabled: false` if that's what they have).
- Not adding telemetry, prompts, ratings, or upsells.
- Not changing the API key obfuscation / storage approach.
- Not adding a "Welcome tour" overlay or multi-step wizard. The user hates wizards.

## Approach

**One-time silent defaults, one-time corner card, one-time single-field setup, auto-save.**

| Decision | Choice | Reason |
|---|---|---|
| Open Options on install? | No | It's the #1 friction point. The user can find Options later. |
| Default `enabled` | `true` (was `false`) | Auto-translate is the only reason to install. The toggle in Popup still exists for users who want to pause. |
| Onboarding UI placement | Bottom-right corner card (non-blocking, in-page, Shadow DOM) | Doesn't interfere with the manga. Auto-collapses after 8s. |
| Onboarding trigger | First time content script runs AND no provider is fully configured | One-time per page load. Persisted dismissal in `chrome.storage.session` (resets on browser restart — user can re-encounter if needed). |
| Options page on "Go configure" click | Auto-scroll to API key input, focus it, blur background | One field. No wizard. |
| API key save semantics | Auto-save on `blur` (was explicit "Save" button) | Removes another barrier. |
| What is "configured"? | `isProviderConfigured(provider)` already returns `true` for Ollama / LM Studio with default baseUrl set; for `openai-compatible` it requires a non-empty `apiKey`. No change here. | The existing predicate is the right one — we just route the user to the missing field. |
| Existing users' `enabled: false` | Preserved | The new default only applies to fresh installs. Existing users who explicitly disabled keep their setting. |

## The 4 Moments of the New On-boarding

### Moment 0 — Install
- User clicks "Add to Chrome" in the store.
- Extension installs silently.
- `onInstalled` reason `install` runs, but does **not** open Options. It only writes the default config (already done) and registers the context menu (already done).
- User sees **nothing**.
- The extension's toolbar icon is the only signal that it's there.

### Moment 1 — First visit to a manga site
- Content script injects.
- Reads config. Detects `enabled: true` and `isProviderConfigured` → `false` (no API key).
- HUD shows a small corner card:
  - Title: "需要 API key 才能翻译"
  - Body: "点下面按钮完成配置（约 10 秒）"
  - Primary button: "去配置"
  - Dismiss × in the top-right
- Card is bottom-right (same region as the existing HUD), max-width 280px, soft amber background, no spinner.
- Auto-collapses 8 seconds after mount (slides down to ~40px height, only the title visible, expand on hover).
- Persisted dismiss flag in `chrome.storage.session` (`manga-translator-onboarding-dismissed: true`). The card does not reappear this browser session.
- The user can still click the toolbar icon to open Popup and see normal controls — the card is independent of Popup.

### Moment 1b — "去配置" click
- The corner card's "去配置" button calls `chrome.runtime.openOptionsPage()`.
- Options page opens.
- A new `?focus=apiKey` query param is passed (or the options page reads a one-shot signal from `chrome.storage.session`).
- Options page detects this signal, scrolls to the **first configured provider's API key input**, focuses it, and applies a brief outline highlight (CSS keyframe, 1.5s).
- User pastes key, clicks anywhere else (blur) → auto-saves → key is set.
- User closes Options tab. On next page load, the corner card does not reappear (dismiss flag still set, AND provider is now configured).

### Moment 1c — Dismissal via ×
- User clicks ×. The session flag is set. Card slides out. Does not return this session.
- User can re-trigger by clicking the toolbar icon and selecting "重置 onboarding 提示" (a small link at the bottom of the Popup, only visible if dismissed).

### Moment 2/3 — Translation experience
- **Out of scope here.** Handled in P3b.

## Scope of changes

### Modified: `src/background/background.ts`
- `chrome.runtime.onInstalled` (line 120-133): remove the `chrome.runtime.openOptionsPage()` call. Reason `install` only writes defaults and registers context menu. Reason `update` keeps the existing migration logic.
- Net change: −1 line in the `install` branch, no semantic change for `update`.

### Modified: `src/shared/app-config.ts`
- `DEFAULT_RUNTIME_APP_CONFIG.enabled`: change `false` → `true` (line 44).
- Net change: 1 character.

### Modified: `src/content/content.ts`
- Add an `initialize()` step that reads config, and if `!isProviderConfigured`, instructs the HUD to show the onboarding state.
- Add a new `ContentState` variant: `{ status: 'onboarding'; configured: false }`. The HUD handles this.
- Add a one-shot storage listener for the "open Options and focus" signal: when the user clicks "去配置", the content script writes a flag to `chrome.storage.session` (`manga-translator-onboarding-focus: { provider, ts }`) and calls `chrome.runtime.openOptionsPage()`. The Options page reads and clears the flag on mount.
- The session flag carries `{ provider, ts }` so the Options page knows which provider's input to focus.
- Persisted dismiss flag (`manga-translator-onboarding-dismissed`) is read on mount; if set, the onboarding card is not shown.

### Modified: `src/content/floating-hud.ts`
- New `HudState` variant: `{ status: 'onboarding' }`.
- Render: small card with title + body + "去配置" button + × dismiss. Auto-collapse after 8 seconds. Re-expand on hover.
- The button click dispatches a `hud-configure` CustomEvent on the container. The content script listens, writes the focus signal, and calls `chrome.runtime.openOptionsPage()`.
- The × click dispatches `hud-dismiss-onboarding`; content script sets the session dismiss flag and updates HUD state to `hidden`.

### Modified: `src/components/Options/OptionsApp.tsx`
- On mount, read `chrome.storage.session.get('manga-translator-onboarding-focus')`. If present, parse `{ provider, ts }`, find the corresponding provider card, scroll into view, focus the API key input, apply a 1.5s outline highlight, then `chrome.storage.session.remove(...)` to clear.
- Existing provider cards already have an `apiKey` input; we just add `id` attributes so the focus logic can find them (e.g. `id="api-key-input-openai-compatible"`).
- API key input: change from explicit "Save" button to auto-save on `blur` (use the existing `setProviderConfig` store action in `onBlur`).
- Add a small text below the API key: "失焦自动保存" (sets user expectation).

### New: `src/utils/onboarding.ts` (~30 LoC)
- Three async functions:
  - `isOnboardingDismissed(): Promise<boolean>`
  - `setOnboardingDismissed(): Promise<void>`
  - `requestConfigureFocus(provider: ProviderType): Promise<void>` — writes the session flag.
- All read/write `chrome.storage.session`. No new dependencies.

### Not modified
- `src/stores/config-v2.ts` — the store's `setProviderConfig` and `isProviderConfigured` are used as-is.
- `src/components/Popup/PopupApp.tsx` — no change. (The "重置 onboarding 提示" link is **out of scope** for V1 to keep the diff small; the dismiss flag is keyed on browser session, so the user gets the card back next browser launch.)
- `src/services/*` — no change.
- `CHANGELOG.md` — deferred to the v0.4.0 release that bundles P3a + P3b.

## Migration / Backwards compatibility

- **Existing users with `enabled: false`**: their stored config is preserved. The new default `enabled: true` only takes effect on a fresh install. So if a user previously disabled the extension, it stays disabled. **Verified by the Zustand `persist` semantics** — `migrate` only runs on version bumps, and we are not bumping version here.
- **Existing users with API key set**: nothing changes for them. The onboarding card never appears.
- **Existing users without API key but with `enabled: true`**: nothing changes for them. The onboarding card now appears (it's an improvement, not a regression).
- **No user-visible data is migrated or deleted.**

## Verification

1. `pnpm type-check` exits 0.
2. `pnpm lint:strict` exits 0 with no warnings.
3. `pnpm test:run` is fully green.
4. `pnpm build` succeeds.
5. `grep -rEn "chrome.runtime.openOptionsPage" src/background/` returns exactly **1** hit (in the context-menu click handler at `background.ts:140`, plus the new call from content script for "去配置" — both expected).
6. `grep -nE "DEFAULT_RUNTIME_APP_CONFIG.enabled" src/shared/app-config.ts` returns the new `true` value.
7. **Manual smoke** (not gated but listed for the user to try):
   - Reset the extension (clear storage), reload a manga site → corner card appears.
   - Click "去配置" → Options opens, API key input is focused and highlighted.
   - Paste a key, click away → saved. Reload manga site → no card, translation works.
   - Click × on the card → no card on reload (same session). Restart browser → card returns.
   - Existing user with `enabled: false` and no key → no card (respects existing setting).

## Risks

- **Negligible**: `chrome.storage.session` is a relatively new API (Chrome 102+). All currently-supported Chrome versions support it. Fallback not needed.
- **Negligible**: The auto-save on blur means a user who pastes a wrong key, then immediately closes the tab, has the wrong key saved. Acceptable — they can fix it in Options. The improvement (no "Save" button) is worth more than the corner case.
- **Negligible**: The onboarding card uses the same HUD container as the translation status. The two states are mutually exclusive (the card only shows when NOT translating), so no visual conflict.
- **Negligible**: If the user has multiple tabs open and dismisses the card in one tab, the other tabs still show it (no cross-tab sync for the dismiss flag in V1). Acceptable — clicking × is one click.

## Out of scope (separate tasks)

- P3b: first-translation transparency (loading-spinner redesign, pre-translate, no-backdrop, always-pinned overlays).
- Popup "重置 onboarding 提示" link.
- v0.4.0 release.
- Renaming `requestedPath: 'ollama-direct'` → `'local-server-direct'`.
- Cross-tab onboarding-state sync.

## Open questions

None.
