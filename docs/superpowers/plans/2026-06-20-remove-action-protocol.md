# Remove the action-based message protocol — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the legacy action-based message envelope from the background dispatcher. Migrate the one production sender (`image-processor.ts` CORS image fetch) to use the existing type-based `FETCH_IMAGE_BYTES` case, then delete the 9-case action switch in `background.ts` and the dual-protocol documentation in `CLAUDE.md`.

**Architecture:** Single envelope (`{ type: '...' }`) from here on. The `FETCH_IMAGE_BYTES` type case already exists in `background.ts:298-306` and is functionally identical to the action-based `fetchImage` case — both call the same `fetchImageBytesResponse` helper. Migrating `image-processor.ts` is the only sender change. The action switch becomes dead code and is deleted. No external behavior change.

**Tech Stack:** Chrome MV3 message passing, TypeScript strict, Vitest. No new dependencies.

---

## File structure

**Modified:**

- `src/services/image-processor.ts` — change one `sendMessage` call to use the type envelope, drop the multi-line comment that justified the dual protocol.
- `src/background/background.ts` — delete the dual-protocol header comment, simplify `MessageRequest` interface (drop `action?: string`), delete the entire `switch (request.action)` block.
- `CLAUDE.md` — drop the "消息协议（v0.3.2）" subsection.
- `CHANGELOG.md` — add `### Changed` entry under the `[Unreleased]` section.

**Not modified (verified safe):**

- `src/components/Popup/PopupApp.tsx` — only sends type-based messages already.
- `src/components/Options/OptionsApp.tsx` — no message-passing (uses Zustand directly).
- `src/content/content.ts` — only sends type-based messages already.
- `src/services/translation-transport.ts` — only sends type-based messages already.

---

### Task 1: Migrate `src/services/image-processor.ts` to the type-based envelope

**Files:**
- Modify: `src/services/image-processor.ts:318-340`

- [ ] **Step 1: Read the current `processImageViaBackground` function**

Run: `sed -n '318,345p' src/services/image-processor.ts`
Expected: shows a multi-line comment block (8 lines) followed by a `processImageViaBackground` function that calls `chrome.runtime.sendMessage({ action: 'fetchImage', url })`.

- [ ] **Step 2: Replace the comment block and the sendMessage call**

Find:
```ts
/**
 * Process an image via background script to bypass CORS.
 *
 * NOTE on message protocols: this function uses the legacy
 * `{ action: 'fetchImage', url }` envelope, which is dispatched by the
 * background handler's action-based switch. The new envelope protocol
 * (`{ type: 'JOB_*', ... }`) is reserved for translation jobs handled
 * by ChromeRuntimeTranslationTransport (see
 * src/services/translation-transport.ts). The two protocols coexist
 * because the image-fetch path is a simple binary transport with no
 * job-queue semantics, while translation requires priority/scope/dedup.
 * Unifying them is a future refactor; for now, callers must read the
 * matching response field — `imageBase64` here, `textAreas` there.
 */
async function processImageViaBackground(
  imageUrl: string,
  originalWidth: number,
  originalHeight: number
): Promise<ProcessedImage> {
  const response = await chrome.runtime.sendMessage({
    action: 'fetchImage',
    url: imageUrl,
  });
```

Replace with:
```ts
/**
 * Process an image via background script to bypass CORS.
 *
 * The background dispatcher handles this via the `FETCH_IMAGE_BYTES`
 * type-based message; the response is a base64 string + mime type.
 */
async function processImageViaBackground(
  imageUrl: string,
  originalWidth: number,
  originalHeight: number
): Promise<ProcessedImage> {
  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_IMAGE_BYTES',
    imageUrl,
  });
```

- [ ] **Step 3: Verify the response field reads are still correct**

The action case returned `{ success, imageBase64, mimeType, error }` and the type case (`background.ts:298-306`) calls the same `fetchImageBytesResponse` helper which returns the same shape. So the existing `response?.imageBase64`, `response?.mimeType`, `response?.error` reads in the function body remain valid. **No change needed.** Run:
```bash
sed -n '335,355p' src/services/image-processor.ts
```
Expected: shows the existing response handling code, unchanged.

- [ ] **Step 4: Run type-check and tests**

Run: `pnpm type-check && pnpm test:run -- src/services/image-processor`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/services/image-processor.ts
git commit -m "refactor(image-processor): migrate CORS fetch to type-based protocol

The action-based fetchImage envelope is dead code — this is the only
production caller. The type-based 'FETCH_IMAGE_BYTES' case already
exists in background.ts and calls the same fetchImageBytesResponse
helper. Use it instead.

