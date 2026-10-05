# Privacy Policy for Manga Translator (漫画翻译助手)

**Last updated: 2026-10-05**

## Summary

Manga Translator is a Chrome extension that translates foreign-language manga/comics on web pages using Vision Language Models (VLM). This privacy policy explains how the extension handles data.

## Data Collection

**This extension does NOT collect, transmit, or store any user data on external servers controlled by the extension developer.**

All processing happens either locally on your device or through API calls to third-party Vision LLM providers that **you configure yourself**.

## What Data Is Processed and Where It Goes

### 1. Manga/Comic Images on Web Pages

When you activate the extension on a webpage, the extension captures images from the page for OCR and translation. These images are sent directly from your browser to the Vision LLM provider **you have configured** (e.g., OpenAI API, Ollama running on localhost, LM Studio running on localhost). The extension developer runs no server and does not receive, see, or store any images.

### 2. API Keys

You may provide API keys for third-party services (e.g., OpenAI-compatible
providers). User-entered keys are:

- Stored locally in your browser using Chrome's `storage.local` API (not synced across devices via your Google account)
- Written to storage in an obfuscated form (XOR with a fixed salt). **This is
  obfuscation, not encryption.** The salt ships inside the extension bundle, so
  any extension granted `storage` permission, or anyone with the unpacked bundle,
  can reverse it. Its only purpose is to keep a key from being readable at a
  glance in the storage inspector — do not treat it as a security boundary.
- Never transmitted to any server other than the API provider you configure
- Never sent to the extension developer

Private builds may also preload provider credentials from a local `.env` file at
build time. Those credentials are compiled into that private extension bundle
and must not be distributed publicly. The `build:public` release path omits
provider API keys and is the required path for shared or Chrome Web Store
artifacts.

> Note: Prior to v0.3.5, configuration was stored in `chrome.storage.sync`, which meant obfuscated API keys were synced across devices via the user's Google account. v0.3.5 moved all configuration to `chrome.storage.local` and performs a one-time automatic migration on startup; the old `storage.sync` copy is deleted after migration.

### 3. Configuration Preferences

Your settings (target language, provider selection, UI preferences) are stored locally using Chrome's `storage.local` API. None of this data is sent to the extension developer or synced across devices.

### 4. Translation Cache

Translated text results are cached locally in your browser's `chrome.storage.local` to avoid re-translating the same images. This cache is stored entirely on your device.

## Third-Party Services

The extension integrates with third-party Vision LLM providers. When you configure a provider:

- **OpenAI**: Images are sent to `https://api.openai.com` (or your custom base URL). OpenAI's privacy policy applies to data sent to their servers.
- **Ollama**: All data stays on your local machine (`localhost:11434`).
- **LM Studio**: All data stays on your local machine (`localhost:1234`).

You are responsible for reviewing the privacy policies of any third-party API providers you choose to use.

## When Images Are Sent

Images leave your device only when the extension translates them. That happens
when you ask for it — the popup button, the context menu, or by translating a
page and then scrolling images into view — or when the page's site is on the
auto-translate list you control from the popup.

The auto-translate list is empty by default, so enabling the extension does not
by itself cause any image to be uploaded. Nothing is ever sent from a site you
have not chosen to translate.

## OCR Language Data

The extension ships the Tesseract worker script and the SIMD WASM core locally
in the bundle, so the OCR engine itself needs no download. When the OCR fallback
path is used — only for pages where the configured vision model returns no text,
or when the user selects the OCR-assisted pipeline — Tesseract downloads the
language model (`.traineddata`) for the languages being detected from the
official `@tesseract.js-data` package on jsdelivr.

- No image content, page content, or user data is included in that request.
- The request is a plain download of a public language model file.
- The download is cached by the browser after the first use.

## Every Network Request the Extension Makes

The extension makes outbound requests to exactly three kinds of destination. No
others exist; there is no analytics endpoint, no update ping, and no
developer-operated server.

1. **The vision provider you configure.** Image bytes are uploaded here when a
   translation runs.
2. **The image host of the page you are reading.** A page's `<img>` element is
   often CORS-restricted, downscaled, or lazy-loaded, so drawing it onto a
   canvas in the page cannot reliably produce the full-resolution bytes a vision
   model needs. The background worker therefore fetches the image URL directly
   from that site's own content-delivery host. This is a plain `GET` of an asset
   the page was already loading, sent with `credentials: 'omit'` so your cookies
   for that host are never forwarded. It happens only for images you have asked
   to translate (or that an allowlisted site auto-translates), never during
   browsing. The extension operates no proxy of its own — the request goes from
   your browser to that host.
3. **jsdelivr**, for the OCR language model described above.

The first is directed at a service you chose. The second and third are requests
to third-party hosts you did not explicitly configure, which is why they are
called out here. On the second path the scheme is restricted to `http`/`https`,
and `localhost`, `*.localhost`, `metadata.google.internal` and private/loopback
IPv4 and IPv6 literals are refused, so a page cannot aim the extension at an
internal service by address. A domain that resolves to a private address is not
caught by these checks — resolving it happens in the browser, after this
validation — so the sender check in the worker remains the primary control on
who may request a fetch.

## No Analytics or Tracking

This extension contains **no analytics, no tracking scripts, no telemetry, and no crash reporting**. There are no third-party SDKs for analytics or advertising. The extension does not use cookies or any form of user tracking.

## Data Retention

All data (configuration, API keys, translation cache) is stored locally in your browser. Uninstalling the extension removes all stored data. You can also clear the data at any time through Chrome's extension settings.

## Children's Privacy

This extension is not directed at children and does not knowingly collect personal information from anyone.

## Changes to This Policy

If this privacy policy changes, the updated version will be included with extension updates. Significant changes will be noted in the extension's Chrome Web Store listing.

## Contact

If you have questions about this privacy policy, you can open an issue on the extension's GitHub repository or contact the developer through the Chrome Web Store support channel.

---

**Key takeaway: Images go only to the API provider you configure and to the
image host of the page you asked to translate. The extension developer never
sees your images, your API keys, or your browsing activity, and operates no
server that receives any of them.**
