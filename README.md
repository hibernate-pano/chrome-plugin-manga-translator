# Manga Translator

A Chrome Manifest V3 extension that translates foreign-language manga in your browser.

It calls **any OpenAI-compatible Vision LLM** (OpenAI, Qwen-VL, Gemini via OpenRouter,
SiliconFlow, ...) or a **local model** (Ollama, LM Studio) on demand, then overlays the
translation on top of the original image. The art stays untouched, the styles are
preserved, and the overlay renders inside the page so you can read without leaving your
manga site.

> **Reading, not just translation.** v0.5.0 added a side panel that lists every
> translated panel in reading order with numbered anchors on each image — a small
> thing, but the first "this isn't just a translation tool" moment for the project.

---

## Quick start

### 1. Install the extension

The extension is not on the Chrome Web Store yet (see [`ROADMAP.md`](./ROADMAP.md)).
To use it now:

```bash
git clone <repo>
cd chrome-plugin-manga-translator
pnpm install
pnpm build
```

Then open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**
and pick the `dist/` directory.

### 2. Pick a backend

Open the extension's **Settings** page. On first install you'll see a 3-step
onboarding modal:

1. **Welcome** — what this extension does, where your images go.
2. **Backend** — pick `OpenAI-compatible`, `Ollama`, or `LM Studio`.
3. **Ready** — finish, enable translation.

You can skip the onboarding and configure later. The extension will not translate
or bill you until you explicitly enable it.

### 3. Translate a page

Open any manga page, click the toolbar icon, then **Translate current page**.

---

## What you get

- **In-place overlay translation**: detected text is replaced with the translation
  while keeping the surrounding art intact.
- **Auto-continue**: new images that scroll into view are translated automatically
  (toggle in Settings).
- **Reading mode side panel**: a right-side panel listing every translation in
  reading order, with numbered anchors on each image. Click a panel entry to jump
  to the image; click an image badge to jump to its panel entry.
- **HUD with stages**: scanning → translating → rendering, with cache-hit and
  filtered-image counts surfaced in the completion card.
- **Errors as repair menus**: every common failure has a fix-it button. Ollama
  not running? Copy `ollama serve`. CORS blocked? Copy
  `OLLAMA_ORIGINS=chrome-extension://* ollama serve`. Auth failed? Open Settings.
- **Local-first**: config + obfuscated API keys live in `chrome.storage.local`.
  Nothing syncs to your Google account. No telemetry. No analytics.

---

## Backend options

| Backend | Requires | Privacy | Cost |
|---|---|---|---|
| `OpenAI-compatible` | API Key | images sent to your configured endpoint | pay per token |
| `Ollama` | local install | stays on your machine | free, needs GPU |
| `LM Studio` | local install | stays on your machine | free, needs GPU/CPU |

For the OpenAI-compatible path, any endpoint that speaks Chat Completions works:

- OpenAI: `https://api.openai.com/v1`, model `gpt-4o` or `gpt-4o-mini`
- SiliconFlow: `https://api.siliconflow.cn/v1`, model `Qwen/Qwen3-VL-8B-Instruct`
- OpenRouter: `https://openrouter.ai/api/v1`, model `google/gemini-2.5-flash`

For local Ollama, you'll need a vision model. `llava` is the smallest; `minicpm-v`
or `qwen2.5vl` give better translations.

---

## Project structure

```
src/
├── background/   Service worker: message routing, job queue, provider-direct calls
├── content/      Content script: image scanning, translation flow, HUD + reading panel
├── components/   React UI: Options, Popup, Onboarding
├── providers/    Vision LLM provider implementations (OpenAI-compatible / Ollama / LM Studio)
├── services/     Translator, renderer, image-processor, text-detector
├── stores/       Zustand config + cache stores (chrome.storage adapter)
├── shared/       Runtime contracts + shared defaults
├── utils/        Error handler, prompt, validation, http client, font matcher
└── test/         Vitest setup
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the longer story.

---

## Development

```bash
pnpm install              # Install deps
pnpm dev                  # Vite dev server (HMR for popup/options)
pnpm build                # Type-check + production build
pnpm test:run             # Run tests once
pnpm lint                 # ESLint
pnpm lint:strict          # ESLint with --max-warnings 0
pnpm type-check           # tsc --noEmit
```

Before opening a PR:

```bash
pnpm build && pnpm lint:strict && pnpm test:run
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Privacy

- Your API key and config live in `chrome.storage.local` only. Nothing syncs to
  your Google account.
- When you translate, the image is sent **directly** from the content script to
  your configured VLM endpoint. The extension author never sees it.
- No analytics, no telemetry, no remote logging. See [`docs/privacy-policy.md`](./docs/privacy-policy.md).

---

## Status

| Version | Status | Highlights |
|---|---|---|
| v0.6.0 | current | Reading-mode panel, error fix-it entries, HUD stages |
| v0.5.0 | shipped | Reading panel + numbered image anchors |
| v0.4.0 | shipped | First-run onboarding, ethics fix, dead code removed |
| v0.3.4 | shipped | Provider consolidation, security hardening |

See [`CHANGELOG.md`](./CHANGELOG.md) for the full history and
[`ROADMAP.md`](./ROADMAP.md) for what's next.

---

## License

MIT.
