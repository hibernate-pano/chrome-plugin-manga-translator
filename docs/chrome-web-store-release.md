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
This has been done once for item `llicfmiagjiknidigpdcnogfeheogpfd`; the steps
below are what was done, for anyone starting a second extension.

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

**Name:** 漫画翻译助手 - AI 漫画翻译与叠加

**Short description:** 在网页原位翻译漫画与条漫图片，译文叠在原文气泡上。支持 OpenAI 兼容接口与本地 Ollama、LM Studio，密钥仅存本地。

Both are the text in `public/manifest.json`, and that is the only place they
can live: the store takes the listing's title and summary from the package, and
the dashboard shows them as read-only 「软件包中的标题」 and 「软件包中的摘要」
with no input box. `check-release-consistency.mjs` fails the build if either
grows past the store's limits (45 and 132 characters). The extension's own
interface does not read them — the popup, the settings page and the onboarding
print their own title — so the longer name shows up in Chrome's extension list
and in the store listing, nowhere else.

The summary's 「译文叠在原文气泡上」 (the translation is laid over the source
bubble) is literal: the translation is drawn in an overlay positioned over the
bubble, and that bubble is covered by an opaque panel — the picture around it
is left alone, the bubble itself is not. Do not restate it as "leaving the
original image uncovered": the listing used to say that, and it contradicts
`src/services/renderer.ts`, which draws the overlay with a
`rgb(240, 240, 235)` background. The wording used to be
"preserving the artwork", which a reviewer reads as "the original text stays
visible"; that was not true, so it was replaced. The summary used to be the
English one-liner while the listing's language was Chinese; the extension's
interface has always been Chinese-only, so the store was introducing English
to a Chinese audience.

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
  Two honest caveats: the concurrency limit is configurable in Settings (画质与并发),
  so the re-read can pick up a changed value and is therefore not idempotent in
  general; and the alarm does **not** keep the worker alive — the outstanding
  content-script message channel does that. See the comment above
  `KEEPALIVE_ALARM` in `src/background/background.ts`.

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

## Smoke Test

### The automated half

The part of the smoke test that does not need a provider is automated, because
it is the part that decides whether the artifact is safe to upload:

```bash
pnpm build:public
pnpm smoke:public
```

`scripts/smoke-test-public-build.mjs` drives a real Chrome with a real,
throwaway profile and asks the artifact itself:

| Check | What it proves |
| --- | --- |
| the bundle carries no credential-shaped string | the shipped bytes are clean |
| the extension loads on a clean profile | the manifest and the bundle are loadable |
| the service worker starts | the extension is alive, not just present |
| no API key is stored in `chrome.storage.local` | the artifact did not carry one in |
| `chrome.storage.sync` is empty | the key does not follow the user's Google account |
| the popup says the provider is not configured | a public build asks for one instead of using the author's defaults |
| the options page renders and asks for an API key | the user can actually supply one |
| the content script answers on a page | the extension is registered and running |

Nothing in that run requests a model, so it costs nothing and works on a
machine that cannot reach the internet.

Note that `pnpm build:public` overwrites `dist/` with the credential-free
build. Run `pnpm build` afterwards to get the private development build back.

### The manual half

The rest of the smoke test needs a provider and a page served over HTTP, and
is therefore still done by hand.

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

Steps 1, 7, 9 and 10 are covered by `pnpm smoke:public` above; the rest need
a provider.

`smoke-test-page.html` in the repository root is the fixture for steps 3-5. It
generates its images inline, so it always produces the same input: an ordinary
page with CJK and Latin bubbles, a 4000px-tall webtoon strip for the tiled
pipeline, one cross-origin image for the background proxy path, and content
that must be skipped (a logo inside `<header>`, and an image below the 200px
minimum). The only one that needs the network is the cross-origin image, which
is fetched from `upload.wikimedia.org` — everything else is generated by the
page itself.

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
   all three bubbles in panel 1, all four bubbles in the strip, the
   cross-origin image, and nothing from section 4.
4. Revisit the same page with cache enabled and verify zero provider calls.
   Only the successful translations are cached — an image that failed to
   translate is asked about again.
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

They are produced by three scripts, in this order:

```bash
node scripts/build-demo-page.mjs      # store/demo/ — the manga pages
pnpm build                            # dist/ — the extension to load
node scripts/capture-store-assets.mjs # store/listing/ — screenshot + video
node scripts/capture-store-assets.mjs --popup # store/listing/ — the popup shot
node scripts/capture-store-assets.mjs --options # store/listing/ — the settings shot
node scripts/build-promo-image.mjs    # store/listing/ — the promo image
```

