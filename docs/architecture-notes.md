# Architecture notes

Contracts in this codebase that are easy to break by accident, and the
reasoning behind them. Read this before touching the listed areas.

## Config storage round-trip

`src/stores/config-v2.ts` is the only persisted configuration store. Its
storage adapter is asymmetric on purpose:

| Direction | Transform |
|---|---|
| `getItem` (rehydrate) | `deobfuscateAllApiKeys` |
| `setItem` (persist) | `obfuscateAllApiKeys` |

Consequences that have caused real bugs:

- **Never compare a persisted snapshot to runtime state with `Object.is` or by
  key count.** The snapshot carries only `PERSISTED_CONFIG_FIELDS` (19 fields);
  the runtime store also carries ~23 actions. Both key count and object
  reference always differ, which is what turned the `chrome.storage.onChanged`
  listener into an unbounded write loop and pushed `obf:`-prefixed keys back
  into memory. Compare by value over `PERSISTED_CONFIG_FIELDS`, via
  `src/stores/config-equality.ts`.
- **Deobfuscate before applying an externally written snapshot.** `onChanged`
  hands you exactly what is on disk, which for API keys is the `obf:` form.
- **Ignore keys outside the whitelist.** Storage is not a trusted channel.
- `partialize` deliberately writes an empty string for the build-time `.env`
  key. Empty therefore means "fall back to the build default", not "clear it".
  `mergePersistedConfig` implements that; do not bypass it.

Regression coverage: `src/stores/config-storage-sync.test.ts`.

## Who may translate without being asked

Three settings are easy to conflate, and conflating them once caused the
extension to translate every site the user visited:

| Setting | Meaning |
|---|---|
| `enabled` | master switch; gates everything, including manual actions |
| `autoTranslateHosts` | hosts where a page translates on load, unprompted |
| `autoContinueEnabled` | within an already-translated page, keep translating images that load later |

`isTranslationEnabled` returns the master switch only. Use
`shouldAutoTranslatePage(config, url)` to decide whether to act unprompted;
`isAutoContinueEnabled` covers the in-page case. Background gates
`tabs.onUpdated` and the content script's `READY` handler with the allowlist,
and the content script arms auto-continue only after the user has requested the
page (or the host is allowlisted).

The allowlist is empty by default. Keep it that way: `<all_urls>` plus
unattended operation is the combination that sends a user's banking or webmail
images to a third-party endpoint, and it is what Chrome Web Store review
scrutinises.

Regression coverage: `src/background/auto-translate.test.ts`.

## Content script size

The content script is injected into every page the user opens, so its weight is
paid on page load. `scripts/check-release-consistency.mjs` fails the build if
`dist/content.js` exceeds 200 KB.

Two things keep it small, both easy to undo by accident:

1. `react-vendor` and `react-dom-vendor` must stay separate chunks in
   `vite.config.ts`. The content script reaches React transitively through
   Zustand but never uses ReactDOM. A single `['react', 'react-dom']` entry made
   the post-build rebundler inline ~110 KB of unused DOM renderer.
2. `contentScriptRebundler()` must keep `minify: true`. It inlines chunks after
   Vite's per-chunk minification and re-expands them otherwise.

Regression coverage: the size budget itself, plus `pnpm build` in CI.

## Background image proxy

`src/background/image-fetch-guard.ts` exists because the content script cannot
read cross-origin image bytes itself (the canvas taints), so the service worker
fetches on its behalf. That makes the worker a fetcher driven by page content.

Layers, in order:

1. `isImageFetchAllowedForSender` in `background.ts` — extension pages are
   refused; cross-origin is limited to image-shaped URLs.
2. `isSafeImageUrl` — http(s) only, and a private-address blocklist.
3. `fetchImageBytes` — `credentials: 'omit'`, a 20s timeout, a 12 MB cap, and an
   `image/*` content-type requirement.

Do not remove the sender check on the grounds that the URL check "already
covers it". DNS rebinding defeats hostname checks, and the sender check is what
stops a page from using the extension as a general-purpose fetch proxy.

`bytesToBase64` is a table encoder rather than
`btoa(String.fromCharCode(...))`: the string-building step was quadratic for
multi-megabyte webtoon strips, and host behaviour around latin1 strings varies.

Regression coverage: `src/background/image-fetch-guard.test.ts`.

## Two message envelopes

`background.ts` dispatches two shapes and they are not interchangeable:

- `{ action: 'fetchImage' | 'getConfig' | ... }` — image proxy and config I/O.
  Response is a flat object (`{ success, imageBase64 }`).
- `{ type: 'JOB_*' }` — translation jobs. Response is an envelope
  (`{ success, job, textAreas }`).

Unifying them is desirable but is a migration, not a rename: every consumer must
move in the same change.

## Service worker lifetime

MV3 terminates an idle service worker after roughly 30 seconds. A chapter of
tiles can keep the queue busy for minutes, so `background.ts` holds an
`alarms`-based keepalive while translation is enabled, and the job map is capped
at 500 terminal records. Without the keepalive, pending content-script requests
never resolve and `JOB_QUERY_STATUS` reports "Job not found".

## Tesseract core selection

`text-detector.ts` passes an explicit `corePath` ending in `.js`. tesseract.js
uses such a path verbatim instead of selecting a variant by feature detection,
which means:

- only the SIMD core pair is reachable, and only that pair ships;
- `minimum_chrome_version` is pinned to 110 in the manifest for SIMD support;
- `langPath` is intentionally unset so language data comes from the library's
  own canonical source rather than a third-party mirror.
