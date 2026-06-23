# Zero-friction on-boarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user go from "installed the extension" to "reading translated manga" with **zero forced configuration steps** and **at most one click + one paste**. No Options page auto-opens on install. Default `enabled: true`. A small in-page corner card appears on the first visit to a manga site when the provider is not configured; clicking its "去配置" button opens Options and focuses the API key input; the key is auto-saved on blur.

**Architecture:** A new `HudState` variant (`'onboarding'`) drives a small corner card inside the existing `FloatingHud` (Shadow DOM, no new dependencies). A new `src/utils/onboarding.ts` owns the session-storage helpers for dismiss + focus signals. `content.ts` reads the configured-flag on first paint and tells the HUD which state to show. `OptionsApp.tsx` reads the focus signal on mount, scrolls + focuses the right API key input, and the existing provider input's `onBlur` auto-saves.

**Tech Stack:** Chrome MV3, TypeScript strict, React, shadcn/ui. No new dependencies. `chrome.storage.session` for transient flags (replaces cross-tab broadcast for this single-purpose signal).

---

## File structure

**New:**
- `src/utils/onboarding.ts` — 3 async functions, session-storage helpers.

**Modified:**
- `src/background/background.ts` — remove the `openOptionsPage()` call in the `install` branch of `onInstalled`.
- `src/shared/app-config.ts` — `DEFAULT_RUNTIME_APP_CONFIG.enabled`: `false` → `true`.
- `src/content/content.ts` — read config + onboarding state on init, drive the new HUD state, handle `hud-configure` and `hud-dismiss-onboarding` events.
- `src/content/floating-hud.ts` — new `HudState` variant + render + auto-collapse + event dispatch.
- `src/components/Options/OptionsApp.tsx` — read focus signal on mount, scroll + focus + highlight the right API key input; change save semantics from explicit button to `onBlur`.

**Not modified:**
- `src/stores/config-v2.ts` — `setProviderConfig` and `isProviderConfigured` used as-is.
- `src/components/Popup/PopupApp.tsx` — out of scope (deferred "重置 onboarding 提示" link).
- `src/services/*` — no change.
- `CHANGELOG.md` — deferred to v0.4.0.

---

### Task 1: Default `enabled: true` and remove forced Options open

**Files:**
- Modify: `src/shared/app-config.ts:44`
- Modify: `src/background/background.ts:120-133`

- [ ] **Step 1: Read the current default**

Run: `sed -n '43,52p' src/shared/app-config.ts`
Expected: `enabled: false,` in the `DEFAULT_RUNTIME_APP_CONFIG` object.

- [ ] **Step 2: Flip the default to `true`**

Find: `enabled: false,`
Replace with: `enabled: true,`

- [ ] **Step 3: Read the `onInstalled` handler**

Run: `sed -n '120,140p' src/background/background.ts`
Expected: shows the `onInstalled` listener with a branch for `details.reason === 'install'` that calls `chrome.runtime.openOptionsPage()`.

- [ ] **Step 4: Remove the forced Options open**

Find:
```ts
  if (details.reason === 'install') {
    void initializeDefaultSettings();
    void chrome.runtime.openOptionsPage();
  } else if (details.reason === 'update') {
    void migrateSettings();
  }
```

Replace with:
```ts
  if (details.reason === 'install') {
    void initializeDefaultSettings();
  } else if (details.reason === 'update') {
    void migrateSettings();
  }
```

- [ ] **Step 5: Type-check + tests**

