# AGENTS.md

This file provides guidelines for agentic coding agents working on this Chrome manga translator extension.

## Build, Lint, and Test Commands

```bash
# Development
pnpm dev                    # Start Vite dev server
pnpm build                  # TypeScript check + Vite build (required before commit)
pnpm preview                # Preview production build

# Testing
pnpm test                   # Run vitest with watch mode
pnpm test:run               # Run tests once (CI mode)
pnpm test:ui                # Run tests with UI
pnpm test:coverage          # Run with coverage report
pnpm test:run -- src/stores/config-v2.test.ts  # Run single test file

# Linting and Formatting
pnpm lint                   # ESLint (fails on errors)
pnpm lint:fix               # ESLint auto-fix
pnpm format                 # Prettier write all files
pnpm format:check           # Check formatting
pnpm type-check             # TypeScript type check only
```

**Required before PR** — this is exactly what CI runs, in this order:

```bash
pnpm format:check && pnpm lint:strict && pnpm type-check && pnpm test:coverage && pnpm build && pnpm release:check
```

Do not substitute `pnpm lint` or `pnpm test:run` for these. `pnpm lint` exits 0
while still reporting warnings, and CI runs `lint:strict` (`--max-warnings 0`),
so a clean `lint` can still be rejected. `pnpm test:run` skips coverage
entirely, which is the only path in which the 70% threshold is evaluated. A PR
that passes the shorter list can still fail CI.

Note on `pnpm build`: it calls `check-release-consistency.mjs` both before and
after Vite. The pre-build call cannot enforce the content-script size budget
because `dist/` does not exist yet, and it deliberately treats that as a pass —
only the post-build call and `pnpm release:check` actually measure `dist/content.js`.

## Code Style Guidelines

### Imports (ordered by type, then alphabetically)

```typescript
// 1. React core
import React from 'react'

// 2. Third-party libraries
import { clsx } from 'clsx'

// 3. @/ aliases (absolute imports)
import { cn } from '@/lib/utils'
import { useAppConfigStore } from '@/stores/config-v2'

// 4. Relative imports
import { handleError } from '../utils/error-handler'

// 5. Type-only imports
import type { VisionProvider } from '@/providers/base'
```

### Formatting (Prettier)

- **Semicolons**: Yes
- **Quotes**: Single quotes (`'`) for JS/TS, JSX single quotes
- **Trailing commas**: ES5 compatible
- **Print width**: 80 characters
- **Tab width**: 2 spaces (no tabs)
- **Arrow functions**: Avoid parens around single params (`x => x`)

### TypeScript Conventions

- **Strict mode**: Always enabled
- **No `any`**: Use `unknown` or specific types; `any` triggers warning
- **No non-null assertion (`!`)**: Use optional chaining or explicit checks
- **Interfaces for contracts**: Use `interface` for extendable types, `type` for unions/primitives
- **Export interfaces**: Define at top of file after imports
- **Path aliases**: Use `@/` prefix (configured in tsconfig.json)

```typescript
// Good
export interface ProviderSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

// Avoid
interface Settings {
  apiKey: string | null;
}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `TranslationPanel`, `Alert` |
| Hooks | camelCase, `use` prefix | `useTranslation`, `useActiveProviderSettings` |
| Functions | camelCase | `analyzeAndTranslate()`, `parseVisionResponse()` |
| Variables | camelCase | `isEnabled`, `parallelLimit` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_CONFIG`, `MAX_RETRY_COUNT` |
| Types/Interfaces | PascalCase | `VisionResponse`, `TranslationParams` |
| Enum values | UPPER_SNAKE_CASE | `TranslationErrorCode.AUTH_ERROR` |
| Selectors | camelCase, `use` prefix | `useTranslationEnabled()` |

### Error Handling

- Use the unified error system in `src/utils/error-handler.ts`
- Import error utilities: `TranslationErrorCode`, `FriendlyError`, `retryWithBackoff`
- Never swallow errors; always log or return user-friendly messages
- Use try/catch with async/await, propagate with context

```typescript
import { TranslationErrorCode, retryWithBackoff } from '@/utils/error-handler';

// In async functions
try {
  const result = await retryWithBackoff(() => api.translate(text), 3, 1000);
  return result;
} catch (error) {
  const friendlyError = parseTranslationError(error);
  console.error(`[Translation] ${friendlyError.message}`);
  throw friendlyError;
}
```

