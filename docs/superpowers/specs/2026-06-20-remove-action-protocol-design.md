# Remove the action-based message protocol

- **Date**: 2026-06-20
- **Status**: Design (awaiting user review)
- **Author**: Claude (co-founder / architect role)
- **Target release**: next minor (v0.4.0 or v0.3.6)

## Context

`src/background/background.ts` currently dispatches on two coexisting message envelopes:

- **Action-based** (legacy): `{ action: 'getConfig' | 'setConfig' | 'toggleTranslation' | ... }` — 9 cases in a `switch (request.action)` block.
- **Type-based** (new): `{ type: 'JOB_TRANSLATE_IMAGE' | 'FETCH_IMAGE_BYTES' | 'TRANSLATE_PAGE' | ... }` — 6 cases in a `switch (request.type)` block.

The two envelopes were documented as "coexisting on purpose" because:
- The image-fetch path is a simple binary transport (response: `{ success, imageBase64 }`).
- The translation job path needs priority/scope/dedup (response: `{ success, job, textAreas }`).

**But the action protocol is dead code.** Grep across `src/` (excluding tests) for action-based senders finds **one** production caller: `src/services/image-processor.ts:335-338`, which sends `{ action: 'fetchImage', url }`. No UI component (Popup, Options) sends action-based messages — they use the Zustand store directly. The action switch in `background.ts` handles 9 cases that nobody calls. CLAUDE.md's "Two protocols coexist" note is now misleading.

`FETCH_IMAGE_BYTES` already exists as a type-based case in `background.ts:298-306` and is functionally identical to the action-based `fetchImage` case at `background.ts:350-358` — they both call the same `fetchImageBytesResponse` helper. The two cases are duplicates.

The only `openOptionsPage` call site in the codebase is direct from `PopupApp.tsx:253` and `background.ts:140` (onInstalled) — `chrome.runtime.openOptionsPage()` is called directly, not via the action message. So the `case 'openOptionsPage'` action case is also dead.

The only real sender is `image-processor.ts`. Migrate it to the type-based protocol, delete the action switch, and the entire dual-protocol story collapses to "we use type-based messages, period."

## Goal

Eliminate the action-based message protocol. After this change:

- Every message has `{ type: '...' }`. No more `action:`.
- `background.ts` has a single `switch (request.type)` block.
- The 9 dead action cases are removed.
- `image-processor.ts` calls the existing `FETCH_IMAGE_BYTES` type-based case.
- The "two coexisting protocols" documentation is deleted.
- No external behavior change for end users (no live senders are modified in shape; just the protocol they use).

## Non-goals

- Not changing the type-based protocol itself (no rename, no restructure).
- Not adding telemetry, error reporting, or other features.
- Not changing the `isExtensionOrigin` trust boundary.
- Not touching any unrelated `chrome.tabs.sendMessage` calls (content ↔ content-script side, all type-based already).

## Approach

**Migrate one caller, delete the dead switch.**

| Decision | Choice | Reason |
|---|---|---|
| Rename action-based messages to type-based? | N/A | Only one caller exists; migrate it. |
| Keep `fetchImage` action for backward compat? | No | This is internal — no external consumers. |
| Use the existing `FETCH_IMAGE_BYTES` case? | Yes | Functionally identical to the action case, no need to add a new case. |
| Keep `MessageRequest.action` field as optional? | No | Delete the field; simplify the request type. |

## Scope of changes

### Surgical edits

- **`src/services/image-processor.ts`** (lines 320-340): 
  - Replace the `{ action: 'fetchImage', url }` envelope with `{ type: 'FETCH_IMAGE_BYTES', imageUrl }`.
  - The action case uses `url`, the type case uses `imageUrl`. Verify the rename in the call.
  - Update the 8-line comment block (lines 318-326) that explains the two protocols. After migration, the comment can be deleted entirely or simplified to one line ("CORS bypass via background").
  - Update the response field reads: action returns `{ imageBase64, mimeType }`; type case returns the same shape. **No change** here.

- **`src/background/background.ts`** (lines 6-22, 41-50, 230-368):
  - Delete the dual-protocol header comment (lines 1-22 area).
  - Simplify the `MessageRequest` interface: remove the `action?: string` field. Keep `type?: string` (it was already there for the type switch).
  - Simplify the `MessageResponse` interface: not needed actually — it's an open type. Verify.
  - Delete the `switch (request.action)` block (lines 317-361).
  - Update the message-handler doc comment to reflect the single protocol.
  - Inside the type switch (line 271), verify `FETCH_IMAGE_BYTES` already exists and works as expected.

### Docs

- **`CLAUDE.md`**: 
  - Remove the "消息协议（v0.3.2）" subsection that documents the dual protocol.
  - The whole project now uses one protocol: type-based messages.

- **`CHANGELOG.md`**: Add a `### Changed` entry to the unreleased section:
  > **Background dispatcher unified to a single type-based message protocol.** The legacy `{ action: '...' }` envelope and its 9-case switch are removed. The only legacy caller (`image-processor.ts` CORS image fetch) was migrated to use the existing `FETCH_IMAGE_BYTES` type-based case, which had been a duplicate of the action case since v0.3.2. No external behavior change.

### Tests

- `src/background/background.test.ts` and related: run `pnpm test:run -- src/background` to verify no regression. If any test was hitting the action switch (unlikely given the dead-code finding), update it.

## Migration

No user-facing migration needed:
- `chrome.storage.local` config keys are unchanged.
- The action protocol was internal; no external API.
- `image-processor.ts` is the only sender and it's in the same package.

## Verification

1. `pnpm type-check` exits 0.
2. `pnpm lint:strict` exits 0 with no warnings.
3. `pnpm test:run` is fully green.
4. `pnpm build` succeeds.
5. `grep -rEn "action: 'getConfig'|action: 'setConfig'|action: 'toggleTranslation'|action: 'startTranslation'|action: 'stopTranslation'|action: 'getState'|action: 'checkState'|action: 'openOptionsPage'|action: 'fetchImage'" src/ public/ scripts/ package.json` returns empty (no live senders of legacy actions).
6. `grep -rEn "switch \(request\.action\)|request\.action" src/background/background.ts` returns empty (the action switch is gone from the dispatcher).

## Risks

- **Low**: If a future external integration (test fixture, debugging script, etc.) was sending one of the 9 action messages, it would now silently fail. Grep in step 5 surfaces this before commit.
- **Negligible**: The `image-processor.ts` CORS path is the only behavior change; it's covered by `src/services/image-processor.test.ts` (which tests the response handling, not the wire protocol).

## Out of scope (separate tasks)

- Renaming `requestedPath: 'ollama-direct'` → `'local-server-direct'`.
- Adding local error statistics.
- Releasing the next version (the `c2ded40` sync→local migration commit and the hybrid-regions removal PR are not yet released).

## Open questions

None.