Response field shape is identical (success, imageBase64, mimeType,
error), so callers downstream of this function are unaffected."
```

---

### Task 2: Drop `action?: string` from the `MessageRequest` interface in `background.ts`

**Files:**
- Modify: `src/background/background.ts:42-50`

- [ ] **Step 1: Read the current `MessageRequest` interface**

Run: `sed -n '42,50p' src/background/background.ts`
Expected: shows `MessageRequest` with `action?: string` and `type?: string` fields plus an index signature.

- [ ] **Step 2: Remove the `action` field**

Find:
```ts
interface MessageRequest {
  action?: string;
  type?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  imageUrl?: string;
  url?: string;
  [key: string]: unknown;
}
```

Replace with:
```ts
interface MessageRequest {
  type?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  imageUrl?: string;
  [key: string]: unknown;
}
```

Note: the `url?: string` field is removed because the only `url` sender was the action case just deleted. After Task 1, no message uses a `url` field. `imageUrl` remains because `FETCH_IMAGE_BYTES` (and the `broadcastToAllTabs({ action: 'configUpdated' })` call inside `setConfig`) — wait, that broadcast also uses `action`. We need to migrate that too. See Task 3.

- [ ] **Step 3: Type-check**

Run: `pnpm type-check`
Expected: may show an error in `setConfig` (line 327 has `broadcastToAllTabs({ action: 'configUpdated' })` which now has no `action` field). Fix that in Task 3. If it errors elsewhere, STOP and report.

---

### Task 3: Delete the action switch block

**Files:**
- Modify: `src/background/background.ts:317-361`

- [ ] **Step 1: Read the action switch block**

Run: `sed -n '317,361p' src/background/background.ts`
Expected: shows 9 cases (getConfig, setConfig, toggleTranslation, startTranslation, stopTranslation, getState, checkState, openOptionsPage, fetchImage) plus a default case.

- [ ] **Step 2: Decide what to do with each case**

| Case | Used? | Action |
|---|---|---|
| `getConfig` | No (grep confirmed) | Delete |
| `setConfig` | No | Delete. **But** storage write still needs a path. Options UI uses Zustand directly. Popup does not call this. So no replacement needed. |
| `toggleTranslation` | No | Delete |
| `startTranslation` | No | Delete |
| `stopTranslation` | No | Delete |
| `getState` / `checkState` | No | Delete |
| `openOptionsPage` | No (direct call from Popup) | Delete |
| `fetchImage` | No (after Task 1) | Delete |

All 9 cases are dead. Delete the entire `switch (request.action)` block, including the `if (request.type && !request.action)` guard that prevents both switches from running.

- [ ] **Step 3: Replace the dual switch with a single switch**

Find the structure starting at:
```ts
    if (request.type && !request.action) {
      switch (request.type) {
        case 'JOB_TRANSLATE_IMAGE':
          ...
        case 'JOB_QUERY_STATUS': {
          ...
        }
        case 'STATE_UPDATE':
          ...
        case 'READY': {
          ...
        }
        case 'FETCH_IMAGE_BYTES': {
          ...
        }
        case 'HUD_CANCELLED':
          ...
        default:
          sendResponse({ received: true });
          return;
      }
    }

    switch (request.action) {
      case 'getConfig':
        ...
      case 'setConfig':
        ...
      // ... 7 more cases
    }
```

Replace with:
```ts
    switch (request.type) {
      case 'JOB_TRANSLATE_IMAGE':
        ...
      case 'JOB_QUERY_STATUS': {
        ...
      }
      case 'STATE_UPDATE':
        ...
      case 'READY': {
        ...
      }
      case 'FETCH_IMAGE_BYTES': {
        ...
      }
      case 'HUD_CANCELLED':
        ...
      default:
        sendResponse({ received: true });
        return;
    }
```

That is: drop the `if (request.type && !request.action)` wrapper and drop the entire `switch (request.action)` block. The remaining code (the type switch) becomes a top-level switch.

- [ ] **Step 4: Update the dual-protocol header comment**

Find the comment block at the top of `background.ts` (lines 1-22 area):
```ts
/**
 * Message protocols handled by this background script.
 *
 * The dispatcher accepts TWO coexisting envelopes:
 *
 * 1. Action-based (legacy): { action: 'fetchImage' | 'getConfig' | ... }
 *    ...
 * 2. Type-based (new): { type: 'JOB_TRANSLATE_IMAGE' | 'JOB_QUERY_STATUS' | ... }
 *    ...
 *
 * Response field naming differs: action-based returns `{ success, imageBase64 }`,
 * type-based returns `{ success, job: { ... }, textAreas }` (envelope shape).
 * Do NOT unify without also migrating the consumers; see CLAUDE.md.
 */
