# Privacy Policy for Manga Translator (漫画翻译助手)

**Last updated: 2026-05-26**

## Summary

Manga Translator is a Chrome extension that translates foreign-language manga/comics on web pages using Vision Language Models (VLM). This privacy policy explains how the extension handles data.

## Data Collection

**This extension does NOT collect, transmit, or store any user data on external servers controlled by the extension developer.**

All processing happens either locally on your device or through API calls to third-party Vision LLM providers that **you configure yourself**.

## What Data Is Processed and Where It Goes

### 1. Manga/Comic Images on Web Pages

When you activate the extension on a webpage, the extension captures images from the page for OCR and translation. These images are sent directly from your browser to the Vision LLM provider **you have configured** (e.g., OpenAI API, Ollama running on localhost, LM Studio running on localhost). The extension developer runs no server and does not receive, see, or store any images.

### 2. API Keys

You may provide API keys for third-party services (e.g., OpenAI). These keys are:

- Stored locally in your browser using Chrome's `storage.local` API (not synced across devices via your Google account)
- Obfuscated before storage (XOR-based obfuscation) to prevent casual inspection by other extensions
- Never transmitted to any server other than the API provider you configure
- Never sent to the extension developer

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

**Key takeaway: All image data goes only to the API provider you configure. The extension developer never sees your images, your API keys, or your browsing activity.**
