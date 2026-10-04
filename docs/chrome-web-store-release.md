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
- `activeTab`: Read the active tab and communicate with its content script after
  the user invokes the extension.
- `contextMenus`: Add a "Translate current page" action to the page context menu.
- `<all_urls>` host permission: The extension runs on user-selected manga and
  webtoon sites that are not known in advance, and fetches comic images from
  arbitrary image CDNs to bypass page-level CORS restrictions.

The content script is injected on normal web pages but performs no image
processing until the user enables the extension and starts translation.

Automatic translation is opt-in per site. Enabling the extension does not make
it translate pages by itself: a page is only translated without an explicit
action when its host has been added to the user's auto-translate list from the
popup. Manual actions (the popup button and the context-menu item) work on any
site the user chooses. This is worth stating explicitly in the review notes
because `<all_urls>` plus unattended operation is the combination reviewers
scrutinise most.

## Privacy Disclosure

Use the hosted `docs/privacy-policy.md` page as the privacy-policy URL.

- Image data goes to the provider selected by the user.
- User-entered API keys are stored in `chrome.storage.local`, not sync storage.
- The developer operates no analytics, telemetry, image proxy, or credential
  server.
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
- A final hosted privacy-policy URL.