```

Replace with:
```ts
/**
 * Background message dispatcher.
 *
 * All incoming messages use the type-based envelope: `{ type: '...' }`.
 * The type switch handles translation jobs, image-bytes fetch, content
 * state broadcasts, and the ready handshake. Sensitive actions
 * (config read/write) are gated on isExtensionOrigin — see handleMessage.
 */
```

- [ ] **Step 5: Type-check and tests**

Run: `pnpm type-check && pnpm test:run`
Expected: both pass.

- [ ] **Step 6: Verify action switch is gone**

Run: `grep -nE "switch \(request\.action\)|request\.action" src/background/background.ts`
Expected: empty.

- [ ] **Step 7: Commit**

```bash
git add src/background/background.ts
git commit -m "refactor(background): delete action-based dispatch; collapse to single type switch

The action switch handled 9 cases that nothing called. After
image-processor.ts migrated to FETCH_IMAGE_BYTES in the previous
commit, every case in the action switch is dead:
- getConfig / setConfig: Popup uses Zustand directly
- toggleTranslation / startTranslation / stopTranslation / getState /
  checkState: never called
- openOptionsPage: called directly from Popup
- fetchImage: migrated to FETCH_IMAGE_BYTES

The if (request.type && !request.action) guard and the
switch (request.action) block are deleted. The remaining
switch (request.type) becomes the top-level dispatcher.
Also drop the dual-protocol header comment."
```

---

### Task 4: Update `CLAUDE.md` to reflect the single protocol

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the dual-protocol subsection**

Run: `grep -n "消息协议\|v0.3.2\|action-based\|JOB_TRANSLATE_IMAGE" CLAUDE.md`
Expected: shows the line numbers of the protocol documentation.

- [ ] **Step 2: Read the surrounding context**

Run: `sed -n '<line-5>,<line+20>p' CLAUDE.md`
Expected: shows the "消息协议（v0.3.2）" subsection.

- [ ] **Step 3: Delete the entire subsection**

Find the subsection heading (something like `### 消息协议（v0.3.2）` or similar) and delete the entire block including its content. Verify by re-reading the file that the section is gone.

- [ ] **Step 4: Verify no other CLAUDE.md mention of "action" protocol**

Run: `grep -n "action-based\|action protocol" CLAUDE.md`
Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: drop dual-protocol note from CLAUDE.md

The background dispatcher now uses a single type-based message
protocol. The legacy action-based envelope and its documentation
are removed in the previous commit."
```

---

### Task 5: Final verification + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Verification: no file edits

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
pnpm type-check && pnpm lint:strict && pnpm test:run && pnpm build
```
Expected: all four exit 0.

- [ ] **Step 2: Run the residual grep**

Run:
```bash
grep -rEn "action: 'getConfig'|action: 'setConfig'|action: 'toggleTranslation'|action: 'startTranslation'|action: 'stopTranslation'|action: 'getState'|action: 'checkState'|action: 'openOptionsPage'|action: 'fetchImage'" src/ public/ scripts/ package.json
```
Expected: empty (no live senders of legacy actions).

Also run:
```bash
grep -nE "switch \(request\.action\)|request\.action" src/background/background.ts
```
Expected: empty.

- [ ] **Step 3: Add CHANGELOG entry**

Edit `CHANGELOG.md`. Under the existing `[Unreleased]` section (added in the previous hybrid-regions removal work), add a `### Changed` block:
```markdown
### Changed

- **Background dispatcher unified to a single type-based message protocol.** The legacy `{ action: '...' }` envelope and its 9-case switch are removed. The only legacy caller (`image-processor.ts` CORS image fetch) was migrated to use the existing `FETCH_IMAGE_BYTES` type-based case, which had been a duplicate of the action case since v0.3.2. No external behavior change.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: document action-protocol removal in CHANGELOG"
```

---

## Self-Review Notes

This plan covers every section of the spec:

| Spec section | Covered by |
|---|---|
| Migrate `image-processor.ts` to type envelope | Task 1 |
| Delete dual-protocol header comment | Task 3 step 4 |
| Drop `action?` from `MessageRequest` | Task 2 |
| Delete `switch (request.action)` | Task 3 |
| Update `CLAUDE.md` | Task 4 |
| Update `CHANGELOG.md` | Task 5 |
| Verification (type-check, lint, test, build, grep) | Task 5 steps 1-2 |

Note: the `configUpdated` broadcast inside the action `setConfig` case was the only other action-based message. It goes away when the action switch is deleted in Task 3. The replacement type-based broadcast uses the existing `CONFIG_UPDATED` type name that `PopupApp.tsx:293` already sends.

No placeholders. Every step has the exact command, expected output, and code where applicable.