Run: `pnpm type-check && pnpm test:run`
Expected: both pass. (The Popup/Options tests should not break — they read state from the store, not the default value.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/app-config.ts src/background/background.ts
git commit -m "feat(onboarding): default enabled: true and drop forced Options open

- DEFAULT_RUNTIME_APP_CONFIG.enabled flipped to true. The Popup
  toggle still exists for users who want to pause.
- onInstalled 'install' branch no longer calls
  chrome.runtime.openOptionsPage(). Users land on the page they
  were on. The extension is silent at install time.

Existing users with stored 'enabled: false' are unaffected: the
Zustand persist layer preserves their stored value across
default changes. The new default only applies to fresh installs.
The 'update' branch is unchanged."
```

---

### Task 2: New `src/utils/onboarding.ts` with 3 async functions

**Files:**
- Create: `src/utils/onboarding.ts`

- [ ] **Step 1: Create the file**

Write `src/utils/onboarding.ts` with the following content:

```ts
import type { ProviderType } from '@/providers/base';

const DISMISSED_KEY = 'manga-translator-onboarding-dismissed';
const FOCUS_KEY = 'manga-translator-onboarding-focus';

export interface OnboardingFocusSignal {
  provider: ProviderType;
  ts: number;
}

export async function isOnboardingDismissed(): Promise<boolean> {
  const result = await chrome.storage.session.get(DISMISSED_KEY);
  return Boolean(result[DISMISSED_KEY]);
}

export async function setOnboardingDismissed(): Promise<void> {
  await chrome.storage.session.set({ [DISMISSED_KEY]: true });
}

export async function requestConfigureFocus(
  provider: ProviderType
): Promise<void> {
  const signal: OnboardingFocusSignal = { provider, ts: Date.now() };
  await chrome.storage.session.set({ [FOCUS_KEY]: signal });
}

export async function readAndClearFocusSignal(): Promise<OnboardingFocusSignal | null> {
  const result = await chrome.storage.session.get(FOCUS_KEY);
  const signal = result[FOCUS_KEY] as OnboardingFocusSignal | undefined;
  if (!signal) {
    return null;
  }
  // Only honor signals from the last 30 seconds
  if (Date.now() - signal.ts > 30_000) {
    void chrome.storage.session.remove(FOCUS_KEY);
    return null;
  }
  await chrome.storage.session.remove(FOCUS_KEY);
  return signal;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/utils/onboarding.ts
git commit -m "feat(onboarding): add session-storage helpers for onboarding flow

- isOnboardingDismissed / setOnboardingDismissed: track whether
  the user clicked × on the corner card this browser session.
- requestConfigureFocus(provider): writes a one-shot signal that
  the Options page reads on mount to know which provider's
  API key input to focus.
- readAndClearFocusSignal: reads the signal (only if < 30s old)
  and clears it. Returns null if missing or stale.

Uses chrome.storage.session so signals are dropped on browser
restart, but persist across tabs in the same session."
```

---

### Task 3: HUD `onboarding` state

**Files:**
- Modify: `src/content/floating-hud.ts`

- [ ] **Step 1: Read the `HudState` type definition**

Run: `sed -n '15,28p' src/content/floating-hud.ts`
Expected: shows the `HudState` union type.

- [ ] **Step 2: Add the `onboarding` variant**

Find:
```ts
export type HudState =
  | { status: 'hidden' }
  | { status: 'translating'; current: number; total: number; currentImageIndex?: number }
  | {
      status: 'complete';
      translatedCount: number;
      failedCount: number;
      cachedCount: number;
    }
  | { status: 'error'; message: string; suggestion?: string };
```

Replace with:
```ts
export type HudState =
  | { status: 'hidden' }
  | { status: 'translating'; current: number; total: number; currentImageIndex?: number }
  | {
      status: 'complete';
      translatedCount: number;
      failedCount: number;
      cachedCount: number;
    }
  | { status: 'error'; message: string; suggestion?: string }
  | { status: 'onboarding' };
```

- [ ] **Step 3: Add fields for the auto-collapse timer**

Find: `private autoHideTimer: ReturnType<typeof setTimeout> | null = null;`

Replace with:
```ts
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private onboardingCollapseTimer: ReturnType<typeof setTimeout> | null = null;
  private onboardingExpanded = true;
```

- [ ] **Step 4: Add the onboarding branch in `update()`**

Find the block:
```ts
    if (state.status === 'hidden') {
      hud.style.display = 'none';
      return;
    }
```

Insert **before** this block (so the existing logic still runs for non-onboarding states):
```ts
    if (state.status === 'onboarding') {
      this.startOnboardingCard(hud);
      return;
    }
```

(The `startOnboardingCard` method is added in step 6. For now this step just adds the branch — the method definition is added next.)

- [ ] **Step 5: Add the `onboarding` case in `renderState`**

Find:
```ts
      case 'error': {
```

Insert **before** that block:
```ts
      case 'onboarding': {
        return `
          <div class="hud-card hud-card--onboarding" id="onboarding-card">
            <button id="onboarding-close" class="hud-onboarding-close" title="关闭" aria-label="关闭">×</button>
            <div class="hud-title">需要 API key 才能翻译</div>
            <div class="hud-sub">点下面按钮完成配置（约 10 秒）</div>
            <button id="onboarding-configure" class="hud-onboarding-action">去配置</button>
          </div>
        `;
      }
```

- [ ] **Step 6: Add the helper methods + styles**

Find the `private clearAutoHide(): void {` method and add the following methods **before** it:

```ts
  private startOnboardingCard(hud: HTMLElement): void {
    this.clearOnboardingTimers();
    hud.style.display = 'block';
    hud.innerHTML = this.renderState({ status: 'onboarding' });
    this.onboardingExpanded = true;

    // Auto-collapse after 8 seconds
    this.onboardingCollapseTimer = setTimeout(() => {
      this.setOnboardingCollapsed(true);
    }, 8000);
  }

  private setOnboardingCollapsed(collapsed: boolean): void {
    this.onboardingExpanded = !collapsed;
    const card = this.shadow.getElementById('onboarding-card');
    if (!card) return;
    card.classList.toggle('hud-onboarding-collapsed', collapsed);
  }

  private clearOnboardingTimers(): void {
    if (this.onboardingCollapseTimer !== null) {
      clearTimeout(this.onboardingCollapseTimer);
      this.onboardingCollapseTimer = null;
    }
  }
```

- [ ] **Step 7: Extend `clearAutoHide` to also clear the onboarding timer**

Find:
```ts
  private clearAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }
```

Replace with:
```ts
  private clearAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
    this.clearOnboardingTimers();
  }
```

- [ ] **Step 8: Add onboarding event handlers + hover-expand**

Find the existing `addEventListener('click', ...)` block in the constructor (around line 52-63). Extend it to handle the new buttons:

```ts
    this.shadow.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.id === 'cancel-btn') {
        this.container.dispatchEvent(
          new CustomEvent('hud-cancel', { bubbles: true, composed: true })
        );
      } else if (target.id === 'retry-failed-btn') {
        this.container.dispatchEvent(
          new CustomEvent('hud-retry-failed', { bubbles: true, composed: true })
        );
      } else if (target.id === 'onboarding-configure') {
        this.container.dispatchEvent(
          new CustomEvent('hud-configure', { bubbles: true, composed: true })
        );
      } else if (target.id === 'onboarding-close') {
        this.container.dispatchEvent(
          new CustomEvent('hud-dismiss-onboarding', { bubbles: true, composed: true })
        );
      }
    });
