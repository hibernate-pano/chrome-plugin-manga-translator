/**
 * The content script must never be able to hold a plaintext API key.
 *
 * The persisted config store (`@/stores/config-v2`) keeps the key in memory:
 * its storage adapter deobfuscates it while rehydrating, and the persist
 * middleware rehydrates at module evaluation. So a content script that
 * imports that store — even without reading the key — has the plaintext key
 * in its heap, in a context that runs inside arbitrary web pages.
 *
 * This test walks the content script's *runtime* import graph and fails if
 * the credential-holding store (or anything that deobfuscates a key) is
 * reachable from it. Reverting the fix — importing `useAppConfigStore` from
 * `content.ts` or from `translator.ts` again — puts that module back on the
 * graph and fails this test.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(process.cwd(), 'src');

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = resolve(SRC_DIR, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    // A package import: not part of the source graph.
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Every module the entry file pulls in at runtime.
 *
 * Type-only imports are excluded on purpose: `import type { … } from
 * '@/stores/config-v2'` is erased at compile time and pulls nothing into the
 * bundle. It is the *value* import that triggers the rehydrate.
 */
function runtimeImportGraph(entry: string): Set<string> {
  const seen = new Set<string>();

  const visit = (file: string): void => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    const specifiers: string[] = [];

    // `import { x } from '…'` / `export { x } from '…'` — a value import.
    const valueImport =
      /(?:^|\n)\s*(?:import|export)(?!\s+type)\s+[\s\S]{0,400}?from\s+['"]([^'"]+)['"]/g;
    // `import '…'` — a side-effect import.
    const sideEffectImport = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
    // `import('…')` — a dynamic import.
    const dynamicImport = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    let match: RegExpExecArray | null;
    while ((match = valueImport.exec(source)) !== null) {
      specifiers.push(match[1] as string);
    }
    while ((match = sideEffectImport.exec(source)) !== null) {
      specifiers.push(match[1] as string);
    }
    while ((match = dynamicImport.exec(source)) !== null) {
      specifiers.push(match[1] as string);
    }

    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved) {
        visit(resolved);
      }
    }
  };

  visit(entry);
  return seen;
}

describe('content script credential boundary', () => {
  it('never reaches the persisted config store at runtime', () => {
    const graph = runtimeImportGraph(resolve(SRC_DIR, 'content/content.ts'));
    const relative = [...graph].map(file =>
      file
        .slice(SRC_DIR.length + 1)
        .split('\\')
        .join('/')
    );

    // The store that deobfuscates the key while rehydrating. Importing it
    // puts the plaintext key in the content script's heap.
    expect(relative).not.toContain('stores/config-v2.ts');
    // The module that reverses the obfuscation.
    expect(relative).not.toContain('utils/crypto.ts');
  });

  it('reaches only the redacted snapshot modules', () => {
    const graph = runtimeImportGraph(resolve(SRC_DIR, 'content/content.ts'));
    const relative = [...graph].map(file =>
      file
        .slice(SRC_DIR.length + 1)
        .split('\\')
        .join('/')
    );

    // These are the two modules that carry configuration into the content
    // script, and neither of them holds a credential.
    expect(relative).toContain('shared/content-config.ts');
    expect(relative).toContain('stores/content-config.ts');
  });

  it('keeps the trusted translator factory out of the content graph', () => {
    // `translator-trusted.ts` reads the persisted store, so it belongs to
    // the worker and the extension pages — never to the content script.
    const graph = runtimeImportGraph(resolve(SRC_DIR, 'content/content.ts'));
    const relative = [...graph].map(file =>
      file
        .slice(SRC_DIR.length + 1)
        .split('\\')
        .join('/')
    );

    expect(relative).not.toContain('services/translator-trusted.ts');
  });
});
