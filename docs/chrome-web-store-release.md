# Chrome Web Store Release Checklist

## Current Artifact

Build the credential-free package:

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm lint:strict
pnpm package:public
```

Upload `release/manga-translator-v<version>-public.zip`.

Never upload a ZIP produced by `pnpm build`; that command intentionally supports
private personal builds that may contain `.env` credentials. `package:public`
uses the credential-free path and writes a SHA-256 checksum next to the ZIP.

## Uploading With the API

`scripts/publish-to-store.mjs` uploads the package and publishes it in one
step. It needs five values, all read from the environment so that no secret
is ever written to a file in this repository:

```bash
CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \
PUBLISHER_ID=... ITEM_ID=... \
  node scripts/publish-to-store.mjs
```

Where they come from:

| Value | Where |
| --- | --- |
| `CLIENT_ID` / `CLIENT_SECRET` | The OAuth client of type **Web application** in the Google Cloud project that has the Chrome Web Store API enabled |
| `REFRESH_TOKEN` | Obtained by exchanging an authorization code for tokens with the scope `https://www.googleapis.com/auth/chromewebstore` (the OAuth 2.0 Playground is the documented route) |
| `PUBLISHER_ID` | Developer dashboard → **Publisher → Settings** |
| `ITEM_ID` | The id in the store listing's dashboard URL — `chrome.google.com/webstore/devconsole/<ITEM_ID>` |

The script exchanges the refresh token for a short-lived access token, uploads
the ZIP's raw bytes, waits for the store to finish processing it, and then
publishes. Uploading alone only creates a draft: without the publish call the
version sits in the dashboard and never reaches the store.

Two things the store enforces, both of which the script cannot work around:

- The manifest `version` must be **higher** than the currently published
  one, or the upload is rejected.
- Every version is **reviewed** before it goes live. Publishing submits it;
  it does not make it available immediately.

## Store Listing

Every promise in the listing, the privacy policy and the review notes has a
code anchor recorded in [`docs/store-claims.md`](./store-claims.md), and
`node scripts/check-store-claims.mjs` fails the build when one of them loses
its support or when a document stops making a promise it is recorded as making.
Read that table before changing any of the wording below.

**Name:** Manga Translator / 漫画翻译助手

**Short description:** Translate manga and webtoon images in place with a vision
model, replacing each text bubble with its translation.

This is the text in `public/manifest.json`, and `check-release-consistency.mjs`
fails the build if it grows past the store's 132-character limit. "Replacing
each text bubble" is literal: the translation is drawn in an overlay
positioned over the bubble, and that bubble is covered by an opaque
panel — the picture around it is left alone, the bubble itself is not. Do not
restate it as "leaving the original image uncovered": the listing used to say
that, and it contradicts `src/services/renderer.ts`, which draws the overlay
with a `rgb(240, 240, 235)` background. The wording used to be
"preserving the artwork", which a reviewer reads as "the original text stays
visible"; that was not true, so it was replaced.

The panel is opaque, and the box is snapped to the real extent of the glyphs
before it is drawn (`src/services/text-box-refiner.ts`). Both parts matter:
an opaque panel over a box that stops short of the text still leaves the
source visible, and that is what used to happen — the source Japanese showed
through at a contrast of 7:1, four times the threshold for readable text.

**Single purpose:** Detect text in comic images on the current page, send those
images to the translation provider selected by the user, and overlay the
returned translation on the source page.

## Permission Justifications

- `storage`: Save provider settings, UI preferences, the local translation
  cache, and usage statistics.
- `contextMenus`: Add two page context menu items — 「翻译当前页面」 (translate
  every translatable image on the page) and 「翻译这张图片」 (translate only the
  image that was right-clicked). The titles are set in
  `src/background/background.ts`; the review notes quote them verbatim.
- `alarms`: Periodically wake the background service worker while translation is
  switched on, so a worker Chrome has reclaimed re-reads its configuration from
  storage instead of resuming with stale in-memory state. It reads no page data.
  Two honest caveats: the concurrency limit has no settings UI, so the stored
  value is always the default 3 and the re-read is idempotent; and the alarm
  does **not** keep the worker alive — the outstanding content-script message
  channel does that. See the comment above `KEEPALIVE_ALARM` in
  `src/background/background.ts`.