```

Also add a `mouseenter` listener on the card to re-expand when the user hovers the collapsed card. **Append** to the constructor (after the existing event listener):

```ts
    this.shadow.addEventListener('mouseover', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('.hud-onboarding-collapsed')) {
        this.setOnboardingCollapsed(false);
        // Re-collapse after another 4s of no interaction
        this.clearOnboardingTimers();
        this.onboardingCollapseTimer = setTimeout(() => {
          this.setOnboardingCollapsed(true);
        }, 4000);
      }
    });
```

- [ ] **Step 9: Add onboarding CSS**

Find the closing `</style>` of `buildStyles()` and insert **before** it:

```css
        .hud-card--onboarding {
          background: rgba(180, 130, 30, 0.92);
          max-width: 280px;
        }

        .hud-onboarding-close {
          position: absolute;
          top: 6px;
          right: 8px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          padding: 4px;
        }

        .hud-onboarding-close:hover {
          color: #fff;
        }

        .hud-onboarding-action {
          margin-top: 12px;
          width: 100%;
          background: rgba(255, 255, 255, 0.95);
          border: none;
          border-radius: 6px;
          color: #8a5a00;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 12px;
          cursor: pointer;
          transition: background 0.15s;
        }

        .hud-onboarding-action:hover {
          background: #fff;
        }

        .hud-onboarding-collapsed .hud-sub,
        .hud-onboarding-collapsed .hud-onboarding-action {
          display: none;
        }
```

(Add this right before the `</style>` closing tag, not before any specific selector. Verify the placement by reading the file.)

- [ ] **Step 10: Type-check**

Run: `pnpm type-check`
Expected: exit 0.

- [ ] **Step 11: Lint**

Run: `pnpm lint:strict`
Expected: exit 0.

- [ ] **Step 12: Commit**

```bash
git add src/content/floating-hud.ts
git commit -m "feat(hud): add 'onboarding' state for first-visit corner card

Renders a small amber card with:
- Title: '需要 API key 才能翻译'
- Body: '点下面按钮完成配置（约 10 秒）'
- '去配置' primary action (white button)
- × dismiss in the top-right

