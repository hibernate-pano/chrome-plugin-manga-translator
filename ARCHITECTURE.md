# Architecture

This document describes how the extension is wired together: which contexts run
where, how they communicate, and where the major pieces of state live.

## Contexts

A Chrome MV3 extension has four isolated JavaScript contexts. Each has its own
DOM, its own `window`, and a constrained message bridge to the others.

```
                +----------------+        +-----------------+
                |   Popup (UI)   |        |   Options (UI)  |
                |   360×460px    |        |   full page     |
                +-------+--------+        +--------+--------+
                        |                          |
                        | chrome.runtime           |
                        | .sendMessage             |
                        v                          v
                +----------------------------------------+
                |        Background Service Worker      |
                |     (job queue, message routing,      |
                |      provider-direct translation)     |
                +----------------+-----------------------+
                                 |
                                 | chrome.tabs
                                 | .sendMessage
                                 v
                +----------------------------------------+
                |          Content Script (per-tab)      |
                |     image scanning, HUD, reading       |
                |     panel + anchors, overlay renderer  |
                +----------------------------------------+
```

### 1. Popup — `src/components/Popup/PopupApp.tsx`

- Toolbar action, ~360×460px.
- One-shot controls: "Translate current page", "Force retranslate", "Reset".
- Shows a small provider switcher + target-language picker + status card.
- Confirms dangerous actions (reset / force-retranslate) via
  `src/components/ui/confirm-dialog.tsx`.

### 2. Options — `src/components/Options/OptionsApp.tsx`

- Full settings page (`src/options.html`).
- Three provider cards (OpenAI-compatible / Ollama / LM Studio), each with
  base URL, model, optional API key, and a "test connection" button.
- Privacy banner explaining where data flows.
- Mounts `<OnboardingApp />` at the top so first-time users see the modal
  before the settings UI.

### 3. Background — `src/background/background.ts`

- Service worker (`src/background/background.ts`).
- Owns the translation job queue and the provider-direct translation path.
- Bridges Popup/Options ↔ Content Script messages.
- Validates message senders: sensitive actions (`getConfig`, `setConfig`)
  are restricted to extension-origin senders; content scripts can use
  job / fetch / state endpoints.

### 4. Content Script — `src/content/content.ts`

- Injected into every page (manifest `content_scripts.matches = ["<all_urls>"]`).
- Owns the page-level translation flow:
  1. Scan → filter (`image-filter.ts`) → dedupe → candidate list.
  2. Translate each image via the background service worker (job envelope).
  3. Render overlays (`services/renderer.ts`).
  4. Upsert into the reading panel (`content/reading-panel.ts`) and the
     numbered image anchors (`content/reading-anchors.ts`).
- Owns the on-page UI: `floating-hud.ts` (status), `reading-panel.ts`
  (translations list), `reading-anchors.ts` (numbered badges).

## Message protocol

The dispatcher accepts two coexisting envelopes — see `src/shared/runtime-contracts.ts`.
Do not unify without also migrating the consumers.

### Action-based (legacy)

```ts
{ action: 'fetchImage' | 'getConfig' | 'setConfig' | ... }
```

Used by `services/image-processor.ts` (CORS image proxy) and by Popup/Options
when reading/writing config.

Response shape: `{ success, imageBase64 }` or `{ success, config }`.

### Type-based (job envelope)

```ts
{ type: 'JOB_TRANSLATE_IMAGE' | 'JOB_QUERY_STATUS' | ... }
```

Used by `services/translation-transport.ts` for translation dispatch via the
job queue.

Response shape: `{ success, job: { ... }, textAreas }` (envelope).

## Translation pipeline

Default: **`full-image-vlm`** — a single VLM pass over the (possibly downscaled)
image that returns a JSON list of translated text bubbles. No Tesseract required.

Optional: **`hybrid-regions`** — Tesseract.js detects text regions, the VLM
translates each region in a smaller batched call. Useful when the default
pipeline wastes tokens on full-image OCR. Requires Tesseract assets (~3 MB WASM).

The translator lives in `src/services/translator.ts`. It is constructed from
the live config via `createTranslatorFromConfig()`.

## State

- **`src/stores/config-v2.ts`** — Zustand store, persisted to
  `chrome.storage.local` (NOT `sync` — see v0.3.5 security fix). The store is
  the single source of truth for: provider, model, base URL, language, target
  language, parallel limit, cache toggle, render mode, translation pipeline,
  onboarding completion flag, overlay style.
- **`src/stores/cache-v2.ts`** — translation cache, scoped per-image hash.
  The cache key is image hash; **the cache does not bind provider**, so switching
  provider requires "Force retranslate".
- **`src/stores/usage-store.ts`** — token / call counters, fed by the
  translator. Wired but not surfaced in UI yet — see ROADMAP.

## Reading mode

`src/content/reading-panel.ts` and `src/content/reading-anchors.ts` together
implement the reading mode that ships in v0.5.0.

- The panel is a 320px-wide floating Shadow-DOM panel on the right side of
  the page. Each translated image gets an entry with: number, preview text,
  full bubble list.
- Anchors are small circular badges anchored to the top-right corner of each
  translated image. Clicking a badge dispatches `reading-anchor-click`,
  which `content.ts` wires to scrolling the matching panel entry into view.
- Both reset together when `clearAll()` runs.

## Errors

`src/utils/error-handler.ts` defines `TranslationErrorCode` (one enum per
known failure mode) and `FriendlyError` (code + message + suggestion +
optional `ErrorAction`).

`ErrorAction` is the v0.6.0 contract:

```ts
interface ErrorAction {
  type: 'open-settings' | 'copy-command';
  label: string;
  command?: string;   // For copy-command actions: the runnable shell snippet
}
```

The HUD renders the action button. The content script handles the click by
opening settings or copying `command` to the clipboard. For `MODEL_NOT_FOUND`,
the content script substitutes the active provider's model name at render time.

## Privacy / security notes

- API keys are XOR-obfuscated before persistence (see `src/utils/crypto.ts`).
  This is **not real encryption** — it stops casual disk inspection but a
  determined attacker with the salt can recover the key. The right hardening
  is to store keys in `chrome.storage.local` (already done in v0.3.5) and
  never log them.
- `host_permissions: ["<all_urls>"]` is required to fetch CORS-tainted
  images from manga sites. The extension does not exfiltrate data; it only
  forwards images to the user's configured VLM endpoint.
- Background message validation restricts `getConfig` / `setConfig` to
  extension-origin senders (introduced in v0.3.3 after a trust-boundary audit).