`scripts/build-promo-image.mjs` composites `promo-1280x800.png` from the two
screenshots. It is deliberately independent of the two steps above: it needs
no model, no API key and no network — it renders a local HTML page with
headless Chrome and copies the result. The expensive assets above can only be
re-taken on a machine that can reach a provider; the promo image can be
re-made anywhere, so the headline and the claims on it can be kept current
even when the screenshots cannot be.

Headless Chrome on macOS writes the screenshot and then reports the display
link teardown as a non-zero exit. That is why the script checks for the
produced file instead of trusting the exit code, and why it renders to a
scratch path before copying — a run that dies half-way must not leave a
truncated image where the listing expects a finished one.

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
| `store/listing/screenshot-popup-1280x800.png` | The popup, with the page's image count in it |
| `store/listing/screenshot-options-1280x800.png` | The settings page, with an empty API-key field |
| `store/listing/demo.mp4` | The demo recording (optional for the store; see below) |

The two manga screenshots are framed by the script rather than by hand: it
measures where the translation overlays landed and picks a scroll position
where the viewport cuts no overlay in half, because a half-cut overlay reads
as a rendering bug rather than as a long web page.

The demo video is **optional** for the store, and it is the one asset that
cannot be re-made anywhere: it needs a machine that can reach a provider.
The four screenshots can all be re-taken (the popup and the settings page
need no model at all), so a missing video costs the listing nothing. A
*broken* video costs more than a missing one — the store would show a
recording of a failed translation — which is why the capture refuses to
record a page that was not translated.

### The demo recording

The store rejects a listing video longer than 30 seconds, and it rejects it
at upload — after the listing has been written and the review queued. The
recording therefore has to show the *result*, and the result is the slowest
part of the product: a vision model needs minutes for two full-page manga
drawings. A recording that starts cold shows thirty seconds of "正在翻译"
and no translation at all.

So the script translates the page once for real (that is the run that costs
money), waits for it to finish, and then records a second pass. The second
pass hits the cache, so the overlays land within a second or two and the
recording contains the whole story: scan, translate, the translation on the
page, the reading panel, the scroll-through.

The length is enforced rather than hoped for: the script reads the duration
back out of the file it produced and fails if it is over the limit, with the
two knobs (`RECORD_SECONDS`, `--hold`) named in the message.

| Knob | Default | What it is |
| --- | --- | --- |
| `--warmup <seconds>` | 300 | How long to wait for the real translation before recording |
| `--hold <seconds>` | 4 | How long to hold on the finished page before scrolling |
| `RECORD_SECONDS` | 18 | The cap on the recording itself |

### When the machine cannot reach the provider

The extension makes the provider request from its **service worker**, and a
worker that cannot reach the network produces a page that never finishes
translating. The symptom is a long silence followed by a timeout, which
reads like "the provider is slow" — but on a machine where Chrome's network
is blocked, no amount of waiting helps and the capture can only produce an
untranslated page.

So the script asks the question before it records anything, and asks it in
the log where the next person will look:

```
[capture] worker -> provider: reachable in 214ms (status 401)
[capture] worker -> provider: unreachable after 5000ms — signal timed out
```

The common cause is a traffic-taking-over extension (Clash, Surge and
friends): Chrome's own connections can be left stuck while curl and Node
sail through. `--forward` works around it — the extension talks to a local
forwarder and Node does the outgoing request — but only if the worker can
still reach `127.0.0.1`, so the script probes that too.

Two things the script refuses to do:

- **It does not record a page that was not translated.** The warm-up has to
  produce at least one translation, and the recorded page has to have
  translation overlays on it, or the run stops with an error. A screenshot of
  an untranslated comic page is worse than no screenshot: it looks like a
  finished product and it is not.
- **It does not write over a good asset with a broken one.** The failure
  happens before the screenshots are written, so a previous, good capture
  survives.

The script also forwards the worker's console and the worker's own network
traffic into the capture log, because that is where a failed request
explains itself:

```
[capture] forwarder: POST /chat/completions arrived (312044 bytes)
[capture] forwarder: POST /chat/completions -> 200 in 3515ms
```

### The popup screenshot

`--popup` takes the third screenshot without translating anything: the popup
counts the images on the page itself, so it needs no provider and no money.

The popup does not know which tab it belongs to — it asks the browser with
`chrome.tabs.query({active:true, currentWindow:true})`, and the browser
answers for the page that opened it. Opened as an ordinary tab, the popup
would ask and find *itself*, and show an empty shell. The script therefore
answers that query with the demo page's tab, and the popup's own logic —
the count, the availability, the state of the button — runs unchanged on the
content script's real answer.

