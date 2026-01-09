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

**Required before PR**: `pnpm build && pnpm lint && pnpm test:run`

## Code Style Guidelines

### Imports (ordered by type, then alphabetically)

```typescript
// 1. React core
import React from 'react'

// 2. Third-party libraries
import { cva, type VariantProps } from 'class-variance-authority'
import { useQuery } from '@tanstack/react-query'

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

- **React Query**: For server state; use hooks from `src/hooks/`
- **Chrome storage**: Adapters wrap `chrome.storage.sync`

### Component Patterns

- **UI components**: Follow shadcn/ui style in `src/components/ui/`
- **Class variance**: Use cva for variants
- **Forward refs**: Use React.forwardRef for components accepting refs

```typescript
const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';
```

### Performance

- **Code splitting**: Vite configured with vendor chunks (react-vendor, query-vendor, state-vendor)
- **Build minification**: Terser removes console.log in production
- **Queries**: Use `queryOptions.standard`, `queryOptions.longTerm` from query-client

### Directory Structure

```
src/
├── api/          # API providers (OpenAI, Claude, DeepSeek, Ollama)
├── components/   # React components
│   ├── ui/       # Base UI (shadcn/ui style)
│   └── *.tsx     # Feature components
├── content/      # Content script (injected into pages)
├── hooks/        # Custom React hooks
├── lib/          # Utility functions
├── providers/    # Vision LLM provider interfaces
├── services/     # Core services
├── stores/       # Zustand stores
├── test/         # Test setup
├── types/        # Global type definitions
└── utils/        # Utility functions
```

### Testing Patterns

- **Test files**: `*.test.ts` or `*.test.tsx` alongside source
- **Setup**: `src/test/setup.ts` (jsdom + custom matchers)
- **Coverage threshold**: 70% for all metrics
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
| State (global) | Zustand |
| Data fetching | TanStack Query v5 |
| UI components | Radix UI primitives + Tailwind |
| Styling | Tailwind CSS + cva |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Animations | Framer Motion |
