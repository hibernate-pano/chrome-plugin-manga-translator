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

Once the listing exists and the credentials are in place, one command does
the rest:

```bash
pnpm release:publish              # build the package, upload it, publish it
node scripts/publish-to-store.mjs --dry-run   # check everything, upload nothing
```

## Uploading With the API

`scripts/publish-to-store.mjs` uploads the package and publishes it in one
step. It needs two values that identify the listing and one way to
authenticate:

```bash
CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=... \
PUBLISHER_ID=... ITEM_ID=... \
  node scripts/publish-to-store.mjs
```

The five values are read from the environment first and from a credentials
file second (`$CWS_CREDENTIALS_FILE`, or
`~/.config/chrome-web-store/credentials.env`), so that no secret is ever
written to a file in this repository. The script refuses to read a
credentials file or a service account key that lives inside the repository.

| Value | Where |
| --- | --- |
| `PUBLISHER_ID` | Developer dashboard → **Publisher → Settings** |
| `ITEM_ID` | The id in the store listing's dashboard URL — `chrome.google.com/webstore/devconsole/<ITEM_ID>` |
| `CLIENT_ID` / `CLIENT_SECRET` | The OAuth client of type **Web application** in the Google Cloud project that has the Chrome Web Store API enabled |
| `REFRESH_TOKEN` | Obtained by exchanging an authorization code for tokens with the scope `https://www.googleapis.com/auth/chromewebstore` (the OAuth 2.0 Playground is the documented route) |

The script exchanges the refresh token for a short-lived access token, uploads
the ZIP's raw bytes, waits for the store to finish processing it, and then
publishes. Uploading alone only creates a draft: without the publish call the
version sits in the dashboard and never reaches the store.

### The flags that change what goes live

| Flag | What it does |
| --- | --- |
| `--dry-run` | Verify the package, the credentials and the item; upload nothing |
| `--publish-type=default` | Go live as soon as the review approves (the default) |
| `--publish-type=staged` | Wait for approval, then release it with a second call |
| `--rollout=N` | Give the new version to N% of users first; the rest follow |
| `--set-percentage=N` | Raise the rollout of the version that is already live |
| `--block-on-warnings` | Fail the publish if the store reports warnings |

`--publish-type` and `--rollout` are sent in the publish request, so they
decide what happens rather than deferring to whatever the dashboard has
saved. `--set-percentage` is the follow-up: it raises the rollout of the live
version after it has been reviewed, which the store only allows for items
with more than 10,000 seven-day active users.

### Three ways to authenticate

| Mode | Values | When |
| --- | --- | --- |
| `ACCESS_TOKEN` | A token that is already valid | A CI job that mints one per run (`gcloud auth print-access-token`) |
| `SERVICE_ACCOUNT_KEY` | Path to a service account JSON key | No human in the loop; the service account's address has to be added to the dashboard under **Account** |
| `CLIENT_ID` + `CLIENT_SECRET` + `REFRESH_TOKEN` | The OAuth Playground path | One person publishing their own extension |

### What the API cannot do

- There is **no** create-item endpoint and **no** listing-metadata endpoint.
  The listing has to be created and filled in once, in the dashboard.
- Every version is **reviewed** before it goes live. Publishing submits it;
  it does not make it available immediately.
- The manifest `version` must be **higher** than the currently published one.
  The script checks this against the store's own report of the live version
  before it uploads anything.
- Visibility changes are published with the settings the item already has. If
  they were changed in the dashboard, the first publish has to be done from
  the dashboard once, or the API refuses it.

## One-Time Setup

The API can upload and publish, but it cannot create a listing. So the first
version is made in the dashboard, and every version after that is a command.

### 1. The listing (dashboard, once)

1. Developer dashboard → **Add new item**.
2. Upload `release/manga-translator-v<version>-public.zip` there. This is
   what creates the item.
3. **Store Listing** tab: the fields are in
   [`docs/store-listing-zh.md`](./store-listing-zh.md) — name, short
   description, description, category, language, and the screenshot from
   `store/listing/`.
4. **Privacy** tab: the single-purpose statement and the data-usage table
   from the same document.
5. **Distribution** tab: visibility (public) and the countries.
6. Save. The item id is in the URL of the item's page:
   `chrome.google.com/webstore/devconsole/<ITEM_ID>`.

### 2. The API credentials (Google Cloud, once)

1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Configure an **OAuth consent screen** (External), add yourself as a test
   user, and skip the scopes screen.
3. **Credentials → OAuth client ID → Web application**, with
   `https://developers.google.com/oauthplayground` as an authorised redirect
   URI.
4. In the OAuth 2.0 Playground, use those credentials, add the scope
   `https://www.googleapis.com/auth/chromewebstore`, and exchange the
   authorization code for tokens. The refresh token is the long-lived half.

The account that owns the store items is not necessarily the account that
owns the Cloud project, and it needs two-step verification switched on.


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

## Listing Assets

The listing needs a screenshot and a demo recording, and both of them show
the extension actually working — a mock-up would not survive the review.

They are produced by two scripts, in this order:

```bash
node scripts/build-demo-page.mjs      # store/demo/ — the manga pages
pnpm build                            # dist/ — the extension to load
node scripts/capture-store-assets.mjs # store/listing/ — screenshot + video
```

`scripts/build-demo-page.mjs` renders two manga pages with Japanese dialogue
burned into the pixels. The text has to be in the pixels: the extension sends
the *image* to the vision model, so lettering drawn in HTML would never be
seen, let alone translated.

`scripts/capture-store-assets.mjs` drives a Chrome with the built extension
loaded over CDP, translates the demo page and records what happens. It
produces:

| File | What it is |
| --- | --- |
| `store/listing/screenshot-1280x800.png` | The listing screenshot: the translated page, reading panel closed |
| `store/listing/screenshot-panel-1280x800.png` | The same page with the reading panel open |
| `store/listing/demo.mp4` | The demo recording |

Both screenshots are framed by the script rather than by hand: it measures
where the translation overlays landed and picks a scroll position where the
viewport cuts no overlay in half, because a half-cut overlay reads as a
rendering bug rather than as a long web page.

Two things the capture depends on, and both are load-bearing:

- The extension has to be built with `pnpm build`, which injects the
  provider credentials. `pnpm build:public` produces a credential-free
  build, which cannot translate anything.
- Chrome 137 and later refuse `--load-extension`. The script starts Chrome
  with `--enable-unsafe-extension-debugging` and loads `dist/` through
  `Extensions.loadUnpacked` instead.

The artwork in `store/artwork/` is AI-generated, so the listing ships
without borrowing anyone's copyrighted page. The rendered demo pages and the
recording are build outputs and are not committed; the commands above
rebuild them.

## Still Required

- A support URL and Chrome Web Store developer account.
- The listing created once in the dashboard (see **One-Time Setup**), and the
  `PUBLISHER_ID` and `ITEM_ID` that come out of it.
- One way to authenticate for `scripts/publish-to-store.mjs` (see above).