One thing is staged: the host name the popup displays. The demo page is
served over `file://`, because Chrome on some machines cannot reach
`127.0.0.1` at all, and `file://` is on the extension's own "cannot work
here" list — the popup would truthfully say "this page does not support
extension scripts" and show a disabled button. The script therefore gives
the popup `comic.example.com`, a domain IANA reserves for examples
(RFC 2606) and which resolves to nobody. The page behind the popup is real,
the count in it is real, and the host name is a stand-in.

Two things the capture depends on, and both are load-bearing:

- The extension has to be built with `pnpm build`, which injects the
  provider credentials. `pnpm build:public` produces a credential-free
  build, which cannot translate anything.
- Chrome 137 and later refuse `--load-extension`. The script starts Chrome
  with `--enable-unsafe-extension-debugging` and loads `dist/` through
  `Extensions.loadUnpacked` instead.

### The settings-page screenshot

`--options` takes the fourth screenshot: the settings page, scrolled to the
provider section.

It is taken from the **public** build (`pnpm build:public`), not the
credentialed one, and that is the whole point of it. The script does not
switch builds for you — it loads whatever is in `dist/` — so the order
matters: build public first, then shoot. The API-key field shows a row of
dots when the author's key is loaded; publishing that would put a rendering
of a real key in a store image, and it would show a new user a settings page
that is already configured. The public build has no key, so the field is
empty — which is what the person who installs the extension will see.

The capture waits for the page's heading and for any dialog to clear, then
scrolls the provider section into view before it shoots, so the screenshot is
the part of the page the listing is about.

### The two cheap screenshots and the two expensive ones

`--popup` and `--options` need no provider, no network and no money: the
popup counts the images by itself, and the settings page only renders. The
two manga screenshots and the recording do need a provider, because they show
a real translation.

That asymmetry is why the listing can have four screenshots on a machine
that cannot reach a model endpoint — two of them can be re-taken anywhere.

Three further details of the capture are worth knowing before changing it:

- **The page is loaded over `file://`, not `http://`.** A local HTTP server
  looks like the obvious choice, but it only works on a machine whose
  Chrome can actually reach `127.0.0.1`. Where the system intercepts
  traffic with a network extension — Clash, Surge and their relatives —
  Chrome's request to loopback connects and then sends nothing at all: no
  bytes, no error, no timeout. `file://` does not touch the network stack
  and loads in milliseconds. Two Chrome flags and one profile preference
  make the extension work there: the profile grants the extension "allow
  access to file URLs" (otherwise the content script is never injected into
  a `file://` page), and `--allow-file-access-from-files` lets the page
  read the images next to it (otherwise the canvas is tainted and the
  pixels cannot be read).
- **`Target.createTarget({ url })` does not navigate.** It creates the tab
  and leaves it on `about:blank`. The tab is therefore created blank and
  navigated with `Page.navigate`.
- **The trigger is a signal, not a result.** The content script answers
  `TRANSLATE_PAGE` when the whole translation is over, which on a long page
  takes minutes. The script fires the request and watches the state instead
  of waiting for the answer.

If the machine's Chrome cannot reach the model endpoint at all — a
locked-down network, a proxy that swallows requests — the capture will
record a page of Japanese with a "translation failed" HUD, which is worse
than no screenshot. `--forward` starts a local relay in front of the
configured endpoint for exactly that case:

```bash
node scripts/capture-store-assets.mjs --forward
```

The relay runs on `127.0.0.1`, passes the request on with Node's network
stack, and returns the response untouched; the extension cannot tell that
anything is in between. It is off by default: an extra hop is an extra
thing that can go wrong.

The artwork in `store/artwork/` is AI-generated, so the listing ships
without borrowing anyone's copyrighted page. The rendered demo pages and the
recording are build outputs and are not committed; the commands above
rebuild them.

## Where the Store Listing Stands

The listing exists: item id `llicfmiagjiknidigpdcnogfeheogpfd`, publisher
`19d9e44e-bb97-4040-a498-5e53414b1a49` (Jasper Pan). v2.1.1 was submitted for
review on 2026-10-25 and had not been published yet when this was written.
The evidence for that, and what is still owed, are in
[`docs/store-release-log.md`](./store-release-log.md) — the ledger records what
the store said, not what was expected.

The one-time setup below is done:

- The Chrome Web Store developer account and the listing exist, and the
  `PUBLISHER_ID` and `ITEM_ID` they produced are the ones above.
- Authentication works: the OAuth client in the Google Cloud project, with the
  credentials read from the environment at publish time.
- The support URL is in the listing.

Still missing, and not required by the store: the two promo tiles and the
optional demo video.

## Still Required

- The two promo images (440×280 and 1400×560). The dashboard now asks for
  those two sizes, and `store/listing/promo-1280x800.png` fits neither of
  them, so new artwork is needed.
- The demo recording is optional for the store and cannot be re-made without a
  machine that can reach a provider.