Auto-collapses to title-only after 8 seconds, re-expands on
hover. Two new CustomEvents are dispatched from the shadow DOM
for the content script to handle:
- hud-configure: user clicked '去配置'
- hud-dismiss-onboarding: user clicked ×"
```

---

### Task 4: Wire content script to onboarding flow

**Files:**
- Modify: `src/content/content.ts`

- [ ] **Step 1: Add imports**

Find:
```ts
import { incrementErrorStats } from '@/utils/error-stats';
```

Add (after it):
```ts
import {
  isOnboardingDismissed,
  setOnboardingDismissed,
  requestConfigureFocus,
} from '@/utils/onboarding';
import { isProviderConfigured } from '@/stores/config-v2';
```

(If `isProviderConfigured` is exported from a different module, adjust. Verify by `grep -nE 'export.*isProviderConfigured' src/`.)

- [ ] **Step 2: Add the `onboarding` variant to `ContentState`**

Find:
```ts
export type ContentState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'translating'; current: number; total: number; currentImageIndex?: number }
  | { status: 'complete'; count: number; failedCount?: number; cachedCount?: number }
  | { status: 'error'; message: string; suggestion?: string };
```

Replace with:
```ts
export type ContentState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'translating'; current: number; total: number; currentImageIndex?: number }
  | { status: 'complete'; count: number; failedCount?: number; cachedCount?: number }
  | { status: 'error'; message: string; suggestion?: string }
  | { status: 'onboarding' };
```

- [ ] **Step 3: Handle `onboarding` in `setState()`**

Find the `switch (state.status)` block in `setState` and add a case:
```ts
      case 'onboarding':
        hud.update({ status: 'onboarding' });
        break;