`activeTab` was removed in v2.0.2: nothing referenced it. The content script is
injected via `host_permissions` on every page, and the popup reads tab metadata
through `chrome.tabs.query`, which does not need `activeTab`. An unused
permission is a question a reviewer will ask, and the honest answer ("none")
is worse than dropping it.
- `<all_urls>` host permission: The extension runs on user-selected manga and
  webtoon sites that are not known in advance, and fetches comic images from
  arbitrary image CDNs to bypass page-level CORS restrictions.

The content script is injected on normal web pages but performs no image
processing until the user enables the extension and starts translation.

`web_accessible_resources` declares exactly one thing, and it is needed by a
page-context load:

- `tesseract/*` — the OCR fallback builds a Web Worker from
  `chrome.runtime.getURL('tesseract/worker.min.js')` inside the content script,
  and a worker created from an extension URL in a page context is only loadable
  if the resource is web-accessible for that page. Hence `<all_urls>` rather
  than a host list: the pages needing it are not known in advance.

The content script itself is **not** web-accessible, and that is deliberate.
CRXJS cannot register a content script directly: for every file in
`content_scripts[].js` it emits a loader asset whose whole body is
`import(chrome.runtime.getURL('content.js'))`, and a dynamic import of an
extension URL from a page context is refused unless the target is exposed to
that page. That put `content.js` in `web_accessible_resources` for every site,
and the bundle carries the API key obfuscation salt and the XOR routine that
uses it — so any page could `fetch(chrome.runtime.getURL('content.js'))` and
reverse a stored `obf:` key back into plaintext.

The build no longer uses that loader. `vite.config.ts` bundles the content
script into a self-contained IIFE and points `content_scripts[].js` at it
directly, which Chrome injects itself, so it never has to be reachable from a
page. `pnpm release:check` fails the build if `content.js` reappears in
`web_accessible_resources`, or if any web-accessible file contains the
obfuscation salt — the second condition is the one that catches the salt being
moved into a differently-named exposed chunk.

The bundler also grows this list from the content script's chunk graph while
the chunks are still separate modules, so the build prunes it back after those
chunks are inlined. `pnpm release:check` fails the build if any path a built
file resolves through `getURL()` is missing from the final list, so the pruning
cannot over-reach in the other direction either.

`content_security_policy.extension_pages` is declared explicitly as
`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. `'wasm-unsafe-eval'`
is required to instantiate the bundled OCR WASM core; no script source other
than the extension's own package is permitted, and `object-src` is locked.

Automatic translation is opt-in per site. Enabling the extension does not make
it translate pages by itself: a page is only translated without an explicit
action when its host has been added to the user's auto-translate list from the
popup. Manual actions (the popup button and the context-menu item) work on any
site the user chooses. This is worth stating explicitly in the review notes
because `<all_urls>` plus unattended operation is the combination reviewers
scrutinise most.

## Privacy Disclosure

Privacy-policy URL: `https://hibernate-pano.github.io/chrome-plugin-manga-translator/privacy-policy.html`

It is rendered by GitHub Pages straight from `docs/privacy-policy.md`, so editing the
Markdown changes the live page. Source of truth stays singular — there is no second
HTML copy to drift. Published from Settings → Pages (source `main`, folder `docs`).

- Image data goes to the provider selected by the user. This is a transfer of
  **website content** to a third party and must be declared as such in the
  Chrome Web Store data-usage disclosure. The developer collects nothing, so
  the disclosure is "the developer does not collect" plus a Website content
  row for the user-configured provider — not an unqualified "no data is
  collected". A disclosure that claims no collection while the extension
  uploads the page's images is a false statement, and it is a harder problem
  than a permission question. `docs/store-listing-zh.md` has the table to
  copy.
