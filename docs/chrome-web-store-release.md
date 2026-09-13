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

## Privacy Disclosure

Use the hosted `docs/privacy-policy.md` page as the privacy-policy URL.

- Image data goes to the provider selected by the user.
- User-entered API keys are stored in `chrome.storage.local`, not sync storage.
- The developer operates no analytics, telemetry, image proxy, or credential
  server.
- Public release artifacts contain no provider API keys.

## Manual Smoke Test

1. Load `dist/` in a clean Chrome profile and complete onboarding.
2. Configure an OpenAI-compatible provider and run "测试配置".
3. Translate a page with one normal image, one long strip, and one CORS-only
   image.
4. Revisit the same page with cache enabled and verify zero provider calls.
5. Switch provider/model and verify the cache is not reused across the change.
6. Cancel a queued translation and verify no new jobs start.
7. Reload the extension and verify settings survive, while no API key appears in
   `chrome.storage.sync`.
8. Install the public ZIP on a second clean profile and verify it asks for
   provider configuration instead of using Jasper's private defaults.

## Assets Still Required

- At least one 1280x800 or 640x400 screenshot showing translation in context.
- A 30-second demo recording.
- A support URL and Chrome Web Store developer account.
- A final hosted privacy-policy URL.