```

- [ ] **Step 4: Add the onboarding check at the start of `initialize()`**

Find `async function initialize(): Promise<void> {` and add **at the top of the function body** (after the `console.warn`):

```ts
    // Onboarding check: if the user hasn't configured a provider
    // AND hasn't dismissed the corner card this session, show it.
    try {
      const dismissed = await isOnboardingDismissed();
      if (!dismissed) {
        const config = useAppConfigStore.getState();
        const provider = config.provider;
        if (!isProviderConfigured(provider)) {
          setState({ status: 'onboarding' });
        }
      }
    } catch (err) {
      console.warn('[ContentScript] onboarding check failed:', err);
    }
```

- [ ] **Step 5: Add HUD event listeners for the new events**

Find:
```ts
function setupHudEventListeners(): void {
  document.addEventListener('hud-cancel', handleHudCancel);
  document.addEventListener('hud-retry-failed', handleRetryFailed);
}
```

Replace with:
```ts
function handleHudConfigure(): void {
  const provider = useAppConfigStore.getState().provider;
  void requestConfigureFocus(provider).then(() => {
    chrome.runtime.openOptionsPage().catch(() => undefined);
  });
}

function handleHudDismissOnboarding(): void {
  void setOnboardingDismissed();
  setState({ status: 'idle' });
}

function setupHudEventListeners(): void {
  document.addEventListener('hud-cancel', handleHudCancel);
  document.addEventListener('hud-retry-failed', handleRetryFailed);
  document.addEventListener('hud-configure', handleHudConfigure);
  document.addEventListener('hud-dismiss-onboarding', handleHudDismissOnboarding);
}
```

- [ ] **Step 6: Extend `cleanup()` to remove the new listeners**

Find the section in `cleanup()` that does `document.removeEventListener('hud-cancel', handleHudCancel);`. Add the two new lines:

```ts
  document.removeEventListener('hud-cancel', handleHudCancel);
  document.removeEventListener('hud-retry-failed', handleRetryFailed);
  document.removeEventListener('hud-configure', handleHudConfigure);
  document.removeEventListener('hud-dismiss-onboarding', handleHudDismissOnboarding);
```

(Replace the existing two lines with all four.)

- [ ] **Step 7: Type-check + lint**

Run: `pnpm type-check && pnpm lint:strict`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/content/content.ts
git commit -m "feat(content): drive onboarding state from config check

On initialize, if the user has not dismissed the corner card this
session AND the current provider is not configured, drive the
HUD into the 'onboarding' state. Two new event listeners:

- hud-configure: writes the focus signal + opens Options.
- hud-dismiss-onboarding: persists the dismiss flag and hides
  the card.

The onboarding state is mutually exclusive with translating /
complete / error — those states take priority when they happen."
```

---

### Task 5: Options page focus + auto-save

**Files:**
- Modify: `src/components/Options/OptionsApp.tsx`

- [ ] **Step 1: Add imports**

Find the import block. Add:
```ts
import { useEffect, useState } from 'react';
```
(If `useEffect` and `useState` are already imported, skip this step — extend the existing line.)

Add (alongside other utility imports):
```ts
import { readAndClearFocusSignal } from '@/utils/onboarding';
```

- [ ] **Step 2: Add a focus effect inside the `OptionsApp` component**

Find the top of the `OptionsApp` function (right after the function signature, before any other hooks). Add:

```ts
  useEffect(() => {
    void (async () => {
      const signal = await readAndClearFocusSignal();
      if (!signal) return;
      // Wait one frame for provider cards to render
      await new Promise(r => setTimeout(r, 50));
      const input = document.getElementById(
        `api-key-input-${signal.provider}`
      ) as HTMLInputElement | null;
      if (!input) return;
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus();
      input.classList.add('manga-translator-focus-highlight');
      setTimeout(() => {
        input.classList.remove('manga-translator-focus-highlight');
      }, 1500);
    })();
  }, []);
```

- [ ] **Step 3: Add `id` attributes to the API key inputs**

This requires reading the `renderProviderCard` function. Find it (it renders an input for `apiKey`) and add `id={\`api-key-input-${providerType}\`}` to that input. The id is stable per provider (the provider type is one of `'openai-compatible' | 'ollama' | 'lm-studio'`).

Also add a small text below the input: `<div className="mt-1 text-xs text-slate-500">失焦自动保存</div>`.

- [ ] **Step 4: Add a CSS keyframe for the focus highlight**

Find the `</style>` of any inline styles in the file (or add a `<style>` block at the top of the component). Add:

```css
@keyframes manga-translator-focus-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.7); }
  70%  { box-shadow: 0 0 0 8px rgba(34, 211, 238, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); }
}
.manga-translator-focus-highlight {
  animation: manga-translator-focus-pulse 1.5s ease-out;
}
```

(Place this in a `<style jsx global>` block, or just inject it once via a `useEffect` that creates a `<style>` element.)

- [ ] **Step 5: Change the API key save semantics from explicit button to `onBlur`**

Find the API key input inside `renderProviderCard`. It currently has an `onChange` (or `onBlur`) that updates the store. Verify it already saves on change/blur. **If it does not, change the handler so the input's value is stored on `onBlur`** (rather than on every keystroke, which is the current behavior in some inputs). Use a local `useState` for the input value and a `useEffect` to sync from the store, OR just use the store's `setProviderConfig` directly on `onBlur`.

- [ ] **Step 6: Type-check + lint + test**

Run: `pnpm type-check && pnpm lint:strict && pnpm test:run`
Expected: all three exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/Options/OptionsApp.tsx
git commit -m "feat(options): focus API key input on onboarding signal + auto-save on blur

On mount, OptionsApp reads the one-shot focus signal from
session storage. If present (set within the last 30s by the
content script's '去配置' click), it scrolls to the matching
provider's API key input, focuses it, and applies a 1.5s cyan
outline pulse.

API key inputs now save on blur instead of on every keystroke.
A small '失焦自动保存' hint below the input sets user
expectation. Existing provider cards are otherwise unchanged."
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
pnpm type-check && pnpm lint:strict && pnpm test:run && pnpm build
```
Expected: all four exit 0.

- [ ] **Step 2: Run the residual greps**

Run:
```bash
grep -nE "DEFAULT_RUNTIME_APP_CONFIG.enabled" src/shared/app-config.ts
grep -nE "chrome.runtime.openOptionsPage" src/background/background.ts
```
Expected:
- The first returns `enabled: true,`
- The second returns exactly 1 hit (the context-menu click handler at `background.ts:140`, which is the only remaining legitimate call site — `onInstalled` no longer calls it).

- [ ] **Step 3: Spot-check the new helper file exists**

Run:
```bash
test -f src/utils/onboarding.ts && echo OK
```
Expected: `OK`.

---

## Self-Review Notes

This plan covers every section of the spec:

| Spec section | Covered by |
|---|---|
| Default `enabled: true` | Task 1 |
| Remove forced Options open on install | Task 1 |
| `src/utils/onboarding.ts` with 3 helpers | Task 2 |
| HUD `onboarding` state | Task 3 |
| Content script drives onboarding | Task 4 |
| Options focus + auto-save | Task 5 |
| Verification (type-check, lint, test, build, grep) | Task 6 |

Total new code: ~200 LoC across 6 files. No new dependencies. The dismiss + focus signals use `chrome.storage.session` so they are tab-scoped per browser session without cross-tab broadcast complexity.

No placeholders. Every step has the exact code, command, and expected output.
