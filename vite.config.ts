import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'path';
import manifest from './public/manifest.json';

/**
 * Vite plugin: 构建后将 content.js 重新打包为自包含模块
 *
 * 问题：Chrome 扩展 content script 通过 dynamic import 加载时，
 * 其内部的 ES module import 语句会相对于页面 URL 解析，
 * 而不是扩展 URL，导致 chunk 文件 404。
 *
 * 解决：构建完成后用 esbuild 将 content.js 及其所有 chunk 依赖
 * 内联为一个自包含文件，消除对外部 chunk 的引用。
 *
 * 副作用：@crxjs/vite-plugin 早期内联之前就已经根据模块图把这些
 * chunk 写进了 web_accessible_resources。内联之后 content.js 不再引用
 * 它们，但声明留在原地，等于把 API key 混淆模块、React 等文件持续暴露给
 * 任意网页按 URL 读取。所以内联完成后要按源 manifest 重新收窄这份声明。
 */
function contentScriptRebundler(): Plugin {
  return {
    name: 'content-script-rebundler',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const contentPath = path.join(distDir, 'content.js');

      const { existsSync } = await import('fs');
      if (!existsSync(contentPath)) return;

      const { build } = await import('esbuild');
      await build({
        entryPoints: [contentPath],
        bundle: true,
        outfile: contentPath,
        allowOverwrite: true,
        format: 'esm',
        // The Vite build minifies each chunk separately, but those chunks are
        // still emitted as separate modules; this step inlines them into one
        // file, which creates a fresh opportunity for dead code and repeated
        // syntax to collapse. Minifying here cut the content script from
        // ~366 KB to ~135 KB.
        minify: true,
        target: 'es2020',
        logLevel: 'info',
      });

      await pruneWebAccessibleResources(distDir);
    },
  };
}

/**
 * Reduce the built manifest's `web_accessible_resources` to what is actually
 * loaded at runtime.
 *
 * CRXJS grows that list from the content script's chunk graph while the chunks
 * are still separate modules. `contentScriptRebundler` then inlines every one of
 * them into `content.js`, so the references disappear but the declarations do
 * not — leaving the key-obfuscation chunk, the config store and the React vendor
 * readable by every site the extension runs on.
 *
 * The rule is deliberately NOT "keep what the source manifest declares". That
 * version of this function bricked the extension: the content script Chrome
 * registers is a CRXJS loader whose body is
 * `import(chrome.runtime.getURL("content.js"))`, so `content.js` must stay
 * web-accessible even though nothing declares it. Anything resolved that way is
 * discovered from the emitted files, so a resource loaded at runtime cannot be
 * pruned by accident.
 */
async function pruneWebAccessibleResources(distDir: string): Promise<void> {
  const { readFileSync, writeFileSync, readdirSync, statSync } =
    await import('fs');
  const manifestPath = path.join(distDir, 'manifest.json');
  const built = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    web_accessible_resources?: Array<{
      resources: string[];
      matches: string[];
    }>;
  };

  const groups = built.web_accessible_resources ?? [];
  const candidates = groups.flatMap(group => group.resources);

  // 1. Everything the source manifest declares by hand.
  const keep = new Set<string>(
    (manifest.web_accessible_resources ?? []).flatMap(group => group.resources)
  );

  // 2. Every resource some built file resolves through chrome.runtime.getURL().
  const loaded = collectRuntimeGetUrlTargets(distDir, {
    readFileSync,
    readdirSync,
    statSync,
  });
  for (const target of loaded) {
    for (const resource of candidates) {
      if (resource === target) {
        keep.add(resource);
        continue;
      }
      // A declared `dir/*` glob covers a concrete file inside it.
      if (resource.endsWith('/*') && target.startsWith(resource.slice(0, -1))) {
        keep.add(resource);
      }
    }
  }

  const kept = groups
    .map(group => ({
      ...group,
      resources: group.resources.filter(resource => keep.has(resource)),
    }))
    .filter(group => group.resources.length > 0);

  if (kept.length > 0) {
    built.web_accessible_resources = kept;
  } else {
    delete built.web_accessible_resources;
  }
  writeFileSync(manifestPath, JSON.stringify(built, null, 2));
}

/**
 * Every path that a built JS file resolves via `chrome.runtime.getURL("...")`.
 *
 * These are exactly the resources that have to stay web-accessible: a content
 * script runs in the page's origin for fetching purposes, so a dynamic import or
 * worker construction aimed at an extension URL is refused unless the manifest
 * exposes that resource to the page.
 */
function collectRuntimeGetUrlTargets(
  distDir: string,
  fs: {
    readFileSync: (p: string, e: string) => string;
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { isDirectory(): boolean };
  }
): Set<string> {
  const targets = new Set<string>();
  const getUrlCall = /getURL\(\s*['"]([^'"]+)['"]\s*\)/g;

  const scan = (dir: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        scan(full);
        continue;
      }
      if (!entry.endsWith('.js')) continue;
      let source = '';
      try {
        source = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      let match: RegExpExecArray | null;
      while ((match = getUrlCall.exec(source))) {
        const raw = match[1];
        // Skip template-ish or absolute values; only plain relative paths can be
        // manifest resource names.
        if (!raw || raw.includes('://') || !/^[A-Za-z0-9._/-]+$/.test(raw)) {
          continue;
        }
        targets.add(raw.replace(/^\.?\//, ''));
      }
    }
  };
  scan(distDir);
  return targets;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), crx({ manifest }), contentScriptRebundler()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'clsx'],
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        // 只移除 console.log 和 console.debug，保留 console.warn/error 便于诊断
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug'],
      },
      mangle: {
        safari10: true,
      },
    },
    cssCodeSplit: true,
    cssMinify: true,
    rollupOptions: {
      input: {
        popup: 'src/popup.tsx',
        options: 'src/options.tsx',
        background: 'src/background/background.ts',
        content: 'src/content/content.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          // 将React相关库分离到单独的chunk（popup/options 受益于代码分割）
          // react and react-dom must stay in SEPARATE chunks. The content
          // script pulls in `react` transitively (zustand), but never
          // react-dom. Sharing one chunk made the post-build rebundler inline
          // all of react-dom into content.js — roughly 110 KB of DOM
          // renderer the content script never calls.
          'react-vendor': ['react'],
          'react-dom-vendor': ['react-dom', 'react-dom/client'],
          'state-vendor': ['zustand'],
          'utils-vendor': ['clsx'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    hmr: {
      overlay: false,
    },
  },
  define: {
    __DEV__: process.env.NODE_ENV === 'development',
  },
});
