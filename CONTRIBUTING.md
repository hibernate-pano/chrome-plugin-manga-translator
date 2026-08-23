# Contributing

Thanks for your interest. The project is small enough that you can read the
whole codebase in an afternoon. Here's how to get oriented.

## Code layout

```
src/
├── background/        Service worker + provider-direct translation path
├── content/           Content script: scan → translate → render → reading panel
├── components/        React UI (Popup, Options, Onboarding)
├── providers/         Vision LLM providers (OpenAI-compatible / Ollama / LM Studio)
├── services/          Translator, renderer, image-processor
├── stores/            Zustand config + cache
├── shared/            Runtime contracts, defaults
└── utils/             Error handler, http client, prompt, validation
```

A new developer should read these in order:

1. `src/shared/runtime-contracts.ts` — message envelopes between contexts.
2. `src/shared/app-config.ts` — the `RuntimeAppConfig` shape and defaults.
3. `src/stores/config-v2.ts` — the persisted Zustand store.
4. `src/content/content.ts` — the page-level flow.
5. `src/providers/base.ts` — `VisionProvider` interface and base class.

## Setting up

```bash
pnpm install
pnpm dev                  # Vite dev server for popup/options HMR
pnpm test:run             # Run tests once
```

To load the extension into Chrome for manual testing:

```bash
pnpm build
```

Then `chrome://extensions/` → enable Developer mode → "Load unpacked" → select
the `dist/` directory.

## Before opening a PR

Run all of these locally:

```bash
pnpm build                # type-check + production build
pnpm lint:strict          # ESLint with --max-warnings 0
pnpm test:run             # Vitest once
```

CI runs the same three on every push to `main` and every PR. The lint:strict
gate was introduced in v0.3.4 because the project committed to zero
warnings; please don't introduce new ones.

## Code conventions

See `AGENTS.md` and `CLAUDE.md` in the repo root. Highlights:

- Prettier: single quotes, semicolons, 80-char width, 2-space indent.
- TypeScript strict mode. No `any`. No non-null assertions (`!`).
- Import order: React → 3rd-party → `@/` aliases → relative → `type`-only.
- Path alias `@/` maps to `src/`.
- Use `parseTranslationError()` from `src/utils/error-handler.ts` instead of
  throwing or returning raw error strings.

## Adding a new provider

The provider system uses a strategy pattern. To add one (e.g. Anthropic,
Voyage, Cohere):

1. Implement `VisionProvider` from `src/providers/base.ts` in a new file.
   Use `BaseVisionProvider` as the abstract base if you can.
2. Register the provider in `src/providers/index.ts` (`createProvider()`
   factory).
3. Add a provider entry to `PROVIDERS` in
   `src/components/Options/OptionsApp.tsx` and to `PROVIDER_OPTIONS` in
   `src/components/Popup/PopupApp.tsx`.
4. Add `DEFAULT_*_CONFIG` to `src/shared/app-config.ts`.
5. Update `ProviderType` and the discriminated unions across the codebase.
6. Add tests for the new provider against a mocked server.

If your provider needs a non-OpenAI request shape, you'll also need to
extend `src/background/provider-direct-client.ts` and the
`TranslationTransportRequest` discriminated union in
`src/services/translation-transport.ts`.

## Adding a new error code

1. Add the enum value to `TranslationErrorCode` in
   `src/utils/error-handler.ts`.
2. Add the message / suggestion / action entry to `ERROR_MESSAGES`.
3. Add a parsing rule in `TranslationErrorHandler.getCodeFromMessage` (or
   `getCodeFromStatusCode`) so the code can be detected from real errors.
4. Add a test case in `src/utils/error-handler.test.ts`.

If the action is `copy-command`, populate `command` with the runnable shell
snippet and update `src/content/content.ts#resolveErrorAction` if the command
needs runtime substitution (e.g. model name).

## Writing a UI component

- UI primitives live in `src/components/ui/` (Button, Card, Switch, Slider,
  ConfirmDialog). Use them — they are the design system.
- Content script UI components (HUD, reading panel, anchors) live in
  `src/content/`. They are React-free, Shadow-DOM-based, and isolated from
  page styles. Don't add React to the content bundle.
- Popup / Options / Onboarding are React-based and use Tailwind.

## Things to avoid

- Don't introduce new dependencies without a one-line justification in the PR.
  The bundle size matters — popup is sensitive, content is more so.
- Don't bypass `parseTranslationError` — every caught error should produce a
  `FriendlyError` so the user sees a fix-it button, not a stack trace.
- Don't add code "for future use". If it's dead now, it should be deleted now.
  The project has been burned by speculative components (e.g. a 507-line
  `reading-layer.ts` that was never instantiated) and will not accept them.
- Don't commit `dist/`. It's gitignored but worth saying out loud.

## Reporting issues

Use GitHub Issues. Include:

- Chrome version
- Extension version
- The page URL (if it's a manga site, anonymize if you want)
- The provider / model you used
- Whether `enabled` is on, `autoContinueEnabled` is on, etc.
- Console errors (right-click the extension icon → "Inspect popup" for
  popup logs; for content-script logs use the page's DevTools console)

## Show me a real example

If you want to see a small, focused PR as reference, look at:

- v0.5.0 "feat: reading-mode side panel + numbered image anchors"
- v0.6.0 "feat: copy-command buttons carry real commands; HUD stages progress"

Both are single-purpose, test-covered, and follow the conventions above.
