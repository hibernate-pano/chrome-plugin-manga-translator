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

## Store Listing

**Name:** Manga Translator / 漫画翻译助手

**Short description:** Translate manga and webtoon images in place while keeping
the original artwork visible.

**Single purpose:** Detect text in comic images on the current page, send those
images to the translation provider selected by the user, and overlay the
returned translation on the source page.

## Permission Justifications

- `storage`: Save provider settings, UI preferences, the local translation
  cache, and usage statistics.
- `contextMenus`: Add a "Translate current page" action to the page context menu.
- `alarms`: Periodically wake the background service worker while translation is
  switched on, so a worker Chrome has reclaimed re-reads its concurrency limit
  from storage instead of resuming a long chapter with a stale one. It reads no
  page data.

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

`web_accessible_resources` declares exactly two things, and both are needed by a
page-context load:

- `tesseract/*` — the OCR fallback builds a Web Worker from
  `chrome.runtime.getURL('tesseract/worker.min.js')` inside the content script,
  and a worker created from an extension URL in a page context is only loadable
  if the resource is web-accessible for that page. Hence `<all_urls>` rather
  than a host list: the pages needing it are not known in advance.
- `content.js` — the content script Chrome registers is a bundler-generated
  loader whose body is `import(chrome.runtime.getURL('content.js'))`. Without
  this declaration the loader's import is refused and the extension does nothing
  on every page.

Nothing else is exposed. The bundler initially grows this list from the content
script's chunk graph, and the build prunes it back after those chunks are inlined
into `content.js`, so the extension's own modules — including the
key-obfuscation chunk — are not readable by arbitrary pages.
`pnpm release:check` fails the build if any path a built file resolves through
`getURL()` is missing from the final list, so the pruning cannot over-reach.

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

- Image data goes to the provider selected by the user.
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

`smoke-test-page.html` in the repository root is the fixture for steps 3-5. It
generates its images inline, so it works offline on `file://` and always
produces the same input: an ordinary page with CJK and Latin bubbles, a
4000px-tall webtoon strip for the tiled pipeline, one cross-origin image for
the background proxy path, and content that must be skipped (a logo inside
`<header>`, and an image below the 200px minimum).

1. Load `dist/` in a clean Chrome profile and complete onboarding.
2. Configure an OpenAI-compatible provider and run "测试配置". It should now
   report an auth failure for a wrong key and an unreachable host for a wrong
   base URL, rather than always reporting success.
3. Open `smoke-test-page.html` and translate it. Expect both bubbles in panel 1,
   all four bubbles in the strip, the cross-origin image, and nothing from
   section 4.
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

## Assets Still Required

- At least one 1280x800 or 640x400 screenshot showing translation in context.
- A 30-second demo recording.
- A support URL and Chrome Web Store developer account.
