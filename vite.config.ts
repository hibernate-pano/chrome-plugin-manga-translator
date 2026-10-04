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
    },
  };
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