- User-entered API keys are stored in `chrome.storage.local`, not sync storage.
  The XOR obfuscation applied on write is not encryption — the salt ships in the
  bundle — so the listing should not claim keys are "encrypted".
- The developer operates no server of any kind: no analytics, no telemetry, no
  credential endpoint, and no relay that image bytes pass through. The comic
  image fetch is the extension's own background worker issuing a `GET` directly
  from the user's browser to the page's own CDN with `credentials: 'omit'`; it
  is not a developer-hosted proxy, and reviewer notes should describe it that
  way rather than as "no image fetching".
- Public release artifacts contain no provider API keys.

## Manual Smoke Test

### Loading the extension in Chrome 137 and later

`--load-extension` is disabled by default since Chrome 137, so the usual
"launch Chrome with a flag and open chrome://extensions" no longer works out
of the box. The supported alternative is to load the unpacked directory over
the DevTools protocol:

```bash
# 1. Start Chrome with a remote debugging port and the flag that re-enables
#    extension loading.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 \
  --user-data-dir=/tmp/mt-chrome-profile \
  --enable-unsafe-extension-debugging \
  about:blank &

# 2. Ask the browser to load dist/ over CDP.
#    Extensions.loadUnpacked returns the extension id.
```

The extension then runs: the service worker starts, the content script is
injected into normal pages, and the extension's own pages open. Two notes
from doing this by hand:

- The **options page and the popup must be opened by Chrome**
  (`chrome.runtime.openOptionsPage()`, or the toolbar button), not by
  navigating a tab to `chrome-extension://<id>/...` from an automation client
  — Chrome answers that with `ERR_BLOCKED_BY_CLIENT` even though the same
  page works when the extension opens it.
- The **cross-origin image in the fixture needs a route to
  `upload.wikimedia.org`**. Without one the image never loads (0×0) and is
  filtered out before any request is made, so the background proxy path
  cannot be exercised.

### The steps

`smoke-test-page.html` in the repository root is the fixture for steps 3-5. It
generates its images inline, so it needs no network, and always produces the
same input: an ordinary page with CJK and Latin bubbles, a 4000px-tall webtoon
strip for the tiled pipeline, one cross-origin image for the background proxy
path, and content that must be skipped (a logo inside `<header>`, and an image
below the 200px minimum).

**Serve it over HTTP, do not open it with `file://`.** The background worker's
image fetch refuses any protocol other than `http`/`https`
(`src/background/image-fetch-guard.ts`), and Chrome does not inject content
scripts into `file://` pages unless "Allow access to file URLs" is switched on
in the extension's details page. The reviewer notes ask for the `http://localhost`
route for the same reason. To serve it:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/smoke-test-page.html
```

1. Load `dist/` in a clean Chrome profile and complete onboarding.
2. Configure an OpenAI-compatible provider and run "测试配置". It should now
   report an auth failure for a wrong key and an unreachable host for a wrong
   base URL, rather than always reporting success.
3. Open `http://localhost:8000/smoke-test-page.html` and translate it. Expect
   both bubbles in panel 1, all four bubbles in the strip, the cross-origin
   image, and nothing from section 4.
4. Revisit the same page with cache enabled and verify zero provider calls.
5. Switch provider/model and verify the cache is not reused across the change.
6. Cancel a queued translation and verify no new jobs start.
7. Reload the extension and verify settings survive, while no API key appears in
   `chrome.storage.sync`.
8. Verify automatic translation does NOT happen on an ordinary site. Add the
   fixture's host to the allowlist from the popup, reload, and confirm it now
   translates on load.
9. Install the public ZIP on a second clean profile and verify it asks for
   provider configuration instead of using the author's private defaults.
10. Load the extension's page and confirm the content script still runs on a
    normal page. The content script is now registered as a static file rather
    than through CRXJS's dynamic-import loader, so this step exists to catch a
    regression in that registration — check that the HUD appears and that
    translation still triggers from the toolbar button.

## Assets Still Required

- At least one 1280x800 or 640x400 screenshot showing translation in context.
- A 30-second demo recording.
- A support URL and Chrome Web Store developer account.