### State Management

- **Global state**: Zustand stores in `src/stores/`
- **Use selector hooks**: Never subscribe to entire store

```typescript
// Good - selective subscription
const enabled = useAppConfigStore((state) => state.enabled);

// Bad - full store subscription
const store = useAppConfigStore();
```

- **Chrome storage**: Adapters wrap `chrome.storage.local` (never `sync` — API
  keys must not follow the user's Google account between devices). The adapter
  in `src/stores/config-v2.ts` obfuscates keys on write and deobfuscates on
  read, so anything comparing or merging that data must use
  `persisted-config` helpers rather than raw object equality.

### Component Patterns

- **UI components**: shadcn/ui style lives in `src/components/ui/`. Only keep
  what is imported — unused primitives drag their Radix dependency along and
  this project has no consumer for them.
- **Styling**: Tailwind classes composed with `cn()` from `@/lib/utils`.
- **Forward refs**: Use `React.forwardRef` for components accepting refs.

### Performance

- **Bundle budget**: the content script is injected into every page, so its
  size is paid on page load. `pnpm build` fails if `dist/content.js` exceeds
  200 KB (see `scripts/check-release-consistency.mjs`). Two regressions have
  already been caught by it, both from `manualChunks` lumping React and
  ReactDOM into one chunk that the content script then inlined.
- **Vendor chunks**: `react-vendor` and `react-dom-vendor` are deliberately
  separate. Merging them pulls the DOM renderer into the content script, which
  uses no React at all.
- **Content-script rebundling**: `contentScriptRebundler()` in `vite.config.ts`
  inlines the content script's chunks and must stay minified.

### Directory Structure

```
src/
├── background/   # Service worker: message routing, job queue, image proxy
├── components/   # React UI: Popup, Options, Onboarding
│   └── ui/       # shadcn/ui-style primitives actually in use
├── content/      # Content script: scanning, HUD, reading panel, anchors
├── providers/    # Vision LLM providers + prompt/response parsing
├── services/     # Translator, renderer, image processing, OCR
├── shared/       # Runtime contracts and app-config defaults
├── stores/       # Zustand stores (config, cache, usage)
├── test/         # Vitest setup
└── utils/        # Error handling, crypto, HTTP, styling helpers
```

There is no `src/api/` or `src/hooks/`. Earlier revisions of this file listed
both, plus TanStack Query, React Hook Form, Zod and Framer Motion as project
dependencies; none of them were ever installed or imported.

### Testing Patterns

- **Test files**: `*.test.ts` or `*.test.tsx` alongside source
- **Setup**: `src/test/setup.ts` (jsdom + custom matchers)
- **Coverage**: enforced at 70% (lines/functions/branches/statements) by
  `pnpm test:coverage`, which CI runs (Vitest 5 reads the nested
  `coverage.thresholds` shape).
- **Coverage denominator**: `scripts/check-coverage-scope.mjs` runs after
  `test:coverage` and fails the build unless every `src/` file is either in
  the report or named in its `UNTESTED_ALLOWLIST`. That list is a debt
  register: shrink it, do not add to it.
- **Mocking**: Use vi.spyOn, vi.mock from vitest

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigPanel } from './ConfigPanel';

describe('ConfigPanel', () => {
  it('renders provider selector', () => {
    render(<ConfigPanel />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
```

### Chrome Extension Specifics

- **Manifest v3**: Configuration in `public/manifest.json`
- **Entry points**: popup.tsx, options.tsx, background.ts, content.ts
- **Permissions**: Declare in manifest, check at runtime
- **Background service worker**: `src/background/background.ts`
- **Content scripts**: `src/content/content.tsx`

### Key Libraries

| Purpose | Library |
|---------|---------|
| State (global) | Zustand (`persist` -> `chrome.storage.local`) |
| UI primitives | Radix UI (only `slider` and `switch` are used) |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| OCR fallback | Tesseract.js (SIMD core, lazily used) |
| Tests | Vitest + Testing Library |
| Build | Vite + `@crxjs/vite-plugin` |
